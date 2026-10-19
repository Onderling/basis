/**
 * A PROFILE'S FACTS — what a person curates on a profile (its properties, the inheritance markers, its disclosure) —
 * as one unit that a person's devices keep the same, newest-wins by `factsAt`. The registry's machine keys (device
 * records, circle memberships, owned nodes) are NOT facts: each rides its own lane, and a landing never touches them.
 */
import { describe, it, expect } from 'vitest';
import { profileFactsOf, withProfileFacts, FACTS_AT_KEY, isReservedPropertyKey, nextFactsAt } from '../index.js';
import { DEVICE_DELEGATIONS_KEY } from '../src/deviceDelegations.js';
import { CIRCLE_MEMBERSHIPS_KEY } from '../src/circleMembership.js';

const entry = {
  agentId: 'p-1', pubKey: 'k', agentUri: 'u',
  properties: { name: 'Werk', place: 'Utrecht', '_inherit.offering': 'default', [DEVICE_DELEGATIONS_KEY]: { d1: {} }, [CIRCLE_MEMBERSHIPS_KEY]: { c1: {} }, [FACTS_AT_KEY]: { mode: 'own', value: 100 } },
  disclosure: { perContext: { c1: { place: { enabled: true } } } },
};

describe('profile facts', () => {
  it('the facts are the person-curated properties + markers + disclosure, and when — never a machine key', () => {
    const f = profileFactsOf(entry);
    expect(f.properties).toEqual({ name: 'Werk', place: 'Utrecht', '_inherit.offering': 'default' });
    expect(f.disclosure).toEqual(entry.disclosure);
    expect(f.factsAt).toBe(100);
  });
  it('landing facts replaces the curated part and keeps every machine key of this device', () => {
    const next = withProfileFacts(entry, { properties: { name: 'Werk', place: 'Amersfoort' }, disclosure: { perContext: {} }, factsAt: 200 });
    expect(next.properties.place).toBe('Amersfoort');
    expect(next.properties['_inherit.offering']).toBeUndefined();
    expect(next.properties[DEVICE_DELEGATIONS_KEY]).toEqual({ d1: {} });
    expect(next.properties[CIRCLE_MEMBERSHIPS_KEY]).toEqual({ c1: {} });
    expect(next.properties[FACTS_AT_KEY]).toEqual({ mode: 'own', value: 200 });
    expect(next.disclosure).toEqual({ perContext: {} });
  });
  it('a machine key in landed facts is ignored; the stamp is the registry\'s own key', () => {
    const next = withProfileFacts(entry, { properties: { [DEVICE_DELEGATIONS_KEY]: { evil: {} }, place: 'X' }, disclosure: {}, factsAt: 300 });
    expect(next.properties[DEVICE_DELEGATIONS_KEY]).toEqual({ d1: {} });
    expect(isReservedPropertyKey(FACTS_AT_KEY)).toBe(true);
  });
});

describe('the stamp is monotonic', () => {
  it('a device whose clock lags its sibling\'s still gets an edit through: the next stamp passes the previous one', () => {
    expect(nextFactsAt(5000, 1000), 'clock behind the landed stamp').toBe(5001);
    expect(nextFactsAt(1000, 5000), 'clock ahead: now').toBe(5000);
    expect(nextFactsAt(null, 42), 'never stamped: now').toBe(42);
  });
});

