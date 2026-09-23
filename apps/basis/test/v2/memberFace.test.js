/**
 * The one answer to "what goes where this person's face goes" — shared, because both shells ask it and only
 * the drawing differs. A shell that worked it out for itself would be a projection in a shell, and the two
 * would drift the first time the rule changed.
 */
import { describe, it, expect } from 'vitest';
import { faceOf, hasFace } from '../../src/v2/memberFace.js';

const THUMB = 'data:image/webp;base64,AAAA';

describe('faceOf — a picture, or the person\'s own first letter', () => {
  it('paints the face when the lane carries one', () => {
    expect(faceOf({ said: { avatarThumb: THUMB }, name: 'Bram' })).toEqual({ kind: 'thumb', thumb: THUMB, initial: 'B', alt: 'Bram' });
    expect(hasFace({ avatarThumb: THUMB })).toBe(true);
  });

  it('falls back to the initial — the person\'s own, not a placeholder', () => {
    // A row without a picture must look deliberate rather than like something failed to load, and the initial
    // is stable across reloads and devices, so it still tells you who it is at a glance.
    expect(faceOf({ name: 'Cato' })).toEqual({ kind: 'initial', initial: 'C', alt: 'Cato' });
    // …and the initial rides along even WITH a picture, so a shell whose image fails to decode has it
    expect(faceOf({ avatarThumb: THUMB, name: 'Cato' }).initial, 'a fallback is always to hand').toBe('C');
    expect(faceOf({ said: { handle: 'bram' } })).toMatchObject({ kind: 'initial', initial: 'B' });
    expect(hasFace({ name: 'Cato' })).toBe(false);
  });

  it('a row with nothing to name it says so, rather than inventing a letter', () => {
    expect(faceOf({})).toMatchObject({ kind: 'initial', initial: '·' });
    expect(faceOf(null)).toMatchObject({ kind: 'initial', initial: '·' });
  });

  it('NEVER takes a face from the private cache, or from any URL that is not inline', () => {
    // `avatarUrl` is the local display cache the roster gate marks private. A shell must also never be handed
    // a `src` it would fetch from somebody else's server: that turns painting a row into a request that says
    // who is reading it and when.
    expect(faceOf({ avatarUrl: 'https://example.org/me.png', name: 'Bram' })).toMatchObject({ kind: 'initial' });
    expect(faceOf({ avatarThumb: 'https://example.org/me.png', name: 'Bram' })).toMatchObject({ kind: 'initial' });
    expect(faceOf({ avatarThumb: 'blob:abc', name: 'Bram' })).toMatchObject({ kind: 'initial' });
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
