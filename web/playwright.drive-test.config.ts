import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./drive-diagnostic-e2e",
  fullyParallel: false,
  timeout: 60000,
  use: {
    baseURL: "http://localhost:5173",
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
  webServer: [
    {
      command: "npm run dev:drive-test",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      env: {
        VITE_GOOGLE_DRIVE_TEST_CLIENT_ID:
          "synthetic-test-client.apps.googleusercontent.com",
        VITE_GOOGLE_DRIVE_TEST_PICKER_API_KEY: "synthetic-picker-key",
        VITE_GOOGLE_DRIVE_TEST_APP_ID: "123456789",
      },
    },
    {
      command: "npm run dev -- --host localhost --port 5174 --strictPort",
      url: "http://localhost:5174/training_hq_2.0/",
      reuseExistingServer: false,
    },
  ],
});
