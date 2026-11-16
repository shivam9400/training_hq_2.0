import { test, expect } from "@playwright/test";
test("mobile folder settings validate locally without pretending Drive authorization or sync", async ({
  page,
}) => {
  const driveRequests: string[] = [];
  page.on("request", (req) => {
    if (
      /drive\.google\.com|googleapis\.com|accounts\.google\.com|apis\.google\.com/.test(
        req.url(),
      )
    )
      driveRequests.push(req.url());
  });
  await page.goto("");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Health Sync Integration", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Health Sync Google Drive folder URL")
    .fill(
      "https://drive.google.com/drive/folders/synthetic-folder-reference-0001?usp=drive_link",
    );
  await page
    .getByRole("button", { name: "Validate folder URL locally" })
    .click();
  await expect(
    page.getByText("Folder existence and access are unverified.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save folder reference to my account" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Connect Google Drive — verification pending",
    }),
  ).toBeDisabled();
  await page
    .getByLabel("Health Sync Google Drive folder URL")
    .fill("https://drive.google.com/file/d/synthetic-file/view");
  await page
    .getByRole("button", { name: "Validate folder URL locally" })
    .click();
  await expect(
    page.getByText("Invalid folder URL.", { exact: false }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "Activities", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sync Activities — unavailable" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Import Activities", exact: true }),
  ).toBeEnabled();
  expect(driveRequests).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await nav.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByLabel("Health Sync Google Drive folder URL"),
  ).toHaveValue("");
});
