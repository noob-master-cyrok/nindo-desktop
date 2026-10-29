/// Timers that run on this computer: task timers (several at once), one
/// focus round (Pomodoro) and one break. Like the phone, the running clock
/// stays on the device; finished time is logged as synced sessions and
/// break runs. Pure functions here; `useTimers` keeps the state.

export interface TaskTimer {
  /// When the current run started; null while paused.
  startedAt: number | null;
  /// Time already run that is not logged yet (under a minute).
  carriedMs: number;
}

export interface FocusRound {
  taskId: string;
  title: string;
  phase: 'focus' | 'rest';
  minutes: number;
  startedAt: number;
  endsAt: number;
}

export interface RunningBreak {
  id: string;
  title: string;
  startedAt: number;
}

export interface ClockState {
  timers: Record<string, TaskTimer>;
  focus: FocusRound | null;
  rest: RunningBreak | null;
}

export const emptyClock: ClockState = { timers: {}, focus: null, rest: null };

export const focusChoices = [15, 25, 45, 50] as const;
export const restMinutes = 5;

export function isRunning(state: ClockState, taskId: string): boolean {
  return state.timers[taskId]?.startedAt != null || state.focus?.taskId === taskId && state.focus.phase === 'focus';
}

/// Milliseconds a task timer shows: carried time plus the running stretch.
export function timerElapsed(t: TaskTimer | undefined, now: number): number {
  if (!t) return 0;
  return t.carriedMs + (t.startedAt != null ? Math.max(0, now - t.startedAt) : 0);
}

/// "1:05:09" or "25:00".
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

export interface Log {
  taskId: string;
  minutes: number;
  startedAt: number;
}

/// Starts [taskId]'s timer.
export function startTimer(state: ClockState, taskId: string, now: number): ClockState {
  const t = state.timers[taskId] ?? { startedAt: null, carriedMs: 0 };
  if (t.startedAt != null) return state;
  return { ...state, timers: { ...state.timers, [taskId]: { ...t, startedAt: now } } };
}

/// Pauses [taskIds]: whole minutes are logged, the rest carries over.
export function pauseTimers(state: ClockState, taskIds: string[], now: number): { state: ClockState; logs: Log[] } {
  const timers = { ...state.timers };
  const logs: Log[] = [];
  for (const id of taskIds) {
    const t = timers[id];
    if (!t || t.startedAt == null) continue;
    const total = t.carriedMs + Math.max(0, now - t.startedAt);
    const minutes = Math.floor(total / 60_000);
    if (minutes > 0) logs.push({ taskId: id, minutes, startedAt: now - minutes * 60_000 });
    timers[id] = { startedAt: null, carriedMs: total - minutes * 60_000 };
  }
  return { state: { ...state, timers }, logs };
}

export function runningTimers(state: ClockState): string[] {
  return Object.entries(state.timers)
    .filter(([, t]) => t.startedAt != null)
    .map(([id]) => id);
}

/// Forgets a paused timer's leftover seconds (Reset).
export function resetTimer(state: ClockState, taskId: string): ClockState {
  const timers = { ...state.timers };
  delete timers[taskId];
  return { ...state, timers };
}

export function startFocus(state: ClockState, taskId: string, title: string, minutes: number, now: number): ClockState {
  return { ...state, focus: { taskId, title, phase: 'focus', minutes, startedAt: now, endsAt: now + minutes * 60_000 } };
}

/// Stops the focus round: whole minutes of focus done so far are logged.
export function stopFocus(state: ClockState, now: number): { state: ClockState; logs: Log[] } {
  const f = state.focus;
  const logs: Log[] = [];
  if (f && f.phase === 'focus') {
    const minutes = Math.floor((Math.min(now, f.endsAt) - f.startedAt) / 60_000);
    if (minutes > 0) logs.push({ taskId: f.taskId, minutes, startedAt: f.startedAt });
  }
  return { state: { ...state, focus: null }, logs };
}

/// Moves a focus round on when its time is up: focus → a short rest (the
/// full round is logged) → done.
export function tickFocus(state: ClockState, now: number): { state: ClockState; logs: Log[]; event: 'rest' | 'done' | null } {
  const f = state.focus;
  if (!f || now < f.endsAt) return { state, logs: [], event: null };
  if (f.phase === 'focus') {
    return {
      state: { ...state, focus: { ...f, phase: 'rest', startedAt: f.endsAt, endsAt: f.endsAt + restMinutes * 60_000 } },
      logs: [{ taskId: f.taskId, minutes: f.minutes, startedAt: f.startedAt }],
      event: 'rest',
    };
  }
  return { state: { ...state, focus: null }, logs: [], event: 'done' };
}

/// Takes a break: every task timer and a focus round pause first, as on the
/// phone, so break time never counts as work.
export function takeBreak(state: ClockState, id: string, now: number): { state: ClockState; logs: Log[] } {
  const paused = pauseTimers(state, runningTimers(state), now);
  const stopped = stopFocus(paused.state, now);
  return { state: { ...stopped.state, rest: { id, title: '', startedAt: now } }, logs: [...paused.logs, ...stopped.logs] };
}

export function parseClock(raw: string | null): ClockState {
  if (!raw) return emptyClock;
  try {
    const v = JSON.parse(raw) as Partial<ClockState>;
    const timers: Record<string, TaskTimer> = {};
    for (const [id, t] of Object.entries(v.timers ?? {})) {
      if (t && typeof t.carriedMs === 'number') timers[id] = { startedAt: typeof t.startedAt === 'number' ? t.startedAt : null, carriedMs: t.carriedMs };
    }
    const f = v.focus;
    const r = v.rest;
    return {
      timers,
      focus: f && typeof f.endsAt === 'number' && typeof f.taskId === 'string' ? f : null,
      rest: r && typeof r.startedAt === 'number' && typeof r.id === 'string' ? r : null,
    };
  } catch {
    return emptyClock;
  }
}
