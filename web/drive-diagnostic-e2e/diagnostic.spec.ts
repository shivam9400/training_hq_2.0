import { test, expect } from "@playwright/test";
import { syntheticCsv } from "../src/services/activities/fixtures";
const token = "synthetic-token-never-real";
const sdk = `window.google={accounts:{oauth2:{initTokenClient(config){window.__scope=config.scope;window.__incremental=config.include_granted_scopes;return{requestAccessToken(options){window.__prompt=options.prompt;config.callback({access_token:"${token}",expires_in:3600,scope:config.scope});}};}}}};`;
const picker = `window.gapi={load(name,options){window.google.picker={ViewId:{FOLDERS:"folders"},Feature:{MULTISELECT_ENABLED:"multi"},DocsView:class {constructor(kind){this.kind=kind;}setIncludeFolders(){return this;}setSelectFolderEnabled(){return this;}},PickerBuilder:class {setOAuthToken(value){window.__pickerUsesSameToken=value==="${token}";return this;}setDeveloperKey(){return this;}setAppId(){return this;}setOrigin(){return this;}addView(view){this.folder=view.kind==="folders";return this;}setCallback(f){this.callback=f;return this;}enableFeature(){return this;}build(){const f=this.callback,folder=this.folder;return{setVisible(visible){if(visible)setTimeout(()=>f({action:"picked",docs:[{id:folder?"root":"explicit"}]}),0);},dispose(){}};}}};options.callback();}};`;
async function mock(page: import("@playwright/test").Page) {
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({ contentType: "application/javascript", body: sdk }),
  );
  await page.route("https://apis.google.com/js/api.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: picker }),
  );
}
async function connect(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", {
      name: "Load Google Identity test SDK (no authorization)",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Connect Test Google Account", exact: true })
    .click();
  await expect(page.locator("#notice")).not.toHaveText(
    "Running explicitly triggered test…",
    { timeout: 45000 },
  );
  await expect(page.locator("#results")).not.toContainText("FAIL");
  await expect(page.locator("#identity")).toContainText(
    "test-a@example.invalid",
  );
  await page.locator("#synthetic").check();
}
test("mocked GIS/Picker uses only drive.file, distinguishes folder/list/body/future outcomes and clears memory", async ({
  page,
}) => {
  let future = false;
  const requests: { url: string; method: string; auth: string | undefined }[] =
    [];
  const consoleText: string[] = [];
  page.on("console", (message) => consoleText.push(message.text()));
  await mock(page);
  await page.route("https://www.googleapis.com/drive/v3/**", (route) => {
    const request = route.request(),
      u = new URL(request.url());
    requests.push({
      url: u.href,
      method: request.method(),
      auth: request.headers().authorization,
    });
    if (u.pathname.endsWith("about"))
      return route.fulfill({
        json: {
          user: {
            permissionId: "synthetic-a",
            emailAddress: "test-a@example.invalid",
            me: true,
          },
        },
      });
    if (u.pathname.endsWith("files/root"))
      return route.fulfill({
        json: {
          id: "root",
          name: "DO-NOT-LOG-FOLDER",
          mimeType: "application/vnd.google-apps.folder",
        },
      });
    if (u.pathname.endsWith("/files"))
      return route.fulfill({
        json: {
          files: future
            ? [
                {
                  id: "before",
                  name: "DO-NOT-LOG.csv",
                  mimeType: "text/csv",
                  size: String(Buffer.byteLength(syntheticCsv())),
                },
                {
                  id: "new",
                  name: "DO-NOT-LOG-FUTURE.csv",
                  mimeType: "text/csv",
                },
              ]
            : [
                {
                  id: "before",
                  name: "DO-NOT-LOG.csv",
                  mimeType: "text/csv",
                  size: String(Buffer.byteLength(syntheticCsv())),
                },
              ],
        },
      });
    if (u.searchParams.get("alt") === "media")
      return route.fulfill({ contentType: "text/csv", body: syntheticCsv() });
    return route.fulfill({
      json: {
        id: u.pathname.split("/").at(-1),
        name: "DO-NOT-LOG.csv",
        mimeType: "text/csv",
        size: String(Buffer.byteLength(syntheticCsv())),
      },
    });
  });
  await page.goto("/");
  const generated = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Generate synthetic before.fit", exact: true })
    .click();
  expect((await generated).suggestedFilename()).toBe(
    "training-hq-test-before.fit",
  );
  expect(requests).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Test folder metadata only" }),
  ).toBeDisabled();
  await connect(page);
  expect(
    await page.evaluate(() => ({
      scope: (window as unknown as { __scope: string }).__scope,
      incremental: (window as unknown as { __incremental: boolean })
        .__incremental,
      prompt: (window as unknown as { __prompt: string }).__prompt,
    })),
  ).toEqual({
    scope: "https://www.googleapis.com/auth/drive.file",
    incremental: false,
    prompt: "select_account",
  });
  await page
    .getByRole("button", {
      name: "Select synthetic folder through Picker",
      exact: true,
    })
    .click();
  await expect(page.locator("#folder")).toHaveValue(
    "https://drive.google.com/drive/folders/root",
  );
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "Test folder metadata only" }).click();
  await expect(page.locator("#results")).toContainText("Folder metadata GET");
  await page.locator("#existing-direct").fill("before");
  await page
    .getByRole("button", {
      name: "Scan existing nested files — establish baseline",
    })
    .click();
  await expect(page.locator("#scan-summary")).toContainText("1 visible");
  expect(requests.some((r) => r.url.includes("alt=media"))).toBe(false);
  future = true;
  await page.locator("#new-direct").fill("new");
  await page
    .getByRole("button", { name: "Rescan with the previously issued grant" })
    .click();
  await expect(page.locator("#results")).toContainText(
    "Expected new direct discovery",
  );
  await page
    .getByRole("button", { name: "Test synthetic download 1", exact: true })
    .click();
  await expect(page.locator("#results")).toContainText(
    "Synthetic file body GET alt=media",
  );
  await page
    .getByRole("button", {
      name: "Parse and deduplicate downloaded synthetic bytes locally",
    })
    .click();
  await expect(page.locator("#notice")).not.toHaveText(
    "Running explicitly triggered test…",
    { timeout: 45000 },
  );
  expect(consoleText.filter((t) => /worker|Refused|MIME/.test(t))).toEqual([]);
  await expect(page.locator("#results")).not.toContainText("FAIL");
  await expect(page.locator("#parsed")).toContainText("1 conservative unique");
  await page
    .getByRole("button", {
      name: "Select individual synthetic files through Picker",
    })
    .click();
  await expect(page.locator("#contamination")).toContainText(
    "conclusions disabled",
  );
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __pickerUsesSameToken: boolean })
          .__pickerUsesSameToken,
    ),
  ).toBe(true);
  expect(
    requests.every((r) => r.method === "GET" && r.auth === `Bearer ${token}`),
  ).toBe(true);
  expect(requests.every((r) => !r.url.includes(token))).toBe(true);
  expect(await page.locator("body").innerText()).not.toContain(token);
  expect(await page.locator("#results").innerText()).not.toContain(
    "DO-NOT-LOG",
  );
  expect(consoleText.join(" ")).not.toContain(token);
  expect(consoleText.join(" ")).not.toContain("DO-NOT-LOG");
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      caches: !!navigator.serviceWorker.controller,
    })),
  ).toEqual({ local: 0, session: 0, caches: false });
  await page
    .getByRole("button", { name: "Disconnect locally / clear all" })
    .click();
  await expect(page.locator("#identity")).toContainText("not verified");
  await expect(page.locator("#folder")).toHaveValue("");
  await expect(page.locator("#results tr")).toHaveCount(0);
  await expect(page.locator("#files")).toBeEmpty();
});
test("mocked identity switch and 403/401 show actual statuses without fabricated access", async ({
  page,
}) => {
  await mock(page);
  let subject = "a",
    status = 200;
  await page.route("https://www.googleapis.com/drive/v3/**", (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("about"))
      return route.fulfill({
        json: {
          user: {
            permissionId: `synthetic-${subject}`,
            emailAddress:
              subject === "a"
                ? "test-a@example.invalid"
                : "test-b@example.invalid",
          },
        },
      });
    return route.fulfill({
      status,
      json: { error: { message: "DO-NOT-LOG-PRIVATE-ERROR" } },
    });
  });
  await page.goto("/");
  await connect(page);
  await page
    .locator("#folder")
    .fill("https://drive.google.com/drive/folders/root");
  status = 403;
  await page.getByRole("button", { name: "Test folder metadata only" }).click();
  await expect(page.locator("#results")).toContainText("403");
  await expect(page.locator("#results")).not.toContainText(
    "DO-NOT-LOG-PRIVATE-ERROR",
  );
  subject = "b";
  await page
    .getByRole("button", { name: "Connect Test Google Account", exact: true })
    .click();
  await expect(page.locator("#identity")).toContainText(
    "test-b@example.invalid",
  );
  await expect(page.locator("#folder")).toHaveValue("");
  await page.locator("#synthetic").check();
  await page
    .locator("#folder")
    .fill("https://drive.google.com/drive/folders/root");
  status = 401;
  await page.getByRole("button", { name: "Test folder metadata only" }).click();
  await expect(page.locator("#results")).toContainText("401");
  await expect(page.locator("#identity")).toContainText("not verified");
  await expect(page.locator("#folder")).toHaveValue("");
});
test("loopback Host and cross-origin requests are refused", async ({
  request,
}) => {
  expect(
    (await request.get("/", { headers: { Host: "evil.example" } })).status(),
  ).toBe(403);
  expect(
    (
      await request.get("/", { headers: { Origin: "https://evil.example" } })
    ).status(),
  ).toBe(403);
});

test("normal app dev server refuses diagnostic source and built diagnostic paths", async ({
  request,
}) => {
  for (const path of [
    "/drive-diagnostic/",
    "/drive-diagnostic/main.ts",
    "/@fs/any/path/drive-diagnostic/main.ts",
    "/drive-diagnostic-dist/index.html",
    "/drive-hosted-dist/index.html",
    "/drive-hosted-e2e/hosted.spec.ts",
  ])
    expect((await request.get(`http://localhost:5174${path}`)).status()).toBe(
      404,
    );
});
