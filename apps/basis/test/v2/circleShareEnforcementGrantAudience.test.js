/**
 * buildCircleShareEnforcement — the canonical GRANT audience, end to end (grants-over-Peer step 2).
 *
 * Runs the REAL stack: the real `buildCircleShareEnforcement` binder, the real `createCanonicalShare`
 * controller, the real group-key resource primitives and real X25519 keypairs — no crypto doubles. It pins
 * the bug the widened grant-side audience fixes: `grantMember` REPLACES the recipient set, so with a
 * roster-only base, granting a SECOND out-of-circle recipient silently revoked the FIRST (the earlier
 * grantee could no longer unwrap the key). And it pins that REVOKE still revokes.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildCircleShareEnforcement } from '../../src/v2/circleShareEnforcement.js';
import { generateKeypair, unwrapGroupKey } from '@onderling/pod-client';

const POD = 'https://pod.example/me/';
const ref = { type: 'shared-ref', sourceCircle: 'circle-1', sourceId: 'item-1' };

function harness() {
  const idKey  = generateKeypair();            // this device's per-circle sealing identity (the controller)
  const member = generateKeypair();            // an origin-circle member
  let resource = null;                         // the item's group-key resource (what the pod would hold)

  const keyStore = {
    read:  async () => resource,
    write: async (r) => { resource = r; },
  };
  const grants = [];
  const sharing = {
    grant:  vi.fn(async (p) => { grants.push(p); }),
    list:   vi.fn(async () => grants),
    revoke: vi.fn(async () => {}),
  };
  const enforcement = buildCircleShareEnforcement({
    sharing,
    strategy: { open: (t) => t },
    podRoot: POD,
    controlAgent: { keyStore, members: () => [{ publicKey: idKey.publicKey }, { publicKey: member.publicKey }] },
    idKey,
  });
  return { enforcement, idKey, member, keyStore, sharing, current: () => resource };
}

/** Can this private key unwrap the resource's current group key? */
const canOpen = (resource, privateKey) => {
  try { return !!unwrapGroupKey(resource, privateKey); } catch { return false; }
};

describe('canonical share — an earlier out-of-circle grantee survives a later grant', () => {
  it('grants A then B; BOTH can still unwrap, and the origin members keep access', async () => {
    const h = harness();
    expect(h.enforcement).toBeTruthy();
    const outA = generateKeypair();
    const outB = generateKeypair();

    await h.enforcement.onShareCanonical({ ref, recipients: ['out-a'], recipientKeys: [outA.publicKey] });
    expect(canOpen(h.current(), outA.privateKey)).toBe(true);

    await h.enforcement.onShareCanonical({ ref, recipients: ['out-b'], recipientKeys: [outB.publicKey] });

    // THE FIX: before the widened grant-side audience, A was silently dropped here.
    expect(canOpen(h.current(), outA.privateKey)).toBe(true);
    expect(canOpen(h.current(), outB.privateKey)).toBe(true);
    expect(canOpen(h.current(), h.member.privateKey)).toBe(true);   // origin member never loses access
    expect(canOpen(h.current(), h.idKey.privateKey)).toBe(true);    // the controller stays a recipient
  });

  it('a stranger who was never granted cannot unwrap (the grant is not a blanket widening)', async () => {
    const h = harness();
    const outA = generateKeypair();
    const stranger = generateKeypair();
    await h.enforcement.onShareCanonical({ ref, recipients: ['out-a'], recipientKeys: [outA.publicKey] });
    expect(canOpen(h.current(), stranger.privateKey)).toBe(false);
  });
});

describe('canonical revoke — still revokes (the widened base must not leak into revoke)', () => {
  it('rotating to the remaining recipients locks the revoked grantee out of the new key', async () => {
    const h = harness();
    const outA = generateKeypair();
    await h.enforcement.onShareCanonical({ ref, recipients: ['out-a'], recipientKeys: [outA.publicKey] });
    expect(canOpen(h.current(), outA.privateKey)).toBe(true);

    // The app passes the remaining sealing keys explicitly (the live circleApp flow).
    await h.enforcement.revokeCanonical({
      ref, recipients: ['out-a'], remainingRecipients: [h.idKey.publicKey, h.member.publicKey],
    });

    expect(canOpen(h.current(), outA.privateKey)).toBe(false);      // rotated out — no access to the NEW key
    expect(canOpen(h.current(), h.member.privateKey)).toBe(true);   // the roster keeps access
  });

  it('the revoke DEFAULT (no remainingRecipients) rotates to the roster only — never back to the revokee', async () => {
    const h = harness();
    const outA = generateKeypair();
    await h.enforcement.onShareCanonical({ ref, recipients: ['out-a'], recipientKeys: [outA.publicKey] });

    await h.enforcement.revokeCanonical({ ref, recipients: ['out-a'] });

    // If the widened grant-side base had leaked into revoke, outA would still hold the rotated key.
    expect(canOpen(h.current(), outA.privateKey)).toBe(false);
    expect(canOpen(h.current(), h.member.privateKey)).toBe(true);
  });
});
