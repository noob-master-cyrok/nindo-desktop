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

function seed(server: MockSupabase) {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const at = (back: number, h: number, m = 0) => {
    const d = new Date(day);
    d.setDate(d.getDate() - back);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const iso = (back: number) => {
    const d = new Date(at(back, 9));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const base = {
    parent_id: null, description: '', labels: '', start_date: null, due_date: null, estimate_minutes: null,
    critical: false, priority: 0, created_at_ms: 1_000, updated_at_ms: 1_000, completed_at_ms: null, deleted_at_ms: null,
  };
  server.seed('planner_projects', { id: 'p-work', name: 'Work', color: 3, sort_order: 0, archived: false, created_at_ms: 1, updated_at_ms: 1, deleted_at_ms: null });
  server.seed('planner_projects', { id: 'p-study', name: 'Study', color: 5, sort_order: 1, archived: false, created_at_ms: 1, updated_at_ms: 1, deleted_at_ms: null });
  const tasks = [
    { id: 't1', project_id: 'p-work', title: 'Prepare client deck', status: 'doing', sort_order: 1 },
    { id: 't2', project_id: 'p-work', title: 'Send the invoice', status: 'done', completed_at_ms: at(0, 0, 5), sort_order: 2 },
    { id: 't3', project_id: 'p-study', title: 'Read chapter 4', status: 'todo', sort_order: 3 },
    { id: 't4', project_id: 'p-work', title: 'Book the venue', status: 'done', completed_at_ms: at(1, 16), sort_order: 4 },
  ];
  for (const t of tasks) server.seed('planner_tasks', { ...base, ...t });
  const session = (id: string, task: string, start: number, minutes: number) =>
    server.seed('planner_sessions', { id, task_id: task, kind: 'manual', started_at_ms: start, minutes, created_at_ms: start, updated_at_ms: start, deleted_at_ms: null });
  session('se1', 't1', at(0, 0, 1), 1);
  session('se2', 't3', at(0, 0, 2), 2);
  session('se3', 't4', at(1, 10), 90);
  session('se4', 't4', at(7, 10), 40);
  server.seed('planner_breaks', { id: 'bk', title: 'Walk', description: '', created_at_ms: 1, updated_at_ms: 1, deleted_at_ms: null });
  server.seed('planner_break_runs', { id: 'br', break_id: 'bk', started_at_ms: at(1, 12), ended_at_ms: at(1, 12, 30), updated_at_ms: at(1, 12), deleted_at_ms: null });
  server.seed('planner_attendance', { id: iso(1), check_in_ms: at(1, 9), check_out_ms: at(1, 17, 30), note: '', edited: false, created_at_ms: at(1, 9), updated_at_ms: at(1, 9), deleted_at_ms: null });
}

async function signIn(page: Page, server: MockSupabase) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(server.email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Prepare client deck').first()).toBeVisible();
}

test('day summary sits beside the Tasks page and keeps notes per day', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const server = new MockSupabase(ORIGIN);
  seed(server);
  await server.install(page);
  await signIn(page, server);

  const panel = page.getByRole('complementary', { name: 'Day summary' });
  await expect(panel).toBeVisible();
  // Safu's Windows app: a wide window with the sidebar hidden to the icon rail.
  await page.setViewportSize({ width: 2000, height: 1125 });
  await page.getByRole('button', { name: 'Hide sidebar' }).click();
  await page.mouse.move(1000, 600);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/day-summary/wide-rail.png' });
  await page.getByRole('button', { name: 'Show sidebar' }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(panel.getByRole('region', { name: 'Finished that day' })).toContainText('Send the invoice');
  await expect(panel.getByRole('region', { name: 'Worked on' })).toContainText('Prepare client deck');
  await expect(panel.getByRole('region', { name: 'Time by project' })).toContainText('Work');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/day-summary/today.png' });

  const notes = panel.getByLabel('Notes & points to present');
  await panel.getByRole('button', { name: 'Suggest points' }).click();
  await expect(notes).toHaveValue(/• Finished Send the invoice/);
  await notes.press('End');
  await notes.pressSequentially('\n• Deck goes to the client on Friday');

  // Yesterday has its own numbers and an empty note.
  await panel.getByRole('button', { name: 'Previous day' }).click();
  await expect(panel.getByText('Yesterday')).toBeVisible();
  await expect(panel.getByRole('region', { name: 'Finished that day' })).toContainText('Book the venue');
  await expect(panel.getByText('1 h 30 min').first()).toBeVisible();
  await expect(notes).toHaveValue('');
  await page.screenshot({ path: 'test-results/day-summary/yesterday.png' });

  // Back to today: the note is still there, and after a reload too.
  await panel.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(notes).toHaveValue(/Deck goes to the client on Friday/);
  await panel.getByRole('button', { name: 'Copy day summary' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('• Deck goes to the client on Friday');
  expect(copied).toContain('Done\n• Send the invoice');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/day-summary/notes.png' });
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Day summary' }).getByLabel('Notes & points to present')).toHaveValue(/Deck goes to the client/);
  // The note is in Supabase, so another computer (no local copy) gets it.
  const stored = [...server.tables.planner_day_notes!.values()];
  expect(stored.map((r) => r.note).join()).toContain('Deck goes to the client on Friday');
  await page.evaluate(() => {
    localStorage.removeItem('nindo.desktop.dayNotes');
    localStorage.removeItem('nindo.desktop.dayNotesUnsynced');
  });
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Day summary' }).getByLabel('Notes & points to present')).toHaveValue(/Deck goes to the client/);

  // The report can leave out a project, and a single task.
  await panel.getByRole('button', { name: /Report covers/ }).click();
  await panel.getByRole('button', { name: 'Work', exact: true }).click();
  await expect(panel.getByRole('region', { name: 'Worked on' })).not.toContainText('Read chapter 4');
  await panel.getByRole('button', { name: 'Show everything' }).click();
  await panel.getByRole('checkbox', { name: 'Include Read chapter 4 in the report' }).uncheck();
  await panel.getByRole('radio', { name: 'Week' }).click();
  await expect(panel.getByText('This week')).toBeVisible();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/day-summary/week.png' });
  await panel.getByRole('button', { name: 'Copy week report for Claude' }).click();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  expect(report).toContain('Nindo report: Week of');
  expect(report).toContain('Send the invoice');
  expect(report).toContain('Deck goes to the client on Friday');
  // The task list leaves it out; the person's own notes are kept as written.
  expect(report).not.toContain('- Read chapter 4 [');
  // Last week loads its own time (the page holds this week only).
  await panel.getByRole('button', { name: 'Previous week' }).click();
  await expect(panel.getByText('Week summary')).toBeVisible();
  await expect(panel.locator('.day-stats')).toContainText('40 min');
  await panel.getByRole('button', { name: 'Today', exact: true }).click();
  await panel.getByRole('radio', { name: 'Day' }).click();

  // Opening a task takes the column; closing it brings the summary back.
  await page.getByRole('button', { name: /^Prepare client deck/ }).first().click();
  await expect(page.getByRole('complementary', { name: 'Day summary' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Day summary' })).toBeVisible();

  // Hidden stays hidden; the head button brings it back.
  await page.getByRole('button', { name: 'Hide day summary' }).click();
  await expect(page.getByRole('complementary', { name: 'Day summary' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Prepare client deck').first()).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Day summary' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Day summary' }).click();
  await expect(page.getByRole('complementary', { name: 'Day summary' })).toBeVisible();

  // A narrow window: the summary only slides over when asked for.
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.getByRole('complementary', { name: 'Day summary' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Day summary' }).click();
  await expect(page.getByRole('complementary', { name: 'Day summary' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/day-summary/narrow.png' });
});
