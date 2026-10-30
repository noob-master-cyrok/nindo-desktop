/// Calendar-day arithmetic on yyyy-mm-dd strings. Days are counted in UTC so
/// daylight-saving changes never move a date.

const dayMs = 86_400_000;

export function parseIso(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function isoOf(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return isoOf(parseIso(iso) + days * dayMs);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseIso(to) - parseIso(from)) / dayMs);
}

/// ISO weekday: Monday 1 … Sunday 7.
export function isoWeekday(iso: string): number {
  const d = new Date(parseIso(iso)).getUTCDay();
  return d === 0 ? 7 : d;
}

/// The Sunday that starts [iso]'s week (Nepal and the phone start on Sunday).
export function weekStart(iso: string): string {
  return addDays(iso, -(isoWeekday(iso) % 7));
}

export function monthLength(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function ymd(year: number, month: number, day: number): string {
  return isoOf(Date.UTC(year, month - 1, day));
}

export function todayIso(now = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

const fmt = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(parseIso(iso)).toLocaleDateString('en-GB', { timeZone: 'UTC', ...options });

/// "Fri 30 Oct"
export const shortDate = (iso: string) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short' });
/// "Friday 30 October 2026"
export const longDate = (iso: string) => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
/// "October 2026"
export const monthTitle = (iso: string) => fmt(iso, { month: 'long', year: 'numeric' });
export const weekdayName = (iso: string, style: 'long' | 'short' | 'narrow' = 'long') => fmt(iso, { weekday: style });
