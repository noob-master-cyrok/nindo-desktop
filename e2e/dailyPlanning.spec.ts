import { expect, test, type Page } from '@playwright/test';
import { MockSupabase } from './mockSupabase';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('nindo.test.section')) return;
    localStorage.setItem('nindo.desktop.section', 'tasks');
    sessionStorage.setItem('nindo.test.section', '1');
  });
});

const ORIGIN = 'https://wvqutuvvbnrnjmjokynf.supabase.co';

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/// Today's Daily planning task; [startedAt] seeds it as in progress since then.
function seed(server: MockSupabase, today: Date, startedAt?: number) {
  const id = `daily-planning-${iso(today)}`;
  server.seed('planner_tasks', {
    id, project_id: null, parent_id: null, title: 'Daily planning', description: '', status: startedAt ? 'doing' : 'todo',
    priority: 4, labels: '', start_date: iso(today), due_date: iso(today), sort_order: 0, estimate_minutes: null, critical: false,
    created_at_ms: 1_000, updated_at_ms: 1_000, completed_at_ms: null, deleted_at_ms: null,
  });
  server.seed('planner_tasks', {
    id: 't1', project_id: null, parent_id: null, title: 'Prepare client deck', description: '', status: 'todo',
    priority: 0, labels: '', start_date: null, due_date: null, sort_order: 1, estimate_minutes: null, critical: false,
    created_at_ms: 1_000, updated_at_ms: 1_000, completed_at_ms: null, deleted_at_ms: null,
  });
  if (startedAt) {
    server.seed('planner_activity', { id: 'act-start', task_id: id, kind: 'status', body: 'doing', created_at_ms: startedAt, updated_at_ms: startedAt, deleted_at_ms: null });
  }
  return id;
}

async function signIn(page: Page, server: MockSupabase) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(server.email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Prepare client deck').first()).toBeVisible();
}

const sessions = (server: MockSupabase, id: string) =>
  [...server.tables.planner_sessions!.values()].filter((r) => r.task_id === id && r.deleted_at_ms == null).map((r) => r.minutes);

test('Start runs the Daily planning timer and Finish logs the time spent', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  const now = new Date();
  const id = seed(server, now);
  await server.install(page);
  await page.clock.install();
  await signIn(page, server);

  const card = page.getByRole('region', { name: 'Daily planning' });
  await card.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('status', { name: 'Running timers' })).toBeVisible();
  await page.clock.fastForward('12:10');
  await card.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Finish' }).click();

  await expect.poll(() => sessions(server, id)).toEqual([12]);
  await expect.poll(() => server.tables.planner_tasks!.get(id)?.status).toBe('done');
  await expect(card).toContainText('12 min logged');
});

test('Finish logs the time since it started when no timer ran on this computer', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  const now = new Date();
  const id = seed(server, now, now.getTime() - 20 * 60_000);
  await server.install(page);
  await page.clock.install();
  await signIn(page, server);

  const card = page.getByRole('region', { name: 'Daily planning' });
  await card.getByRole('button', { name: 'Finish' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('No timer ran for it on this computer');
  await dialog.getByRole('button', { name: /^Finish and log 2\d min$/ }).click();

  await expect.poll(() => server.tables.planner_tasks!.get(id)?.status).toBe('done');
  const logged = sessions(server, id);
  expect(logged).toHaveLength(1);
  expect(logged[0]).toBeGreaterThanOrEqual(20);
});

test('Finish only leaves the time to the phone timer', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  const now = new Date();
  const id = seed(server, now, now.getTime() - 20 * 60_000);
  await server.install(page);
  await page.clock.install();
  await signIn(page, server);

  await page.getByRole('region', { name: 'Daily planning' }).getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Finish only' }).click();

  await expect.poll(() => server.tables.planner_tasks!.get(id)?.status).toBe('done');
  expect(sessions(server, id)).toEqual([]);
});

/// Only the other task: the phone has not made today's Daily planning yet.
function seedWithout(server: MockSupabase) {
  server.seed('planner_tasks', {
    id: 't1', project_id: null, parent_id: null, title: 'Prepare client deck', description: '', status: 'todo',
    priority: 0, labels: '', start_date: null, due_date: null, sort_order: 1, estimate_minutes: null, critical: false,
    created_at_ms: 1_000, updated_at_ms: 1_000, completed_at_ms: null, deleted_at_ms: null,
  });
}

const planningRows = (server: MockSupabase) => [...server.tables.planner_tasks!.values()].filter((r) => String(r.id).startsWith('daily-planning-'));

test('makes today\'s Daily planning task when the phone has not, once', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  seedWithout(server);
  await server.install(page);
  const today = iso(new Date());
  // Today is one of this computer's Daily planning days.
  await page.addInitScript(() => localStorage.setItem('nindo.desktop.settings', JSON.stringify({ dailyPlanningDays: [0, 1, 2, 3, 4, 5, 6] })));
  await page.clock.install();
  const inserts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/rest/v1/planner_tasks')) inserts.push(r.url());
  });
  await signIn(page, server);

  const card = page.getByRole('region', { name: 'Daily planning' });
  await expect(card.getByRole('button', { name: 'Start' })).toBeVisible();
  await expect.poll(() => planningRows(server).map((r) => [r.id, r.status, r.priority, r.due_date])).toEqual([
    [`daily-planning-${today}`, 'todo', 4, today],
  ]);

  // Coming back to the window reloads; nothing is made again.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.clock.runFor(2_000);
  }
  await expect(card).toBeVisible();
  expect(planningRows(server)).toHaveLength(1);
  expect(inserts).toHaveLength(1);
});

test('makes no Daily planning task on a day that is off', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  seedWithout(server);
  await server.install(page);
  // Every day on but today's weekday.
  const day = new Date().getDay();
  await page.addInitScript((off) => localStorage.setItem('nindo.desktop.settings', JSON.stringify({ dailyPlanningDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== off) })), day);
  await page.clock.install();
  await signIn(page, server);
  await page.clock.runFor(2_000);
  await expect(page.getByRole('region', { name: 'Daily planning' })).toHaveCount(0);
  expect(planningRows(server)).toHaveLength(0);
});

test('a deleted Daily planning task stays deleted', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  seedWithout(server);
  server.seed('planner_tasks', {
    id: `daily-planning-${iso(new Date())}`, project_id: null, parent_id: null, title: 'Daily planning', description: '', status: 'todo',
    priority: 4, labels: '', start_date: null, due_date: null, sort_order: 0, estimate_minutes: null, critical: false,
    created_at_ms: 1_000, updated_at_ms: 2_000, completed_at_ms: null, deleted_at_ms: 2_000,
  });
  await server.install(page);
  await page.addInitScript(() => localStorage.setItem('nindo.desktop.settings', JSON.stringify({ dailyPlanningDays: [0, 1, 2, 3, 4, 5, 6] })));
  await page.clock.install();
  await signIn(page, server);
  await page.clock.runFor(2_000);
  await expect(page.getByRole('region', { name: 'Daily planning' })).toHaveCount(0);
  expect(planningRows(server).map((r) => r.deleted_at_ms)).toEqual([2_000]);
});
