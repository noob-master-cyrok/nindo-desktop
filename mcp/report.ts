import { rangeSummary, reportForClaude, type ReportScope } from '../src/domain/daySummary';
import { addDays, monthLength } from '../src/domain/dates';
import { decodeLabels, isClosed, localIsoDate, statusLabels, type PlannerTask, type Project, type Status } from '../src/domain/planner';
import { startOfLocalDay, weekStart, type TimeData } from '../src/domain/time';

/// What the connector hands Claude, built from the same summary code as the
/// desktop's day summary column, so the numbers match what Safu sees there.

export interface NindoData {
  tasks: PlannerTask[];
  projects: Project[];
  time: TimeData;
  /// The desktop's notes and points to present, by day (yyyy-mm-dd).
  notes?: Record<string, string>;
}

export type Period = 'day' | 'week' | 'month';

export interface ReportArgs {
  period: Period;
  /// Any day inside the period; today when left out.
  date?: string;
  /// Project names or ids; "No project" for tasks without one. Empty = all.
  projects?: string[];
  labels?: string[];
  /// Task titles or ids to leave out.
  exclude_tasks?: string[];
}

const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(startOfLocalDay(iso)).toLocaleDateString('en-GB', o);

export function rangeOf(period: Period, iso: string): { from: string; count: number; title: string } {
  if (period === 'day') return { from: iso, count: 1, title: fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) };
  if (period === 'week') {
    const from = weekStart(iso);
    return { from, count: 7, title: `Week of ${fmt(from, { day: 'numeric', month: 'long', year: 'numeric' })} to ${fmt(addDays(from, 6), { day: 'numeric', month: 'long' })}` };
  }
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return { from: `${iso.slice(0, 7)}-01`, count: monthLength(y, m), title: fmt(iso, { month: 'long', year: 'numeric' }) };
}

const live = <T extends { deleted_at_ms: number | null }>(rows: T[]) => rows.filter((r) => r.deleted_at_ms == null);

/// Matches project names (any case) or ids; unknown names are reported back.
export function resolveProjects(names: string[], projects: Project[]): { ids: (string | null)[]; unknown: string[] } {
  const ids: (string | null)[] = [];
  const unknown: string[] = [];
  for (const raw of names) {
    const n = raw.trim().toLowerCase();
    if (n === 'no project' || n === 'inbox' || n === 'none') {
      ids.push(null);
      continue;
    }
    const p = live(projects).find((x) => x.id === raw || x.name.trim().toLowerCase() === n);
    if (p) ids.push(p.id);
    else unknown.push(raw);
  }
  return { ids, unknown };
}

export function buildReport(data: NindoData, args: ReportArgs, today: string): string {
  const day = args.date ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return `The date must look like 2026-11-02; got "${day}".`;
  const { from, count, title } = rangeOf(args.period, day);
  const { ids, unknown } = resolveProjects(args.projects ?? [], data.projects);
  if (unknown.length) return `No project called ${unknown.map((u) => `"${u}"`).join(', ')}. Projects: ${live(data.projects).map((p) => p.name).join(', ')}, or "No project".`;
  const tasks = live(data.tasks);
  const exclude = new Set((args.exclude_tasks ?? []).map((x) => x.trim().toLowerCase()));
  const hidden = tasks.filter((t) => exclude.has(t.id.toLowerCase()) || exclude.has(t.title.trim().toLowerCase())).map((t) => t.id);
  const scope: ReportScope = { projects: ids, labels: args.labels ?? [], hidden };
  const s = rangeSummary(from, count, tasks, data.time, today, scope);
  const shortDay = (iso: string) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  const text = reportForClaude(s, data.projects, data.notes ?? {}, title, shortDay);
  const covers = [ids.length ? `projects: ${(args.projects ?? []).join(', ')}` : 'all projects', scope.labels.length ? `labels: ${scope.labels.join(', ')}` : '', hidden.length ? `${hidden.length} task(s) left out` : '']
    .filter(Boolean)
    .join('; ');
  return `${text}\n\n(Report covers ${covers}. Period ${from} to ${addDays(from, count - 1)}. Notes are Safu's own words from the desktop, for the whole period.)`;
}

export interface TaskArgs {
  status?: Status | 'open';
  project?: string;
  query?: string;
  limit?: number;
}

/// Tasks as short lines: title, status, project, labels, due date.
export function listTasks(data: NindoData, args: TaskArgs, today: string): string {
  const projectName = (id: string | null) => (id ? (data.projects.find((p) => p.id === id)?.name ?? 'Other') : 'No project');
  let tasks = live(data.tasks).filter((t) => !t.parent_id);
  if (args.status === 'open') tasks = tasks.filter((t) => !isClosed(t.status));
  else if (args.status) tasks = tasks.filter((t) => t.status === args.status);
  if (args.project) {
    const { ids, unknown } = resolveProjects([args.project], data.projects);
    if (unknown.length) return `No project called "${args.project}".`;
    tasks = tasks.filter((t) => (t.project_id ?? null) === ids[0]);
  }
  if (args.query) {
    const q = args.query.toLowerCase();
    tasks = tasks.filter((t) => t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q) || decodeLabels(t.labels ?? '').some((l) => l.toLowerCase().includes(q)));
  }
  tasks.sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || b.priority - a.priority);
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  if (!tasks.length) return 'No tasks match.';
  const lines = tasks.slice(0, limit).map((t) => {
    const labels = decodeLabels(t.labels ?? '');
    const due = t.due_date ? `, due ${t.due_date}${!isClosed(t.status) && t.due_date < today ? ' (overdue)' : ''}` : '';
    const done = t.completed_at_ms ? `, done ${localIsoDate(new Date(t.completed_at_ms))}` : '';
    return `- ${t.title} [${statusLabels[t.status]}; ${projectName(t.project_id ?? null)}${labels.length ? `; ${labels.join(', ')}` : ''}]${due}${done}`;
  });
  return `${tasks.length} task(s)${tasks.length > limit ? `, first ${limit} shown` : ''}:\n${lines.join('\n')}`;
}

export function listProjects(data: NindoData): string {
  const open = (id: string) => live(data.tasks).filter((t) => !t.parent_id && t.project_id === id && !isClosed(t.status)).length;
  const rows = live(data.projects)
    .filter((p) => !p.archived)
    .map((p) => `- ${p.name}: ${open(p.id)} open task(s)`);
  return rows.length ? `Projects:\n${rows.join('\n')}\n- No project (inbox)` : 'No projects yet.';
}
