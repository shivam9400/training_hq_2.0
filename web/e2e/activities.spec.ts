import { test, expect } from "@playwright/test";
import {
  syntheticFit,
  syntheticTcx,
  syntheticCsv,
  syntheticZip,
  wire,
} from "../src/services/activities/fixtures";

test("mobile local ZIP preview merges companions and keeps validated/source distances distinct", async ({
  page,
}) => {
  const archive = await syntheticZip([
    { name: "Health Sync/nested/walk.fit", bytes: syntheticFit() },
    { name: "Health Sync/nested/walk.tcx", bytes: wire(syntheticTcx()) },
    { name: "Health Sync/activities.csv", bytes: wire(syntheticCsv()) },
    { name: "Health Sync/readme.txt", bytes: wire("Synthetic metadata") },
  ]);
  await page.goto("");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Activities", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import Activities", exact: true })
    .click();
  const choose = async () => {
    await page.getByLabel("Health Sync files", { exact: true }).setInputFiles({
      name: "synthetic.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(archive),
    });
    await page
      .getByRole("button", { name: "Preview local activities" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Activity import preview",
        exact: true,
      }),
    ).toBeVisible();
  };
  await choose();
  await expect(
    page.getByText("3 supported files inspected", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("1 addition · 0 enrichment", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Effective: 4.26 km", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Reported: 8.32 km · GPS: 4.26 km", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Continue to activity confirmation" })
    .click();
  await page.getByLabel("I reviewed duplicates", { exact: false }).check();
  await expect(
    page.getByRole("button", { name: "Confirm activities to my account" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Back to activity review" }).click();
  await choose();
  await expect(
    page.getByText("1 addition · 0 enrichment", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Cancel and clear activities" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Activity import preview", exact: true }),
  ).not.toBeVisible();
});

test("mobile rejects unsafe XML and reports continuous HR separately without persistence", async ({
  page,
}) => {
  await page.goto("");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Activities", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import Activities", exact: true })
    .click();
  await page.getByLabel("Health Sync files", { exact: true }).setInputFiles([
    {
      name: "synthetic.tcx",
      mimeType: "application/xml",
      buffer: Buffer.from(
        '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><x>&x;</x>',
      ),
    },
    {
      name: "synthetic-hr.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Date,Heart rate\n2028-02-07T07:00:00Z,120"),
    },
  ]);
  await page.getByRole("button", { name: "Preview local activities" }).click();
  await expect(
    page.getByRole("heading", { name: "File notices" }),
  ).toBeVisible();
  await expect(
    page.getByText("No supported complete workouts found.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("continuous", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue to activity confirmation" }),
  ).toBeDisabled();
});

test("mobile explicit matching preserves status and supports manual unmatch", async ({
  page,
}) => {
  await page.goto("");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Plan", exact: true }).click();
  for (const title of ["Synthetic walk slot one", "Synthetic walk slot two"]) {
    await page
      .getByRole("button", { name: "Add session", exact: true })
      .click();
    await page.getByLabel("Session name", { exact: true }).fill(title);
    await page
      .getByRole("combobox", { name: "Type", exact: true })
      .selectOption("Walk");
    await page.getByLabel("Planned minutes").fill("30");
    await page.getByRole("button", { name: "Save session" }).click();
  }
  await nav.getByRole("button", { name: "Activities", exact: true }).click();
  await page
    .getByText("Match planned session · not matched", { exact: true })
    .click();
  await expect(
    page.getByText("2 possible candidates; none is chosen automatically.", {
      exact: false,
    }),
  ).toBeVisible();
  const select = page.getByLabel("Planned session for Sample easy walk");
  expect(await select.inputValue()).toBe("");
  const option = select
    .getByRole("option")
    .filter({ hasText: "Synthetic walk slot two" });
  await select.selectOption((await option.getAttribute("value")) ?? "");
  await page
    .getByLabel("I confirm this workout belongs", { exact: false })
    .check();
  await page.getByRole("button", { name: "Confirm workout match" }).click();
  await nav.getByRole("button", { name: "Today", exact: true }).click();
  const card = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Synthetic walk slot two",
      exact: true,
    }),
  });
  await expect(
    card.getByText("Confirmed actual:", { exact: false }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Planned", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await nav.getByRole("button", { name: "Progress", exact: true }).click();
  await expect(
    page.getByText("1 confirmed session matches", { exact: false }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "Activities", exact: true }).click();
  await page
    .getByText("Match planned session · Synthetic walk slot two", {
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Confirm unmatch" }).click();
  await nav.getByRole("button", { name: "Progress", exact: true }).click();
  await expect(
    page.getByText("0 confirmed session matches", { exact: false }),
  ).toBeVisible();
});
