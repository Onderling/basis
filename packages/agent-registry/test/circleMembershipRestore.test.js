// Identity portability — the per-circle RESTORE-data vocabulary (circleMembership.js). The registry
// must carry per-circle { handle, address, proof, relays, key:{ref,posture} } records so a NEW DEVICE
// re-derives circle state after a phrase restore (NOTE-identity-profiles-and-portability.md "What the
// registry must gain"). These are the PURE vocabulary tests (guards + own/inherit graph + export/import
// round-trip). The end-to-end acceptance — a restored account OPENS a pre-wipe message on a p2 circle —
// exercises pod-client seal/open, so it lives in apps/basis (which depends on both packages), beside the
// other recovery stories: apps/basis/test/circleMembershipRestore.test.js.
import { describe, it, expect } from 'vitest';
import { Bootstrap } from '@onderling/core';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry } from '../src/AgentRegistry.js';
import {
  exportProfileRegistry, importProfileRegistry, restoreProfilesInto,
  createProfile, profilePubKey,
  setCircleMembership, circleMembershipOf, circleKeyRefOf, circleMembershipsFromProperties,
  isKeyRef, isCircleMembershipRecord, normaliseCircleMembership,
} from '../index.js';

const LIGHT = { m: 8, t: 1, p: 1 };   // fast argon2 for tests (prod cost is much higher)
const mkReg = () => createAgentRegistry({
  pseudoPod: createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd' }),
  deviceId: 'd',
});

describe('the circle-membership record vocabulary', () => {
  it('validates a key ref: a <scheme>:<id> pointer, never inline secret bytes', () => {
    expect(isKeyRef({ ref: 'dec:groupkey-123', posture: 'p2' })).toBe(true);
    expect(isKeyRef({ ref: 'dec:groupkey-123' })).toBe(true);              // posture optional
    expect(isKeyRef({ ref: 'no-scheme' })).toBe(false);                    // must be "<scheme>:<id>"
    expect(isKeyRef({ ref: 'dec:x', posture: 'p9' })).toBe(false);         // unknown posture
    expect(isKeyRef({ key: 'AAAA==' })).toBe(false);                       // no ref
    expect(isKeyRef('dec:x')).toBe(false);
  });

  it('validates a record: handle + address required, the rest optional facets', () => {
    expect(isCircleMembershipRecord({ handle: 'anne', address: 'nkn:abc' })).toBe(true);
    expect(isCircleMembershipRecord({ handle: 'anne', address: 'nkn:abc', relays: ['wss://r'], key: { ref: 'dec:k' } })).toBe(true);
    expect(isCircleMembershipRecord({ handle: 'anne' })).toBe(false);      // no address
    expect(isCircleMembershipRecord({ address: 'nkn:abc' })).toBe(false);  // no handle
    expect(isCircleMembershipRecord({ handle: 'a', address: 'b', relays: [1] })).toBe(false);
    expect(isCircleMembershipRecord({ handle: 'a', address: 'b', key: { ref: 'bad' } })).toBe(false);
  });

  it('normalise keeps exactly the known facets and freezes', () => {
    const rec = normaliseCircleMembership({ handle: 'a', address: 'b', proof: 'p', relays: ['r'], key: { ref: 'dec:k', posture: 'p2' }, junk: 1 });
    expect(rec).toEqual({ handle: 'a', address: 'b', proof: 'p', relays: ['r'], key: { ref: 'dec:k', posture: 'p2' } });
    expect(Object.isFrozen(rec)).toBe(true);
    expect(normaliseCircleMembership({ handle: 'a' })).toBeNull();
  });

  it('setCircleMembership upserts one circle without dropping the others', () => {
    let props = {};
    props = setCircleMembership(props, 'oosterpoort', { handle: 'anne', address: 'nkn:a1' });
    props = setCircleMembership(props, 'werkgroep',   { handle: 'a.dev', address: 'nkn:a2' });
    const map = circleMembershipsFromProperties(() => ({ properties: props }), 'me');
    expect(Object.keys(map).sort()).toEqual(['oosterpoort', 'werkgroep']);
    expect(map.oosterpoort.handle).toBe('anne');
    // re-upsert one — the other survives
    props = setCircleMembership(props, 'oosterpoort', { handle: 'anne', address: 'nkn:a1-new' });
    expect(circleMembershipsFromProperties(() => ({ properties: props }), 'me').werkgroep.address).toBe('nkn:a2');
  });

  it('a persona inherits its memberships from the default profile unless it declares its own', () => {
    let dflt = {};
    dflt = setCircleMembership(dflt, 'oosterpoort', { handle: 'anne', address: 'nkn:a1' });
    const profiles = { default: { properties: dflt }, work: { properties: {} } };
    const getProfile = (id) => profiles[id];
    const map = circleMembershipsFromProperties(getProfile, 'work', { defaultProfileId: 'default' });
    expect(map.oosterpoort.handle).toBe('anne');
  });

  it('the records round-trip through the export/restore artifact (the pod-less recovery path)', async () => {
    const root = Bootstrap.create().bootstrap;
    const reg = mkReg();
    let props = {};
    props = setCircleMembership(props, 'oosterpoort', {
      handle: 'anne', address: 'nkn:a1', proof: 'proof-blob',
      relays: ['wss://relay.oosterpoort'], key: { ref: 'dec:groupkey-oosterpoort-v1', posture: 'p2' },
    });
    await createProfile({ registry: reg, ownerRoot: root, profileId: 'default', properties: props });

    const sealed = await exportProfileRegistry({ ownerRoot: root, registry: reg, passphrase: 'pw', argonOpts: LIGHT });
    const { registry: snapshot } = await importProfileRegistry({ sealed, passphrase: 'pw', argonOpts: LIGHT });
    const fresh = mkReg();
    await restoreProfilesInto(fresh, snapshot);

    const entry = await fresh.lookup('default');
    expect(profilePubKey(root, 'default')).toBe(entry.pubKey);
    const rec = circleMembershipOf(entry, 'oosterpoort');
    expect(rec.handle).toBe('anne');
    expect(rec.relays).toEqual(['wss://relay.oosterpoort']);
    expect(circleKeyRefOf(entry, 'oosterpoort')).toEqual({ ref: 'dec:groupkey-oosterpoort-v1', posture: 'p2' });
  });
});
