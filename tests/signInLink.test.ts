import { describe, expect, it } from 'vitest';
import { cleanCode, parseSignInLink } from '../src/domain/signInLink';

const verify =
  'https://abc.supabase.co/auth/v1/verify?token=0f3c9e1a2b&type=magiclink&redirect_to=https://noob-master-cyrok.github.io/nindo-desktop/';

describe('parseSignInLink', () => {
  it('reads the token from the email link', () => {
    expect(parseSignInLink(verify)).toEqual({ kind: 'token', tokenHash: '0f3c9e1a2b', type: 'magiclink' });
  });

  it('reads a link wrapped by a mail link checker', () => {
    const wrapped = `https://safelinks.example.com/?url=${encodeURIComponent(verify)}&data=1`;
    expect(parseSignInLink(wrapped)).toEqual({ kind: 'token', tokenHash: '0f3c9e1a2b', type: 'magiclink' });
  });

  it('reads the page a link landed on', () => {
    const landed = 'https://noob-master-cyrok.github.io/nindo-desktop/#access_token=aaa&expires_in=3600&refresh_token=rrr&type=magiclink';
    expect(parseSignInLink(landed)).toEqual({ kind: 'session', accessToken: 'aaa', refreshToken: 'rrr' });
  });

  it('ignores anything else', () => {
    expect(parseSignInLink('')).toBeNull();
    expect(parseSignInLink('hello')).toBeNull();
    expect(parseSignInLink('https://abc.supabase.co/auth/v1/verify?type=magiclink')).toBeNull();
    expect(parseSignInLink('https://abc.supabase.co/auth/v1/verify?token=x&type=recovery')).toBeNull();
    expect(parseSignInLink('https://x.test/#error=access_denied')).toBeNull();
  });
});

describe('cleanCode', () => {
  it('drops spaces and dashes', () => {
    expect(cleanCode(' 123 456 ')).toBe('123456');
    expect(cleanCode('123-456')).toBe('123456');
  });
  it('refuses non-codes', () => {
    expect(cleanCode('12345')).toBeNull();
    expect(cleanCode('12a456')).toBeNull();
  });
});
