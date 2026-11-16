import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./drive-hosted-e2e",
  fullyParallel: false,
  timeout: 60000,
  use: { viewport: { width: 390, height: 844 } },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: process.env.CI
          ? {}
          : { executablePath: "/usr/bin/chromium", args: ["--no-sandbox"] },
      },
    },
  ],
});
