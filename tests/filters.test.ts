import { describe, expect, it } from 'vitest';
import { counts, relativeTime, visibleTasks } from '../src/domain/filters';
import { newTaskRow, type TaskRow } from '../src/domain/task';

let n = 0;
function task(title: string, fields: Partial<TaskRow> = {}): TaskRow {
  return {
    ...newTaskRow(String(++n), 1, { title, due_date_ad: '2026-10-27' }),
    owner_id: 'u',
    revision: n,
    server_updated_at: '',
    ...fields,
  } as TaskRow;
}

const today = '2026-10-27';
const tasks = [
  task('Late', { due_date_ad: '2026-10-20' }),
  task('Now afternoon', { due_time: '15:00' }),
  task('Now morning', { due_time: '08:00', urgency: 3 }),
  task('Later', { due_date_ad: '2026-11-02', urgency: 2 }),
  task('Someday', { undated: true }),
  task('Done old', { completed_at_ms: 10 }),
  task('Done new', { completed_at_ms: 20 }),
];
const titles = (list: TaskRow[]) => list.map((t) => t.title);

describe('task filters', () => {
  it('splits open tasks by date', () => {
    expect(titles(visibleTasks(tasks, 'today', '', 'due', today))).toEqual(['Now morning', 'Now afternoon']);
    expect(titles(visibleTasks(tasks, 'overdue', '', 'due', today))).toEqual(['Late']);
    expect(titles(visibleTasks(tasks, 'upcoming', '', 'due', today))).toEqual(['Later']);
    expect(titles(visibleTasks(tasks, 'undated', '', 'due', today))).toEqual(['Someday']);
    expect(titles(visibleTasks(tasks, 'completed', '', 'due', today))).toEqual(['Done new', 'Done old']);
  });

  it('sorts by due date with undated last, or by urgency', () => {
    expect(titles(visibleTasks(tasks, 'all', '', 'due', today))).toEqual([
      'Late', 'Now morning', 'Now afternoon', 'Later', 'Someday',
    ]);
    expect(titles(visibleTasks(tasks, 'all', '', 'urgency', today)).slice(0, 2)).toEqual(['Now morning', 'Later']);
  });

  it('searches titles', () => {
    expect(titles(visibleTasks(tasks, 'all', 'NOW', 'due', today))).toEqual(['Now morning', 'Now afternoon']);
  });

  it('counts each filter', () => {
    expect(counts(tasks, today)).toEqual({ all: 5, today: 2, upcoming: 1, overdue: 1, undated: 1, completed: 2 });
  });

  it('describes last change', () => {
    const now = Date.parse('2026-10-27T10:00:00Z');
    expect(relativeTime('2026-10-27T09:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-10-27T09:30:00Z', now)).toBe('30 min ago');
    expect(relativeTime('2026-10-27T07:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('bad', now)).toBe('');
  });
});
