import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: "http://127.0.0.1:4180",
    browserName: "chromium",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: [
        "--disable-gpu-compositing",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
    viewport: { width: 1280, height: 800 },
    reducedMotion: "reduce",
  },
  webServer: {
    command: "npm run dev -- --port 4180 --strictPort",
    url: "http://127.0.0.1:4180",
    env: {
      VITE_BILIBILI_SEARCH_URL: "/test-bilibili",
      VITE_YOUTUBE_API_KEY: "test-fixture-key",
    },
    reuseExistingServer: false,
  },
});
