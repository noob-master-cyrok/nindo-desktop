import { expect, test } from '@playwright/test';
import { MockSupabase } from './mockSupabase';

const ORIGIN = 'https://wvqutuvvbnrnjmjokynf.supabase.co';

/// Claude's "connect" lands on the desktop site with an authorization_id;
/// after signing in, the person allows or denies it and goes back to Claude.
test('allowing Claude to read Nindo', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  await server.install(page);
  let decided: unknown = null;
  await page.route(`${ORIGIN}/auth/v1/oauth/authorizations/**`, async (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.method() === 'GET')
      return route.fulfill({
        headers: cors,
        json: { authorization_id: 'auth-1', redirect_uri: 'https://claude.ai/api/mcp/auth_callback', client: { id: 'c1', name: 'Claude', uri: '', logo_uri: '' }, user: { id: server.userId, email: server.email }, scope: 'email' },
      });
    decided = req.postDataJSON();
    return route.fulfill({ headers: cors, json: { redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=abc&state=s' } });
  });
  await page.route('https://claude.ai/**', (route) => route.fulfill({ body: 'back in Claude' }));

  await page.goto('/?authorization_id=auth-1');
  await page.getByLabel('Email', { exact: true }).fill(server.email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Allow Claude to read your Nindo?' })).toBeVisible();
  await expect(page.getByText('It cannot change anything.')).toBeVisible();
  await page.screenshot({ path: 'test-results/day-summary/connect.png' });
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page).toHaveURL(/claude\.ai\/api\/mcp\/auth_callback\?code=abc/);
  expect(decided).toMatchObject({ action: 'approve' });
});
