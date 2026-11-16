import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { syntheticCsv } from "../src/services/activities/fixtures";
const site = "https://synthetic-test-owner.github.io/training-hq-drive-test/";
const token = "synthetic-hosted-token-not-real";
const sdk = `window.google={accounts:{oauth2:{initTokenClient(c){window.__scope=c.scope;return{requestAccessToken(){c.callback({access_token:"${token}",expires_in:3600,scope:c.scope});}};}}}};`;
const picker = `window.gapi={load(n,o){window.google.picker={ViewId:{FOLDERS:"folder"},Feature:{MULTISELECT_ENABLED:"multi"},DocsView:class{constructor(kind){this.kind=kind}setIncludeFolders(){return this}setSelectFolderEnabled(){return this}},PickerBuilder:class{setOAuthToken(t){window.__pickerTokenMatches=t==="${token}";return this}setDeveloperKey(){return this}setAppId(){return this}setOrigin(origin){window.__pickerOrigin=origin;return this}addView(v){this.folder=v.kind==="folder";return this}setCallback(f){this.f=f;return this}enableFeature(){return this}build(){const f=this.f,folder=this.folder;return{setVisible(show){if(show)setTimeout(()=>f({action:"picked",docs:[{id:folder?"synthetic-root":"synthetic-explicit"}]}),0)},dispose(){}}}}};o.callback()}};`;
async function assets(page: Page) {
  await page.route("https://**.github.io/**", async (route) => {
    const url = new URL(route.request().url());
    const relative = url.pathname.split("/training-hq-drive-test/")[1] ?? "";
    let name = relative || "index.html";
    if (
      url.hostname !== "synthetic-test-owner.github.io" &&
      !relative.startsWith("assets/")
    )
      name = "index.html";
    const root = resolve("drive-hosted-dist"),
      file = resolve(root, name);
    if (!file.startsWith(`${root}/`)) {
      await route.fulfill({ status: 404, body: "No route" });
      return;
    }
    try {
      const body = await readFile(file);
      await route.fulfill({
        body,
        contentType:
          extname(file) === ".js"
            ? "application/javascript"
            : extname(file) === ".css"
              ? "text/css"
              : "text/html",
      });
    } catch {
      await route.fulfill({ status: 404, body: "No route" });
    }
  });
}
async function google(page: Page, who = () => "a", status = () => 200) {
  const calls: { url: string; method: string }[] = [];
  await page.route("https://accounts.google.com/gsi/client", (r) =>
    r.fulfill({ contentType: "application/javascript", body: sdk }),
  );
  await page.route("https://apis.google.com/js/api.js", (r) =>
    r.fulfill({ contentType: "application/javascript", body: picker }),
  );
  await page.route("https://www.googleapis.com/drive/v3/**", (r) => {
    const req = r.request(),
      u = new URL(req.url());
    calls.push({ url: u.href, method: req.method() });
    if (status() !== 200)
      return r.fulfill({
        status: status(),
        json: { error: { message: "private-error-do-not-show" } },
      });
    if (u.pathname.endsWith("about"))
      return r.fulfill({
        json: {
          user: {
            permissionId: `synthetic-${who()}`,
            emailAddress: `${who()}@example.invalid`,
          },
        },
      });
    if (u.pathname.endsWith("files/synthetic-root"))
      return r.fulfill({
        json: {
          id: "synthetic-root",
          name: "private-folder",
          mimeType: "application/vnd.google-apps.folder",
        },
      });
    if (u.pathname.endsWith("files"))
      return r.fulfill({
        json: {
          files: [
            {
              id: "synthetic-file",
              name: "private-name.csv",
              mimeType: "text/csv",
              size: String(Buffer.byteLength(syntheticCsv())),
            },
          ],
        },
      });
    if (u.searchParams.get("alt") === "media")
      return r.fulfill({ body: syntheticCsv(), contentType: "text/csv" });
    return r.fulfill({
      json: {
        id: u.pathname.split("/").at(-1),
        name: "private-name.csv",
        mimeType: "text/csv",
        size: String(Buffer.byteLength(syntheticCsv())),
      },
    });
  });
  return calls;
}
async function configure(page: Page) {
  await page
    .getByLabel("Replacement test OAuth Web Client ID")
    .fill("synthetic-hosted.apps.googleusercontent.com");
  await page
    .getByLabel("Public Picker browser API key (not a Client Secret)")
    .fill("synthetic-public-picker-key");
  await page.getByLabel("Numeric test project number").fill("123456");
  await page
    .getByRole("button", { name: "Apply test settings in memory" })
    .click();
}
async function connect(page: Page) {
  await page
    .getByRole("button", {
      name: "Load Google Identity test SDK (no authorization)",
    })
    .click();
  await page
    .getByRole("button", { name: "Connect Test Google Account", exact: true })
    .click();
  await expect(page.locator("#identity")).toContainText("a@example.invalid");
}
test("hosted build requests nothing until user configuration and explicit OAuth; routing, Picker and download use the approved origin", async ({
  page,
}) => {
  await assets(page);
  const all: string[] = [];
  page.on("request", (r) => all.push(r.url()));
  const calls = await google(page);
  await page.goto(site);
  await expect(
    page.getByRole("button", {
      name: "Connect Test Google Account",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Load Google Identity test SDK (no authorization)",
    }),
  ).toBeDisabled();
  expect(
    all.filter((u) => u.includes("google.com") || u.includes("googleapis.com")),
  ).toEqual([]);
  await configure(page);
  expect(calls).toEqual([]);
  await connect(page);
  expect(
    await page.evaluate(
      () => (window as unknown as { __scope: string }).__scope,
    ),
  ).toBe("https://www.googleapis.com/auth/drive.file");
  await page.locator("#synthetic").check();
  await page
    .getByRole("button", {
      name: "Select synthetic folder through Picker",
      exact: true,
    })
    .click();
  await expect(page.locator("#folder")).toHaveValue(
    "https://drive.google.com/drive/folders/synthetic-root",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { __pickerOrigin: string }).__pickerOrigin,
    ),
  ).toBe(new URL(site).origin);
  await page.getByRole("button", { name: "Test folder metadata only" }).click();
  await page.locator("#existing-direct").fill("synthetic-file");
  await page
    .getByRole("button", {
      name: "Scan existing nested files — establish baseline",
    })
    .click();
  await expect(page.locator("#scan-summary")).toContainText("1 visible");
  expect(calls.some((c) => c.url.includes("alt=media"))).toBe(false);
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
  await expect(page.locator("#parsed")).toContainText("1 conservative unique", {
    timeout: 45000,
  });
  expect(calls.every((c) => c.method === "GET" && !c.url.includes(token))).toBe(
    true,
  );
  expect(await page.locator("body").innerText()).not.toContain(token);
  expect(await page.locator("#results").innerText()).not.toContain(
    "private-name",
  );
  expect(all.some((u) => /firebase|firestore/.test(u))).toBe(false);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      worker: !!navigator.serviceWorker.controller,
    })),
  ).toEqual({ local: 0, session: 0, worker: false });
  await page
    .getByRole("button", { name: "Disconnect locally / clear all" })
    .click();
  await expect(page.locator("#identity")).toContainText("not verified");
  await expect(page.locator("#settings-state")).toContainText("missing");
  await expect(page.locator("#results tr")).toHaveCount(0);
});
test("hosted account switching, expiry and callback denial clear memory without Firebase", async ({
  page,
}) => {
  await assets(page);
  let who = "a",
    status = 200;
  await google(
    page,
    () => who,
    () => status,
  );
  await page.goto(site);
  await configure(page);
  await connect(page);
  who = "b";
  await page
    .getByRole("button", { name: "Connect Test Google Account", exact: true })
    .click();
  await expect(page.locator("#identity")).toContainText("b@example.invalid");
  await expect(page.locator("#folder")).toHaveValue("");
  await page
    .getByRole("button", { name: "Simulate local expiry (not revocation)" })
    .click();
  await expect(page.locator("#identity")).toContainText("not verified");
  await page
    .getByRole("button", { name: "Connect Test Google Account", exact: true })
    .click();
  await expect(page.locator("#identity")).toContainText("b@example.invalid");
  status = 401;
  await page
    .getByRole("button", { name: "Probe current Drive identity" })
    .click();
  await expect(page.locator("#results")).toContainText("401");
  await expect(page.locator("#identity")).toContainText("not verified");
});
test("wrong origin and wrong path cannot start the hosted diagnostic", async ({
  page,
}) => {
  await assets(page);
  await page.goto("https://shivam9400.github.io/training_hq_2.0/");
  await expect(page.locator("body")).toContainText("Diagnostic blocked");
  await expect(page.locator("#connect")).toHaveCount(0);
  await page.goto(site + "index.html?access_token=synthetic");
  await expect(page.locator("body")).toContainText("Diagnostic blocked");
  await page.goto(site + "index.html");
  await expect(page.locator("#settings-state")).toContainText("missing");
});
