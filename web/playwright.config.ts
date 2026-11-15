import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4173/training_hq_2.0/",
    viewport: { width: 390, height: 844 },
  },
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
  webServer: {
    command: "npm run preview -- --host 127.0.0.1",
    url: "http://127.0.0.1:4173/training_hq_2.0/",
    reuseExistingServer: false,
  },
});
