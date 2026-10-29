import { describe, expect, it } from 'vitest';
import { bsLabel, toBs } from '../src/domain/bs';

// The same fixtures as the phone's test/bs_calendar_test.dart.
describe('BS dates', () => {
  it('matches the patro dates the phone checks', () => {
    const cases: [string, [number, number, number]][] = [
      ['1943-04-14', [2000, 1, 1]],
      ['1944-04-13', [2001, 1, 1]],
      ['2000-01-01', [2056, 9, 17]],
      ['2019-04-14', [2076, 1, 1]],
      ['2025-04-14', [2082, 1, 1]],
      ['2026-04-13', [2082, 12, 30]],
      ['2026-04-14', [2083, 1, 1]],
      ['2026-09-27', [2083, 6, 11]],
      ['2026-10-01', [2083, 6, 15]],
      ['2026-10-18', [2083, 7, 1]],
      ['2026-10-29', [2083, 7, 12]],
      ['2027-04-13', [2083, 12, 30]],
    ];
    for (const [iso, [year, month, day]] of cases) expect(toBs(iso), iso).toEqual({ year, month, day });
  });

  it('gives no date outside the table', () => {
    expect(toBs('1943-04-13')).toBeNull();
    expect(toBs('2050-01-01')).toBeNull();
  });

  it('labels in the chosen numerals', () => {
    expect(bsLabel('2026-10-29', (v) => v)).toBe('12 Kartik 2083');
    expect(bsLabel('2026-10-29', (v) => v, true)).toBe('12 Kartik');
  });
});
