import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { applyTheme, defaultSettings, digits, loadSettings, saveSettings, type Settings } from './theme';

interface Ctx {
  settings: Settings;
  update: (change: Partial<Settings>) => void;
  /// A number (or any text with digits) in the chosen numerals.
  num: (value: number | string) => string;
}

const SettingsContext = createContext<Ctx>({
  settings: defaultSettings,
  update: () => {},
  num: (v) => String(v),
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(loadSettings);

  useEffect(() => {
    applyTheme(settings);
    if (settings.mode !== 'system' || typeof matchMedia !== 'function') return;
    // Follow the computer when it switches between light and dark.
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(settings);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [settings]);

  const update = (change: Partial<Settings>) =>
    setSettings((s) => {
      const next = { ...s, ...change };
      saveSettings(next);
      return next;
    });

  return (
    <SettingsContext.Provider value={{ settings, update, num: (v) => digits(v, settings.numerals) }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
