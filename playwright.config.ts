import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  use: { baseURL: "http://127.0.0.1:4178", trace: "retain-on-failure", launchOptions: { executablePath: "/run/current-system/sw/bin/chromium" } },
  webServer: { command: "bun run fixture", url: "http://127.0.0.1:4178", reuseExistingServer: true, timeout: 30_000 },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } } },
    { name: "pixel-7a", use: { ...devices["Pixel 5"], viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36" } },
  ],
});
