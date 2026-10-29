import { z } from 'zod';

/// The phone's Tasks tab (the planner), as synced by migration 0005.

/// In board order, as on the phone.
export const statuses = ['backlog', 'todo', 'doing', 'done', 'cancelled'] as const;
export type Status = (typeof statuses)[number];

export const statusLabels: Record<Status, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  doing: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const priorityLabels = ['No priority', 'Low', 'Medium', 'High', 'Urgent'] as const;

export function isClosed(status: string): boolean {
  return status === 'done' || status === 'cancelled';
}

/// The phone's project colours (index stored on the project).
export const projectColors = ['#6B665C', '#B8336A', '#2E7D6B', '#3466B0', '#9A5418', '#7B4FB0', '#B42318', '#1F7A8C'];

export function projectColor(index: number): string {
  return projectColors[index] ?? projectColors[0]!;
}

interface Synced {
  id: string;
  owner_id: string;
  created_at_ms: number;
  updated_at_ms: number;
  deleted_at_ms: number | null;
  revision: number;
  server_updated_at: string;
}

export interface Project extends Synced {
  name: string;
  color: number;
  sort_order: number;
  archived: boolean;
}

export interface PlannerTask extends Synced {
  project_id: string | null;
  parent_id: string | null;
  title: string;
  description: string;
  status: Status;
  priority: number;
  labels: string;
  start_date: string | null;
  due_date: string | null;
  sort_order: number;
  estimate_minutes: number | null;
  critical: boolean;
  completed_at_ms: number | null;
}

export interface Link extends Synced {
  task_id: string;
  url: string;
  title: string | null;
}

export interface Activity extends Synced {
  task_id: string;
  kind: string;
  body: string;
}

/// Fields a person can change from the desktop.
export type TaskEdit = Partial<
  Pick<
    PlannerTask,
    | 'title'
    | 'description'
    | 'status'
    | 'priority'
    | 'project_id'
    | 'labels'
    | 'start_date'
    | 'due_date'
    | 'estimate_minutes'
    | 'critical'
    | 'completed_at_ms'
    | 'deleted_at_ms'
    | 'sort_order'
  >
>;

/// Labels as the phone stores them: trimmed, distinct, comma separated.
export function decodeLabels(value: string): string[] {
  return value.split(',').map((l) => l.trim()).filter(Boolean);
}

export function encodeLabels(labels: Iterable<string>): string {
  return [...new Set([...labels].map((l) => l.trim().replace(/,/g, ' ')).filter(Boolean))].join(',');
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function localIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const optionalDate = z.string().refine(isValidIsoDate, 'Use a real date as yyyy-mm-dd.').nullable();

/// Mirrors the `planner_tasks` check constraints so a person sees a friendly
/// message instead of a database error.
const taskSchema = z
  .object({
    id: z.string().min(1).max(80),
    title: z.string().trim().min(1, 'Give the task a title.').max(300, 'Titles can be at most 300 characters.'),
    description: z.string().max(100000, 'The description is too long.'),
    status: z.enum(['backlog', 'todo', 'doing', 'done', 'cancelled']),
    priority: z.number().int().min(0).max(4),
    labels: z.string().max(4000, 'Too many labels.'),
    start_date: optionalDate,
    due_date: optionalDate,
    estimate_minutes: z.number().int().min(0, 'The estimate must be 0 minutes or more.').nullable(),
    project_id: z.string().max(80).nullable(),
    parent_id: z.string().max(80).nullable(),
  })
  .loose()
  .refine(
    (t) => !t.start_date || !t.due_date || t.start_date <= t.due_date,
    'The start date must be on or before the due date.',
  );

export function validateTask(row: object): string[] {
  const result = taskSchema.safeParse(row);
  return result.success ? [] : [...new Set(result.error.issues.map((i) => i.message))];
}

/// A brand-new task, matching what the phone writes on create.
export function newTask(
  id: string,
  now: number,
  fields: Pick<PlannerTask, 'title'> & Partial<PlannerTask>,
): Omit<PlannerTask, 'owner_id' | 'revision' | 'server_updated_at'> {
  const status = fields.status ?? 'todo';
  return {
    id,
    project_id: fields.project_id ?? null,
    parent_id: fields.parent_id ?? null,
    title: fields.title.trim(),
    description: fields.description ?? '',
    status,
    priority: fields.priority ?? 0,
    labels: fields.labels ?? '',
    start_date: fields.start_date ?? null,
    due_date: fields.due_date ?? null,
    sort_order: fields.sort_order ?? 0,
    estimate_minutes: fields.estimate_minutes ?? null,
    critical: fields.critical ?? false,
    created_at_ms: now,
    updated_at_ms: now,
    completed_at_ms: isClosed(status) ? now : null,
    deleted_at_ms: null,
  };
}

/// The hand-made order: sort order, then oldest first.
export function byBoardOrder(a: PlannerTask, b: PlannerTask): number {
  return a.sort_order - b.sort_order || a.created_at_ms - b.created_at_ms;
}

export type Sort = 'manual' | 'due' | 'priority' | 'updated';

export const sortLabels: Record<Sort, string> = {
  manual: 'My order',
  due: 'Due date',
  priority: 'Priority',
  updated: 'Last changed',
};

/// [tasks] in [sort] order, as the phone sorts them: open critical tasks
/// lead every order but the hand-made one.
export function sortTasks(tasks: PlannerTask[], sort: Sort): PlannerTask[] {
  const list = [...tasks];
  const compare: (a: PlannerTask, b: PlannerTask) => number =
    sort === 'due'
      ? (a, b) =>
          a.due_date === b.due_date
            ? byBoardOrder(a, b)
            : a.due_date === null
              ? 1
              : b.due_date === null
                ? -1
                : a.due_date.localeCompare(b.due_date)
      : sort === 'priority'
        ? (a, b) => b.priority - a.priority || byBoardOrder(a, b)
        : sort === 'updated'
          ? (a, b) => b.updated_at_ms - a.updated_at_ms
          : byBoardOrder;
  if (sort === 'manual') return list.sort(compare);
  const rank = (t: PlannerTask) => (t.critical && !isClosed(t.status) ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b) || compare(a, b));
}

export type Scope = 'all' | 'inbox' | 'today' | 'overdue' | { project: string };

export type Due = 'any' | 'overdue' | 'today' | 'week' | 'none';

export const dueLabels: Record<Due, string> = {
  any: 'Any time',
  overdue: 'Overdue',
  today: 'Due today',
  week: 'Next 7 days',
  none: 'No date',
};

/// The phone's filter sheet: priorities, labels, due and done.
export interface Filter {
  priorities: number[];
  labels: string[];
  due: Due;
  showClosed: boolean;
}

export const noFilter: Filter = { priorities: [], labels: [], due: 'any', showClosed: true };

export function filterActive(f: Filter): boolean {
  return f.priorities.length > 0 || f.labels.length > 0 || f.due !== 'any' || !f.showClosed;
}

/// [iso] moved by [days].
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return localIsoDate(new Date(y, m - 1, d + days));
}

export function isOverdue(t: Pick<PlannerTask, 'status' | 'due_date'>, today: string): boolean {
  return !isClosed(t.status) && t.due_date !== null && t.due_date < today;
}

/// Top-level tasks (not sub-tasks) in [scope], matching [search] (every
/// word, as on the phone) and [filter].
export function visibleTasks(
  tasks: PlannerTask[],
  scope: Scope,
  search: string,
  today: string,
  filter: Filter = noFilter,
): PlannerTask[] {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const weekEnd = addDays(today, 7);
  return tasks.filter((t) => {
    if (t.parent_id) return false;
    if (words.length) {
      const text = `${t.title} ${t.description} ${t.labels}`.toLowerCase();
      if (!words.every((w) => text.includes(w))) return false;
    }
    if (filter.priorities.length && !filter.priorities.includes(t.priority)) return false;
    if (filter.labels.length && !decodeLabels(t.labels).some((l) => filter.labels.includes(l))) return false;
    if (!filter.showClosed && isClosed(t.status)) return false;
    const d = t.due_date;
    if (filter.due === 'overdue' && !isOverdue(t, today)) return false;
    if (filter.due === 'today' && d !== today) return false;
    if (filter.due === 'week' && (d === null || d < today || d > weekEnd)) return false;
    if (filter.due === 'none' && d !== null) return false;
    if (scope === 'all') return true;
    if (scope === 'inbox') return !t.project_id;
    if (scope === 'today') return !isClosed(t.status) && (t.due_date === today || (t.start_date !== null && t.start_date <= today && (t.due_date ?? today) >= today));
    if (scope === 'overdue') return isOverdue(t, today);
    return t.project_id === scope.project;
  });
}

/// [tasks] split by project, keeping their order: projects in [projects]
/// order, then tasks with no (or an unknown) project, under null, last.
export function groupByProject(tasks: PlannerTask[], projects: Project[]): { projectId: string | null; tasks: PlannerTask[] }[] {
  const known = new Set(projects.map((p) => p.id));
  const groups = new Map<string | null, PlannerTask[]>();
  for (const t of tasks) {
    const id = t.project_id && known.has(t.project_id) ? t.project_id : null;
    groups.set(id, [...(groups.get(id) ?? []), t]);
  }
  return [
    ...projects.filter((p) => groups.has(p.id)).map((p) => ({ projectId: p.id as string | null, tasks: groups.get(p.id)! })),
    ...(groups.has(null) ? [{ projectId: null, tasks: groups.get(null)! }] : []),
  ];
}

/// The phone's summary strip, over top-level tasks.
export function summary(tasks: PlannerTask[], today: string, now: number) {
  const top = tasks.filter((t) => !t.parent_id);
  const weekAgo = now - 7 * 24 * 3_600_000;
  return {
    open: top.filter((t) => !isClosed(t.status)).length,
    doing: top.filter((t) => t.status === 'doing').length,
    overdue: top.filter((t) => isOverdue(t, today)).length,
    doneWeek: top.filter((t) => t.status === 'done' && t.completed_at_ms !== null && t.completed_at_ms > weekAgo).length,
  };
}

/// Sort order for a task dropped at [index] of [column] (the other tasks in
/// the target status, in order), like the phone's board.
export function orderAt(column: PlannerTask[], index: number): number {
  const i = Math.max(0, Math.min(index, column.length));
  const before = i === 0 ? null : column[i - 1]!.sort_order;
  const after = i >= column.length ? null : column[i]!.sort_order;
  if (before === null && after === null) return 1;
  if (before === null) return after! - 1;
  if (after === null) return before + 1;
  return (before + after) / 2;
}

/// Daily planning tasks have fixed ids, one a day.
export function dailyPlanningId(today: string): string {
  return `daily-planning-${today}`;
}

/// "1 h 25 min", "40 min".
export function durationLabel(minutes: number, num: (n: number) => string = String): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${num(m)} min`;
  if (m === 0) return `${num(h)} h`;
  return `${num(h)} h ${num(m)} min`;
}

/// Minutes logged on a history line ("focus" and "time" carry minutes).
export function loggedMinutes(a: Pick<Activity, 'kind' | 'body'>): number {
  if (a.kind !== 'focus' && a.kind !== 'time') return 0;
  const n = Number.parseInt(a.body, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/// Critical, high or urgent.
export function isMajor(t: Pick<PlannerTask, 'critical' | 'priority'>): boolean {
  return t.critical || t.priority >= 3;
}

/// Which of today's tasks Today's highlights lists.
export interface HighlightFilter {
  statuses: Status[];
  /// Project ids; null stands for Inbox. Empty: every project.
  projects: (string | null)[];
  majorOnly: boolean;
}

export const defaultHighlights: HighlightFilter = { statuses: ['done'], projects: [], majorOnly: false };

export interface Highlight {
  task: PlannerTask;
  minutesToday: number;
}

/// Today's highlights, as on the phone: top-level tasks finished (or worked
/// on, or dropped) on the day that starts at [dayStart], the major ones
/// first, then by time spent, then the latest first. Time spent comes from
/// today's focus and time lines in the tasks' history.
export function todaysHighlights(
  tasks: PlannerTask[],
  activity: Pick<Activity, 'task_id' | 'kind' | 'body' | 'created_at_ms'>[],
  dayStart: number,
  filter: HighlightFilter = defaultHighlights,
): Highlight[] {
  const dayEnd = dayStart + 24 * 3_600_000;
  const isToday = (ms: number | null) => ms !== null && ms >= dayStart && ms < dayEnd;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const minutes = new Map<string, number>();
  for (const a of activity) {
    if (!isToday(a.created_at_ms)) continue;
    const t = byId.get(a.task_id);
    const id = t?.parent_id ?? a.task_id;
    minutes.set(id, (minutes.get(id) ?? 0) + loggedMinutes(a));
  }
  const today = (t: PlannerTask) =>
    t.status === 'done'
      ? isToday(t.completed_at_ms)
      : t.status === 'doing'
        ? (minutes.get(t.id) ?? 0) > 0
        : t.status === 'cancelled'
          ? isToday(t.updated_at_ms)
          : false;
  const list = tasks
    .filter(
      (t) =>
        t.deleted_at_ms == null &&
        !t.parent_id &&
        filter.statuses.includes(t.status) &&
        today(t) &&
        (filter.projects.length === 0 || filter.projects.includes(t.project_id)) &&
        (!filter.majorOnly || isMajor(t)),
    )
    .map((task) => ({ task, minutesToday: minutes.get(task.id) ?? 0 }));
  const weight = (t: PlannerTask) => (t.critical ? 10 : 0) + t.priority;
  const when = (t: PlannerTask) => t.completed_at_ms ?? t.updated_at_ms;
  return list.sort(
    (a, b) => weight(b.task) - weight(a.task) || b.minutesToday - a.minutesToday || when(b.task) - when(a.task),
  );
}

/// The changes that move a task to [status], keeping completed_at_ms in step
/// as the phone does.
export function statusChange(task: Pick<PlannerTask, 'status' | 'completed_at_ms'>, status: Status, now: number): TaskEdit {
  if (task.status === status) return {};
  const wasClosed = isClosed(task.status);
  const closed = isClosed(status);
  return {
    status,
    completed_at_ms: closed ? (wasClosed ? task.completed_at_ms : now) : null,
  };
}

/// A readable line for a history entry (the phone's activity log).
export function activityText(a: Activity, projects: Project[]): string {
  switch (a.kind) {
    case 'created':
      return 'Created';
    case 'status':
      return `Status: ${statusLabels[a.body as Status] ?? a.body}`;
    case 'priority':
      return `Priority: ${priorityLabels[['none', 'low', 'medium', 'high', 'urgent'].indexOf(a.body)] ?? a.body}`;
    case 'due':
      return a.body ? `Due ${a.body}` : 'Due date removed';
    case 'project':
      return a.body ? `Project: ${projects.find((p) => p.id === a.body)?.name ?? 'a removed project'}` : 'Moved to Inbox';
    case 'critical':
      return a.body === '1' ? 'Marked critical' : 'No longer critical';
    case 'link':
      return `Link added: ${a.body}`;
    case 'file':
      return `File added on phone: ${a.body}`;
    case 'focus':
      return `Focus session: ${a.body} min`;
    case 'time':
      return `Time logged: ${a.body} min`;
    default:
      return a.body ? `${a.kind}: ${a.body}` : a.kind;
  }
}
