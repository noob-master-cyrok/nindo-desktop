import { useEffect, useState, type FormEvent } from 'react';
import type { AuthError, SupabaseClient } from '@supabase/supabase-js';
import { inInstalledApp, linkError, signInReturnUrl } from '../supabase';
import { cleanCode, parseSignInLink } from '../domain/signInLink';

const COOLDOWN_SECONDS = 60;

function sendProblem(error: AuthError): string {
  if (error.status === 429) {
    return 'The sign-in email service only sends a few emails an hour, so no new email went out. If you have an unused Nindo email from the last hour, enter its code or paste its link. Otherwise try again in about an hour.';
  }
  if (!error.status) return 'Nindo could not reach the server. Check your internet connection and try again.';
  return 'We could not send a code to that address. Use the email you signed in with on your phone.';
}

function verifyProblem(error: AuthError, what: 'code' | 'link'): string {
  if (!error.status) return 'Nindo could not reach the server. Check your internet connection and try again.';
  if (error.status === 429) return 'Too many tries. Wait a minute and try again.';
  return what === 'code'
    ? 'That code did not work. It may have a typo, be over an hour old, or be from an older email. Use the code from the newest Nindo email, or send a new one.'
    : 'That link did not work. It may already have been opened (opening it uses it up) or be over an hour old. Send a new code.';
}

/// Email one-time code, the same sign-in the phone uses. The emailed link can
/// also be pasted in, for windows that links do not open in.
export function SignIn({ client }: { client: SupabaseClient }) {
  const installed = inInstalledApp();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [link, setLink] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
    const address = (sentTo ?? email).trim();
    if (!address || cooldown > 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    // Existing accounts only: the desktop never creates a new one.
    const { error: sendError } = await client.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: false, emailRedirectTo: signInReturnUrl() },
    });
    setBusy(false);
    setCooldown(COOLDOWN_SECONDS);
    if (sendError) {
      setError(sendProblem(sendError));
      // An earlier email may still work, so offer the code and link boxes.
      if (sendError.status === 429) setSentTo(address);
      return;
    }
    setSentTo(address);
    setNotice(`We sent an email to ${address}.`);
  }

  function haveEmail() {
    const address = email.trim();
    if (!address) {
      setError('Type your email first.');
      return;
    }
    setError(null);
    setNotice(null);
    setSentTo(address);
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    if (!sentTo) return;
    const token = cleanCode(code);
    if (!token) {
      setError('Type the code from the email: just its digits.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: verifyError } = await client.auth.verifyOtp({ email: sentTo, token, type: 'email' });
    setBusy(false);
    if (verifyError) setError(verifyProblem(verifyError, 'code'));
  }

  async function verifyLink(event: FormEvent) {
    event.preventDefault();
    const parsed = parseSignInLink(link);
    if (!parsed) {
      setError('That is not a Nindo sign-in link. Copy the whole link from the email and paste it here.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: linkProblem } =
      parsed.kind === 'token'
        ? await client.auth.verifyOtp({ token_hash: parsed.tokenHash, type: parsed.type })
        : await client.auth.setSession({ access_token: parsed.accessToken, refresh_token: parsed.refreshToken });
    setBusy(false);
    if (linkProblem) setError(verifyProblem(linkProblem, 'link'));
  }

  return (
    <main className="center">
      <div className="card narrow">
        <p className="wordmark">
          Nindo <span className="kicker">Tasks</span>
        </p>
        <h1 className="sheet-title">Sign in</h1>
        <p className="muted">Use the same email as Nindo on your phone. Your tasks stay private to that account.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

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
            <button type="button" className="link self-start" onClick={haveEmail}>
              I already have a code
            </button>
          </form>
        ) : (
          <>
            <form onSubmit={verifyCode} className="stack">
              <p>
                {notice ?? (
                  <>
                    Signing in as <strong>{sentTo}</strong>.
                  </>
                )}{' '}
                Enter the code from the newest Nindo email.
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
            </form>

            <div className="row">
              <button
                type="button"
                className="link"
                onClick={() => {
                  setSentTo(null);
                  setNotice(null);
                  setError(null);
                }}
              >
                Use another email
              </button>
              <button type="button" className="link" disabled={busy || cooldown > 0} onClick={() => sendCode()}>
                {cooldown > 0 ? `Send again in ${cooldown}s` : 'Send a new code'}
              </button>
            </div>
          </>
        )}
        <form onSubmit={verifyLink} className="stack link-sign-in">
          <label className="field">
            <span>Or paste the link from the email</span>
            <input
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://…supabase.co/auth/v1/verify?token=…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </label>
          <p className="muted small">
            In Mail, Control-click the sign-in link and choose Copy Link.
            {installed
              ? ' Clicking the link would sign in Safari, not this window. Already signed in to Nindo in Safari? Choose Settings › Move sign-in to the Mac app there, then paste here.'
              : ' Or open the link in this browser.'}
          </p>
          <button disabled={busy || !link.trim()}>
            Sign in with link
          </button>
        </form>
      </div>
    </main>
  );
}
