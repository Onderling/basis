/**
 * The not-understood memory is bounded per peer: an authorized peer that invents subtype names gets at most
 * NOT_UNDERSTOOD_PER_PEER answers in a start, and its row keeps at most that many names.
 */
import { describe, it, expect } from 'vitest';
import { createNotUnderstood, NOT_UNDERSTOOD_PER_PEER } from '../../src/v2/notUnderstood.js';

describe('not-understood is capped per peer', () => {
  it('answers at most the cap per peer, then stops; another peer has its own count', () => {
    const nu = createNotUnderstood();
    const answers = [];
    for (let i = 0; i < 100; i += 1) answers.push(nu.answerFor('peer-a', `made-up-${i}`, 2));
    expect(answers.filter(Boolean)).toHaveLength(NOT_UNDERSTOOD_PER_PEER);
    expect(nu.answerFor('peer-b', 'made-up-0', 2)).not.toBeNull();
  });
  it('keeps at most the cap of names a peer said it could not receive', () => {
    const nu = createNotUnderstood();
    for (let i = 0; i < 100; i += 1) nu.noteAnswer('peer-a', { of: `kind-${i}`, wire: 1 }, 2);
    for (let i = 0; i < 100; i += 1) nu.noteAnswer('peer-a', { of: `same-${i}`, wire: 2 }, 2);
    expect(nu.toldBy('peer-a')).toHaveLength(NOT_UNDERSTOOD_PER_PEER);
    expect(nu.noteAnswer('peer-a', { of: 'same-99', wire: 2 }, 2), 'past the cap a same-wire answer is not logged again').toBe(false);
  });
  it('the cap is small', () => {
    expect(NOT_UNDERSTOOD_PER_PEER).toBe(16);
  });
});
