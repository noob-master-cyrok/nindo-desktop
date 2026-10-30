import { bsFirstYear, bsMonthLengths } from './bsData';

/// Bikram Sambat dates for the desktop, from the same table the phone uses.
/// Only BS 2000–2100 (April 1943 – April 2044) is covered; outside it there
/// is no BS date rather than a guess.

export const bsMonthNames = ['Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'] as const;

export interface BsDate {
  year: number;
  /// 1 = Baisakh … 12 = Chaitra.
  month: number;
  day: number;
}

const dayMs = 86_400_000;
const epoch = Date.UTC(1943, 3, 14);

/// The BS date of the local day [iso] (yyyy-mm-dd), or null outside the table.
export function toBs(iso: string): BsDate | null {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  let days = Math.round((Date.UTC(y, m - 1, d) - epoch) / dayMs);
  if (days < 0) return null;
  for (let i = 0; i < bsMonthLengths.length; i++) {
    const months = bsMonthLengths[i]!;
    const length = months.reduce((n, v) => n + v, 0);
    if (days >= length) {
      days -= length;
      continue;
    }
    for (let month = 0; month < 12; month++) {
      if (days < months[month]!) return { year: bsFirstYear + i, month: month + 1, day: days + 1 };
      days -= months[month]!;
    }
  }
  return null;
}

/// "12 Kartik 2083", or "12 Kartik" with [short].
export function bsLabel(iso: string, num: (v: string) => string, short = false): string | null {
  const bs = toBs(iso);
  if (!bs) return null;
  const name = bsMonthNames[bs.month - 1]!;
  return num(short ? `${bs.day} ${name}` : `${bs.day} ${name} ${bs.year}`);
}

/// Days in BS [month] of [year], or null outside the table.
export function bsMonthLength(year: number, month: number): number | null {
  return bsMonthLengths[year - bsFirstYear]?.[month - 1] ?? null;
}

/// The AD date (yyyy-mm-dd) of a BS date, or null outside the table or when
/// the month has fewer days.
export function fromBs({ year, month, day }: BsDate): string | null {
  const length = bsMonthLength(year, month);
  if (length == null || day < 1 || day > length) return null;
  let days = 0;
  for (let y = bsFirstYear; y < year; y++) days += bsMonthLengths[y - bsFirstYear]!.reduce((n, v) => n + v, 0);
  for (let m = 1; m < month; m++) days += bsMonthLengths[year - bsFirstYear]![m - 1]!;
  return new Date(epoch + (days + day - 1) * dayMs).toISOString().slice(0, 10);
}

export const bsFirst = bsFirstYear;
export const bsLast = bsFirstYear + bsMonthLengths.length - 1;
