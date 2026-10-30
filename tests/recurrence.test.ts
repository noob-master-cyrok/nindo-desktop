import { describe, expect, it } from 'vitest';
import { fromBs, toBs } from '../src/domain/bs';
import { anchoredAt, nextAfter, nextFrom, occurrencesBetween, recurrenceOf, repeatSummary, type Recurrence } from '../src/domain/recurrence';

// Cases copied from the phone's test/recurrence_test.dart.
const upcoming = (r: Recurrence, from: string, n: number) => {
  const out: string[] = [];
  let cursor = from;
  while (out.length < n) {
    const o = nextAfter(r, cursor);
    if (!o) break;
    out.push(o.day);
    cursor = o.day;
  }
  return out;
};
const bare = (rule: Recurrence['rule']): Recurrence => ({ rule, anchorMonth: null, anchorDay: null, policy: 'last', interval: 1, weekdays: [], start: null, until: null, count: null, exceptions: [] });

describe('AD rules', () => {
  it('daily and weekly step from the current occurrence', () => {
    expect(nextAfter(bare('daily'), '2026-12-31')!.day).toBe('2027-01-01');
    expect(upcoming(bare('weekly'), '2026-09-27', 2)).toEqual(['2026-10-04', '2026-10-11']);
  });

  it('monthly on the 31st uses the last day or skips', () => {
    const last = anchoredAt('monthAd', '2027-01-31')!;
    expect(upcoming(last, '2027-01-31', 3)).toEqual(['2027-02-28', '2027-03-31', '2027-04-30']);
    const skip = anchoredAt('monthAd', '2027-01-31', { policy: 'skip' })!;
    expect(upcoming(skip, '2027-01-31', 2)).toEqual(['2027-03-31', '2027-05-31']);
  });

  it('yearly on 29 February', () => {
    expect(nextAfter(anchoredAt('yearAd', '2028-02-29')!, '2028-02-29')!.day).toBe('2029-02-28');
    expect(nextAfter(anchoredAt('yearAd', '2028-02-29', { policy: 'skip' })!, '2028-02-29')!.day).toBe('2032-02-29');
  });
});

describe('BS rules', () => {
  it('keep the BS anchor', () => {
    const r = anchoredAt('monthBs', '2026-09-27')!;
    expect([r.anchorMonth, r.anchorDay]).toEqual([6, 11]);
    expect(upcoming(r, '2026-09-27', 3).map(toBs)).toEqual([
      { year: 2083, month: 7, day: 11 },
      { year: 2083, month: 8, day: 11 },
      { year: 2083, month: 9, day: 11 },
    ]);
  });

  it('day 32 of Asar clamps or skips', () => {
    const asar32 = fromBs({ year: 2083, month: 3, day: 32 })!;
    const last = anchoredAt('monthBs', asar32)!;
    const o = nextAfter(last, asar32)!;
    expect(toBs(o.day)).toEqual({ year: 2083, month: 4, day: 31 });
    expect(o.clamped).toBe(true);
    const skip = anchoredAt('monthBs', asar32, { policy: 'skip' })!;
    expect(toBs(nextAfter(skip, asar32)!.day)).toEqual({ year: 2084, month: 2, day: 32 });
  });

  it('every 2 BS months keeps the BS day', () => {
    const start = fromBs({ year: 2083, month: 6, day: 11 })!;
    expect(upcoming(anchoredAt('monthBs', start, { interval: 2 })!, start, 2).map(toBs)).toEqual([
      { year: 2083, month: 8, day: 11 },
      { year: 2083, month: 10, day: 11 },
    ]);
  });
});

describe('intervals and ends', () => {
  it('nextFrom passes over missed occurrences', () => {
    expect(nextFrom(bare('daily'), '2026-09-20', '2026-09-27')!.day).toBe('2026-09-27');
  });

  it('every 3 days, every 2 weeks on Monday and Thursday', () => {
    expect(upcoming(anchoredAt('daily', '2026-09-27', { interval: 3 })!, '2026-09-27', 3)).toEqual(['2026-09-30', '2026-10-03', '2026-10-06']);
    expect(upcoming(anchoredAt('weekly', '2026-09-28', { interval: 2, weekdays: [1, 4] })!, '2026-09-28', 4)).toEqual([
      '2026-10-01',
      '2026-10-12',
      '2026-10-15',
      '2026-10-26',
    ]);
  });

  it('until, count and skipped dates end or thin the series', () => {
    expect(upcoming(anchoredAt('daily', '2026-09-27', { until: '2026-09-29' })!, '2026-09-27', 10)).toEqual(['2026-09-28', '2026-09-29']);
    expect(upcoming(anchoredAt('daily', '2026-09-27', { count: 3 })!, '2026-09-27', 10)).toEqual(['2026-09-28', '2026-09-29']);
    const r = { ...anchoredAt('daily', '2026-09-27', { count: 4 })!, exceptions: ['2026-09-28'] };
    expect(upcoming(r, '2026-09-27', 10)).toEqual(['2026-09-29', '2026-09-30']);
  });

  it('reads stored columns and lists a month of dates', () => {
    const r = recurrenceOf({
      repeat_rule: 'weekly', anchor_month: null, anchor_day: null, missing_date_policy: 'last', repeat_interval: 1,
      repeat_weekdays: '5', series_start: '2026-10-02', repeat_until: null, repeat_count: null, repeat_exceptions: '',
    });
    expect(occurrencesBetween(r, '2026-10-02', '2026-10-01', '2026-10-31')).toEqual(['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']);
    expect(repeatSummary(r)).toBe('Weekly on Fri');
  });

  it('lunar rules show only the stored date', () => {
    const r = { ...bare('tithi') };
    expect(occurrencesBetween(r, '2026-10-05', '2026-10-01', '2026-12-31')).toEqual(['2026-10-05']);
  });
});
