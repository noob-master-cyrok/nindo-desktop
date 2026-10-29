import { localIsoDate, type PlannerTask } from './planner';

/// Worked time, breaks and attendance, as the phone syncs them (migration
/// 0006). The desktop reads sessions and break runs; it edits attendance.

interface Synced {
  id: string;
  owner_id: string;
  created_at_ms?: number;
  updated_at_ms: number;
  deleted_at_ms: number | null;
  revision: number;
  server_updated_at: string;
}

/// A stretch of work on a task: `focus` (a Pomodoro), `manual`, or timed.
export interface Session extends Synced {
  task_id: string;
  kind: string;
  started_at_ms: number;
  minutes: number;
}

export interface Break extends Synced {
  title: string;
  description: string;
}

export interface BreakRun extends Synced {
  break_id: string;
  started_at_ms: number;
  ended_at_ms: number;
}

/// One local day (`id` is yyyy-mm-dd).
export interface AttendanceDay extends Synced {
  check_in_ms: number | null;
  check_out_ms: number | null;
  note: string;
  edited: boolean;
}

export interface TimeData {
  sessions: Session[];
  breaks: Break[];
  runs: BreakRun[];
  attendance: AttendanceDay[];
}

/// Each session's share of the wall clock, in minutes: timed work that
/// overlaps counts once, split evenly among the sessions running at that
/// moment; time added by hand counts in full (the phone's `sessionShares`).
export function sessionShares(sessions: Pick<Session, 'id' | 'kind' | 'started_at_ms' | 'minutes'>[]): Map<string, number> {
  const shares = new Map<string, number>();
  const edges: { at: number; start: boolean; id: string }[] = [];
  for (const s of sessions) {
    if (s.kind === 'manual') {
      shares.set(s.id, s.minutes);
      continue;
    }
    shares.set(s.id, 0);
    if (s.minutes <= 0) continue;
    edges.push({ at: s.started_at_ms, start: true, id: s.id });
    edges.push({ at: s.started_at_ms + s.minutes * 60_000, start: false, id: s.id });
  }
  // Ends before starts at the same moment, so back-to-back runs never meet.
  edges.sort((a, b) => a.at - b.at || Number(a.start) - Number(b.start));
  const open = new Set<string>();
  let last: number | null = null;
  for (const e of edges) {
    if (last !== null && open.size > 0 && e.at > last) {
      const each = (e.at - last) / 60_000 / open.size;
      for (const id of open) shares.set(id, (shares.get(id) ?? 0) + each);
    }
    last = e.at;
    if (e.start) open.add(e.id);
    else open.delete(e.id);
  }
  return shares;
}

export function startOfLocalDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getTime();
}

/// Local days from [from] for [count] days, as yyyy-mm-dd.
export function daysFrom(from: string, count: number): string[] {
  const start = startOfLocalDay(from);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return localIsoDate(d);
  });
}

/// The Sunday on or before [iso]: the phone's week starts on Sunday.
export function weekStart(iso: string): string {
  const d = new Date(startOfLocalDay(iso));
  d.setDate(d.getDate() - d.getDay());
  return localIsoDate(d);
}

export interface DayTime {
  day: string;
  workedMinutes: number;
  breakMinutes: number;
  /// Hours from check-in to check-out; null without both.
  attendanceMinutes: number | null;
}

/// Worked time (overlap counted once), break time and attendance for each of
/// [days]. Sessions and runs belong to the day they started on.
export function weekTime(days: string[], data: TimeData): DayTime[] {
  const shares = sessionShares(data.sessions);
  return days.map((day) => {
    const from = startOfLocalDay(day);
    const to = from + 24 * 3_600_000;
    const inDay = (ms: number) => ms >= from && ms < to;
    const worked = data.sessions.filter((s) => inDay(s.started_at_ms)).reduce((n, s) => n + (shares.get(s.id) ?? 0), 0);
    const rest = data.runs.filter((r) => inDay(r.started_at_ms)).reduce((n, r) => n + Math.max(0, r.ended_at_ms - r.started_at_ms) / 60_000, 0);
    const att = data.attendance.find((a) => a.id === day);
    const attendance =
      att && att.check_in_ms !== null && att.check_out_ms !== null && att.check_out_ms > att.check_in_ms
        ? Math.round((att.check_out_ms - att.check_in_ms) / 60_000)
        : null;
    return { day, workedMinutes: Math.round(worked), breakMinutes: Math.round(rest), attendanceMinutes: attendance };
  });
}

/// A session as a history line, so Today's highlights can use real sessions.
export function sessionsAsActivity(sessions: Session[]) {
  return sessions.map((s) => ({ task_id: s.task_id, kind: 'time', body: String(s.minutes), created_at_ms: s.started_at_ms }));
}

/// Minutes worked on [task] today from [sessions].
export function minutesOn(task: Pick<PlannerTask, 'id'>, sessions: Session[]): number {
  return Math.round(sessions.filter((s) => s.task_id === task.id).reduce((n, s) => n + s.minutes, 0));
}

/// "HH:MM" for a time input from epoch ms (local), or '' when none.
export function timeInput(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/// Epoch ms for [day] at "HH:MM"; null for ''. A check-out earlier than the
/// check-in means the next morning, as on the phone.
export function atTime(day: string, hhmm: string, after?: number | null): number | null {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const d = new Date(startOfLocalDay(day));
  d.setHours(h, m, 0, 0);
  if (after != null && d.getTime() < after) d.setDate(d.getDate() + 1);
  return d.getTime();
}
