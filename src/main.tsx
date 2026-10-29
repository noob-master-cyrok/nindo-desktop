import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SettingsProvider } from './settings';
import { applyTheme, loadSettings } from './theme';
import './styles.css';

// Colours before the first paint, so there is no flash of the wrong theme.
applyTheme(loadSettings());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);

// Lets the app open without internet once it has been opened online. Only in
// the built site: the dev server's files change on every save.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
