// A media-typed attribute (the profile picture) is set through the same op as a coarse one — its value is the
// sealed media ref, an object. Declared as a plain string, the WAIST refused every picture (`param "value" must be
// a string — got object`) and the Mij editor swallowed the refusal: a person picked a picture and nothing was kept.
// The cores never saw it, so the core-level tests could not; this goes through the wired handler.
import { describe, it, expect } from 'vitest';
import { wireSkill } from '@onderling/sdk';
import { agentsManifest } from '../manifest.js';
import { setProfileProperty } from '../src/cores.js';

const op = agentsManifest.operations.find((o) => o.id === 'setProfileProperty');

function wired() {
  const properties = {};
  const store = { registry: { list: async () => [] }, profiles: { setProperty: async ({ key, value }) => { properties[key] = value; } } };
  const handler = wireSkill(setProfileProperty, op, { storeFor: () => store });
  return { handler, properties };
}
const call = (handler, args) => handler({ parts: [{ type: 'DataPart', data: args }] });

describe('setProfileProperty through the waist', () => {
  it('keeps a sealed picture ref (an object)', async () => {
    const { handler, properties } = wired();
    const ref = { kind: 'media', enc: { mime: 'image/png', thumb: 'c2VhbGVk' }, pointer: 'blob:x' };
    const r = await call(handler, { id: 'default', key: 'profilePicture', value: ref });
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    expect(properties.profilePicture).toEqual(ref);
  });

  it('still keeps a coarse string', async () => {
    const { handler, properties } = wired();
    await call(handler, { id: 'default', key: 'place', value: 'Groningen' });
    expect(properties.place).toBe('Groningen');
  });
});
