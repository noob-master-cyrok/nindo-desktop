import { describe, expect, it } from 'vitest';
import { accentById, accentFromSeed, backgroundFromSeed, contrast, dark, digits, light, tokens, defaultSettings } from '../src/theme';

describe('theme', () => {
  it('uses the phone tokens, white by default in light mode', () => {
    const t = tokens(defaultSettings, false);
    expect(t.bg).toBe('#FFFFFF');
    expect(t.acc).toBe('#B8336A');
    expect(t.accInk).toBe('#8E2652');
    expect(tokens({ ...defaultSettings, background: 'paper' }, false).bg).toBe(light.bg);
    const d = tokens({ ...defaultSettings, background: 'sky' }, true);
    expect(d.bg).toBe(dark.bg);
    expect(d.acc).toBe('#E0679A');
  });

  it('changes the accent family with App colors', () => {
    const t = tokens({ ...defaultSettings, accent: 'teal' }, false);
    expect([t.acc, t.accInk, t.accTint]).toEqual(['#0F766E', '#115E59', '#DCEEEA']);
    expect(accentById('nope').id).toBe('raspberry');
  });

  it('keeps custom colours readable (AA) in both themes', () => {
    for (const seed of ['#FFEE00', '#00FFFF', '#222222', '#FF0000', '#9FE870']) {
      const a = accentFromSeed(seed);
      expect(contrast(light.onAcc!, a.lightAcc)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(a.lightInk, light.bg!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark.onAcc!, a.darkAcc)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(a.darkInk, dark.bg!)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps custom backgrounds pale', () => {
    expect(contrast(light.ink!, backgroundFromSeed('#0000FF'))).toBeGreaterThan(12);
  });

  it('writes numerals as chosen', () => {
    expect(digits('12/30', 'latin')).toBe('12/30');
    expect(digits('12/30', 'devanagari')).toBe('१२/३०');
  });
});
