import { useEffect, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { linkError, signInReturnUrl } from '../supabase';

const COOLDOWN_SECONDS = 60;

/// Email one-time code, the same sign-in the phone uses.
export function SignIn({ client }: { client: SupabaseClient }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    linkError() ? 'That sign-in link has expired or was already used. Send a new code.' : null,
  );

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    const address = email.trim();
    if (!address || cooldown > 0) return;
    setBusy(true);
    setError(null);
    // Existing accounts only: the desktop never creates a new one.
    const { error: sendError } = await client.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: false, emailRedirectTo: signInReturnUrl() },
    });
    setBusy(false);
    setCooldown(COOLDOWN_SECONDS);
    if (sendError) {
      setError(
        sendError.status === 429
          ? 'Too many codes were requested. Wait a minute and try again.'
          : 'We could not send a code to that address. Use the email you signed in with on your phone.',
      );
      return;
    }
    setSentTo(address);
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!sentTo || !code.trim()) return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await client.auth.verifyOtp({ email: sentTo, token: code.trim(), type: 'email' });
    setBusy(false);
    if (verifyError) setError('That code did not work. Check it, or send a new one.');
  }

  return (
    <main className="center">
      <div className="card narrow">
        <p className="kicker">Nindo Desktop</p>
        <h1>Sign in</h1>
        <p className="muted">Use the same email as Nindo on your phone. Your tasks stay private to that account.</p>

        {!sentTo ? (
          <form onSubmit={sendCode} className="stack">
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            </label>
            <button className="primary" disabled={busy || cooldown > 0 || !email.trim()}>
              {cooldown > 0 ? `Send code (${cooldown}s)` : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="stack">
            <p>
              We sent an email to <strong>{sentTo}</strong>. Enter the code from it, or open its sign-in link in this
              browser.
            </p>
            <label className="field">
              <span>Code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
              />
            </label>
            <button className="primary" disabled={busy || !code.trim()}>
              Sign in
            </button>
            <div className="row">
              <button type="button" className="link" onClick={() => setSentTo(null)}>
                Use another email
              </button>
              <button type="button" className="link" disabled={cooldown > 0} onClick={() => sendCode()}>
                {cooldown > 0 ? `Send again in ${cooldown}s` : 'Send a new code'}
              </button>
            </div>
          </form>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
