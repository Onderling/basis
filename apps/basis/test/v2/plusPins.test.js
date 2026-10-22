/**
 * VASTGEZET — what a person pinned to their "+": their own acts, and BOOKMARKS to an op in a circle. A bookmark is an
 * address (`{circleId, appOrigin, opId}`) and nothing else; in the sheet it OPENS its circle with that op's form, never
 * acts from there; a bookmark whose circle the person left (or whose op that circle no longer shows) is not painted, and
 * a tap from a stale paint opens nothing and says so.
 */
import { describe, it, expect } from 'vitest';
import { withPin, withoutPin, pinsOf, pinKey, paintablePins, openPin } from '../../src/v2/plusPins.js';

const book = () => ({ screens: [], activeId: null });

describe('Vastgezet: pins in the book', () => {
  it('a bookmark keeps its address only — never an op\'s args or a circle\'s content (condition a)', () => {
    const b = withPin(book(), { kind: 'bookmark', circleId: 'c1', appOrigin: 'pinboard', opId: 'postRequest', args: { text: 'geheim' }, title: 'Straat', items: [1] });
    expect(pinsOf(b)).toEqual([{ kind: 'bookmark', circleId: 'c1', appOrigin: 'pinboard', opId: 'postRequest' }]);
  });
  it('an own act is pinned by its id; the same pin twice is one; unpin takes it away', () => {
    let b = withPin(book(), { kind: 'own', actId: 'household.note' });
    b = withPin(b, { kind: 'own', actId: 'household.note' });
    expect(pinsOf(b)).toEqual([{ kind: 'own', actId: 'household.note' }]);
    expect(pinsOf(withoutPin(b, pinKey({ kind: 'own', actId: 'household.note' })))).toEqual([]);
  });
  it('a malformed pin is no pin', () => {
    expect(pinsOf(withPin(book(), { kind: 'bookmark', circleId: 'c1' }))).toEqual([]);
    expect(pinsOf(withPin(book(), { kind: 'whatever' }))).toEqual([]);
  });
});

describe('Vastgezet in the sheet: only what still works, and a bookmark only OPENS (condition b)', () => {
  const pins = [
    { kind: 'own', actId: 'household.note' },
    { kind: 'bookmark', circleId: 'c1', appOrigin: 'pinboard', opId: 'postRequest' },
    { kind: 'bookmark', circleId: 'left', appOrigin: 'pinboard', opId: 'postRequest' },
    { kind: 'bookmark', circleId: 'c2', appOrigin: 'tasks', opId: 'addTask' },
  ];
  const circles = [{ id: 'c1', name: 'Straat' }, { id: 'c2', name: 'Werk' }];
  const availability = { c1: { of: () => ({ state: 'enabled' }) }, c2: { of: () => ({ state: 'hidden' }) } };
  it('a bookmark to a circle the person LEFT, or whose op is hidden there, is not painted', () => {
    const shown = paintablePins(pins, { circles, availabilityOf: (id) => availability[id] ?? null, ownActIds: ['household.note'] });
    expect(shown.map((p) => p.circleId ?? p.actId)).toEqual(['household.note', 'c1']);
    expect(shown[1]).toMatchObject({ name: 'Straat' });
  });
  it('a bookmark opens its circle with the op\'s form — it carries no args, nothing to invoke', () => {
    expect(openPin(pins[1], { circles })).toEqual({ kind: 'open-circle', circleId: 'c1', appOrigin: 'pinboard', opId: 'postRequest' });
  });
  it('a tap from a stale paint (the circle was left since) opens nothing and says so', () => {
    expect(openPin(pins[2], { circles })).toEqual({ error: 'circle.vandaag.pin_gone' });
  });
});
