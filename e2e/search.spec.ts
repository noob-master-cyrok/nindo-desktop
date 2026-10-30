import { expect, test, type Page } from '@playwright/test';
import { MockSupabase } from './mockSupabase';

/// The phone's search on the desktop: one search over items (with their
/// notes, steps and category), planner tasks (with sub-tasks and labels) and
/// the city calendar's festivals (both names, their notes). ⌘K / Ctrl+K
/// opens it from anywhere. Screenshots land in test-results/search/.

const ORIGIN = 'https://wvqutuvvbnrnjmjokynf.supabase.co';
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

function iso(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let n = 0;
function item(fields: Record<string, unknown>) {
  n++;
  return {
    id: `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title: 'Item', due_date_ad: iso(0), date_system: 'AD', time_zone_policy: 'floating_local', kind: 'reminder', notes: null, due_time: null, urgency: 1,
    category: null, undated: false, repeat_rule: 'none', repeat_interval: 1, repeat_weekdays: '', anchor_month: null, anchor_day: null, missing_date_policy: 'last',
    series_start: null, repeat_until: null, repeat_count: null, repeat_exceptions: '', alert_offsets: '0', tithi_key: null, tithi_region: null, tithi_source: null,
    ringtone: null, alert_style: 'notification', steps: [], created_at_ms: 1_000, updated_at_ms: 1_000, completed_at_ms: null, deleted_at_ms: null,
    ...fields,
  };
}

const task = (fields: Record<string, unknown>) => ({
  id: 't', project_id: null, parent_id: null, title: 'Task', description: '', status: 'todo', priority: 0, labels: '', start_date: null, due_date: null,
  sort_order: 0, estimate_minutes: null, critical: false, created_at_ms: 1_000, updated_at_ms: 1_000, completed_at_ms: null, deleted_at_ms: null, ...fields,
});

function seed(server: MockSupabase) {
  n = 0;
  const oil = item({ title: 'Change motor oil', due_date_ad: iso(3), kind: 'household', due_time: '09:30' });
  server.seed('tasks', oil);
  const bike = item({ title: 'Bike service', due_date_ad: iso(2), notes: 'Ask them to top up the motor oil and check the chain', category: 'personal' });
  server.seed('tasks', bike);
  server.seed('tasks', item({ title: 'Buy cooking oil', due_date_ad: iso(1), kind: 'household' }));
  server.seed('tasks', item({ title: 'Old motor oil receipt', due_date_ad: iso(-10), completed_at_ms: 5_000 }));
  server.seed('tasks', item({ title: 'Dentist', due_date_ad: iso(4), kind: 'appointment', steps: [{ id: 's1', title: 'Bring the x-ray', done: false }], category: 'health' }));
  server.seed('item_notes', { id: 'n1', parent_type: 'task', parent_id: bike.id, body: 'Garage on Ring Road closes at five', created_at_ms: 2_000, updated_at_ms: 2_000, deleted_at_ms: null });
  server.seed('item_notes', { id: 'n2', parent_type: 'festival', parent_id: 'kmc-2083-07-22', body: 'Buy marigolds and diyo for the door', created_at_ms: 2_000, updated_at_ms: 2_000, deleted_at_ms: null });
  server.seed('planner_tasks', task({ id: 'p1', title: 'Prepare client deck', description: 'Slides for Friday', labels: 'client,slides', status: 'doing', due_date: iso(0) }));
  server.seed('planner_tasks', task({ id: 'p2', parent_id: 'p1', title: 'Collect the sales numbers' }));
}

async function signIn(page: Page, server: MockSupabase) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(server.email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Nindo' })).toBeVisible();
}

test('search finds everything the phone search finds, in its order', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 860 });
  const server = new MockSupabase(ORIGIN);
  seed(server);
  await server.install(page);
  await signIn(page, server);

  // ⌘K / Ctrl+K from anywhere, even while typing in another field.
  await page.getByRole('navigation', { name: 'Nindo' }).getByRole('button', { name: /^Tasks/ }).click();
  await page.getByRole('textbox', { name: 'Search tasks' }).or(page.getByRole('searchbox', { name: 'Search tasks' })).click();
  await page.keyboard.press(`${mod}+k`);
  const box = page.getByRole('searchbox', { name: 'Search', exact: true });
  await expect(box).toBeFocused();
  await expect(page.getByText(/People, alarms and Google events are searched on your phone/)).toBeVisible();

  // Whole phrase first: the title hit, then the description hit; then
  // partial matches, more words first; finished things last.
  await box.fill('motor oil');
  const matches = page.getByRole('region', { name: 'Matches', exact: true });
  const partial = page.getByRole('region', { name: 'Partial matches' });
  await expect(matches.locator('.search-hit')).toHaveCount(3);
  await expect(matches.locator('.search-hit').nth(0)).toContainText('Change motor oil');
  await expect(matches.locator('.search-hit').nth(0)).toContainText('Household');
  await expect(matches.locator('.search-hit').nth(0)).toContainText('09:30');
  await expect(matches.locator('.search-hit').nth(1)).toContainText('Old motor oil receipt');
  await expect(matches.locator('.search-hit').nth(2)).toContainText('Bike service');
  await expect(matches.locator('.search-hit').nth(2)).toContainText('Description: Ask them to top up the motor oil');
  await expect(matches.locator('mark').first()).toHaveText('motor');
  await expect(partial.locator('.search-hit')).toHaveCount(1);
  await expect(partial).toContainText('Buy cooking oil');
  await page.screenshot({ path: 'test-results/search/phrase.png' });

  // Notes, steps, categories, labels, sub-tasks and festivals in both languages.
  const first = () => page.locator('.search-hit').first();
  for (const [q, title, line] of [
    ['ring road', 'Bike service', 'Note: Garage on Ring Road'],
    ['x-ray', 'Dentist', 'Step: Bring the x-ray'],
    ['health', 'Dentist', 'Category: Health'],
    ['slides', 'Prepare client deck', 'Description: Slides for Friday'],
    ['sales numbers', 'Prepare client deck', 'Step: Collect the sales numbers'],
    ['लक्ष्मी', 'Kukur Tihar/ Laxmi Puja', 'Also: कुकुर तिहार / लक्ष्मी पूजा'],
    ['marigolds', 'Kukur Tihar/ Laxmi Puja', 'Note: Buy marigolds'],
  ] as const) {
    await box.fill(q);
    await expect(first(), q).toContainText(title);
    await expect(first(), q).toContainText(line);
  }
  await box.fill('zzz nothing');
  await expect(page.getByText('Nothing matches “zzz nothing”')).toBeVisible();

  // Opening: a festival opens its page, an item its editor, a task its panel.
  await box.fill('laxmi puja');
  await first().click();
  await expect(page.getByRole('complementary', { name: 'Festival' })).toBeVisible();
  await page.keyboard.press('Escape');
  await box.fill('dentist');
  // Down moves into the results, Enter opens.
  await box.press('ArrowDown');
  await expect(first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Item' }).getByLabel('Name')).toHaveValue('Dentist');
  await page.screenshot({ path: 'test-results/search/open-item.png' });
  await page.keyboard.press('Escape');
  await box.fill('client deck');
  await box.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Nindo' }).getByRole('button', { name: /^Tasks/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('complementary').getByText('Prepare client deck').first()).toBeVisible();

  // ⌘K again brings the last search back, selected for a new one.
  await page.keyboard.press(`${mod}+k`);
  await expect(box).toHaveValue('client deck');
  await expect.poll(() => box.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe('client deck'.length);
  expect(errors).toEqual([]);
});
