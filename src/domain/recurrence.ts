import { bsMonthLength, fromBs, toBs } from './bs';
import { addDays, daysBetween, isoWeekday, monthLength, ymd } from './dates';

/// The phone's repeat rules (lib/features/recurrence/domain/recurrence.dart),
/// on yyyy-mm-dd strings. Lunar rules (`tithi`, `yearTithi`) follow the
/// phone's sunrise reckoning, which the desktop does not repeat: their next
/// dates are left to the phone.

export type RepeatRule = 'none' | 'daily' | 'weekly' | 'monthAd' | 'yearAd' | 'monthBs' | 'yearBs' | 'tithi' | 'yearTithi';

export interface Recurrence {
  rule: RepeatRule;
  anchorMonth: number | null;
  anchorDay: number | null;
  policy: 'skip' | 'last';
  interval: number;
  /// ISO weekdays (Monday 1) for weekly rules.
  weekdays: number[];
  start: string | null;
  until: string | null;
  count: number | null;
  exceptions: string[];
}

export interface Occurrence {
  day: string;
  clamped: boolean;
}

export interface RecurrenceColumns {
  repeat_rule: string;
  anchor_month: number | null;
  anchor_day: number | null;
  missing_date_policy: string;
  repeat_interval: number;
  repeat_weekdays: string;
  series_start: string | null;
  repeat_until: string | null;
  repeat_count: number | null;
  repeat_exceptions: string;
  undated?: boolean;
}

const list = (v: string) => (v ? v.split(',').filter(Boolean) : []);

export function recurrenceOf(row: RecurrenceColumns): Recurrence {
  const rules: RepeatRule[] = ['none', 'daily', 'weekly', 'monthAd', 'yearAd', 'monthBs', 'yearBs', 'tithi', 'yearTithi'];
  const rule = row.undated ? 'none' : rules.find((r) => r === row.repeat_rule) ?? 'none';
  return {
    rule,
    anchorMonth: row.anchor_month,
    anchorDay: row.anchor_day,
    policy: row.missing_date_policy === 'skip' ? 'skip' : 'last',
    interval: Math.max(1, row.repeat_interval || 1),
    weekdays: list(row.repeat_weekdays).map(Number).filter((n) => n >= 1 && n <= 7),
    start: row.series_start ? row.series_start.slice(0, 10) : null,
    until: row.repeat_until ? row.repeat_until.slice(0, 10) : null,
    count: row.repeat_count,
    exceptions: list(row.repeat_exceptions),
  };
}

/// A new rule whose first occurrence is [start] (the phone's
/// `Recurrence.anchoredAt`). Null for a BS rule outside the BS table.
export function anchoredAt(
  rule: Exclude<RepeatRule, 'tithi' | 'yearTithi'>,
  start: string,
  options: { interval?: number; weekdays?: number[]; until?: string | null; count?: number | null; policy?: 'skip' | 'last' } = {},
): Recurrence | null {
  let anchorMonth: number | null = null;
  let anchorDay: number | null = null;
  if (rule === 'monthAd' || rule === 'yearAd') {
    const [, m, d] = start.split('-').map(Number) as [number, number, number];
    anchorMonth = m;
    anchorDay = d;
  } else if (rule === 'monthBs' || rule === 'yearBs') {
    const bs = toBs(start);
    if (!bs) return null;
    anchorMonth = bs.month;
    anchorDay = bs.day;
  }
  const weekdays = rule === 'weekly' && !options.weekdays?.length ? [isoWeekday(start)] : (options.weekdays ?? []);
  return {
    rule,
    anchorMonth,
    anchorDay,
    policy: options.policy ?? 'last',
    interval: Math.max(1, options.interval ?? 1),
    weekdays: rule === 'weekly' ? weekdays : [],
    start: rule === 'none' ? null : start,
    until: options.until ?? null,
    count: options.count != null && options.count < 1 ? 1 : (options.count ?? null),
    exceptions: [],
  };
}

export function recurrenceColumns(r: Recurrence): RecurrenceColumns & { date_system: string } {
  return {
    date_system: r.rule === 'tithi' || r.rule === 'yearTithi' ? 'TITHI' : r.rule === 'monthBs' || r.rule === 'yearBs' ? 'BS' : 'AD',
    repeat_rule: r.rule,
    anchor_month: r.anchorMonth,
    anchor_day: r.anchorDay,
    missing_date_policy: r.policy,
    repeat_interval: r.interval,
    repeat_weekdays: [...r.weekdays].sort((a, b) => a - b).join(','),
    series_start: r.start,
    repeat_until: r.until,
    repeat_count: r.count,
    repeat_exceptions: [...r.exceptions].sort().join(','),
  };
}

export const repeats = (r: Recurrence) => r.rule !== 'none';

/// Whether the desktop can work out this rule's next dates.
export const desktopCanRepeat = (r: Recurrence) => r.rule !== 'tithi' && r.rule !== 'yearTithi';

const monday = (iso: string) => addDays(iso, 1 - isoWeekday(iso));
const monthsBetween = (a: string, b: string) => {
  const [ay, am] = a.split('-').map(Number) as [number, number];
  const [by, bm] = b.split('-').map(Number) as [number, number];
  return (by - ay) * 12 + bm - am;
};

function adCandidate(r: Recurrence, year: number, month: number, day: number): Occurrence | null {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + 1;
  const length = monthLength(y, m);
  if (day <= length) return { day: ymd(y, m, day), clamped: false };
  if (r.policy === 'skip') return null;
  return { day: ymd(y, m, length), clamped: true };
}

function bsCandidate(r: Recurrence, year: number, month: number): Occurrence | null {
  const length = bsMonthLength(year, month);
  if (length == null) return null;
  const day = r.anchorDay!;
  const clamped = day > length;
  if (clamped && r.policy === 'skip') return null;
  const ad = fromBs({ year, month, day: clamped ? length : day });
  return ad ? { day: ad, clamped } : null;
}

const bsCovers = (year: number) => bsMonthLength(year, 1) != null;

function nextRaw(r: Recurrence, a: string): Occurrence | null {
  const s = r.start;
  switch (r.rule) {
    case 'none':
    case 'tithi':
    case 'yearTithi':
      return null;
    case 'daily': {
      if (!s) return { day: addDays(a, r.interval), clamped: false };
      if (a < s) return { day: s, clamped: false };
      const k = Math.floor(daysBetween(s, a) / r.interval) + 1;
      return { day: addDays(s, k * r.interval), clamped: false };
    }
    case 'weekly': {
      const days = r.weekdays.length ? r.weekdays : [isoWeekday(s ?? a)];
      const base = monday(s ?? a);
      for (let i = 1; i <= 7 * r.interval + 7; i++) {
        const d = addDays(a, i);
        if (s && d < s) continue;
        if (!days.includes(isoWeekday(d))) continue;
        const weeks = Math.floor(daysBetween(base, monday(d)) / 7);
        if (weeks % r.interval === 0) return { day: d, clamped: false };
      }
      return null;
    }
    case 'monthAd': {
      const base = s ?? `${a.slice(0, 7)}-01`;
      const gap = monthsBetween(base, a);
      let k = gap <= 0 ? 0 : Math.floor((gap - 1) / r.interval) * r.interval;
      const [by, bm] = base.split('-').map(Number) as [number, number];
      for (let guard = 0; guard < 60; guard++, k += r.interval) {
        const o = adCandidate(r, by, bm + k, r.anchorDay!);
        if (o && o.day > a) return o;
      }
      return null;
    }
    case 'yearAd': {
      const baseYear = Number((s ?? a).slice(0, 4));
      const gap = Number(a.slice(0, 4)) - baseYear;
      let k = gap <= 0 ? 0 : Math.floor((gap - 1) / r.interval) * r.interval;
      for (let guard = 0; guard < 40; guard++, k += r.interval) {
        const o = adCandidate(r, baseYear + k, r.anchorMonth!, r.anchorDay!);
        if (o && o.day > a) return o;
      }
      return null;
    }
    case 'monthBs': {
      const from = toBs(a);
      if (!from) return null;
      const first = s ? toBs(s) : null;
      const base = first ? first.year * 12 + first.month - 1 : from.year * 12;
      let index = from.year * 12 + from.month - 1;
      index = base + Math.floor((index - base) / r.interval) * r.interval;
      for (; bsCovers(Math.floor(index / 12)); index += r.interval) {
        if (index < base) continue;
        const o = bsCandidate(r, Math.floor(index / 12), (index % 12) + 1);
        if (o && o.day > a) return o;
      }
      return null;
    }
    case 'yearBs': {
      const from = toBs(a);
      if (!from) return null;
      const first = s ? toBs(s) : null;
      const base = first?.year ?? from.year;
      let year = base + Math.floor((from.year - base) / r.interval) * r.interval;
      for (; bsCovers(year); year += r.interval) {
        if (year < base) continue;
        const o = bsCandidate(r, year, r.anchorMonth!);
        if (o && o.day > a) return o;
      }
      return null;
    }
  }
}

function rawIndex(r: Recurrence, day: string): number {
  if (!r.start) return 1;
  let index = 1;
  let cursor = r.start;
  for (let guard = 0; guard < 5000 && cursor < day; guard++) {
    const o = nextRaw(r, cursor);
    if (!o) break;
    cursor = o.day;
    index++;
  }
  return index;
}

/// The first occurrence strictly after [after], or null when there is none.
export function nextAfter(r: Recurrence, after: string): Occurrence | null {
  let cursor = after;
  for (let guard = 0; guard < 2000; guard++) {
    const o = nextRaw(r, cursor);
    if (!o) return null;
    if (r.until && o.day > r.until) return null;
    if (r.count != null && rawIndex(r, o.day) > r.count) return null;
    if (!r.exceptions.includes(o.day)) return o;
    cursor = o.day;
  }
  return null;
}

/// The first occurrence after [due] that is on or after [today]; missed
/// ones are passed over (the phone's `nextFrom`).
export function nextFrom(r: Recurrence, due: string, today: string): Occurrence | null {
  let o = nextAfter(r, due);
  for (let guard = 0; o && o.day < today && guard < 4000; guard++) o = nextAfter(r, o.day);
  return o;
}

/// Every occurrence of an item due on [due] from [from] to [to], the stored
/// due date included. Lunar rules show only the stored date.
export function occurrencesBetween(r: Recurrence, due: string, from: string, to: string, limit = 400): string[] {
  const out: string[] = [];
  if (due >= from && due <= to) out.push(due);
  if (!repeats(r) || !desktopCanRepeat(r)) return out;
  let cursor = due;
  while (out.length < limit) {
    const o = nextAfter(r, cursor);
    if (!o || o.day > to) break;
    if (o.day >= from) out.push(o.day);
    cursor = o.day;
  }
  return out;
}

const ruleLabels: Record<RepeatRule, string> = {
  none: 'Does not repeat',
  daily: 'Daily',
  weekly: 'Weekly',
  monthAd: 'Monthly',
  yearAd: 'Yearly',
  monthBs: 'Monthly (BS)',
  yearBs: 'Yearly (BS)',
  tithi: 'On a lunar day',
  yearTithi: 'Yearly on a lunar date',
};
const unit: Partial<Record<RepeatRule, string>> = { daily: 'days', weekly: 'weeks', monthAd: 'months', monthBs: 'BS months', yearAd: 'years', yearBs: 'BS years' };
const dayNames = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function repeatSummary(r: Recurrence): string {
  if (r.rule === 'none') return ruleLabels.none;
  let text = r.interval > 1 && unit[r.rule] ? `Every ${r.interval} ${unit[r.rule]}` : ruleLabels[r.rule];
  if (r.rule === 'weekly' && r.weekdays.length) text += ` on ${[...r.weekdays].sort().map((d) => dayNames[d]).join(', ')}`;
  if (r.until) text += `, until ${r.until}`;
  if (r.count) text += `, ${r.count} times`;
  return text;
}
