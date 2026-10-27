import { z } from 'zod';

/// The phone's Tasks tab (the planner), as synced by migration 0005.

export const statuses = ['doing', 'todo', 'backlog', 'done', 'cancelled'] as const;
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

/// Order inside a status group, as on the phone: critical first, then the
/// manual order.
export function byBoardOrder(a: PlannerTask, b: PlannerTask): number {
  return Number(b.critical) - Number(a.critical) || a.sort_order - b.sort_order || a.created_at_ms - b.created_at_ms;
}

export type Sort = 'manual' | 'priority' | 'due';

export function sortTasks(tasks: PlannerTask[], sort: Sort): PlannerTask[] {
  const list = [...tasks];
  if (sort === 'priority') return list.sort((a, b) => b.priority - a.priority || byBoardOrder(a, b));
  if (sort === 'due') {
    return list.sort(
      (a, b) =>
        (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || byBoardOrder(a, b),
    );
  }
  return list.sort(byBoardOrder);
}

export type Scope = 'all' | 'inbox' | 'today' | 'overdue' | { project: string };

/// Top-level tasks (not sub-tasks) in [scope], matching [search].
export function visibleTasks(tasks: PlannerTask[], scope: Scope, search: string, today: string): PlannerTask[] {
  const needle = search.trim().toLowerCase();
  return tasks.filter((t) => {
    if (t.parent_id) return false;
    if (needle && !`${t.title} ${t.labels} ${t.description}`.toLowerCase().includes(needle)) return false;
    if (scope === 'all') return true;
    if (scope === 'inbox') return !t.project_id;
    if (scope === 'today') return !isClosed(t.status) && (t.due_date === today || (t.start_date !== null && t.start_date <= today && (t.due_date ?? today) >= today));
    if (scope === 'overdue') return !isClosed(t.status) && t.due_date !== null && t.due_date < today;
    return t.project_id === scope.project;
  });
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
