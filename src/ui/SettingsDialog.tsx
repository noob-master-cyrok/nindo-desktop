import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useSettings } from '../settings';
import { forgetSignInHere, handoffLink, inInstalledApp, supabase } from '../supabase';
import { accentById, accents, backgroundById, backgrounds, customPrefix, isDarkFor, type Mode, type Numerals } from '../theme';
import { Modal } from './Modal';
import { Segmented } from './Segmented';

/// Desktop settings, kept on this computer: the phone's Appearance, App
/// colors, Background and Numerals, plus the account.
export function SettingsDialog({ email, onSignOut, onClose }: { email: string; onSignOut: () => void; onClose: () => void }) {
  const { settings, update } = useSettings();
  const customAccent = settings.accent.startsWith(customPrefix);
  const customBackground = settings.background.startsWith(customPrefix);
  const dark = isDarkFor(settings.mode);
  // Read ahead so the copy runs straight from the click, as Safari requires.
  const [session, setSession] = useState<Session | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  useEffect(() => {
    void supabase?.auth.getSession().then(({ data }) => setSession(data.session));
  }, []);

  function moveToMacApp() {
    if (!supabase || !session) return;
    navigator.clipboard.writeText(handoffLink(session)).then(
      () => forgetSignInHere(supabase!),
      () => setHandoffError('Nindo could not copy to the clipboard. Try again.'),
    );
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="stack settings">
        <section className="set-group" aria-label="Appearance">
          <h3 className="kicker">Appearance</h3>
          <Segmented<Mode>
            label="Appearance"
            value={settings.mode}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={(mode) => update({ mode })}
          />
        </section>

        <section className="set-group" aria-label="App colors">
          <h3 className="kicker">App colors</h3>
          <div className="swatches" role="radiogroup" aria-label="App colors">
            {accents.map((a) => (
              <button
                key={a.id}
                role="radio"
                aria-checked={settings.accent === a.id}
                aria-label={a.name}
                title={a.name}
                className="swatch-pick"
                onClick={() => update({ accent: a.id })}
              >
                <span className="swatch-fill" style={{ background: dark ? a.darkAcc : a.lightAcc }} />
              </button>
            ))}
            <label className={customAccent ? 'swatch-pick custom on' : 'swatch-pick custom'} title="Custom colour">
              <span className="swatch-fill" style={{ background: customAccent ? accentById(settings.accent).lightAcc : undefined }} />
              <input
                type="color"
                aria-label="Custom app colour"
                value={customAccent ? '#' + settings.accent.slice(customPrefix.length) : '#B8336A'}
                onChange={(e) => update({ accent: customPrefix + e.target.value.slice(1).toUpperCase() })}
              />
            </label>
          </div>
          <p className="muted small">Buttons, switches, progress and selection use this colour. Custom colours are adjusted so text stays easy to read.</p>
        </section>

        <section className="set-group" aria-label="Background">
          <h3 className="kicker">Background</h3>
          <div className="swatches" role="radiogroup" aria-label="Background">
            {backgrounds.map((b) => (
              <button
                key={b.id}
                role="radio"
                aria-checked={settings.background === b.id}
                aria-label={b.name}
                title={b.name}
                className="swatch-pick bg"
                onClick={() => update({ background: b.id })}
              >
                <span className="swatch-fill" style={{ background: b.color }} />
              </button>
            ))}
            <label className={customBackground ? 'swatch-pick bg custom on' : 'swatch-pick bg custom'} title="Custom background">
              <span className="swatch-fill" style={{ background: customBackground ? backgroundById(settings.background) : undefined }} />
              <input
                type="color"
                aria-label="Custom background colour"
                value={customBackground ? '#' + settings.background.slice(customPrefix.length) : '#EEF4FB'}
                onChange={(e) => update({ background: customPrefix + e.target.value.slice(1).toUpperCase() })}
              />
            </label>
          </div>
          <p className="muted small">{dark ? 'Dark mode keeps its own background.' : 'Light mode only. Dark mode keeps its own background.'}</p>
        </section>

        <section className="set-group" aria-label="Numerals">
          <h3 className="kicker">Numerals</h3>
          <Segmented<Numerals>
            label="Numerals"
            value={settings.numerals}
            options={[
              { value: 'latin', label: '123' },
              { value: 'devanagari', label: '१२३' },
            ]}
            onChange={(numerals) => update({ numerals })}
          />
        </section>

        <section className="set-group" aria-label="Account">
          <h3 className="kicker">Account</h3>
          <div className="row">
            <span className="account-email">
              {email}
            </span>
            <button className="secondary push" onClick={onSignOut}>
              Sign out
            </button>
          </div>
          {!inInstalledApp() && session && (
            <div className="stack handoff">
              <button className="secondary" onClick={moveToMacApp}>
                Move sign-in to the Mac app
              </button>
              <p className="muted small">
                Copies this sign-in and signs out this browser window. Open Nindo from the Dock and paste it into “Or
                paste the link from the email”. One window at a time can hold a sign-in.
              </p>
              {handoffError && (
                <p className="error" role="alert">
                  {handoffError}
                </p>
              )}
            </div>
          )}
          <p className="muted small">These settings are kept on this computer. Your phone keeps its own.</p>
        </section>

        <div className="row end">
          <button className="primary" onClick={onClose} autoFocus>
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
