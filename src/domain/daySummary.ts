import { decodeLabels, durationLabel, isClosed, type PlannerTask, type Project } from './planner';
import { daysFrom, sessionShares, startOfLocalDay, weekTime, type TimeData } from './time';

/// What a day, week or month held, for the Tasks page's summary and its
/// copied report: tasks finished, work in hand, time worked per project,
/// breaks and attendance. Subtasks count only through their parent's time.

export interface ProjectTime {
  projectId: string | null;
  minutes: number;
}

/// What the report talks about. Empty lists mean everything; a task can be
/// left out by hand on top of that.
export interface ReportScope {
  projects: (string | null)[];
  labels: string[];
  hidden: string[];
}

export const fullScope: ReportScope = { projects: [], labels: [], hidden: [] };

export function scopeNarrowed(s: ReportScope): boolean {
  return s.projects.length > 0 || s.labels.length > 0 || s.hidden.length > 0;
}

/// Whether [t] (a top-level task) belongs in a report with [scope].
export function inScope(t: Pick<PlannerTask, 'id' | 'project_id' | 'labels'>, scope: ReportScope): boolean {
  if (scope.hidden.includes(t.id)) return false;
  if (scope.projects.length && !scope.projects.includes(t.project_id ?? null)) return false;
  if (scope.labels.length && !decodeLabels(t.labels ?? '').some((l) => scope.labels.includes(l))) return false;
  return true;
}

export interface DaySummary {
  /// First day and the number of days covered (1, 7, or a month).
  day: string;
  days: number;
  done: PlannerTask[];
  /// In progress now (when the range holds today), or worked on in the range
  /// without being finished.
  inHand: PlannerTask[];
  /// Every task the range touched before the scope, for picking what to keep.
  touched: PlannerTask[];
  workedMinutes: number;
  breakMinutes: number;
  /// Check-in and check-out of a single day.
  checkInMs: number | null;
  checkOutMs: number | null;
  /// Check-in to check-out, added over the range.
  attendanceMinutes: number;
  byProject: ProjectTime[];
  minutesByTask: Map<string, number>;
}

export function rangeSummary(from: string, count: number, tasks: PlannerTask[], time: TimeData | null, today: string, scope: ReportScope = fullScope): DaySummary {
  const days = daysFrom(from, count);
  const start = startOfLocalDay(from);
  const end = startOfLocalDay(days.at(-1)!) + 24 * 3_600_000;
  const inRange = (ms: number | null | undefined) => ms != null && ms >= start && ms < end;
  const top = tasks.filter((t) => !t.parent_id && t.deleted_at_ms == null && !t.id.startsWith('daily-planning-'));

  // Shares come from every session, so overlapping timers count once even
  // when the report leaves one of them out.
  const sessions = (time?.sessions ?? []).filter((s) => s.deleted_at_ms == null);
  const shares = sessionShares(sessions);
  const parentOf = new Map(tasks.map((t) => [t.id, t.parent_id ?? t.id]));
  const byTask = new Map<string, number>();
  for (const s of sessions) {
    if (!inRange(s.started_at_ms)) continue;
    const id = parentOf.get(s.task_id) ?? s.task_id;
    byTask.set(id, (byTask.get(id) ?? 0) + (shares.get(s.id) ?? 0));
  }

  const holdsToday = days.includes(today);
  const doneAll = top.filter((t) => t.status === 'done' && inRange(t.completed_at_ms)).sort((a, b) => (a.completed_at_ms ?? 0) - (b.completed_at_ms ?? 0));
  const doneIds = new Set(doneAll.map((t) => t.id));
  const inHandAll = top.filter((t) => !doneIds.has(t.id) && !isClosed(t.status) && ((holdsToday && t.status === 'doing') || (byTask.get(t.id) ?? 0) > 0));
  inHandAll.sort((a, b) => (byTask.get(b.id) ?? 0) - (byTask.get(a.id) ?? 0) || a.sort_order - b.sort_order);
  const touched = [...doneAll, ...inHandAll];

  const keep = (t: PlannerTask) => inScope(t, scope);
  const byId = new Map(top.map((t) => [t.id, t]));
  const perProject = new Map<string | null, number>();
  let worked = 0;
  const minutesByTask = new Map<string, number>();
  for (const [id, minutes] of byTask) {
    const t = byId.get(id);
    if (!t || !keep(t)) continue;
    worked += minutes;
    minutesByTask.set(id, Math.round(minutes));
    perProject.set(t.project_id ?? null, (perProject.get(t.project_id ?? null) ?? 0) + minutes);
  }
  const byProject = [...perProject]
    .map(([projectId, minutes]) => ({ projectId, minutes: Math.round(minutes) }))
    .filter((p) => p.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  const totals = time ? weekTime(days, { ...time, sessions }) : [];
  const att = count === 1 ? time?.attendance.find((a) => a.id === from && a.deleted_at_ms == null) : undefined;
  return {
    day: from,
    days: count,
    done: doneAll.filter(keep),
    inHand: inHandAll.filter(keep),
    touched,
    workedMinutes: Math.round(worked),
    breakMinutes: totals.reduce((n, d) => n + d.breakMinutes, 0),
    checkInMs: att?.check_in_ms ?? null,
    checkOutMs: att?.check_out_ms ?? null,
    attendanceMinutes: totals.reduce((n, d) => n + (d.attendanceMinutes ?? 0), 0),
    byProject,
    minutesByTask,
  };
}

export function daySummary(day: string, tasks: PlannerTask[], time: TimeData | null, today: string, scope: ReportScope = fullScope): DaySummary {
  return rangeSummary(day, 1, tasks, time, today, scope);
}

function projectName(projects: Project[], id: string | null): string {
  return id ? (projects.find((p) => p.id === id)?.name ?? 'Other') : 'No project';
}

/// Points to present that follow from the numbers, for the person to keep,
/// change or drop. Plain sentences, no claims beyond the data.
export function suggestedPoints(s: DaySummary, projects: Project[]): string[] {
  const name = (id: string | null) => projectName(projects, id);
  const points: string[] = [];
  if (s.done.length) points.push(`Finished ${s.done.length === 1 ? '' : `${s.done.length} tasks: `}${s.done.map((t) => t.title).join(', ')}`);
  if (s.workedMinutes > 0) {
    const split = s.byProject.length > 1 ? ` (${s.byProject.map((p) => `${name(p.projectId)} ${durationLabel(p.minutes)}`).join(', ')})` : s.byProject.length === 1 ? ` on ${name(s.byProject[0]!.projectId)}` : '';
    points.push(`Worked ${durationLabel(s.workedMinutes)}${split}`);
  }
  if (s.inHand.length) points.push(`In progress: ${s.inHand.map((t) => t.title).join(', ')}`);
  return points;
}

/// A note's lines as points, without their bullets.
export function noteLines(notes: string): string[] {
  return notes
    .split('\n')
    .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean);
}

/// The day as plain text to paste into a message or a report.
export function summaryText(s: DaySummary, projects: Project[], notes: string, dateLabel: string, clock: (ms: number) => string): string {
  const lines = [dateLabel];
  const facts: string[] = [];
  if (s.checkInMs) facts.push(`In ${clock(s.checkInMs)}${s.checkOutMs ? `, out ${clock(s.checkOutMs)}` : ''}`);
  if (s.workedMinutes > 0) facts.push(`worked ${durationLabel(s.workedMinutes)}`);
  if (s.breakMinutes > 0) facts.push(`breaks ${durationLabel(s.breakMinutes)}`);
  if (facts.length) lines.push(facts.join(' · '));
  const own = noteLines(notes);
  const points = own.length ? own : suggestedPoints(s, projects);
  if (points.length) lines.push('', ...points.map((p) => `• ${p}`));
  if (own.length && s.done.length) lines.push('', 'Done', ...s.done.map((t) => `• ${t.title}`));
  return lines.join('\n');
}

/// A week or month as text for Claude (or a person): the numbers, time per
/// project, every task with its minutes, and each day's own notes, under a
/// short request Claude can act on. Nothing outside [scope] is in it.
export function reportForClaude(
  s: DaySummary,
  projects: Project[],
  notesByDay: Record<string, string>,
  title: string,
  dayLabel: (iso: string) => string,
): string {
  const name = (id: string | null) => projectName(projects, id);
  const lines = [
    `Nindo report: ${title}`,
    '',
    'Please turn this into a short update for my superior or client: what was done, where the time went, what is in progress, and anything to flag. Keep it factual and use only what is below.',
    '',
    '## Numbers',
    `Worked: ${durationLabel(s.workedMinutes)}`,
  ];
  if (s.breakMinutes) lines.push(`Breaks: ${durationLabel(s.breakMinutes)}`);
  if (s.attendanceMinutes) lines.push(`At work (check-in to check-out): ${durationLabel(s.attendanceMinutes)}`);
  lines.push(`Tasks finished: ${s.done.length}`);
  if (s.byProject.length) lines.push('', '## Time by project', ...s.byProject.map((p) => `- ${name(p.projectId)}: ${durationLabel(p.minutes)}`));
  const taskLine = (t: PlannerTask, extra: string) => {
    const m = s.minutesByTask.get(t.id);
    const labels = decodeLabels(t.labels ?? '');
    return `- ${t.title} [${name(t.project_id ?? null)}${labels.length ? `; ${labels.join(', ')}` : ''}]${extra}${m ? `, ${durationLabel(m)}` : ''}`;
  };
  if (s.done.length) lines.push('', '## Finished', ...s.done.map((t) => taskLine(t, t.completed_at_ms ? `, done ${dayLabel(isoOfMs(t.completed_at_ms))}` : '')));
  if (s.inHand.length) lines.push('', '## In progress', ...s.inHand.map((t) => taskLine(t, t.due_date ? `, due ${dayLabel(t.due_date)}` : '')));
  const noted = daysFrom(s.day, s.days).filter((d) => noteLines(notesByDay[d] ?? '').length);
  if (noted.length) {
    lines.push('', '## My notes and points');
    for (const d of noted) lines.push(`${dayLabel(d)}:`, ...noteLines(notesByDay[d]!).map((p) => `- ${p}`));
  }
  return lines.join('\n');
}

function isoOfMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
