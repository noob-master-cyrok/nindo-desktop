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
