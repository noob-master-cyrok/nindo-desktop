import { expect, test, type Page } from '@playwright/test';
import { MockSupabase } from './mockSupabase';

/// Screenshots of the main screens in light and dark, for design reviews.
/// Run with `SCREENS=1 npx playwright test screens`; they land in
/// test-results/screens/.
test.skip(!process.env.SCREENS, 'Only when SCREENS=1');

const ORIGIN = 'https://wvqutuvvbnrnjmjokynf.supabase.co';

function iso(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function seed(server: MockSupabase) {
  const now = Date.now();
  const base = {
    parent_id: null, description: '', labels: '', start_date: null, due_date: null, estimate_minutes: null,
    critical: false, priority: 0, created_at_ms: 1_000, updated_at_ms: 1_000, completed_at_ms: null, deleted_at_ms: null,
  };
  const projects = [
    ['p-work', 'Work', 3],
    ['p-home', 'Home', 2],
    ['p-study', 'Study', 5],
  ] as const;
  projects.forEach(([id, name, color], i) =>
    server.seed('planner_projects', {
      id, name, color, sort_order: i, archived: false, created_at_ms: 1, updated_at_ms: 1, deleted_at_ms: null,
    }),
  );
  const tasks: Record<string, unknown>[] = [
    { id: 't1', project_id: 'p-work', title: 'Prepare client deck', status: 'doing', priority: 3, labels: 'client,slides', due_date: iso(0), estimate_minutes: 90, critical: true, sort_order: 1 },
    { id: 't2', project_id: 'p-work', title: 'Review the budget sheet', status: 'todo', priority: 2, due_date: iso(-2), sort_order: 2 },
    { id: 't3', project_id: 'p-home', title: 'Fix the kitchen tap', status: 'todo', priority: 1, due_date: iso(3), sort_order: 3 },
    { id: 't4', project_id: null, title: 'Renew passport', status: 'backlog', sort_order: 4 },
    { id: 't5', project_id: 'p-study', title: 'Read chapter 4', status: 'doing', priority: 4, labels: 'reading', estimate_minutes: 45, sort_order: 5 },
    { id: 't6', project_id: 'p-work', title: 'Send the invoice', status: 'done', priority: 2, completed_at_ms: now - 3_600_000, sort_order: 6 },
    { id: 't7', project_id: 'p-home', title: 'Water the plants', status: 'done', completed_at_ms: now - 7_200_000, sort_order: 7 },
    { id: `daily-planning-${iso(0)}`, project_id: null, title: 'Daily planning', status: 'todo', priority: 4, due_date: iso(0), sort_order: 0 },
    { id: 's1', parent_id: 't1', project_id: 'p-work', title: 'Collect numbers', status: 'done', completed_at_ms: now, sort_order: 1 },
    { id: 's2', parent_id: 't1', project_id: 'p-work', title: 'Draft slides', status: 'todo', sort_order: 2 },
  ];
  for (const t of tasks) server.seed('planner_tasks', { ...base, ...t });
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const at = (back: number, h: number, m = 0) => {
    const d = new Date(day);
    d.setDate(d.getDate() - back);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  for (let back = 0; back < 4; back++) {
    server.seed('planner_sessions', { id: `se${back}a`, task_id: 't1', kind: 'focus', started_at_ms: at(back, 9), minutes: 25 + back * 20, created_at_ms: at(back, 9), updated_at_ms: at(back, 9), deleted_at_ms: null });
    server.seed('planner_sessions', { id: `se${back}b`, task_id: 't5', kind: 'manual', started_at_ms: at(back, 14), minutes: 45, created_at_ms: at(back, 14), updated_at_ms: at(back, 14), deleted_at_ms: null });
    server.seed('planner_break_runs', { id: `br${back}`, break_id: 'bk', started_at_ms: at(back, 12), ended_at_ms: at(back, 12, 20 + back * 5), updated_at_ms: at(back, 12), deleted_at_ms: null });
    const d = new Date(at(back, 9));
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    server.seed('planner_attendance', { id: iso, check_in_ms: at(back, 9), check_out_ms: back === 0 ? null : at(back, 17, back * 10), note: '', edited: false, created_at_ms: at(back, 9), updated_at_ms: at(back, 9), deleted_at_ms: null });
  }
  server.seed('planner_breaks', { id: 'bk', title: 'Walk', description: '', created_at_ms: 1, updated_at_ms: 1, deleted_at_ms: null });
  server.seed('planner_activity', {
    id: 'a1', task_id: 't1', kind: 'comment', body: 'Ask Maya for the charts',
    created_at_ms: now - 600_000, updated_at_ms: now - 600_000, deleted_at_ms: null,
  });
  server.seed('planner_activity', {
    id: 'a2', task_id: 't1', kind: 'focus', body: '25',
    created_at_ms: now - 300_000, updated_at_ms: now - 300_000, deleted_at_ms: null,
  });
}

async function signIn(page: Page, server: MockSupabase) {
  await page.goto('/');
  await page.getByLabel('Email').fill(server.email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Prepare client deck').first()).toBeVisible();
}

for (const scheme of ['light', 'dark'] as const) {
  test(`screens ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const server = new MockSupabase(ORIGIN);
    seed(server);
    await server.install(page);
    page.on('console', (m) => m.type() === 'warning' && console.log('PAGE', m.text()));
    await page.goto('/');
    await page.screenshot({ path: `test-results/screens/${scheme}-signin.png` });
    await signIn(page, server);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `test-results/screens/${scheme}-list.png` });
    await page.getByRole('region', { name: 'This week' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/screens/${scheme}-week.png` });
    await page.evaluate(() => document.querySelector('.list-pane')!.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Start timer: Prepare client deck' }).click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /^Prepare client deck/ }).click();
    await expect(page.getByText('Ask Maya for the charts')).toBeVisible();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `test-results/screens/${scheme}-task.png` });
    await page.getByRole('button', { name: 'Priority High' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/screens/${scheme}-picker.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Full screen' }).first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/screens/${scheme}-fullclock.png` });
    await page.getByRole('button', { name: 'Close full screen' }).click();
    await page.getByRole('button', { name: /Take a break/ }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/screens/${scheme}-break.png` });
    await page.getByRole('button', { name: 'Back to Prepare client deck' }).click();
    await page.setViewportSize({ width: 420, height: 900 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/screens/${scheme}-narrow-task.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('radio', { name: 'Board' }).click();
    await page.screenshot({ path: `test-results/screens/${scheme}-board.png` });
    await page.getByRole('radio', { name: 'Day planner' }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/screens/${scheme}-day.png` });
    await page.getByRole('button', { name: /^Prepare client deck, .*running/ }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `test-results/screens/${scheme}-day-task.png` });
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('radio', { name: 'Board' }).click();
    await page.getByRole('button', { name: 'Filter', exact: true }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/screens/${scheme}-filter.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `test-results/screens/${scheme}-settings.png` });
    await page.getByRole('radio', { name: 'Teal' }).click();
    await page.getByRole('radio', { name: 'Sky' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await page.getByRole('radio', { name: 'List' }).click();
    await page.screenshot({ path: `test-results/screens/${scheme}-teal-sky.png` });
  });
}
