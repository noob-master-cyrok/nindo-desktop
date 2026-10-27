import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
