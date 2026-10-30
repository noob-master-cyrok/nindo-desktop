import { describe, expect, it } from 'vitest';
import data from '../src/domain/calendarData.json';
import kmc from '../src/domain/kmc2083.json';
import { NepaliCalendar, lunarLabel, tithiName, type CalendarData, type KmcData } from '../src/domain/calendar';

const cal = new NepaliCalendar(data as unknown as CalendarData, kmc as unknown as KmcData);

describe('Nepali calendar data from the phone', () => {
  it('names tithis like the phone', () => {
    expect(tithiName(1)).toBe('Pratipada');
    expect(tithiName(26)).toBe('Ekadashi');
    expect(tithiName(15)).toBe('Purnima');
    expect(tithiName(30, 'ne')).toBe('औंसी');
  });

  it('gives the printed tithi inside the patro table', () => {
    // 1 Baishakh 2083 (14 April 2026): the table's first character.
    const day = cal.day('2026-04-14')!;
    expect(day.status).toBe('official');
    expect(day.tithi).toBe(parseInt((data as unknown as CalendarData).years[2083 - 2057]!.tithi[0]![0]!, 36));
    expect(lunarLabel(day)).toMatch(/^(Adhik )?\w+ (Shukla |Krishna )?\w+$/);
  });

  it('marks projected and calculated years', () => {
    expect(cal.day('2028-01-01')!.status).toBe('projected');
    expect(['calculated', 'uncertain']).toContain(cal.day('2040-06-01')!.status);
    expect(cal.day('1990-01-01')).toBeNull();
  });

  it('lists named days and KMC holidays', () => {
    expect(cal.festivals('2026-04-14').some((f) => f.nameEn === 'New Year' && f.holiday)).toBe(true);
    expect(cal.search('dashami').length).toBeGreaterThan(5);
    const year = cal.between('2026-04-14', '2027-04-13');
    expect(year.filter((f) => f.kind === 'ekadashi').length).toBeGreaterThanOrEqual(24);
  });
});

describe('festival notes', () => {
  it('hang on the city calendar id, even when a named day shares the name', () => {
    const dashami = cal.festivals('2026-10-21').find((f) => /Dashami/.test(f.nameEn))!;
    expect(dashami.source).toBe('named');
    expect(dashami.noteId).toMatch(/^kmc-2083-/);
    expect(cal.festivals('2026-10-21').filter((f) => /Dashami/.test(f.nameEn))).toHaveLength(1);
  });
});
