import { defineConfig } from '@playwright/test';

/// Runs the built app (with its Content-Security-Policy) against a mocked
/// Supabase. Uses the installed Google Chrome; set PW_CHANNEL= to use
/// Playwright's own Chromium instead.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    channel: process.env.PW_CHANNEL ?? 'chrome',
    viewport: { width: 1360, height: 860 },
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
