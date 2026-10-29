import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import {
  activityText,
  decodeLabels,
  encodeLabels,
  newTask,
  defaultHighlights,
  durationLabel,
  filterActive,
  groupByProject,
  noFilter,
  orderAt,
  sortTasks,
  statusChange,
  statuses,
  summary,
  todaysHighlights,
  validateTask,
  visibleTasks,
  type Activity,
  type Filter,
  type PlannerTask,
  type Project,
} from '../src/domain/planner';
import { neutralize, plannerToCsv } from '../src/domain/plannerCsv';
import { nextStatus } from '../src/ui/PlannerWorkspace';

let n = 0;
function task(title: string, fields: Partial<PlannerTask> = {}): PlannerTask {
  return { ...newTask(`t${++n}`, n, { title }), owner_id: 'u', revision: n, server_updated_at: '', ...fields } as PlannerTask;
}

const today = '2026-10-27';

describe('planner rules', () => {
  it('labels match the phone', () => {
    expect(encodeLabels([' web ', 'web', 'a,b', ''])).toBe('web,a b');
    expect(decodeLabels('web, sync,,')).toEqual(['web', 'sync']);
  });

  it('status circle cycles like the phone', () => {
    expect(nextStatus('todo')).toBe('doing');
    expect(nextStatus('backlog')).toBe('doing');
    expect(nextStatus('doing')).toBe('done');
    expect(nextStatus('done')).toBe('todo');
    expect(nextStatus('cancelled')).toBe('todo');
  });

  it('status changes set and clear completion', () => {
    expect(statusChange({ status: 'todo', completed_at_ms: null }, 'done', 5)).toEqual({ status: 'done', completed_at_ms: 5 });
    expect(statusChange({ status: 'done', completed_at_ms: 3 }, 'todo', 5)).toEqual({ status: 'todo', completed_at_ms: null });
    expect(statusChange({ status: 'todo', completed_at_ms: null }, 'todo', 5)).toEqual({});
  });

  it('validates like the server', () => {
    const ok = newTask('id', 1, { title: 'A' });
    expect(validateTask(ok)).toEqual([]);
    expect(validateTask({ ...ok, title: 'x'.repeat(301) })).not.toEqual([]);
    expect(validateTask({ ...ok, due_date: '2026-02-30' })).not.toEqual([]);
    expect(validateTask({ ...ok, priority: 5 })).not.toEqual([]);
    expect(validateTask({ ...ok, status: 'blocked' })).not.toEqual([]);
    expect(validateTask({ ...ok, estimate_minutes: -1 })).not.toEqual([]);
    expect(validateTask({ ...ok, id: 'daily-planning-2026-10-27' })).toEqual([]);
  });

  it('sorts like the phone: my order is the hand-made order, the rest put open critical tasks first', () => {
    const list = [task('b', { sort_order: 1 }), task('c', { sort_order: 2, critical: true }), task('a', { sort_order: 0 })];
    expect(sortTasks(list, 'manual').map((t) => t.title)).toEqual(['a', 'b', 'c']);
    expect(sortTasks(list, 'priority').map((t) => t.title)).toEqual(['c', 'a', 'b']);
    expect(sortTasks([task('x', { due_date: null }), task('y', { due_date: '2026-11-01' })], 'due').map((t) => t.title)).toEqual(['y', 'x']);
    const closed = task('done critical', { critical: true, status: 'done', due_date: '2026-10-01' });
    expect(sortTasks([task('z', { due_date: '2026-10-02' }), closed], 'due').map((t) => t.title)).toEqual(['done critical', 'z']);
    expect(sortTasks([task('old', { updated_at_ms: 1 }), task('new', { updated_at_ms: 9 })], 'updated').map((t) => t.title)).toEqual(['new', 'old']);
  });

  it('lists statuses in board order', () => {
    expect(statuses).toEqual(['backlog', 'todo', 'doing', 'done', 'cancelled']);
  });

  it('filters like the phone sheet', () => {
    const list = [
      task('Urgent web', { priority: 4, labels: 'web' }),
      task('Low home', { priority: 1, labels: 'home', due_date: '2026-10-30' }),
      task('Done', { status: 'done', due_date: today }),
      task('Late', { due_date: '2026-10-01' }),
      task('Far', { due_date: '2026-12-01' }),
    ];
    const titles = (f: Partial<Filter>, q = '') => visibleTasks(list, 'all', q, today, { ...noFilter, ...f }).map((t) => t.title);
    expect(titles({ priorities: [4, 1] })).toEqual(['Urgent web', 'Low home']);
    expect(titles({ labels: ['home'] })).toEqual(['Low home']);
    expect(titles({ showClosed: false })).not.toContain('Done');
    expect(titles({ due: 'overdue' })).toEqual(['Late']);
    expect(titles({ due: 'today' })).toEqual(['Done']);
    expect(titles({ due: 'week' })).toEqual(['Low home', 'Done']);
    expect(titles({ due: 'none' })).toEqual(['Urgent web']);
    expect(titles({}, 'web urgent')).toEqual(['Urgent web']);
    expect(titles({}, 'web home')).toEqual([]);
    expect(filterActive(noFilter)).toBe(false);
    expect(filterActive({ ...noFilter, showClosed: false })).toBe(true);
  });

  it('groups by project, Inbox last', () => {
    const p = (id: string) => ({ id, name: id }) as Project;
    const list = [task('i'), task('b1', { project_id: 'b' }), task('a1', { project_id: 'a' }), task('gone', { project_id: 'x' }), task('b2', { project_id: 'b' })];
    expect(groupByProject(list, [p('a'), p('b')]).map((g) => [g.projectId, g.tasks.map((t) => t.title)])).toEqual([
      ['a', ['a1']],
      ['b', ['b1', 'b2']],
      [null, ['i', 'gone']],
    ]);
  });

  it('places a dropped card between its neighbours', () => {
    const column = [task('a', { sort_order: 1 }), task('b', { sort_order: 2 })];
    expect(orderAt([], 0)).toBe(1);
    expect(orderAt(column, 0)).toBe(0);
    expect(orderAt(column, 1)).toBe(1.5);
    expect(orderAt(column, 2)).toBe(3);
  });

  it('counts the summary strip', () => {
    const now = Date.UTC(2026, 9, 27);
    const list = [
      task('open'),
      task('doing', { status: 'doing' }),
      task('late', { due_date: '2026-10-01' }),
      task('done now', { status: 'done', completed_at_ms: now - 1000 }),
      task('done long ago', { status: 'done', completed_at_ms: now - 30 * 86_400_000 }),
      task('sub', { parent_id: 'x' }),
    ];
    expect(summary(list, today, now)).toEqual({ open: 3, doing: 1, overdue: 1, doneWeek: 1 });
  });

  it("builds today's highlights, major first, with time from history", () => {
    const day = Date.UTC(2026, 9, 27);
    const done = task('Finished', { status: 'done', completed_at_ms: day + 3_600_000 });
    const major = task('Big one', { status: 'done', completed_at_ms: day + 1000, priority: 4 });
    const worked = task('Worked on', { status: 'doing' });
    const yesterday = task('Yesterday', { status: 'done', completed_at_ms: day - 1000 });
    const sub = task('Step', { parent_id: worked.id });
    const log = [
      { task_id: sub.id, kind: 'focus', body: '25', created_at_ms: day + 10 },
      { task_id: worked.id, kind: 'time', body: '15', created_at_ms: day + 20 },
      { task_id: worked.id, kind: 'comment', body: '99', created_at_ms: day + 30 },
      { task_id: worked.id, kind: 'time', body: '60', created_at_ms: day - 10 },
    ];
    const tasks = [done, major, worked, yesterday, sub];
    expect(todaysHighlights(tasks, log, day).map((h) => h.task.title)).toEqual(['Big one', 'Finished']);
    const both = todaysHighlights(tasks, log, day, { ...defaultHighlights, statuses: ['done', 'doing'] });
    expect(both.map((h) => [h.task.title, h.minutesToday])).toEqual([
      ['Big one', 0],
      ['Worked on', 40],
      ['Finished', 0],
    ]);
    expect(todaysHighlights(tasks, log, day, { ...defaultHighlights, majorOnly: true }).map((h) => h.task.title)).toEqual(['Big one']);
  });

  it('labels durations', () => {
    expect(durationLabel(40)).toBe('40 min');
    expect(durationLabel(120)).toBe('2 h');
    expect(durationLabel(85)).toBe('1 h 25 min');
  });

  it('scopes and search', () => {
    const list = [
      task('Inbox one'),
      task('Work late', { project_id: 'p', due_date: '2026-10-20' }),
      task('Today', { due_date: today }),
      task('Running', { start_date: '2026-10-25', due_date: '2026-10-30' }),
      task('Closed late', { due_date: '2026-10-01', status: 'done' }),
      task('Sub', { parent_id: 't1' }),
    ];
    const titles = (s: Parameters<typeof visibleTasks>[1], q = '') => visibleTasks(list, s, q, today).map((t) => t.title);
    expect(titles('all')).not.toContain('Sub');
    expect(titles('inbox')).toEqual(['Inbox one', 'Today', 'Running', 'Closed late']);
    expect(titles({ project: 'p' })).toEqual(['Work late']);
    expect(titles('overdue')).toEqual(['Work late']);
    expect(titles('today')).toEqual(['Today', 'Running']);
    expect(titles('all', 'LATE')).toEqual(['Work late', 'Closed late']);
  });

  it('describes history', () => {
    const a = (kind: string, body: string) => ({ kind, body }) as Activity;
    expect(activityText(a('status', 'doing'), [])).toBe('Status: In progress');
    expect(activityText(a('priority', 'high'), [])).toBe('Priority: High');
    expect(activityText(a('project', ''), [])).toBe('Moved to Inbox');
  });
});

describe('CSV export', () => {
  it('writes tasks with sub-tasks and neutralizes formulas', () => {
    const parent = task('=SUM(A1)', { labels: 'web,sync', priority: 4, status: 'doing' });
    const csv = plannerToCsv([parent, task('Step', { parent_id: parent.id, status: 'done' })], []);
    const rows = Papa.parse<Record<string, string>>(csv, { header: true }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: "'=SUM(A1)",
      status: 'In progress',
      priority: 'Urgent',
      project: 'Inbox',
      labels: 'web, sync',
      subtasks: '[x] Step',
    });
  });

  it.each(['=1', '+1', '-1', '@x'])('neutralizes %s', (v) => expect(neutralize(v)).toBe(`'${v}`));
});
