/**
 * Phase-4 Wave B tail — profile picture as a reveal-gated, media-typed persona
 * attribute. A present sealed media ref on the roster row means the member
 * disclosed it (propagation is reveal-gated); it then renders only when the
 * viewer is also entitled.
 */
import { describe, it, expect } from 'vitest';
import { isDisclosed } from '@onderling/agent-registry';
import { personaAttributes, memberRevealState } from '../../src/v2/memberCards.js';

const PIC = { type: 'blob', ref: 'blob://pic1', enc: { sealed: true, keyRef: 'k', format: 'jpeg', bytes: 100 } };

describe('personaAttributes — profilePicture only when a sealed ref is present', () => {
  it('adds a media-typed profilePicture attribute carrying the sealed ref', () => {
    const attrs = personaAttributes({ handle: 'jan', realName: 'Jan', profilePicture: PIC });
    const pic = attrs.find((a) => a.key === 'profilePicture');
    expect(pic).toMatchObject({ key: 'profilePicture', media: true, value: PIC, openness: 'pairwise' });
  });
  it('omits it when absent or not a sealed ref', () => {
    expect(personaAttributes({ handle: 'jan' }).some((a) => a.key === 'profilePicture')).toBe(false);
    expect(personaAttributes({ handle: 'jan', profilePicture: 'blob://x' }).some((a) => a.key === 'profilePicture')).toBe(false);
    // an UNSEALED ref must not surface (never leak plaintext bytes as an attribute)
    const unsealed = { type: 'blob', ref: 'blob://x', enc: { sealed: false } };
    expect(personaAttributes({ handle: 'jan', profilePicture: unsealed }).some((a) => a.key === 'profilePicture')).toBe(false);
  });
});

describe('memberRevealState — profilePicture enabled iff present, independent of realName', () => {
  it('enables it when the row carries the pic', () => {
    const rs = memberRevealState({ member: { profilePicture: PIC }, contextId: 'c1' });
    expect(isDisclosed(rs, 'c1', 'profilePicture')).toBe(true);
    expect(isDisclosed(rs, 'c1', 'handle')).toBe(true); // floor always
  });
  it('leaves it withheld when the row has no pic', () => {
    const rs = memberRevealState({ member: {}, contextId: 'c1' });
    expect(isDisclosed(rs, 'c1', 'profilePicture')).toBe(false);
  });
  it('the pic is not tied to realName sharing (present-with-no-realName still enables it)', () => {
    const rs = memberRevealState({ member: { profilePicture: PIC }, policy: 'pairwise', contextId: 'c1' });
    expect(isDisclosed(rs, 'c1', 'profilePicture')).toBe(true);
    expect(isDisclosed(rs, 'c1', 'realName')).toBe(false); // no reveals[] → realName withheld
  });
});
