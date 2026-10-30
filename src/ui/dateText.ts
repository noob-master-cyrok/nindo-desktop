import { bsMonthNames, toBs } from '../domain/bs';
import { longDate, parseIso } from '../domain/dates';
import { useSettings } from '../settings';

/// Dates in the person's chosen order: "14 Kartik 2083" first when BS leads,
/// with the other calendar as the second line.
export function useDates() {
  const { settings, num } = useSettings();
  const bsFirst = settings.calendarFirst === 'BS';
  const bs = (iso: string, withYear = true) => {
    const d = toBs(iso);
    return d ? num(`${d.day} ${bsMonthNames[d.month - 1]}${withYear ? ` ${d.year}` : ''}`) : null;
  };
  const ad = (iso: string, withYear = true) =>
    num(new Date(parseIso(iso)).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) }));
  const weekday = (iso: string) => new Date(parseIso(iso)).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'long' });
  return {
    bsFirst,
    num,
    bs,
    ad,
    weekday,
    /// "Friday, 13 Kartik 2083" (or the AD date when AD leads).
    primary: (iso: string, withYear = true) => (bsFirst ? (bs(iso, withYear) ?? ad(iso, withYear)) : ad(iso, withYear)),
    /// The other calendar's date, or null when BS is out of range.
    secondary: (iso: string, withYear = true) => (bsFirst ? (toBs(iso) ? ad(iso, withYear) : null) : bs(iso, withYear)),
    long: (iso: string) => num(longDate(iso)),
    /// "16 Kartik" or "2 Nov": short enough for a row's date column.
    short: (iso: string) =>
      bsFirst && toBs(iso) ? bs(iso, false)! : num(new Date(parseIso(iso)).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })),
  };
}
