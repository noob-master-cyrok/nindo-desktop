import { useEffect } from 'react';
import { clockText, runningTimers, timerElapsed } from '../domain/clock';
import type { PlannerTask } from '../domain/planner';
import { useSettings } from '../settings';
import { Close, Leaf, Pause, Play, Stop } from './Icons';
import type { Timers } from './useTimers';

/// A running break covers the Tasks screen until it ends, as on the phone.
export function BreakCover({ timers }: { timers: Timers }) {
  const { num } = useSettings();
  const rest = timers.state.rest;
  if (!rest) return null;
  return (
    <div className="break-cover" role="dialog" aria-modal="true" aria-label="On a break">
      <div className="break-inner">
        <span className="break-icon">
          <Leaf size={36} />
        </span>
        <p className="kicker">On a break</p>
        <span className="big-clock huge">{num(clockText(timers.now - rest.startedAt))}</span>
        <input
          className="break-name"
          aria-label="What is this break?"
          placeholder="What is this break? (optional)"
          maxLength={300}
          value={rest.title}
          onChange={(e) => timers.nameBreak(e.target.value)}
        />
        <p className="muted small">Your task timers are paused. Break time never counts as work.</p>
        <button className="primary done-fill wide-button" autoFocus onClick={() => void timers.endBreak()}>
          End break
        </button>
      </div>
    </div>
  );
}

/// The phone's black full-screen clock: large digits on black for the task
/// timers or the focus round. Escape closes it.
export function FullClock({ timers, tasks, onClose }: { timers: Timers; tasks: PlannerTask[]; onClose: () => void }) {
  const { num } = useSettings();
  const focus = timers.state.focus;
  const running = runningTimers(timers.state);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (!focus && !running.length) onClose();
  }, [focus, running.length, onClose]);

  const title = (id: string) => tasks.find((t) => t.id === id)?.title ?? 'Task';
  return (
    <div className="full-clock" role="dialog" aria-modal="true" aria-label="Full-screen timer">
      <button className="icon-button full-close" aria-label="Close full screen" onClick={onClose}>
        <Close />
      </button>
      {focus ? (
        <div className="full-main">
          <p className="full-kicker">{focus.phase === 'focus' ? `Focus · ${num(focus.minutes)} min` : 'Rest'}</p>
          <span className="full-digits">{num(clockText(focus.endsAt - timers.now))}</span>
          <p className="full-title">{focus.title}</p>
          <button className="full-button" onClick={timers.stopFocus}>
            <Stop size={18} /> Stop
          </button>
        </div>
      ) : (
        <div className="full-main">
          {running.map((id) => {
            const task = tasks.find((t) => t.id === id);
            return (
              <div key={id} className="full-row">
                <span className={running.length > 1 ? 'full-digits small' : 'full-digits'}>{num(clockText(timerElapsed(timers.state.timers[id], timers.now)))}</span>
                <p className="full-title">{title(id)}</p>
                {task && (
                  <button className="full-button" onClick={() => timers.toggle(task)}>
                    {timers.state.timers[id]?.startedAt != null ? <Pause size={18} /> : <Play size={18} />} Pause
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
