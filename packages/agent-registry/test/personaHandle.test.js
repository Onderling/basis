/**
 * A persona's handle is an ATTRIBUTE its own statements present, never part of a release: even a disclosure entry that
 * enables it releases nothing, so no policy, Mij toggle or crafted request can put it on a circle another way.
 */
import { describe, it, expect } from 'vitest';
import { own } from '../src/profileProperties.js';
import { createDisclosurePolicy, setDisclosure, releasedValues } from '../src/disclosure.js';
import { HANDLE_KEY, isPresentedAttributeKey } from '../src/personaHandle.js';
import { PERSON_SETTABLE_KEYS } from '../src/reservedProperties.js';

describe('the persona handle', () => {
  const profile = { agentId: 'default', properties: { [HANDLE_KEY]: own('bea'), place: own('Groningen') } };
  const getProfile = (id) => (id === 'default' ? profile : null);

  it('is never released, whatever the disclosure says', () => {
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'c', HANDLE_KEY, { enabled: true });
    policy = setDisclosure(policy, 'c', 'place', { enabled: true });
    const out = releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' },
      { items: [{ key: HANDLE_KEY }, { key: 'place' }] }, policy, 'c');
    expect(out).toEqual({ place: 'Groningen' });
  });

  it('is a presented attribute the person may set', () => {
    expect(isPresentedAttributeKey(HANDLE_KEY)).toBe(true);
    expect(isPresentedAttributeKey('place')).toBe(false);
    expect(PERSON_SETTABLE_KEYS).toContain(HANDLE_KEY);
  });
});
