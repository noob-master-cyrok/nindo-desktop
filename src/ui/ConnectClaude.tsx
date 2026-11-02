import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

const key = 'nindo.oauth.authorization';

/// The authorization request an AI app (Claude) sent here, from the address
/// or from before a sign-in in this tab.
export function pendingAuthorization(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('authorization_id');
  try {
    if (fromUrl) sessionStorage.setItem(key, fromUrl);
    return fromUrl ?? sessionStorage.getItem(key);
  } catch {
    return fromUrl;
  }
}

function finish() {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing kept.
  }
}

type Details = { client: string; email: string; scope: string; redirect: string };

/// Supabase Auth's OAuth server sends Claude's "connect" here: the person
/// sees which app asks, for which account, and allows or denies it. Allowed,
/// Claude can read this account's Nindo through the Nindo connector (read
/// only; row-level security as for this app).
export function ConnectClaude({ client, authorizationId, onDone }: { client: SupabaseClient; authorizationId: string; onDone: () => void }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    client.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (!live) return;
      if (error || !data) {
        finish();
        setProblem('This connection request has expired or was already used. Start connecting again from Claude.');
        return;
      }
      if ('redirect_url' in data) {
        finish();
        window.location.assign(data.redirect_url);
        return;
      }
      setDetails({ client: data.client.name || 'An app', email: data.user.email, scope: data.scope, redirect: new URL(data.redirect_uri).host });
    });
    return () => {
      live = false;
    };
  }, [client, authorizationId]);

  async function decide(allow: boolean) {
    setBusy(true);
    const { data, error } = allow
      ? await client.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await client.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    finish();
    if (error || !data) {
      setBusy(false);
      setProblem('That did not go through. Start connecting again from Claude.');
      return;
    }
    window.location.assign(data.redirect_url);
  }

  return (
    <main className="center">
      <div className="card narrow connect-card" role="dialog" aria-labelledby="connect-title">
        <p className="kicker">Nindo</p>
        <h1 id="connect-title" className="sheet-title">
          {details ? `Allow ${details.client} to read your Nindo?` : 'Connecting…'}
        </h1>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        {details && !problem && (
          <>
            <p>
              Signed in as <b>{details.email}</b>. {details.client} will be able to read your tasks, projects, worked time, breaks, attendance and day notes, to write
              reports. It cannot change anything.
            </p>
            <p className="muted small">
              It returns to {details.redirect}. You can disconnect it in Claude at any time. Requested access: {details.scope || 'default'}.
            </p>
            <div className="connect-actions">
              <button className="secondary" disabled={busy} onClick={() => decide(false)}>
                Deny
              </button>
              <button className="primary" disabled={busy} onClick={() => decide(true)}>
                Allow
              </button>
            </div>
          </>
        )}
        {problem && (
          <button
            className="secondary"
            onClick={() => {
              window.history.replaceState(null, '', window.location.pathname);
              onDone();
            }}
          >
            Open Nindo
          </button>
        )}
      </div>
    </main>
  );
}
