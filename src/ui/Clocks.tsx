import { useEffect, useState } from 'react';
import { clockText, runningTimers, timerElapsed } from '../domain/clock';
import { durationLabel, isClosed, type PlannerTask } from '../domain/planner';
import { useSettings } from '../settings';
import { Close, Leaf, Pause, Stop } from './Icons';
import type { Timers } from './useTimers';

const breakIdeas = ['Tea', 'Stretch', 'Walk', 'Lunch'];

/// A ring that fills as time passes; [progress] runs 0…1.
function Ring({ progress, tone }: { progress: number; tone: 'acc' | 'done' | 'dark' }) {
  const r = 170;
  const length = 2 * Math.PI * r;
  return (
    <svg className={`clock-ring ${tone}`} viewBox="0 0 380 380" aria-hidden="true">
      <circle cx="190" cy="190" r={r} className="clock-ring-track" />
      <circle
        cx="190"
        cy="190"
        r={r}
        className="clock-ring-fill"
        strokeDasharray={`${Math.max(0, Math.min(1, progress)) * length} ${length}`}
        transform="rotate(-90 190 190)"
      />
    </svg>
  );
}

/// A running break covers the screen until it ends, as on the phone: a calm
/// green page with the break clock, quick names, and the way back to work.
export function BreakCover({ timers, tasks }: { timers: Timers; tasks: PlannerTask[] }) {
  const { num } = useSettings();
  const rest = timers.state.rest;
  if (!rest) return null;
  const back = (rest.resume ?? []).map((id) => tasks.find((t) => t.id === id)).filter((t): t is PlannerTask => !!t && !isClosed(t.status));
  const named = breakIdeas.includes(rest.title);
  return (
    <div className="break-cover" role="dialog" aria-modal="true" aria-label="On a break">
      <div className="break-inner">
        <p className="kicker done-ink">On a break · task timers paused</p>
        <span className="break-icon">
          <Leaf size={44} />
        </span>
        <span className="big-clock huge done-ink">{num(clockText(timers.now - rest.startedAt))}</span>
        <p className="break-note">Nice. Break time never counts as work.</p>
        <div className="break-ideas" role="group" aria-label="Break ideas">
          {breakIdeas.map((idea) => (
            <button key={idea} className={rest.title === idea ? 'break-idea on' : 'break-idea'} aria-pressed={rest.title === idea} onClick={() => timers.nameBreak(rest.title === idea ? '' : idea)}>
              {idea}
            </button>
          ))}
        </div>
        <input
          className="break-name"
          aria-label="What is this break?"
          placeholder="Something else? (optional)"
          maxLength={300}
          value={named ? '' : rest.title}
          onChange={(e) => timers.nameBreak(e.target.value)}
        />
        {back.length > 0 ? (
          <>
            <button className="primary done-fill wide-button" autoFocus onClick={() => void timers.endBreak(true)}>
              {back.length === 1 ? `Back to ${back[0]!.title}` : `Back to ${num(back.length)} tasks`}
            </button>
            <button className="text done-ink" onClick={() => void timers.endBreak(false)}>
              End break without resuming
            </button>
          </>
        ) : (
          <button className="primary done-fill wide-button" autoFocus onClick={() => void timers.endBreak(false)}>
            End break
          </button>
        )}
      </div>
    </div>
  );
}

/// The full-screen clock, black on purpose (as on the phone) so an OLED
/// screen stays dark: a ring around the focus round's time left, or around a
/// task timer against its estimate. Escape closes it.
export function FullClock({ timers, tasks, onClose }: { timers: Timers; tasks: PlannerTask[]; onClose: () => void }) {
  const { num } = useSettings();
  const focus = timers.state.focus;
  const running = runningTimers(timers.state);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (!focus && !running.length) onClose();
  }, [focus, running.length, onClose]);

  const takeBreak = () => {
    timers.takeBreak();
    onClose();
  };
  const close = (
    <button className="icon-button full-close" aria-label="Close full screen" onClick={onClose}>
      <Close />
    </button>
  );

  if (focus) {
    const total = focus.endsAt - focus.startedAt;
    const left = focus.endsAt - timers.now;
    return (
      <div className="full-clock" role="dialog" aria-modal="true" aria-label="Full-screen timer">
        {close}
        <div className="full-main">
          <p className="full-kicker">{focus.phase === 'focus' ? `Focus · ${num(focus.minutes)} min round` : 'Rest'}</p>
          <div className="clock-face">
            <Ring progress={1 - left / total} tone={focus.phase === 'focus' ? 'acc' : 'done'} />
            <span className="clock-center">
              <span className="full-digits">{num(clockText(left))}</span>
              <span className="full-sub">left</span>
            </span>
          </div>
          <p className="full-title">{focus.title}</p>
          <div className="full-actions">
            <button className="full-button" onClick={timers.stopFocus}>
              <Stop size={16} /> Stop round
            </button>
            {focus.phase === 'focus' && (
              <button className="full-button break" onClick={takeBreak}>
                <Leaf size={16} /> Take a break
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const id = running[Math.min(index, running.length - 1)];
  const task = tasks.find((t) => t.id === id);
  const elapsed = timerElapsed(id ? timers.state.timers[id] : undefined, timers.now);
  const estimate = task?.estimate_minutes ? task.estimate_minutes * 60_000 : null;
  return (
    <div className="full-clock" role="dialog" aria-modal="true" aria-label="Full-screen timer">
      {close}
      <div className="full-main">
        <p className="full-kicker">{running.length > 1 ? `Running · ${num(Math.min(index, running.length - 1) + 1)} of ${num(running.length)}` : 'Running'}</p>
        <div className="full-switch">
          {running.length > 1 && (
            <button className="full-arrow" aria-label="Previous running timer" onClick={() => setIndex((i) => (i - 1 + running.length) % running.length)}>
              ‹
            </button>
          )}
          <div className="clock-face">
            <Ring progress={estimate ? elapsed / estimate : (elapsed % 3_600_000) / 3_600_000} tone="acc" />
            <span className="clock-center">
              <span className="full-digits">{num(clockText(elapsed))}</span>
              <span className="full-sub">{estimate ? `of ${durationLabel(task!.estimate_minutes!, num)}` : 'so far'}</span>
            </span>
          </div>
          {running.length > 1 && (
            <button className="full-arrow" aria-label="Next running timer" onClick={() => setIndex((i) => (i + 1) % running.length)}>
              ›
            </button>
          )}
        </div>
        <p className="full-title">{task?.title ?? 'Task'}</p>
        <div className="full-actions">
          {task && (
            <button className="full-button acc" onClick={() => timers.toggle(task)}>
              <Pause size={16} /> Pause
            </button>
          )}
          <button className="full-button break" onClick={takeBreak}>
            <Leaf size={16} /> Take a break
          </button>
        </div>
      </div>
    </div>
  );
}
