/// What a pasted sign-in email link holds. Opening the link itself signs in
/// whichever browser opens it (Safari, not the Dock app), so the app reads
/// the link instead and signs itself in.
export type SignInLink =
  | { kind: 'token'; tokenHash: string; type: 'magiclink' | 'signup' | 'email' }
  | { kind: 'session'; accessToken: string; refreshToken: string };

const linkTypes = new Set(['magiclink', 'signup', 'email']);

export function parseSignInLink(text: string): SignInLink | null {
  const raw = text.trim();
  if (!raw) return null;
  // Mail apps and link checkers sometimes wrap the real link inside another
  // one, so look through every decoded layer.
  const layers = [raw];
  for (let i = 0; i < 3; i++) {
    const next = safeDecode(layers[layers.length - 1]!);
    if (next === layers[layers.length - 1]) break;
    layers.push(next);
  }
  for (const layer of layers) {
    // The email's own link: https://<project>.supabase.co/auth/v1/verify?token=…&type=magiclink
    const verify = layer.match(/\/auth\/v1\/verify\?([^\s#"'<>]*)/);
    if (verify) {
      const params = new URLSearchParams(verify[1]);
      const token = params.get('token');
      const type = params.get('type') ?? 'magiclink';
      if (token && linkTypes.has(type) && !token.startsWith('pkce_')) {
        return { kind: 'token', tokenHash: token, type: type as 'magiclink' | 'signup' | 'email' };
      }
    }
    // The page the link lands on after Supabase checks it: …/#access_token=…&refresh_token=…
    const hash = layer.indexOf('#');
    if (hash >= 0) {
      const params = new URLSearchParams(layer.slice(hash + 1));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) return { kind: 'session', accessToken, refreshToken };
    }
  }
  return null;
}

/// A typed code with spaces or dashes taken out; null unless it is all digits.
export function cleanCode(text: string): string | null {
  const digits = text.replace(/[\s-]/g, '');
  return /^\d{6,10}$/.test(digits) ? digits : null;
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
