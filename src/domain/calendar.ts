import { bsMonthNames, toBs } from './bs';

/// Tithi, lunar months and named days for the desktop. The numbers come from
/// the phone's own code (tool/desktop/calendar_data_test.dart writes
/// calendarData.json), so both show the same day. Festivals add the
/// Kathmandu Metropolitan City list the phone ships (kmc2083.json).

export interface CalendarData {
  generatedFrom: string;
  firstBs: number;
  years: { bs: number; tithi: string[]; lunar: string[]; status: string[] }[];
  /// [iso, id, English, Nepali, kind]
  named: [string, string, string, string, string][];
}

export interface KmcData {
  source: { name: string; url: string; fetched: string };
  events: { id: string; ad: string; nameEn: string; nameNe: string; holiday: boolean; region: string; verification: string }[];
}

/// How sure a day's tithi is: printed by the patros, Nepali Patro's
/// projection, calculated at sunrise, or calculated close to a change.
export type TithiStatus = 'official' | 'projected' | 'calculated' | 'uncertain';

export interface TithiDay {
  /// 1–30: 1–15 Shukla paksha (15 Purnima), 16–30 Krishna (30 Aunsi).
  tithi: number;
  status: TithiStatus;
  /// 1 Baishakh … 12 Chaitra (purnimanta, as Nepal names them).
  lunarMonth: number;
  adhik: boolean;
}

export interface Festival {
  id: string;
  iso: string;
  nameEn: string;
  nameNe: string;
  holiday: boolean;
  /// ekadashi, purnima, aunsi or festival (named lunar days), or kmc.
  kind: string;
  source: 'named' | 'kmc';
  /// The city calendar's event id: notes hang on it, as on the phone's
  /// festival page. Null for named days the city list leaves out.
  noteId: string | null;
}

const tithiEn = ['Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami', 'Shashthi', 'Saptami', 'Ashtami', 'Navami', 'Dashami', 'Ekadashi', 'Dwadashi', 'Trayodashi', 'Chaturdashi'];
const tithiNe = ['प्रतिपदा', 'द्वितीया', 'तृतीया', 'चतुर्थी', 'पञ्चमी', 'षष्ठी', 'सप्तमी', 'अष्टमी', 'नवमी', 'दशमी', 'एकादशी', 'द्वादशी', 'त्रयोदशी', 'चतुर्दशी'];

/// The printed name of a tithi (1–30).
export function tithiName(tithi: number, lang: 'en' | 'ne' = 'en'): string {
  if (tithi === 15) return lang === 'ne' ? 'पूर्णिमा' : 'Purnima';
  if (tithi === 30) return lang === 'ne' ? 'औंसी' : 'Aunsi';
  return (lang === 'ne' ? tithiNe : tithiEn)[((tithi - 1) % 15)]!;
}

/// "Kartik Krishna Ashtami", "Asoj Purnima", "Adhik Jestha Shukla Dashami".
export function lunarLabel(day: TithiDay): string {
  const month = `${day.adhik ? 'Adhik ' : ''}${bsMonthNames[day.lunarMonth - 1]}`;
  if (day.tithi === 15 || day.tithi === 30) return `${month} ${tithiName(day.tithi)}`;
  return `${month} ${day.tithi <= 15 ? 'Shukla' : 'Krishna'} ${tithiName(day.tithi)}`;
}

export const statusLabel: Record<TithiStatus, string> = {
  official: 'Printed by the patros',
  projected: "Nepali Patro's projection",
  calculated: 'Calculated',
  uncertain: 'Calculated, may differ by a day',
};

const statusOf: Record<string, TithiStatus> = { o: 'official', p: 'projected', c: 'calculated', u: 'uncertain' };

export class NepaliCalendar {
  private readonly byIso = new Map<string, Festival[]>();
  readonly firstIso: string;
  readonly lastIso: string;

  constructor(
    private readonly data: CalendarData,
    kmc?: KmcData,
  ) {
    const add = (f: Festival) => {
      const list = this.byIso.get(f.iso) ?? [];
      // The KMC list repeats some named days ("Vijaya Dashami"); keep one
      // of each name, matched in English or Nepali.
      const same = list.find((g) => g.nameEn.toLowerCase() === f.nameEn.toLowerCase() || g.nameNe.replace(/\s/g, '') === f.nameNe.replace(/\s/g, ''));
      if (!same) list.push(f);
      else same.noteId ??= f.noteId;
      this.byIso.set(f.iso, list);
    };
    for (const [iso, id, nameEn, nameNe, kind] of data.named) add({ id, iso, nameEn, nameNe, kind, holiday: false, source: 'named', noteId: null });
    for (const e of kmc?.events ?? []) {
      add({ id: e.id, iso: e.ad, nameEn: e.nameEn, nameNe: e.nameNe, kind: 'kmc', holiday: e.holiday, source: 'kmc', noteId: e.id });
      // A KMC holiday on a named day marks that day as a holiday too.
      if (e.holiday) for (const f of this.byIso.get(e.ad) ?? []) f.holiday = true;
    }
    const isoKeys = [...this.byIso.keys()].sort();
    this.firstIso = isoKeys[0] ?? '';
    this.lastIso = isoKeys[isoKeys.length - 1] ?? '';
  }

  /// The tithi and lunar month of [iso], or null outside the data.
  day(iso: string): TithiDay | null {
    const bs = toBs(iso);
    if (!bs) return null;
    const year = this.data.years[bs.year - this.data.firstBs];
    if (!year) return null;
    const t = year.tithi[bs.month - 1]?.[bs.day - 1];
    const l = year.lunar[bs.month - 1]?.[bs.day - 1];
    const s = year.status[bs.month - 1]?.[bs.day - 1];
    if (!t || t === '0' || !l || !s || s === '-') return null;
    const lunar = parseInt(l, 36);
    return { tithi: parseInt(t, 36), status: statusOf[s] ?? 'calculated', lunarMonth: lunar > 12 ? lunar - 12 : lunar, adhik: lunar > 12 };
  }

  festivals(iso: string): Festival[] {
    return this.byIso.get(iso) ?? [];
  }

  isHoliday(iso: string): boolean {
    return this.festivals(iso).some((f) => f.holiday);
  }

  /// Every festival from [from] to [to] (inclusive), by date.
  between(from: string, to: string): Festival[] {
    const out: Festival[] = [];
    for (const [iso, list] of this.byIso) if (iso >= from && iso <= to) out.push(...list);
    return out.sort((a, b) => a.iso.localeCompare(b.iso) || Number(b.holiday) - Number(a.holiday));
  }

  /// Every festival, by date.
  all(): Festival[] {
    return [...this.byIso.keys()].sort().flatMap((iso) => this.byIso.get(iso)!);
  }

  /// Every festival whose English or Nepali name contains [query].
  search(query: string): Festival[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Festival[] = [];
    for (const list of this.byIso.values()) for (const f of list) if (f.nameEn.toLowerCase().includes(q) || f.nameNe.includes(q)) out.push(f);
    return out.sort((a, b) => a.iso.localeCompare(b.iso));
  }
}

let loading: Promise<NepaliCalendar> | null = null;

/// The calendar data is large, so it loads on first use, apart from the
/// rest of the app.
export function loadCalendar(): Promise<NepaliCalendar> {
  loading ??= Promise.all([import('./calendarData.json'), import('./kmc2083.json')]).then(
    ([data, kmc]) => new NepaliCalendar(data.default as unknown as CalendarData, kmc.default as unknown as KmcData),
  );
  return loading;
}
