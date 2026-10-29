import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/// Null when the build has no Supabase settings; the app then explains how
/// to add them instead of failing.
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        // detectSessionInUrl: an emailed sign-in link opens this page with the
        // session in the URL; supabase-js reads it and clears it.
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

/// Where an emailed sign-in link should land: this page, without any
/// query or hash.
export function signInReturnUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/// An error a failed sign-in link left in the URL hash, if any.
export function linkError(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  return params.get('error_description') ?? params.get('error');
}

/// True in the Mac app made with Safari's Add to Dock (or any installed web
/// app). Its sign-in is kept apart from Safari's, and email links open in
/// Safari, so links have to be pasted in instead of opened.
export function inInstalledApp(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/// A link holding this browser's sign-in, for pasting into the Dock app.
export function handoffLink(session: Session): string {
  const params = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: String(session.expires_at ?? ''),
    token_type: 'bearer',
  });
  return `${signInReturnUrl()}#${params}`;
}

/// Forgets the sign-in on this browser only. signOut() would also end it on
/// the server, and with it the copy just handed to the Dock app; two copies
/// refreshing the same token would get both signed out, so this one stops.
export function forgetSignInHere(client: SupabaseClient) {
  client.auth.stopAutoRefresh();
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('sb-') && key.includes('-auth-token')) localStorage.removeItem(key);
  }
  window.location.reload();
}
