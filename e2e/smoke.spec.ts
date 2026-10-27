import { expect, test } from '@playwright/test';
import { MockSupabase } from './mockSupabase';

const ORIGIN = 'https://wvqutuvvbnrnjmjokynf.supabase.co';
const TASK_ID = '0b6c3d8e-1f2a-4b5c-8d9e-0f1a2b3c4d5e';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function phoneTask(fields: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    title: 'Pay electricity bill',
    due_date_ad: today(),
    date_system: 'AD',
    time_zone_policy: 'floating_local',
    kind: 'task',
    notes: null,
    due_time: '10:00',
    urgency: 2,
    category: 'Home',
    undated: false,
    repeat_rule: 'none',
    repeat_interval: 1,
    repeat_weekdays: '',
    anchor_month: null,
    anchor_day: null,
    missing_date_policy: 'last',
    series_start: null,
    repeat_until: null,
    repeat_count: null,
    repeat_exceptions: '',
    alert_offsets: '10',
    tithi_key: null,
    tithi_region: null,
    tithi_source: null,
    ringtone: 'temple_bell',
    alert_style: 'alarm',
    steps: [{ id: 'step-1', title: 'Find the bill', done: false }],
    created_at_ms: 1_000,
    updated_at_ms: 1_000,
    completed_at_ms: null,
    deleted_at_ms: null,
    ...fields,
  };
}

test('sign in, create, edit, complete, note, conflict and delete', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  server.seed('tasks', phoneTask());
  server.seed('tasks', phoneTask({ id: '2b6c3d8e-1f2a-4b5c-8d9e-0f1a2b3c4d5e', title: 'Water plants', repeat_rule: 'daily', urgency: 1 }));
  await server.install(page);
  const cspErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) cspErrors.push(m.text());
  });

  // Sign in with an email code.
  await page.goto('/');
  await page.getByLabel('Email').fill(server.email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText(`We sent an email to ${server.email}`)).toBeVisible();
  await page.getByLabel('Code').fill('000000');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('That code did not work');
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Signed in account')).toContainText(server.email);

  // Today's list shows phone tasks.
  await expect(page.getByRole('button', { name: /Pay electricity bill/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/list.png', fullPage: true });

  // Create.
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Renew passport');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('status')).toContainText(/Task added|Saved/);
  await expect(page.getByRole('button', { name: /Renew passport/ })).toBeVisible();
  const created = [...server.tables.tasks!.values()].find((r) => r.title === 'Renew passport')!;
  expect(created).toMatchObject({ owner_id: server.userId, time_zone_policy: 'floating_local', kind: 'task' });

  // Edit keeps fields the desktop does not show.
  await page.getByRole('button', { name: /Pay electricity bill/ }).click();
  await page.getByLabel('Title', { exact: true }).fill('Pay electricity bill today');
  await page.getByLabel('New step').fill('Pay online');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  const edited = server.tables.tasks!.get(TASK_ID)!;
  expect(edited).toMatchObject({ title: 'Pay electricity bill today', ringtone: 'temple_bell', alert_style: 'alarm' });
  expect((edited.steps as { id: string }[]).map((s) => s.id)[0]).toBe('step-1');
  await page.screenshot({ path: 'test-results/editor.png', fullPage: true });

  // Conflict: the phone saves while the desktop has unsaved changes.
  server.phoneWrite('tasks', TASK_ID, { title: 'Phone title', updated_at_ms: Date.now() - 5_000 });
  await page.getByLabel('Category').fill('Bills');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog', { name: 'This changed on another device' })).toBeVisible();
  await page.screenshot({ path: 'test-results/conflict.png' });
  expect(server.tables.tasks!.get(TASK_ID)!.category).toBe('Home');
  await page.getByRole('button', { name: 'Use my changes' }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  expect(server.tables.tasks!.get(TASK_ID)).toMatchObject({ title: 'Phone title', category: 'Bills' });

  // Notes.
  await page.getByLabel('New note').fill('Account no. 1234');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.locator('.note-body')).toHaveText('Account no. 1234');
  expect([...server.tables.item_notes!.values()][0]).toMatchObject({ parent_type: 'task', parent_id: TASK_ID });

  // Complete.
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Marked complete.');
  expect(server.tables.tasks!.get(TASK_ID)!.completed_at_ms).not.toBeNull();

  // Repeating tasks cannot be completed here.
  await page.getByRole('button', { name: /Water plants/ }).click();
  await expect(page.getByRole('button', { name: 'Complete', exact: true })).toBeDisabled();

  // Delete (soft).
  await page.getByRole('button', { name: /Renew passport/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: /Renew passport/ })).toHaveCount(0);
  expect(created.id && server.tables.tasks!.get(created.id as string)!.deleted_at_ms).not.toBeNull();

  expect(cspErrors).toEqual([]);
});

test('an emailed sign-in link signs in and is cleared from the address bar', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  server.seed('tasks', phoneTask());
  await server.install(page);
  const s = server.session();
  await page.goto(
    `/#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&expires_at=${s.expires_at}&token_type=bearer&type=magiclink`,
  );
  await expect(page.getByLabel('Signed in account')).toContainText(server.email);
  await expect(page.getByRole('button', { name: /Pay electricity bill/ })).toBeVisible();
  expect(page.url()).not.toContain('access_token');
});

test('an expired sign-in link explains what to do', async ({ page }) => {
  await new MockSupabase(ORIGIN).install(page);
  await page.goto('/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  await expect(page.getByRole('alert')).toContainText('expired or was already used');
});
