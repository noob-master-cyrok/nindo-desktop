import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import {
  activityText,
  decodeLabels,
  encodeLabels,
  newTask,
  sortTasks,
  statusChange,
  validateTask,
  visibleTasks,
  type Activity,
  type PlannerTask,
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

  it('orders critical first, then manual order', () => {
    const list = [task('b', { sort_order: 1 }), task('c', { sort_order: 2, critical: true }), task('a', { sort_order: 0 })];
    expect(sortTasks(list, 'manual').map((t) => t.title)).toEqual(['c', 'a', 'b']);
    expect(sortTasks([task('x', { due_date: null }), task('y', { due_date: '2026-11-01' })], 'due').map((t) => t.title)).toEqual(['y', 'x']);
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
