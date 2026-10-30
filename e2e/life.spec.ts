import { expect, test, type Page } from '@playwright/test';
import { MockSupabase } from './mockSupabase';

/// Today, Calendar, Events, Festivals, Search, People, Alarms and the rail,
/// against a mocked Supabase holding what the phone synced. Screenshots land
/// in test-results/life/.

const ORIGIN = 'https://wvqutuvvbnrnjmjokynf.supabase.co';

function iso(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let n = 0;
function item(fields: Record<string, unknown>) {
  n++;
  return {
    id: `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title: 'Item',
    due_date_ad: iso(0),
    date_system: 'AD',
    time_zone_policy: 'floating_local',
    kind: 'reminder',
    notes: null,
    due_time: null,
    urgency: 1,
    category: null,
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
    alert_offsets: '0',
    tithi_key: null,
    tithi_region: null,
    tithi_source: null,
    ringtone: null,
    alert_style: 'notification',
    steps: [],
    created_at_ms: 1_000,
    updated_at_ms: 1_000,
    completed_at_ms: null,
    deleted_at_ms: null,
    ...fields,
  };
}

function seed(server: MockSupabase) {
  n = 0;
  const call = item({ title: 'Call Ama about Tihar', due_time: '18:30', kind: 'reminder', steps: [{ id: 's1', title: 'Ask about the date', done: false }] });
  server.seed('tasks', call);
  server.seed('tasks', item({ title: 'Electricity bill', due_date_ad: iso(-2), kind: 'bill', urgency: 2 }));
  server.seed('tasks', item({ title: 'Passport renewal', due_date_ad: iso(3), kind: 'renewal', urgency: 3 }));
  const bday = iso(5);
  server.seed('tasks', item({ title: "Sita's birthday", due_date_ad: bday, kind: 'birthday', repeat_rule: 'yearAd', anchor_month: Number(bday.slice(5, 7)), anchor_day: Number(bday.slice(8)), series_start: bday }));
  server.seed('tasks', item({ title: 'Yoga class', due_date_ad: iso(1), due_time: '07:00', kind: 'appointment', repeat_rule: 'daily', series_start: iso(1) }));
  server.seed('tasks', item({ title: 'Buy a new kettle', undated: true, kind: 'household' }));
  server.seed('item_notes', { id: 'n1', parent_type: 'task', parent_id: call.id, body: 'She prefers mornings', created_at_ms: 2_000, updated_at_ms: 2_000, deleted_at_ms: null });
  server.seed('planner_tasks', {
    id: 't1', project_id: null, parent_id: null, title: 'Prepare client deck', description: 'Slides for Friday', status: 'doing', priority: 3, labels: '', start_date: null,
    due_date: iso(0), sort_order: 1, estimate_minutes: 90, critical: true, created_at_ms: 1_000, updated_at_ms: 1_000, completed_at_ms: null, deleted_at_ms: null,
  });
}

async function signIn(page: Page, server: MockSupabase) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(server.email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(450); // let entrance motion finish
  await page.screenshot({ path: `test-results/life/${name}.png` });
}

test('every place of the phone app is on the desktop', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewportSize({ width: 1440, height: 960 });
  const server = new MockSupabase(ORIGIN);
  seed(server);
  await server.install(page);
  await signIn(page, server);

  // Today opens first: greeting, attention, today's items, tasks, upcoming.
  const main = page.getByRole('main');
  await expect(main.getByText('Call Ama about Tihar')).toBeVisible();
  await expect(main.getByRole('region', { name: 'Needs attention' }).getByText('Electricity bill')).toBeVisible();
  await expect(main.getByRole('region', { name: 'Needs attention' }).getByText('Passport renewal')).toBeVisible();
  await expect(main.getByRole('region', { name: 'Tasks' }).getByText('Prepare client deck')).toBeVisible();
  await expect(main.getByRole('region', { name: 'Upcoming' }).getByText("Sita's birthday")).toBeVisible();
  await expect(page.locator('.hero-tithi')).toBeVisible();
  await page.mouse.move(700, 900);
  await shot(page, 'today');

  // Open an item: details, steps and its notes log; add a note.
  await main.locator('.item-open', { hasText: 'Call Ama about Tihar' }).first().click();
  const pane = page.getByRole('complementary', { name: 'Item' });
  await expect(pane.getByText('She prefers mornings')).toBeVisible();
  await pane.getByLabel('New note').fill('Booked for Sunday');
  await pane.getByRole('button', { name: 'Add note' }).click();
  await expect(pane.getByText('Booked for Sunday')).toBeVisible();
  await shot(page, 'item');

  // Mark it complete: XP is written and the toast offers Undo.
  await pane.getByRole('button', { name: 'Mark complete' }).click();
  await expect(page.getByText(/done\. \+10 XP/)).toBeVisible();
  expect(server.tables.xp_ledger!.size).toBe(1);
  await page.keyboard.press('Escape');

  // Add a new item from Today.
  await main.getByRole('button', { name: 'Add', exact: true }).click();
  const editor = page.getByRole('complementary', { name: 'Item' });
  await editor.getByLabel('Name').fill('Dentist');
  await editor.getByRole('button', { name: 'Tomorrow' }).click();
  await editor.getByRole('button', { name: '15:00' }).click();
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('Reminder added.')).toBeVisible();
  const added = [...server.tables.tasks!.values()].find((r) => r.title === 'Dentist')!;
  expect(added).toMatchObject({ due_date_ad: iso(1), due_time: '15:00', kind: 'reminder', date_system: 'AD' });
  await page.keyboard.press('Escape');

  // Calendar month: BS first, tithi in cells, the day card.
  await page.getByRole('navigation', { name: 'Nindo' }).getByRole('button', { name: /^Calendar/ }).click();
  await expect(page.locator('.cal-cell.today')).toBeVisible();
  await expect(page.locator('.cell-tithi').first()).toBeVisible();
  await expect(page.getByRole('region', { name: /Day details/ })).toBeVisible();
  await page.mouse.move(700, 900);
  await shot(page, 'calendar-month');
  for (const v of ['Year', 'Week', 'Events'] as const) {
    await page.getByRole('radio', { name: v }).click();
    await page.mouse.move(700, 900);
    await shot(page, `calendar-${v.toLowerCase()}`);
  }
  await page.getByRole('radio', { name: 'Week' }).click();
  await expect(page.locator('.week-chip', { hasText: 'Dentist' })).toBeVisible();
  await page.getByRole('radio', { name: 'Month' }).click();
  // Jump to Baisakh 2084.
  await page.locator('.cal-title-button').click();
  await page.getByRole('radio', { name: 'Bai' }).click();
  await page.getByLabel('Year (BS)').fill('2084');
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.locator('.page-title')).toHaveText('Baisakh 2084');
  await expect(page.getByText(/projected month lengths/)).toBeVisible();

  // Events: the smart tiles.
  await page.getByRole('navigation', { name: 'Nindo' }).getByRole('button', { name: /^Events/ }).click();
  await page.getByRole('tab', { name: /Overdue/ }).click();
  await expect(page.getByText('Electricity bill')).toBeVisible();
  await page.getByRole('tab', { name: /Inbox/ }).click();
  await expect(page.getByText('Buy a new kettle')).toBeVisible();
  await page.getByRole('tab', { name: /Upcoming/ }).click();
  await page.mouse.move(700, 900);
  await shot(page, 'events');

  // Festivals, then one festival's page.
  await page.getByRole('navigation', { name: 'Nindo' }).getByRole('button', { name: /^Festivals/ }).click();
  await expect(page.locator('.festival-row').first()).toBeVisible();
  await page.getByLabel('Find a festival').fill('Dashami');
  await page.locator('.festival-row .item-open').first().click();
  await expect(page.getByRole('complementary', { name: 'Festival' }).getByText(/Tithi/)).toBeVisible();
  await shot(page, 'festival');
  await page.keyboard.press('Escape');

  // Search: items, notes and tasks.
  await page.keyboard.press('/');
  await page.getByRole('searchbox', { name: 'Search' }).fill('mornings');
  await expect(page.getByRole('region', { name: 'Matches' }).getByText('Call Ama about Tihar')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search' }).fill('client deck');
  await expect(page.getByRole('region', { name: 'Matches' }).getByText('Prepare client deck')).toBeVisible();
  await shot(page, 'search');

  // Phone-only places explain themselves.
  await page.getByRole('navigation', { name: 'Nindo' }).getByRole('button', { name: /^People/ }).click();
  await expect(page.getByText(/never uploads them/)).toBeVisible();
  await page.getByRole('navigation', { name: 'Nindo' }).getByRole('button', { name: /^Alarms/ }).click();
  await expect(page.getByText('Alarms ring on your phone')).toBeVisible();
  await page.getByRole('button', { name: '1 min', exact: true }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('timer')).toHaveText(/00:5\d|01:00/);
  await shot(page, 'alarms');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Hide the sidebar: the rail shows every place with a tooltip and the
  // current one marked; a running timer adds a live dot.
  await page.getByRole('navigation', { name: 'Nindo' }).getByRole('button', { name: /^Tasks/ }).click();
  await page.getByRole('button', { name: 'Start timer: Prepare client deck' }).click();
  await page.getByRole('button', { name: 'Hide sidebar' }).click();
  const rail = page.getByRole('navigation', { name: 'Places' });
  for (const name of ['Today', 'Calendar', 'Events', 'Tasks', 'Festivals', 'Search', 'People', 'Alarms & timer', 'Settings']) {
    await expect(rail.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(rail.getByRole('button', { name: 'Tasks', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(rail.locator('.rail-live').first()).toBeVisible();
  await expect(rail.getByRole('button', { name: /Timer running/ })).toBeVisible();
  await rail.getByRole('button', { name: 'Calendar', exact: true }).hover();
  await page.waitForTimeout(600);
  await shot(page, 'rail');
  await rail.getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(rail.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.cal-grid').first()).toBeVisible();
  await expect(page.locator('.running-chip')).toBeVisible();
  await page.mouse.move(700, 900);
  await shot(page, 'rail-calendar');

  expect(errors).toEqual([]);
});

test('dark mode and AD first', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.addInitScript(() => localStorage.setItem('nindo.desktop.settings', JSON.stringify({ calendarFirst: 'AD', name: 'Safu' })));
  const server = new MockSupabase(ORIGIN);
  seed(server);
  await server.install(page);
  await signIn(page, server);
  await expect(page.getByText(/, Safu$/)).toBeVisible();
  await page.mouse.move(700, 900);
  await shot(page, 'today-dark-ad');
  await page.getByRole('navigation', { name: 'Nindo' }).getByRole('button', { name: /^Calendar/ }).click();
  const month = new Date().toLocaleDateString('en-GB', { month: 'long' });
  await expect(page.locator('.page-title')).toContainText(month);
  await page.mouse.move(700, 900);
  await shot(page, 'calendar-dark-ad');
});

test('a narrow window stacks the pages', async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 1000 });
  const server = new MockSupabase(ORIGIN);
  seed(server);
  await server.install(page);
  await signIn(page, server);
  await expect(page.getByRole('main').getByText('Call Ama about Tihar')).toBeVisible();
  await shot(page, 'narrow-today');
  await page.getByRole('navigation', { name: 'Nindo' }).getByRole('button', { name: /^Calendar/ }).click();
  await expect(page.locator('.cal-cell.today')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, 'narrow-calendar');
});
