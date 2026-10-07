import { describe, it, expect } from 'vitest';
import { sealForLink, openForLink, isLinkSealed, randomKey } from '../src/index.js';

describe('a blob that opens with the key a link carries', () => {
  it('opens with that key only; the envelope holds no plaintext and no key', () => {
    const k = randomKey();
    const env = sealForLink('BEGIN:VCALENDAR Tandarts', k);
    expect(isLinkSealed(env)).toBe(true);
    expect(env).not.toContain('Tandarts');
    expect(env).not.toContain(k);
    expect(openForLink(env, k)).toBe('BEGIN:VCALENDAR Tandarts');
    expect(openForLink(env, randomKey())).toBeNull();
    expect(openForLink('not an envelope', k)).toBeNull();
    expect(isLinkSealed('{"v":1}')).toBe(false);
  });
  it('a link key is 128 bits of base64url (the bucket\'s minter)', () => {
    expect(randomKey()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
