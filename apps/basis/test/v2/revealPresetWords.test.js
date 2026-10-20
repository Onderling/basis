/**
 * How much of a persona a member card reveals — "Zichtbaar: profiel" — said the same on both shells: one words
 * function, both paint its output. The phone's member card had no badge at all (web had it): a person's own
 * disclosure fact, missing on one shell.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { revealPresetWords } from '../../src/v2/memberCards.js';

const t = (k) => `T(${k})`;
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('revealPresetWords', () => {
  it('a preset: the label and its value, in words', () => {
    expect(revealPresetWords('profile', t)).toEqual({ label: 'T(circle.memberCard.preset_label)', value: 'T(circle.reveal.preset.profile)' });
  });
  it('no preset (nothing reaches the floor): no badge', () => {
    expect(revealPresetWords(null, t)).toBe(null);
    expect(revealPresetWords('nonsense', t)).toBe(null);
  });
  it('both shells paint it', () => {
    expect(read('../../web/v2/circleMemberCard.js')).toMatch(/revealPresetWords\(preset, tr\)/);
    expect(read('../../../basis-mobile/src/screens/v2/CircleMemberCardScreen.js')).toMatch(/revealPresetWords\(split\.preset, t\)/);
  });
});
