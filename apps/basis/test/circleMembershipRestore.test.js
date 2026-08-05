// Identity portability — a restored account OPENS a pre-wipe message. The story beside 11.1/11.4
// (recoveryRestoreThreeDevice.test.js): 11.1 proved the phrase re-derives the SAME identity; 11.4 proved
// recovery restores identity but NOT entitlement rotated away. This proves the missing half that a real
// wipe-and-restore on hardware exposed — "the phrase came back, nothing else did": the registry must
// carry the per-circle WRAPPED-KEY-RESOURCE REF so the re-derived key has something to unwrap.
//
// The acceptance criterion (NOTE-identity-profiles-and-portability.md "What the registry must gain"):
// assert on OPENING a message (the failure looks like success, so never assert on membership), on a p2
// (client-side E2E, the household default) circle — p0/p1 open trivially and would prove nothing.
//
// Real primitives throughout: the group-key resource + grant + unwrap are the same pod-client crypto the
// runtime seals circle content with; the registry export/import is the real pod-less recovery path.
import { describe, it, expect } from 'vitest';
import { Bootstrap } from '@onderling/core';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import {
  createAgentRegistry, createProfile, profilePubKey,
  exportProfileRegistry, importProfileRegistry, restoreProfilesInto,
  setCircleMembership, circleMembershipOf, circleKeyRefOf,
} from '@onderling/agent-registry';
import {
  generateKeypair, generateGroupKey, buildGroupKeyResource, grantMember, unwrapGroupKey,
  sealWithGroupKey, openWithGroupKey,
} from '@onderling/pod-client';

const LIGHT = { m: 8, t: 1, p: 1 };   // fast argon2 for tests (prod cost is much higher)
const mkReg = () => createAgentRegistry({
  pseudoPod: createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd' }),
  deviceId: 'd',
});
const CIRCLE = 'oosterpoort';

// A p2 circle: content is sealed with a group key; that group key is wrapped to each member's sealing
// key inside a group-key RESOURCE. The member's sealing key stands for "the key the phrase re-derives"
// (its re-derivation is story 11.1's job) — this test proves the OTHER half: that the registry carries
// the RESOURCE REF through the restore, so the re-derived key has a resource to unwrap.
function seedCircle() {
  const controller = generateKeypair();
  const member     = generateKeypair();
  const groupKey   = generateGroupKey();
  let resource = buildGroupKeyResource({ version: 1, groupKey, recipients: [controller.publicKey] });
  resource = grantMember(resource, { newRecipient: member.publicKey, granterPrivateKey: controller.privateKey });
  const sealedMessage = sealWithGroupKey('the pre-wipe note', groupKey);   // received BEFORE the wipe
  return { member, resource, sealedMessage };
}

describe('a restored account OPENS a pre-wipe message (p2 circle)', () => {
  it('restore carries the wrapped-key ref → the re-derived key opens the message', async () => {
    const { member, resource, sealedMessage } = seedCircle();
    // The wrapped-key RESOURCE lives behind a ref (a resolver-swappable pointer). Model that resolver
    // as a store keyed by the ref — the registry carries only the pointer, never the secret bytes.
    const keyRef = 'dec:groupkey-oosterpoort-v1';
    const resourceStore = new Map([[keyRef, resource]]);

    // Pre-wipe: the account's registry records the per-circle membership INCLUDING the key ref.
    const root = Bootstrap.create().bootstrap;
    const reg = mkReg();
    let props = {};
    props = setCircleMembership(props, CIRCLE, {
      handle:  'anne',
      address: 'nkn:anne-oosterpoort',
      proof:   'membership-proof-blob',
      relays:  ['wss://relay.oosterpoort'],
      key:     { ref: keyRef, posture: 'p2' },
    });
    await createProfile({ registry: reg, ownerRoot: root, profileId: 'default', properties: props });

    // ── WIPE ── the device is gone; recover from JUST the sealed export + the phrase.
    const sealed = await exportProfileRegistry({ ownerRoot: root, registry: reg, passphrase: 'pw', argonOpts: LIGHT });
    const { ownerRoot: restoredRoot, registry: snapshot } = await importProfileRegistry({ sealed, passphrase: 'pw', argonOpts: LIGHT });
    const fresh = mkReg();
    await restoreProfilesInto(fresh, snapshot);

    // The phrase re-derived the SAME identity (story 11.1) …
    expect(profilePubKey(restoredRoot, 'default')).toBe(profilePubKey(root, 'default'));

    // … AND the registry carried the per-circle facts back, so the account can OPEN the old message.
    const entry = await fresh.lookup('default');
    expect(circleMembershipOf(entry, CIRCLE).relays, 'connection points survived').toEqual(['wss://relay.oosterpoort']);
    const ref = circleKeyRefOf(entry, CIRCLE);
    expect(ref, 'the wrapped-key ref survived the restore').toEqual({ ref: keyRef, posture: 'p2' });

    const recoveredResource = resourceStore.get(ref.ref);                     // resolve the ref
    const groupKey = unwrapGroupKey(recoveredResource, member.privateKey);    // re-derived key unwraps it
    expect(openWithGroupKey(sealedMessage, groupKey)).toBe('the pre-wipe note');   // ← the acceptance
  });

  it('CONTROL — without the extension the restored account cannot reach the key (the "nothing came back" gap)', async () => {
    const { member, resource, sealedMessage } = seedCircle();
    const keyRef = 'dec:groupkey-oosterpoort-v1';
    const resourceStore = new Map([[keyRef, resource]]);

    // A registry that was NEVER extended past identity — a plain profile, no circle memberships.
    const root = Bootstrap.create().bootstrap;
    const reg = mkReg();
    await createProfile({ registry: reg, ownerRoot: root, profileId: 'default' });

    const sealed = await exportProfileRegistry({ ownerRoot: root, registry: reg, passphrase: 'pw', argonOpts: LIGHT });
    const { registry: snapshot } = await importProfileRegistry({ sealed, passphrase: 'pw', argonOpts: LIGHT });
    const fresh = mkReg();
    await restoreProfilesInto(fresh, snapshot);

    // Identity restored, but there is no key ref to resolve — exactly the documented failure.
    const entry = await fresh.lookup('default');
    expect(circleMembershipOf(entry, CIRCLE)).toBeNull();
    expect(circleKeyRefOf(entry, CIRCLE)).toBeNull();

    // Proof the CONTROL fails on the missing REF and not on a broken fixture: the resource itself is
    // genuinely openable by the member key — the account simply can't reach it without the carried ref.
    expect(openWithGroupKey(sealedMessage, unwrapGroupKey(resourceStore.get(keyRef), member.privateKey)))
      .toBe('the pre-wipe note');
  });
});
