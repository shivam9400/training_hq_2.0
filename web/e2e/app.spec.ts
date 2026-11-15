import { test, expect } from "@playwright/test";
test("mobile demo: edit multiple sessions, statuses, recovery and all screens", async ({
  page,
}) => {
  await page.goto("");
  await expect(page.getByText("Synthetic demo ·")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByRole("button", { name: "Add session", exact: true }).click();
  await page
    .getByLabel("Session name", { exact: true })
    .fill("Synthetic yoga session");
  await page
    .getByRole("combobox", { name: "Type", exact: true })
    .selectOption("Yoga");
  await page.getByLabel("Planned minutes").fill("15");
  await page
    .getByLabel("Workout instructions")
    .fill("Synthetic mobility fixture");
  await page.getByRole("button", { name: "Save session" }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic yoga session" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Partial", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: "Partial", exact: true }).last(),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Edit Synthetic yoga session" })
    .click();
  await page
    .getByLabel("Session name", { exact: true })
    .fill("Edited synthetic yoga");
  await page.getByRole("button", { name: "Save session" }).click();
  await expect(
    page.getByRole("heading", { name: "Edited synthetic yoga" }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "Progress", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Training consistency" }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "Activities", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sample easy walk" }),
  ).toBeVisible();
  await expect(page.getByText("12:00 /km", { exact: false })).toBeVisible();
  await nav.getByRole("button", { name: "Health", exact: true }).click();
  await page.getByLabel("Sleep (hours)", { exact: true }).fill("5");
  await page.getByLabel("Soreness (1–5)", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Save check-in" }).click();
  await nav.getByRole("button", { name: "Today", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Recovery day" }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeDisabled();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export mock records" }).click();
  await download;
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("static-only service worker supports offline shell without health response caching", async ({
  page,
  context,
}) => {
  await page.goto("");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  await context.route("**/private-health.json", (route) =>
    route.fulfill({ json: { syntheticPrivateFixture: true } }),
  );
  const privateResponse = await page.evaluate(async () =>
    (await fetch("/training_hq_2.0/private-health.json")).json(),
  );
  expect(privateResponse.syntheticPrivateFixture).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText("Offline · Static app resources remain available.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Synthetic demo ·", { exact: false }),
  ).toBeVisible();
  const keys = await page.evaluate(async () => {
    const result: string[] = [];
    for (const name of await caches.keys())
      for (const req of await (await caches.open(name)).keys())
        result.push(req.url);
    return result;
  });
  expect(keys.length).toBeGreaterThan(0);
  expect(
    keys.every(
      (key) =>
        key.startsWith("http://127.0.0.1:4173/training_hq_2.0/") &&
        new URL(key).origin === "http://127.0.0.1:4173" &&
        !key.includes("googleapis") &&
        !key.includes("private-health"),
    ),
  ).toBe(true);
});
