import { useEffect, useState } from 'react';
import type { PlannerRepo } from '../data/plannerRepo';
import { clockText, focusChoices, timerElapsed } from '../domain/clock';
import { durationLabel, isClosed, type PlannerTask } from '../domain/planner';
import type { Session } from '../domain/time';
import { useSettings } from '../settings';
import { Close, Expand, Pause, Play, Stop, Timer } from './Icons';
import type { Timers } from './useTimers';

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/// A task's time: its timer, a focus round, and the time log (sessions
/// from here and from the phone), with time added by hand.
export function TimePanel({
  task,
  planner,
  timers,
  onFullScreen,
  onToast,
  onChanged,
}: {
  task: PlannerTask;
  planner: PlannerRepo;
  timers: Timers;
  onFullScreen: () => void;
  onToast: (text: string) => void;
  onChanged: () => void;
}) {
  const { num } = useSettings();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [minutes, setMinutes] = useState('30');
  const [busy, setBusy] = useState(false);
  const timer = timers.state.timers[task.id];
  const running = timer?.startedAt != null;
  const elapsed = timerElapsed(timer, timers.now);
  const focus = timers.state.focus?.taskId === task.id ? timers.state.focus : null;
  const total = (sessions ?? []).reduce((n, s) => n + s.minutes, 0);
  const closed = isClosed(task.status);

  const load = () =>
    planner
      .sessionsFor(task.id)
      .then(setSessions)
      .catch(() => setSessions([]));
  // Reload the log when the task changes (a timer logged time on it).
  useEffect(() => {
    void load();
  }, [task.id, task.revision]);

  return (
    <section className="time-card" aria-label="Time">
      <div className="time-head">
        <Timer size={18} className="acc-ink" />
        <h3 className="kicker">Time</h3>
        <span className="muted small push">{sessions === null ? '' : `${durationLabel(total, num)} logged`}</span>
      </div>

      <div className={running || focus ? 'time-live on' : 'time-live'}>
        <span className="big-clock" aria-live="off">
          {num(focus ? clockText(focus.endsAt - timers.now) : clockText(elapsed))}
        </span>
        <span className="muted small">
          {focus ? (focus.phase === 'focus' ? `Focus round · ${num(focus.minutes)} min` : 'Rest') : running ? 'Timer running' : elapsed ? 'Paused' : 'Timer'}
        </span>
        <div className="row time-actions">
          {focus ? (
            <button className="secondary" onClick={timers.stopFocus}>
              <Stop size={16} /> Stop
            </button>
          ) : (
            <>
              <button className={running ? 'secondary' : 'primary'} disabled={closed} onClick={() => timers.toggle(task)}>
                {running ? <Pause size={16} /> : <Play size={16} />} {running ? 'Pause' : elapsed ? 'Resume' : 'Start timer'}
              </button>
              {!running && elapsed > 0 && (
                <button className="text" onClick={() => timers.reset(task.id)}>
                  Reset
                </button>
              )}
            </>
          )}
          {(running || focus) && (
            <button className="icon-button push" aria-label="Full screen" title="Full screen" onClick={onFullScreen}>
              <Expand />
            </button>
          )}
        </div>
        {!focus && !closed && (
          <div className="chips focus-chips" aria-label="Focus round">
            <span className="muted small">Focus</span>
            {focusChoices.map((m) => (
              <button key={m} className="chip" onClick={() => timers.startFocus(task, m)}>
                {num(m)} min
              </button>
            ))}
          </div>
        )}
      </div>

      {sessions && sessions.length > 0 && (
        <ul className="ruled time-log" aria-label="Time log">
          {[...sessions].reverse().map((s) => (
            <li key={s.id}>
              <span>{durationLabel(s.minutes, num)}</span>
              <span className="muted small">
                {s.kind === 'manual' ? 'Added' : 'Timed'} · {num(when(s.started_at_ms))}
              </span>
              <button
                type="button"
                className="icon-button small push"
                aria-label={`Remove ${s.minutes} minutes`}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await planner.removeSession(s);
                    if (r.status === 'saved') {
                      onToast('Time removed.');
                      await load();
                      onChanged();
                    }
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Close size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <form
          className="row add-time"
          onSubmit={async (e) => {
            e.preventDefault();
            const m = Number(minutes);
            setBusy(true);
            try {
              const r = await planner.logTime(task, m, Date.now() - m * 60_000, 'manual');
              if (r.status === 'saved') {
                setAdding(false);
                onToast(`${durationLabel(m, num)} added.`);
                await load();
                onChanged();
              } else if (r.status === 'invalid') onToast(r.problems.join(' '));
            } finally {
              setBusy(false);
            }
          }}
        >
          <span className="suffix-field">
            <input autoFocus inputMode="numeric" aria-label="Minutes to add" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} />
            <span className="suffix muted">min</span>
          </span>
          <button className="primary" disabled={busy || !Number(minutes)}>
            Add
          </button>
          <button type="button" className="text" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button className="text add-time-link" onClick={() => setAdding(true)}>
          Add time by hand
        </button>
      )}
    </section>
  );
}
