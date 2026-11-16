import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./drive-codespace-e2e",
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
  webServer: {
    command: "npm run dev:drive-codespace",
    url: "http://127.0.0.1:5173/",
    reuseExistingServer: false,
    env: {
      CODESPACES: "true",
      CODESPACE_NAME: "synthetic-proxy-test",
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
    },
  },
});
