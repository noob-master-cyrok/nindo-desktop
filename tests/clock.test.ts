import { describe, expect, it } from 'vitest';
import { clockText, emptyClock, parseClock, pauseTimers, startFocus, startTimer, stopFocus, takeBreak, tickFocus, timerElapsed } from '../src/domain/clock';

const m = 60_000;

describe('desktop timers', () => {
  it('logs whole minutes on pause and carries the rest', () => {
    let s = startTimer(emptyClock, 't', 0);
    s = startTimer(s, 'u', 0);
    const first = pauseTimers(s, ['t'], 2 * m + 30_000);
    expect(first.logs).toEqual([{ taskId: 't', minutes: 2, startedAt: 30_000 }]);
    expect(first.state.timers.t).toEqual({ startedAt: null, carriedMs: 30_000 });
    expect(first.state.timers.u!.startedAt).toBe(0);
    s = startTimer(first.state, 't', 10 * m);
    expect(timerElapsed(s.timers.t, 10 * m + 30_000)).toBe(60_000);
    const second = pauseTimers(s, ['t'], 10 * m + 30_000);
    expect(second.logs[0]!.minutes).toBe(1);
    expect(second.state.timers.t!.carriedMs).toBe(0);
  });

  it('runs a focus round, then a rest, then ends', () => {
    let s = startFocus(emptyClock, 't', 'Write', 25, 0);
    expect(tickFocus(s, 24 * m).event).toBeNull();
    const up = tickFocus(s, 25 * m);
    expect(up.event).toBe('rest');
    expect(up.logs).toEqual([{ taskId: 't', minutes: 25, startedAt: 0 }]);
    s = up.state;
    expect(s.focus!.phase).toBe('rest');
    expect(tickFocus(s, 30 * m).event).toBe('done');
  });

  it('stopping a focus round early logs the minutes done', () => {
    const s = startFocus(emptyClock, 't', 'Write', 25, 0);
    expect(stopFocus(s, 12 * m + 5_000).logs).toEqual([{ taskId: 't', minutes: 12, startedAt: 0 }]);
    expect(stopFocus(s, 30_000).logs).toEqual([]);
  });

  it('a break pauses every timer and the focus round first', () => {
    let s = startTimer(emptyClock, 't', 0);
    s = startFocus(s, 'u', 'Read', 25, 0);
    const r = takeBreak(s, 'b1', 10 * m);
    expect(r.logs.map((l) => [l.taskId, l.minutes])).toEqual([
      ['t', 10],
      ['u', 10],
    ]);
    expect(r.state.rest).toEqual({ id: 'b1', title: '', startedAt: 10 * m });
    expect(r.state.focus).toBeNull();
    expect(r.state.timers.t!.startedAt).toBeNull();
  });

  it('formats and survives storage', () => {
    expect(clockText(65_000)).toBe('1:05');
    expect(clockText(3_725_000)).toBe('1:02:05');
    const s = startTimer(emptyClock, 't', 5);
    expect(parseClock(JSON.stringify(s))).toEqual(s);
    expect(parseClock('nope')).toEqual(emptyClock);
  });
});
