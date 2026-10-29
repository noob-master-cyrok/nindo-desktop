import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlannerRepo } from '../data/plannerRepo';
import {
  emptyClock,
  parseClock,
  pauseTimers,
  resetTimer,
  runningTimers,
  startFocus,
  startTimer,
  stopFocus,
  takeBreak,
  tickFocus,
  type ClockState,
  type Log,
} from '../domain/clock';
import { isClosed, type PlannerTask } from '../domain/planner';

const key = 'nindo.desktop.clock';

function load(): ClockState {
  try {
    return parseClock(localStorage.getItem(key));
  } catch {
    return emptyClock;
  }
}

function save(state: ClockState) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Private windows may refuse; the timers then last for this visit.
  }
}

/// The timers running on this computer, kept across reloads and shared
/// between tabs. Finished time is logged on the task through [planner].
export function useTimers({
  planner,
  tasks,
  onLogged,
  say,
}: {
  planner: PlannerRepo;
  tasks: PlannerTask[];
  onLogged: () => void;
  say: (text: string) => void;
}) {
  const [state, setState] = useState<ClockState>(load);
  const [now, setNow] = useState(() => Date.now());
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const write = useCallback(
    async (logs: Log[]) => {
      let wrote = false;
      for (const l of logs) {
        const task = tasksRef.current.find((t) => t.id === l.taskId);
        if (!task) continue;
        try {
          const r = await planner.logTime(task, l.minutes, l.startedAt);
          if (r.status === 'saved') wrote = true;
        } catch {
          say('That time could not be saved. Check your connection.');
        }
      }
      if (wrote) onLogged();
    },
    [planner, onLogged, say],
  );

  const apply = useCallback(
    (next: ClockState, logs: Log[] = []) => {
      setState(next);
      save(next);
      if (logs.length) void write(logs);
    },
    [write],
  );

  // Another tab started or stopped something.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => e.key === key && setState(load());
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const active = runningTimers(state).length > 0 || state.focus !== null || state.rest !== null;
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [active]);

  // A focus round moves on when its time is up.
  useEffect(() => {
    const r = tickFocus(state, now);
    if (!r.event) return;
    apply(r.state, r.logs);
    say(r.event === 'rest' ? `Focus round done. Take ${5} minutes.` : 'Rest over. Ready for the next round.');
  }, [now, state, apply, say]);

  // Finishing a task (here or on the phone) pauses its timer and focus.
  useEffect(() => {
    const closed = new Set(tasks.filter((t) => isClosed(t.status) || t.deleted_at_ms != null).map((t) => t.id));
    const stop = runningTimers(state).filter((id) => closed.has(id));
    const focusDone = state.focus?.phase === 'focus' && closed.has(state.focus.taskId);
    if (!stop.length && !focusDone) return;
    const t = Date.now();
    const paused = pauseTimers(state, stop, t);
    const stopped = focusDone ? stopFocus(paused.state, t) : { state: paused.state, logs: [] };
    apply(stopped.state, [...paused.logs, ...stopped.logs]);
  }, [tasks, state, apply]);

  return {
    state,
    now,
    toggle: (task: PlannerTask) => {
      const t = Date.now();
      setNow(t);
      if (state.timers[task.id]?.startedAt != null) {
        const r = pauseTimers(state, [task.id], t);
        apply(r.state, r.logs);
      } else apply(startTimer(state, task.id, t));
    },
    pauseAll: () => {
      const r = pauseTimers(state, runningTimers(state), Date.now());
      apply(r.state, r.logs);
    },
    reset: (taskId: string) => apply(resetTimer(state, taskId)),
    startFocus: (task: PlannerTask, minutes: number) => {
      const t = Date.now();
      setNow(t);
      const stopped = stopFocus(state, t);
      apply(startFocus(stopped.state, task.id, task.title, minutes, t), stopped.logs);
    },
    stopFocus: () => {
      const r = stopFocus(state, Date.now());
      apply(r.state, r.logs);
    },
    takeBreak: () => {
      const t = Date.now();
      setNow(t);
      const r = takeBreak(state, crypto.randomUUID(), t);
      apply(r.state, r.logs);
    },
    nameBreak: (title: string) => state.rest && apply({ ...state, rest: { ...state.rest, title } }),
    endBreak: async () => {
      const rest = state.rest;
      if (!rest) return;
      apply({ ...state, rest: null });
      try {
        const r = await planner.recordBreak(rest.id, rest.title, rest.startedAt, Date.now());
        if (r.status === 'saved') onLogged();
      } catch {
        say('That break could not be saved. Check your connection.');
      }
    },
  };
}

export type Timers = ReturnType<typeof useTimers>;
