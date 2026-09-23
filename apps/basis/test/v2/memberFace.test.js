/**
 * The one answer to "what goes where this person's face goes" — shared, because both shells ask it and only
 * the drawing differs. A shell that worked it out for itself would be a projection in a shell, and the two
 * would drift the first time the rule changed.
 *
 * The picture is the persona's `profilePicture` attribute, disclosed per circle and carried in the release.
 * There was briefly a second, inline road (`said.avatarThumb`); it was duplication and was removed the same
 * day. These tests assert the ONE road, including that the other shape is not a face.
 */
import { describe, it, expect } from 'vitest';
import { faceOf, hasFace } from '../../src/v2/memberFace.js';

/** The shape a released picture really has: an embeds-style pointer with a SEALED `enc` line. */
const PIC = { type: 'blob', ref: 'blob://abc', enc: { sealed: true, keyRef: 'k1', format: 'x', bytes: 900, thumb: 'AAAA' } };

describe('faceOf — the released picture, or the person\'s own first letter', () => {
  it('takes the picture from the release, wherever the row carries it', () => {
    for (const row of [
      { personaProperties: { profilePicture: PIC }, name: 'Bram' },
      { said: { personaProperties: { profilePicture: PIC } }, name: 'Bram' },
      { profilePicture: PIC, name: 'Bram' },
    ]) {
      expect(faceOf(row)).toEqual({ kind: 'picture', picture: PIC, initial: 'B', alt: 'Bram' });
      expect(hasFace(row)).toBe(true);
    }
  });

  it('hands back the REF, not an image — the thumbnail is sealed and only a shell can open it', () => {
    // The decision is shared; the unsealing is the shell's, because only it holds the circle's media opener.
    expect(faceOf({ personaProperties: { profilePicture: PIC } }).picture).toBe(PIC);
  });

  it('falls back to the initial — the person\'s own, not a placeholder', () => {
    // A row without a picture must look deliberate rather than like something failed to load, and the initial
    // is stable across reloads and devices, so it still tells you who it is at a glance.
    expect(faceOf({ name: 'Cato' })).toEqual({ kind: 'initial', initial: 'C', alt: 'Cato' });
    expect(faceOf({ said: { handle: 'bram' } })).toMatchObject({ kind: 'initial', initial: 'B' });
    expect(hasFace({ name: 'Cato' })).toBe(false);
    // …and it rides along even WITH a picture, because unsealing can fail and a hole where somebody was is worse
    expect(faceOf({ profilePicture: PIC, name: 'Cato' }).initial, 'a fallback is always to hand').toBe('C');
  });

  it('a row with nothing to name it says so, rather than inventing a letter', () => {
    expect(faceOf({})).toMatchObject({ kind: 'initial', initial: '·' });
    expect(faceOf(null)).toMatchObject({ kind: 'initial', initial: '·' });
  });

  it('NEVER accepts an unsealed value, a bare URL, or the private avatarUrl cache', () => {
    // An UNSEALED ref would be inline plaintext where a sealed pointer belongs; a bare URL would turn painting
    // a row into a request to somebody else's server that says who is reading it and when; `avatarUrl` is the
    // local display cache the roster gate keeps private and nothing may paint.
    expect(faceOf({ profilePicture: { ...PIC, enc: { ...PIC.enc, sealed: false } }, name: 'B' })).toMatchObject({ kind: 'initial' });
    expect(faceOf({ profilePicture: 'https://example.org/me.png', name: 'B' })).toMatchObject({ kind: 'initial' });
    expect(faceOf({ profilePicture: 'data:image/png;base64,AAAA', name: 'B' })).toMatchObject({ kind: 'initial' });
    expect(faceOf({ avatarUrl: 'https://example.org/me.png', name: 'B' })).toMatchObject({ kind: 'initial' });
    expect(faceOf({ avatarThumb: 'data:image/png;base64,AAAA', name: 'B' }), 'the retired inline road is not a face').toMatchObject({ kind: 'initial' });
  });

  it('takes the name a person would recognise, in that order', () => {
    expect(faceOf({ name: 'Bram', displayName: 'X', handle: 'y' }).alt).toBe('Bram');
    expect(faceOf({ said: { displayName: 'Bram de Vries' } }).alt).toBe('Bram de Vries');
  });

  it('an emoji or accented name gives one whole character, not half of one', () => {
    expect(faceOf({ name: 'Émile' }).initial).toBe('É');
    expect(faceOf({ name: '🌳 Boomgaard' }).initial).toBe('🌳');
  });
});
