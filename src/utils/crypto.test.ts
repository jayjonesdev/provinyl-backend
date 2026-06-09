import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './crypto';

describe('crypto (AES-256-GCM)', () => {
  it('round-trips a value', () => {
    const secret = 'discogs-oauth-token-abc123';
    expect(decrypt(encrypt(secret))).toBe(secret);
  });

  it('produces the tagged v1 format and hides the plaintext', () => {
    const enc = encrypt('hello world');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc.split(':')).toHaveLength(4);
    expect(enc).not.toContain('hello world');
  });

  it('uses a random IV so the same input encrypts differently each time', () => {
    expect(encrypt('same')).not.toBe(encrypt('same'));
  });

  it('passes through legacy plaintext (not in v1 format)', () => {
    expect(decrypt('legacy-plaintext-token')).toBe('legacy-plaintext-token');
  });

  it('throws on a tampered ciphertext (auth tag mismatch)', () => {
    const enc = encrypt('tamper me');
    const parts = enc.split(':');
    // Flip the last base64 char of the ciphertext segment.
    const ct = parts[3];
    parts[3] = (ct.slice(0, -1) + (ct.endsWith('A') ? 'B' : 'A'));
    expect(() => decrypt(parts.join(':'))).toThrow();
  });
});
