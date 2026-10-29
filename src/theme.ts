/// The phone's design tokens (lib/app/theme/nindo_colors.dart), App colors
/// (accent_palette.dart) and backgrounds (background_palette.dart), applied
/// as CSS variables. Settings are kept per computer, as the phone keeps them
/// per phone.

export type Mode = 'system' | 'light' | 'dark';
export type Numerals = 'latin' | 'devanagari';

export interface Settings {
  mode: Mode;
  /// An App colors id, or `custom:RRGGBB`.
  accent: string;
  /// A background id, or `custom:RRGGBB`. Light mode only, as on the phone.
  background: string;
  numerals: Numerals;
}

export const defaultSettings: Settings = { mode: 'system', accent: 'raspberry', background: 'white', numerals: 'latin' };

type Tokens = Record<string, string>;

export const light: Tokens = {
  bg: '#F6F3EC',
  card: '#FBF9F4',
  ink: '#1C1B19',
  ink2: '#4A463F',
  mute: '#6B665C',
  rule: '#E3DED3',
  rule2: '#CFC8BA',
  acc: '#B8336A',
  accInk: '#8E2652',
  accTint: '#F3E3E7',
  onAcc: '#FFFFFF',
  done: '#3D7A55',
  attn: '#9A5418',
  attnTint: '#F4E6D6',
  danger: '#B42318',
  seg: 'rgba(28, 27, 25, 0.071)',
  segOn: '#FFFFFF',
  glass: 'rgba(251, 249, 244, 0.72)',
  glassBorder: 'rgba(255, 255, 255, 0.9)',
  glassShadow: 'rgba(28, 27, 25, 0.1)',
  backdrop: 'rgba(28, 27, 25, 0.32)',
  toast: '#1C1B19',
  toastInk: '#F6F3EC',
};

export const dark: Tokens = {
  bg: '#16151A',
  card: '#1F1E24',
  ink: '#F1ECE3',
  ink2: '#CEC8BD',
  mute: '#A29C91',
  rule: '#302E33',
  rule2: '#4A474D',
  acc: '#E0679A',
  accInk: '#F29BBF',
  accTint: '#3A2230',
  onAcc: '#1C1B19',
  done: '#7CC49A',
  attn: '#E8AE6C',
  attnTint: '#3A2D1F',
  danger: '#F97066',
  seg: 'rgba(255, 255, 255, 0.078)',
  segOn: '#3A383F',
  glass: 'rgba(38, 36, 42, 0.72)',
  glassBorder: 'rgba(255, 255, 255, 0.1)',
  glassShadow: 'rgba(0, 0, 0, 0.45)',
  backdrop: 'rgba(0, 0, 0, 0.5)',
  toast: '#F1ECE3',
  toastInk: '#1C1B19',
};

export interface AccentPalette {
  id: string;
  name: string;
  lightAcc: string;
  lightInk: string;
  lightTint: string;
  darkAcc: string;
  darkInk: string;
  darkTint: string;
}

export const accents: AccentPalette[] = [
  { id: 'raspberry', name: 'Raspberry', lightAcc: '#B8336A', lightInk: '#8E2652', lightTint: '#F3E3E7', darkAcc: '#E0679A', darkInk: '#F29BBF', darkTint: '#3A2230' },
  { id: 'indigo', name: 'Indigo', lightAcc: '#4F46E5', lightInk: '#3730A3', lightTint: '#E6E5F7', darkAcc: '#8B8CF0', darkInk: '#B9BAFA', darkTint: '#26253D' },
  { id: 'teal', name: 'Teal', lightAcc: '#0F766E', lightInk: '#115E59', lightTint: '#DCEEEA', darkAcc: '#4FB8AC', darkInk: '#8ED8CE', darkTint: '#1C302D' },
  { id: 'forest', name: 'Forest', lightAcc: '#3F6B2A', lightInk: '#2F5220', lightTint: '#E3ECDB', darkAcc: '#8DBF6E', darkInk: '#B5DA9C', darkTint: '#25301E' },
  { id: 'saffron', name: 'Saffron', lightAcc: '#B45309', lightInk: '#8A3F06', lightTint: '#F6E6D3', darkAcc: '#F0A04B', darkInk: '#F6C389', darkTint: '#3A2A18' },
  { id: 'plum', name: 'Plum', lightAcc: '#7E3F98', lightInk: '#62307A', lightTint: '#EEE3F2', darkAcc: '#C08ADB', darkInk: '#DBB6EC', darkTint: '#2F2338' },
];

export const backgrounds: { id: string; name: string; color: string }[] = [
  { id: 'white', name: 'White', color: '#FFFFFF' },
  { id: 'paper', name: 'Paper', color: light.bg! },
  { id: 'mist', name: 'Mist', color: '#F2F4F7' },
  { id: 'sky', name: 'Sky', color: '#EEF4FB' },
  { id: 'mint', name: 'Mint', color: '#EEF6F1' },
  { id: 'blush', name: 'Blush', color: '#FBF0F2' },
];

export const customPrefix = 'custom:';

// Colour maths, as Flutter's HSLColor and computeLuminance do it.

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const v = Number.parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  if (delta !== 0) {
    if (max === rr) h = 60 * (((gg - bb) / delta) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / delta + 2);
    else h = 60 * ((rr - gg) / delta + 4);
  }
  if (h < 0) h += 360;
  const s = l === 1 || l === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return [h, Math.min(1, s), l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/// WCAG contrast ratio between two opaque colours.
export function contrast(a: string, b: string): number {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/// An App colors palette from any colour, kept at WCAG AA in both themes
/// (AccentPalette.fromSeed).
export function accentFromSeed(seed: string): AccentPalette {
  const [h, s, l0] = toHsl(hexToRgb(seed));
  const at = (l: number) => rgbToHex(fromHsl(h, s, clamp(l, 0, 1)));
  let l = clamp(l0, 0.2, 0.6);
  while (l > 0 && contrast(light.onAcc!, at(l)) < 4.6) l -= 0.01;
  let inkL = l * 0.8;
  while (inkL > 0 && contrast(at(inkL), light.bg!) < 6) inkL -= 0.01;
  let d = clamp(l0, 0.45, 0.8);
  while (d < 1 && contrast(dark.onAcc!, at(d)) < 4.6) d += 0.01;
  let darkInkL = d + (1 - d) * 0.4;
  while (darkInkL < 1 && contrast(at(darkInkL), dark.bg!) < 7) darkInkL += 0.01;
  return {
    id: customPrefix + seed.replace('#', '').toUpperCase(),
    name: 'Custom',
    lightAcc: at(l),
    lightInk: at(inkL),
    lightTint: rgbToHex(fromHsl(h, clamp(s * 0.6, 0, 0.5), 0.93)),
    darkAcc: at(d),
    darkInk: at(darkInkL),
    darkTint: rgbToHex(fromHsl(h, clamp(s * 0.5, 0, 0.35), 0.18)),
  };
}

/// A pale tint of any colour (BackgroundPalette.fromSeed).
export function backgroundFromSeed(seed: string): string {
  const [h, s] = toHsl(hexToRgb(seed));
  return rgbToHex(fromHsl(h, clamp(s * 0.7, 0, 0.7), 0.95));
}

function customHex(id: string): string | null {
  return id.startsWith(customPrefix) && /^[0-9A-Fa-f]{6}$/.test(id.slice(customPrefix.length)) ? '#' + id.slice(customPrefix.length) : null;
}

/// Unknown ids fall back to the default, as on the phone.
export function accentById(id: string): AccentPalette {
  const hex = customHex(id);
  if (hex) return accentFromSeed(hex);
  return accents.find((a) => a.id === id) ?? accents[0]!;
}

export function backgroundById(id: string): string {
  const hex = customHex(id);
  if (hex) return backgroundFromSeed(hex);
  return (backgrounds.find((b) => b.id === id) ?? backgrounds[0]!).color;
}

function mix(a: string, b: string, t: number): string {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/// Every token for [settings] in light or dark.
export function tokens(settings: Settings, isDark: boolean): Tokens {
  const t = { ...(isDark ? dark : light) };
  const a = accentById(settings.accent);
  t.acc = isDark ? a.darkAcc : a.lightAcc;
  t.accInk = isDark ? a.darkInk : a.lightInk;
  t.accTint = isDark ? a.darkTint : a.lightTint;
  t.accShadow = alpha(t.acc, isDark ? 0.25 : 0.3);
  // Backgrounds change light mode only; Paper is the original canvas.
  if (!isDark && settings.background !== 'paper') {
    const bg = backgroundById(settings.background);
    const card = mix(bg, '#FFFFFF', 0.6);
    t.bg = bg;
    t.card = card;
    t.rule = mix(bg, t.ink!, 0.09);
    t.rule2 = mix(bg, t.ink!, 0.18);
    t.glass = alpha(card, 0.72);
    t.toastInk = bg;
  }
  return t;
}

const kebab = (k: string) => k.replace(/[A-Z0-9]/g, (c) => '-' + c.toLowerCase());

export function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function isDarkFor(mode: Mode): boolean {
  return mode === 'dark' || (mode === 'system' && prefersDark());
}

/// Writes the tokens onto the page.
export function applyTheme(settings: Settings, root: HTMLElement = document.documentElement) {
  const isDark = isDarkFor(settings.mode);
  for (const [k, v] of Object.entries(tokens(settings, isDark))) root.style.setProperty(`--${kebab(k)}`, v);
  root.style.colorScheme = isDark ? 'dark' : 'light';
  root.dataset.theme = isDark ? 'dark' : 'light';
}

const storageKey = 'nindo.desktop.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaultSettings;
    const v = JSON.parse(raw) as Partial<Settings>;
    return {
      mode: v.mode === 'light' || v.mode === 'dark' ? v.mode : 'system',
      accent: typeof v.accent === 'string' ? v.accent : defaultSettings.accent,
      background: typeof v.background === 'string' ? v.background : defaultSettings.background,
      numerals: v.numerals === 'devanagari' ? 'devanagari' : 'latin',
    };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch {
    // Private windows may refuse; the choice then lasts for this visit.
  }
}

const devanagari = '०१२३४५६७८९';

/// Digits in the chosen numerals ("123" means Latin everywhere).
export function digits(text: string | number, numerals: Numerals): string {
  const s = String(text);
  return numerals === 'devanagari' ? s.replace(/[0-9]/g, (d) => devanagari[Number(d)]!) : s;
}
