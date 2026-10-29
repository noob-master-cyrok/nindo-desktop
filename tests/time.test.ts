import { beforeEach, describe, expect, it } from 'vitest';
import { PlannerRepo } from '../src/data/plannerRepo';
import { atTime, daysFrom, sessionShares, timeInput, weekStart, weekTime, type AttendanceDay, type Session, type TimeData } from '../src/domain/time';
import { FakeStore } from './fakeStore';

const at = (h: number, m = 0) => new Date(2026, 9, 27, h, m).getTime();
let n = 0;
const session = (kind: string, start: number, minutes: number): Session =>
  ({ id: `s${++n}`, task_id: 't', kind, started_at_ms: start, minutes }) as Session;

describe('session shares', () => {
  it('counts overlapping timers once and manual time in full', () => {
    const a = session('timer', at(9), 60);
    const b = session('focus', at(9, 30), 60);
    const m = session('manual', at(8), 20);
    const shares = sessionShares([a, b, m]);
    // 9:00-9:30 alone, 9:30-10:00 split, 10:00-10:30 alone.
    expect(shares.get(a.id)).toBeCloseTo(45);
    expect(shares.get(b.id)).toBeCloseTo(45);
    expect(shares.get(m.id)).toBe(20);
  });

  it('back-to-back runs never overlap', () => {
    const a = session('timer', at(9), 30);
    const b = session('timer', at(9, 30), 30);
    const shares = sessionShares([a, b]);
    expect([shares.get(a.id), shares.get(b.id)]).toEqual([30, 30]);
  });
});

describe('week', () => {
  it('starts on Sunday', () => {
    expect(weekStart('2026-10-27')).toBe('2026-10-25');
    expect(weekStart('2026-10-25')).toBe('2026-10-25');
    expect(daysFrom('2026-10-25', 7).at(-1)).toBe('2026-10-31');
  });

  it('adds worked, break and attendance time per day', () => {
    const data: TimeData = {
      sessions: [session('focus', at(9), 25), session('manual', at(14), 35)],
      breaks: [],
      runs: [{ id: 'r', break_id: 'b', started_at_ms: at(12), ended_at_ms: at(12, 20) } as never],
      attendance: [{ id: '2026-10-27', check_in_ms: at(9), check_out_ms: at(17) } as AttendanceDay],
    };
    const [day] = weekTime(['2026-10-27', '2026-10-28'], data);
    expect(day).toEqual({ day: '2026-10-27', workedMinutes: 60, breakMinutes: 20, attendanceMinutes: 480 });
    expect(weekTime(['2026-10-28'], data)[0]).toMatchObject({ workedMinutes: 0, attendanceMinutes: null });
  });

  it('turns times to and from inputs, next morning when out is earlier', () => {
    expect(timeInput(at(9, 5))).toBe('09:05');
    expect(timeInput(null)).toBe('');
    expect(atTime('2026-10-27', '')).toBeNull();
    const checkIn = atTime('2026-10-27', '22:00')!;
    expect(atTime('2026-10-27', '06:00', checkIn)).toBe(new Date(2026, 9, 28, 6).getTime());
  });
});

describe('time data and attendance', () => {
  let store: FakeStore;
  let repo: PlannerRepo;
  beforeEach(() => {
    store = new FakeStore();
    repo = new PlannerRepo({ store, now: () => 50_000 });
  });

  it('reads this week only, and null when the server has no such tables', async () => {
    store.seed('planner_sessions', { id: 's-old', task_id: 't', kind: 'focus', started_at_ms: 10, minutes: 5, updated_at_ms: 10, deleted_at_ms: null });
    store.seed('planner_sessions', { id: 's-new', task_id: 't', kind: 'focus', started_at_ms: 500, minutes: 5, updated_at_ms: 500, deleted_at_ms: null });
    expect((await repo.timeSince(100))!.sessions.map((s) => s.id)).toEqual(['s-new']);
    const broken = new PlannerRepo({ store: { ...store, list: async () => { throw new Error('no table'); } } as never });
    expect(await broken.timeSince(0)).toBeNull();
  });

  it('saves a day by hand: new, existing, and one removed on the phone', async () => {
    const created = await repo.saveAttendance('2026-10-27', { check_in_ms: 1, check_out_ms: 2, note: 'Late start' });
    expect(created.status).toBe('saved');
    expect(store.tables.planner_attendance.get('2026-10-27')).toMatchObject({ check_in_ms: 1, edited: true, note: 'Late start' });

    await repo.saveAttendance('2026-10-27', { check_in_ms: 5, check_out_ms: null, note: '' });
    expect(store.tables.planner_attendance.get('2026-10-27')).toMatchObject({ check_in_ms: 5, check_out_ms: null });

    store.phoneWrite('planner_attendance', '2026-10-27', { deleted_at_ms: 40_000, updated_at_ms: 40_000 });
    const back = await repo.saveAttendance('2026-10-27', { check_in_ms: 7, check_out_ms: null, note: '' });
    expect(back.status).toBe('saved');
    expect(store.tables.planner_attendance.get('2026-10-27')).toMatchObject({ check_in_ms: 7, deleted_at_ms: null });
  });
});
