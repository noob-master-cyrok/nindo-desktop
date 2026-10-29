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
  const now = new Date();
  now.setHours(9, 0, 0, 0);
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  server.seed('planner_sessions', { id: 'se1', task_id: TASK_ID, kind: 'focus', started_at_ms: now.getTime(), minutes: 25, created_at_ms: 1, updated_at_ms: 1, deleted_at_ms: null });
  server.seed('planner_attendance', { id: iso, check_in_ms: now.getTime(), check_out_ms: null, note: '', edited: false, created_at_ms: now.getTime(), updated_at_ms: now.getTime(), deleted_at_ms: null });
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

  await page.clock.install();
  // Sign in with an email code.
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(server.email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText(`We sent an email to ${server.email}`)).toBeVisible();
  await page.getByLabel('Code').fill('000000');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('That code did not work');
  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Signed in account')).toContainText(server.email);

  // Grouped by status; sub-tasks stay inside their task.
  await expect(page.getByRole('region', { name: 'In progress' })).toContainText('Prepare client deck');
  await expect(page.getByRole('region', { name: 'Backlog' })).toContainText('Renew passport');
  await expect(page.getByRole('region', { name: 'In progress' })).toContainText('0/1');
  await expect(page.getByText('Collect numbers')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/list.png', fullPage: true });

  // All the details.
  await page.getByRole('button', { name: /^Prepare client deck/ }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Prepare client deck');
  await expect(page.getByRole('button', { name: 'Project Work' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove label client' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove label slides' })).toBeVisible();
  await expect(page.getByLabel('Estimate (minutes)')).toHaveValue('90');
  await expect(page.getByRole('region', { name: 'Sub-tasks' })).toContainText('Collect numbers');
  await expect(page.getByRole('region', { name: 'Activity' })).toContainText('Ask Maya for the charts');

  // Edit.
  await page.getByLabel('Description').fill('Slides for Friday, 10 pages');
  await page.getByRole('button', { name: 'Priority High' }).click();
  await page.getByRole('option', { name: 'Urgent' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  expect(server.tables.planner_tasks!.get(TASK_ID)).toMatchObject({
    description: 'Slides for Friday, 10 pages', priority: 4, labels: 'client,slides', critical: true,
  });
  await expect(page.getByRole('region', { name: 'Activity' })).toContainText('Priority: Urgent');

  // Sub-task, link, comment.
  await page.getByLabel('Done: Collect numbers').click();
  await expect(page.getByLabel('Done: Collect numbers')).toBeChecked();
  await expect(page.getByRole('region', { name: 'In progress' })).toContainText('1/1');
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
  await expect.poll(() => server.tables.planner_tasks!.get(TASK_ID)!.estimate_minutes).toBe(120);
  expect(server.tables.planner_tasks!.get(TASK_ID)).toMatchObject({ title: 'Prepare client deck v2', estimate_minutes: 120 });

  // Status circle: in progress → done.
  await page.getByRole('button', { name: /In progress: Prepare client deck v2/ }).click();
  await expect(page.getByRole('region', { name: 'In progress' })).toHaveCount(0);
  expect(server.tables.planner_tasks!.get(TASK_ID)!.completed_at_ms).not.toBeNull();

  // Create in a project.
  await page.getByRole('button', { name: /^Work/ }).click();
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Book venue');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('status')).toContainText('Task added.');
  const created = [...server.tables.planner_tasks!.values()].find((r) => r.title === 'Book venue')!;
  expect(created).toMatchObject({ project_id: PROJECT_ID, status: 'todo', owner_id: server.userId });

  // Delete (soft), then Undo.
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: /Book venue/ })).toHaveCount(0);
  expect(server.tables.planner_tasks!.get(created.id as string)!.deleted_at_ms).not.toBeNull();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: /Book venue/ }).first()).toBeVisible();
  expect(server.tables.planner_tasks!.get(created.id as string)!.deleted_at_ms).toBeNull();

  // Duplicate.
  await page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Book venue (copy)');

  // Quick add, then drag it on the board to In progress.
  await page.getByRole('button', { name: /^All tasks/ }).click();
  await page.getByLabel('Add a task').fill('Call the printer');
  await page.getByLabel('Add a task').press('Enter');
  await expect(page.getByRole('button', { name: 'Call the printer', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('radio', { name: 'Board' }).click();
  await page.getByRole('button', { name: 'Call the printer', exact: true }).dragTo(page.getByRole('region', { name: 'In progress' }));
  await expect(page.getByRole('region', { name: 'In progress' })).toContainText('Call the printer');
  const printer = [...server.tables.planner_tasks!.values()].find((r) => r.title === 'Call the printer')!;
  expect(printer).toMatchObject({ status: 'doing', project_id: null });
  await page.getByRole('radio', { name: 'List' }).click();

  // Filter: urgent only.
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Urgent' }).click();
  await page.getByRole('button', { name: 'Show tasks' }).click();
  await expect(page.getByRole('button', { name: 'Call the printer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Prepare client deck v2/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Filtered/ }).click();
  await expect(page.getByRole('button', { name: 'Call the printer', exact: true })).toBeVisible();

  // Attendance: set today's times by hand.
  await page.getByRole('button', { name: 'Edit today' }).click();
  await page.getByLabel('Check in').fill('09:15');
  await page.getByLabel('Check out').fill('17:45');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('region', { name: 'Attendance' })).toContainText('Out');
  const day = [...server.tables.planner_attendance!.values()][0]!;
  expect(day).toMatchObject({ edited: true });
  expect(new Date(day.check_out_ms as number).getHours()).toBe(17);

  // Timer: start on a row, pause after three minutes; the time is logged.
  await page.clock.fastForward(0);
  await page.getByRole('button', { name: 'Start timer: Call the printer' }).click();
  await expect(page.getByRole('status', { name: 'Running timers' })).toBeVisible();
  await page.clock.fastForward('03:05');
  await page.getByRole('button', { name: 'Pause timer: Call the printer' }).click();
  await expect.poll(() => [...server.tables.planner_sessions!.values()].filter((r) => r.task_id === printer.id).map((r) => r.minutes)).toEqual([3]);

  // A break pauses timers and covers the page until it ends.
  await page.getByRole('button', { name: 'Start timer: Call the printer' }).click();
  await page.getByRole('button', { name: /Take a break/ }).click();
  await expect(page.getByRole('dialog', { name: 'On a break' })).toBeVisible();
  await page.getByLabel('What is this break?').fill('Tea');
  await page.clock.fastForward('10:00');
  await page.getByRole('button', { name: 'End break' }).click();
  await expect(page.getByRole('dialog', { name: 'On a break' })).toHaveCount(0);
  await expect.poll(() => [...server.tables.planner_breaks!.values()].map((r) => r.title)).toEqual(['Tea']);
  await expect.poll(() => server.tables.planner_break_runs!.size).toBe(1);

  // Settings: App colors and dark mode stay after a reload.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Teal' }).click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await expect(page.getByLabel('Signed in account')).toContainText(server.email);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--acc').trim())).toBe('#4FB8AC');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

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

test('the emailed link can be pasted in, even after the email limit is hit', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  seed(server);
  server.otpStatus = 429;
  await server.install(page);
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(server.email);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('alert')).toContainText('only sends a few emails an hour');
  await expect(page.getByLabel('Code')).toBeVisible();
  const paste = page.getByLabel('Or paste the link from the email');
  await paste.fill('not a link');
  await page.getByRole('button', { name: 'Sign in with link' }).click();
  await expect(page.getByRole('alert')).toContainText('not a Nindo sign-in link');
  await paste.fill(`${ORIGIN}/auth/v1/verify?token=usedhash&type=magiclink&redirect_to=x`);
  await page.getByRole('button', { name: 'Sign in with link' }).click();
  await expect(page.getByRole('alert')).toContainText('already have been opened');
  await paste.fill(`${ORIGIN}/auth/v1/verify?token=goodhash&type=magiclink&redirect_to=x`);
  await page.getByRole('button', { name: 'Sign in with link' }).click();
  await expect(page.getByLabel('Signed in account')).toContainText(server.email);
});

test('a code from an earlier email works without sending a new one', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  seed(server);
  await server.install(page);
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(server.email);
  await page.getByRole('button', { name: 'I already have a code' }).click();
  await page.getByLabel('Code').fill('123 456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Signed in account')).toContainText(server.email);
});

test('the sign-in moves from the browser to the Dock app by paste', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const server = new MockSupabase(ORIGIN);
  seed(server);
  await server.install(page);
  await signIn(page, server);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Move sign-in to the Mac app' }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('refresh_token=');
  await page.getByLabel('Or paste the link from the email').fill(copied);
  await page.getByRole('button', { name: 'Sign in with link' }).click();
  await expect(page.getByLabel('Signed in account')).toContainText(server.email);
});

test('an expired sign-in link explains what to do', async ({ page }) => {
  await new MockSupabase(ORIGIN).install(page);
  await page.goto('/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  await expect(page.getByRole('alert')).toContainText('expired or was already used');
});

async function signIn(page: import('@playwright/test').Page, server: MockSupabase) {
  const s = server.session();
  await page.goto(
    `/#access_token=${s.access_token}&refresh_token=${s.refresh_token}&expires_in=3600&expires_at=${s.expires_at}&token_type=bearer&type=magiclink`,
  );
  await expect(page.getByLabel('Signed in account')).toContainText(server.email);
}

test('the sidebar hides, peeks on hover, and stays hidden after a reload', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  seed(server);
  await server.install(page);
  await signIn(page, server);
  const lists = page.getByRole('navigation', { name: 'Task lists' });
  const work = lists.getByRole('button', { name: /^Work/ });

  await page.getByRole('button', { name: 'Hide sidebar' }).click();
  await expect(work).toBeHidden();
  await page.screenshot({ path: 'test-results/sidebar-hidden.png' });

  // Pointing at the rail slides the lists out; they still work.
  await page.getByRole('button', { name: 'Show sidebar' }).hover();
  await expect(work).toBeVisible();
  await page.waitForTimeout(600); // let the slide finish for the picture
  await page.screenshot({ path: 'test-results/sidebar-peek.png' });
  await work.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Work');
  await page.mouse.move(900, 500);
  await expect(work).toBeHidden();

  // Remembered on this computer.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible();
  await page.getByRole('button', { name: 'Show sidebar' }).click();
  await page.mouse.move(900, 500);
  await expect(work).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Hide sidebar' })).toBeVisible();

  // The [ key does the same.
  await page.keyboard.press('[');
  await expect(page.getByRole('button', { name: 'Show sidebar' })).toBeVisible();
});

test('closing a task without Save keeps the edits', async ({ page }) => {
  const server = new MockSupabase(ORIGIN);
  seed(server);
  await server.install(page);
  await signIn(page, server);
  const PASSPORT = 'a1b2c3d4-0000-4000-8000-000000000002';

  // The close button.
  await page.getByRole('button', { name: /^Prepare client deck/ }).click();
  await page.getByLabel('Description').fill('Slides for Friday, 12 pages');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('region', { name: 'Task details' })).toBeHidden();
  await expect(page.getByRole('status')).toContainText('Changes saved.');
  expect(server.tables.planner_tasks!.get(TASK_ID)!.description).toBe('Slides for Friday, 12 pages');

  // Escape.
  await page.getByRole('button', { name: /^Prepare client deck/ }).click();
  await page.getByLabel('Estimate (minutes)').fill('100');
  await page.getByRole('heading', { name: 'Task', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Task details' })).toBeHidden();
  await expect.poll(() => server.tables.planner_tasks!.get(TASK_ID)!.estimate_minutes).toBe(100);

  // Opening another task.
  await page.getByRole('button', { name: /^Prepare client deck/ }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Prepare client deck v3');
  await page.getByRole('button', { name: /^Renew passport/ }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Renew passport');
  expect(server.tables.planner_tasks!.get(TASK_ID)!.title).toBe('Prepare client deck v3');

  // Something that cannot be saved keeps the task open, with a way out.
  await page.getByLabel('Estimate (minutes)').fill('soon');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('alert')).toContainText('whole number of minutes');
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Renew passport');
  await page.screenshot({ path: 'test-results/close-unsaved.png' });
  await page.getByRole('button', { name: 'Close without saving' }).click();
  await expect(page.getByRole('region', { name: 'Task details' })).toBeHidden();
  expect(server.tables.planner_tasks!.get(PASSPORT)!.estimate_minutes).toBeNull();

  // A new task with a title is added when its window closes.
  await page.getByRole('button', { name: 'New task' }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Pay the electricity bill');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('status')).toContainText('Task added.');
  await expect(page.getByRole('button', { name: /Pay the electricity bill/ }).first()).toBeVisible();
});
