import type { TaskRow } from './task';

export const filters = ['all', 'today', 'upcoming', 'overdue', 'undated', 'completed'] as const;
export type Filter = (typeof filters)[number];
export type Sort = 'due' | 'urgency';

export const filterLabels: Record<Filter, string> = {
  all: 'All open',
  today: 'Today',
  upcoming: 'Upcoming',
  overdue: 'Overdue',
  undated: 'No date',
  completed: 'Completed',
};

export function matchesFilter(task: TaskRow, filter: Filter, today: string): boolean {
  const done = task.completed_at_ms != null;
  if (filter === 'completed') return done;
  if (done) return false;
  switch (filter) {
    case 'all':
      return true;
    case 'undated':
      return task.undated;
    case 'today':
      return !task.undated && task.due_date_ad === today;
    case 'overdue':
      return !task.undated && task.due_date_ad < today;
    case 'upcoming':
      return !task.undated && task.due_date_ad > today;
  }
}

function byDue(a: TaskRow, b: TaskRow): number {
  if (a.undated !== b.undated) return a.undated ? 1 : -1;
  return (
    a.due_date_ad.localeCompare(b.due_date_ad) ||
    (a.due_time ?? '99:99').localeCompare(b.due_time ?? '99:99') ||
    a.title.localeCompare(b.title)
  );
}

export function visibleTasks(tasks: TaskRow[], filter: Filter, search: string, sort: Sort, today: string): TaskRow[] {
  const needle = search.trim().toLowerCase();
  const list = tasks.filter(
    (t) => matchesFilter(t, filter, today) && (!needle || t.title.toLowerCase().includes(needle)),
  );
  const compare =
    sort === 'urgency' ? (a: TaskRow, b: TaskRow) => b.urgency - a.urgency || byDue(a, b) : byDue;
  const sorted = list.sort(compare);
  // Completed: most recent first.
  return filter === 'completed' && sort === 'due'
    ? sorted.sort((a, b) => (b.completed_at_ms ?? 0) - (a.completed_at_ms ?? 0))
    : sorted;
}

export function counts(tasks: TaskRow[], today: string): Record<Filter, number> {
  return Object.fromEntries(
    filters.map((f) => [f, tasks.filter((t) => matchesFilter(t, f, today)).length]),
  ) as Record<Filter, number>;
}

/// "2 min ago", "3 h ago", or a date, for the last-changed indicator.
export function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  if (seconds < 7 * 86400) return `${Math.round(seconds / 86400)} d ago`;
  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
