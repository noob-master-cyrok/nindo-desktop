import { defineConfig } from '@playwright/test';

/// Runs the built app (with its Content-Security-Policy) against a mocked
/// Supabase. Uses the installed Google Chrome; set PW_CHANNEL= to use
/// Playwright's own Chromium instead. WEBKIT=1 also runs the layout audit in
/// WebKit, the engine of Safari and the Dock app (`npx playwright install webkit`).
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1360, height: 860 },
    // The offline service worker would fetch around the mocked Supabase.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chrome', use: { channel: process.env.PW_CHANNEL ?? 'chrome' } },
    ...(process.env.WEBKIT ? [{ name: 'webkit', use: { browserName: 'webkit' as const }, testMatch: /layout\.spec\.ts/ }] : []),
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
