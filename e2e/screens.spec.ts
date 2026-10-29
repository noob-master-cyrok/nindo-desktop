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
    await page.goto('/');
    await page.screenshot({ path: `test-results/screens/${scheme}-signin.png` });
    await signIn(page, server);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `test-results/screens/${scheme}-list.png` });
    await page.getByText('Prepare client deck').first().click();
    await expect(page.getByText('Ask Maya for the charts')).toBeVisible();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `test-results/screens/${scheme}-task.png` });
    await page.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('radio', { name: 'Board' }).click();
    await page.screenshot({ path: `test-results/screens/${scheme}-board.png` });
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
