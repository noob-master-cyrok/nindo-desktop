import { expect, test } from '@playwright/test';
import { MockSupabase } from './mockSupabase';

const ORIGIN = 'https://wvqutuvvbnrnjmjokynf.supabase.co';
const TASK_ID = 'a1b2c3d4-0000-4000-8000-000000000001';
const PROJECT_ID = 'a1b2c3d4-0000-4000-8000-0000000000aa';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function phoneTask(fields: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    project_id: PROJECT_ID,
    parent_id: null,
    title: 'Prepare client deck',
    description: 'Slides for Friday',
    status: 'doing',
    priority: 3,
    labels: 'client,slides',
    start_date: null,
    due_date: today(),
    sort_order: 1,
    estimate_minutes: 90,
    critical: true,
    created_at_ms: 1_000,
    updated_at_ms: 1_000,
    completed_at_ms: null,
    deleted_at_ms: null,
    ...fields,
  };
}

function seed(server: MockSupabase) {
  server.seed('planner_projects', {
    id: PROJECT_ID, name: 'Work', color: 3, sort_order: 0, archived: false,
    created_at_ms: 1, updated_at_ms: 1, deleted_at_ms: null,
  });
  server.seed('planner_tasks', phoneTask());
  server.seed('planner_tasks', phoneTask({
    id: 'a1b2c3d4-0000-4000-8000-000000000002', project_id: null, title: 'Renew passport',
    status: 'backlog', priority: 0, labels: '', due_date: null, critical: false, estimate_minutes: null,
  }));
  server.seed('planner_tasks', phoneTask({
    id: 'a1b2c3d4-0000-4000-8000-000000000003', parent_id: TASK_ID, title: 'Collect numbers',
    status: 'todo', critical: false,
  }));
  server.seed('planner_activity', {
    id: 'act-1', task_id: TASK_ID, kind: 'comment', body: 'Ask Maya for the charts',
    created_at_ms: 2_000, updated_at_ms: 2_000, deleted_at_ms: null,
  });
}

test('sign in and work through the Tasks screen', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  seed(server);
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

  // Grouped by status; sub-tasks stay inside their task.
  await expect(page.getByRole('region', { name: 'In progress' })).toContainText('Prepare client deck');
  await expect(page.getByRole('region', { name: 'Backlog' })).toContainText('Renew passport');
  await expect(page.getByRole('region', { name: 'In progress' })).toContainText('0/1 sub-tasks');
  await expect(page.getByText('Collect numbers')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/list.png', fullPage: true });

  // All the details.
  await page.getByRole('button', { name: /Prepare client deck/ }).last().click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Prepare client deck');
  await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue(PROJECT_ID);
  await expect(page.getByLabel('Labels (comma separated)')).toHaveValue('client, slides');
  await expect(page.getByLabel('Estimate (minutes)')).toHaveValue('90');
  await expect(page.getByRole('region', { name: 'Sub-tasks' })).toContainText('Collect numbers');
  await expect(page.getByRole('region', { name: 'Activity' })).toContainText('Ask Maya for the charts');

  // Edit.
  await page.getByLabel('Description').fill('Slides for Friday, 10 pages');
  await page.getByRole('combobox', { name: 'Priority' }).selectOption({ label: 'Urgent' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  expect(server.tables.planner_tasks!.get(TASK_ID)).toMatchObject({
    description: 'Slides for Friday, 10 pages', priority: 4, labels: 'client,slides', critical: true,
  });
  await expect(page.getByRole('region', { name: 'Activity' })).toContainText('Priority: Urgent');

  // Sub-task, link, comment.
  await page.getByLabel('Done: Collect numbers').click();
  await expect(page.getByLabel('Done: Collect numbers')).toBeChecked();
  await expect(page.getByRole('region', { name: 'In progress' })).toContainText('1/1 sub-tasks');
  await page.getByLabel('New sub-task').fill('Rehearse');
  await page.getByRole('region', { name: 'Sub-tasks' }).getByRole('button', { name: 'Add' }).click();
  await expect(page.getByRole('region', { name: 'Sub-tasks' })).toContainText('Rehearse');
  await page.getByLabel('Link address').fill('https://example.test/deck');
  await page.getByLabel('Link title').fill('Deck draft');
  await page.getByRole('button', { name: 'Add link' }).click();
  await expect(page.getByRole('link', { name: 'Deck draft' })).toBeVisible();
  await page.getByLabel('New comment').fill('Sent to Maya');
  await page.getByRole('button', { name: 'Comment' }).click();
  await expect(page.getByRole('region', { name: 'Activity' })).toContainText('Sent to Maya');
  await page.screenshot({ path: 'test-results/editor.png', fullPage: true });

  // Conflict: the phone saves while the desktop has unsaved changes.
  server.phoneWrite('planner_tasks', TASK_ID, { title: 'Prepare client deck v2', updated_at_ms: Date.now() + 1 });
  await page.getByLabel('Estimate (minutes)').fill('120');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog', { name: 'This changed on another device' })).toBeVisible();
  await page.screenshot({ path: 'test-results/conflict.png' });
  expect(server.tables.planner_tasks!.get(TASK_ID)!.estimate_minutes).toBe(90);
  await page.getByRole('button', { name: 'Use my changes' }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  expect(server.tables.planner_tasks!.get(TASK_ID)).toMatchObject({ title: 'Prepare client deck v2', estimate_minutes: 120 });

  // Status circle: in progress → done.
  await page.getByRole('button', { name: /In progress: Prepare client deck v2/ }).click();
  await expect(page.getByRole('region', { name: 'In progress' })).toHaveCount(0);
  expect(server.tables.planner_tasks!.get(TASK_ID)!.completed_at_ms).not.toBeNull();

  // Create in a project.
  await page.getByRole('button', { name: /^Work/ }).click();
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Book venue');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('status')).toContainText('Task added.');
  const created = [...server.tables.planner_tasks!.values()].find((r) => r.title === 'Book venue')!;
  expect(created).toMatchObject({ project_id: PROJECT_ID, status: 'todo', owner_id: server.userId });

  // Delete (soft).
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('button', { name: /Book venue/ })).toHaveCount(0);
  expect(server.tables.planner_tasks!.get(created.id as string)!.deleted_at_ms).not.toBeNull();

  expect(cspErrors).toEqual([]);
});

test('an emailed sign-in link signs in and is cleared from the address bar', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  seed(server);
  await server.install(page);
  const s = server.session();
  await page.goto(
    `/#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&expires_at=${s.expires_at}&token_type=bearer&type=magiclink`,
  );
  await expect(page.getByLabel('Signed in account')).toContainText(server.email);
  await expect(page.getByRole('region', { name: 'In progress' })).toContainText('Prepare client deck');
  expect(page.url()).not.toContain('access_token');
});

test('an expired sign-in link explains what to do', async ({ page }) => {
  await new MockSupabase(ORIGIN).install(page);
  await page.goto('/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  await expect(page.getByRole('alert')).toContainText('expired or was already used');
});
