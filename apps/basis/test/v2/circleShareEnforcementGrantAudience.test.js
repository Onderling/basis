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

// ── Story 1.2 (the CONFIRMED bug, now fixed) ───────────────────────────────────────────────────────────
// Revoking ONE out-of-circle grantee must not evict the OTHERS. The revoke base is now "every current
// key-holder MINUS the named revokee", with the revokee's sealing key resolved from the roster (member) or
// re-derived from their contact's published network key (out-of-circle) — a pure map, no stored grant record.
describe('canonical revoke — evicts exactly the named party (story 1.2)', () => {
  /** Harness + a contact-backed resolver, mirroring how the shells wire `sealingKeyForRecipient`. */
  function harnessWithContacts(contactKeys) {
    const idKey = generateKeypair(); const member = generateKeypair();
    let resource = null;
    const sharing = { grant: vi.fn(async () => {}), list: vi.fn(async () => []), revoke: vi.fn(async () => {}) };
    const enforcement = buildCircleShareEnforcement({
      sharing, strategy: { open: (t) => t }, podRoot: POD,
      controlAgent: {
        keyStore: { read: async () => resource, write: async (r) => { resource = r; } },
        members: () => [
          { webId: 'urn:me', publicKey: idKey.publicKey },
          { webId: 'urn:member', publicKey: member.publicKey },
        ],
      },
      idKey,
      // The shells derive this from the Contacten roster; here the map IS the derivation's output.
      sealingKeyForRecipient: async (webid) => contactKeys[webid] ?? null,
    });
    return { enforcement, idKey, member, current: () => resource };
  }

  it('revoking Bram leaves Cato (and the members) still able to open', async () => {
    const bram = generateKeypair(); const cato = generateKeypair();
    const h = harnessWithContacts({ 'urn:bram': bram.publicKey, 'urn:cato': cato.publicKey });
    await h.enforcement.onShareCanonical({ ref, recipients: ['urn:bram'], recipientKeys: [bram.publicKey] });
    await h.enforcement.onShareCanonical({ ref, recipients: ['urn:cato'], recipientKeys: [cato.publicKey] });

    await h.enforcement.revokeCanonical({ ref, recipients: ['urn:bram'] });   // no explicit remainingRecipients

    expect(canOpen(h.current(), bram.privateKey)).toBe(false);   // the named party IS evicted
    expect(canOpen(h.current(), cato.privateKey)).toBe(true);    // ← the bug: Cato used to lose access too
    expect(canOpen(h.current(), h.member.privateKey)).toBe(true);
    expect(canOpen(h.current(), h.idKey.privateKey)).toBe(true);
  });

  it('revoking a MEMBER keeps the out-of-circle grantee (story 1.6 — roster resolves without any contact)', async () => {
    const cato = generateKeypair();
    const h = harnessWithContacts({ 'urn:cato': cato.publicKey });
    await h.enforcement.onShareCanonical({ ref, recipients: ['urn:cato'], recipientKeys: [cato.publicKey] });

    await h.enforcement.revokeCanonical({ ref, recipients: ['urn:member'] });  // a roster member

    expect(canOpen(h.current(), h.member.privateKey)).toBe(false);  // the removed member is out
    expect(canOpen(h.current(), cato.privateKey)).toBe(true);       // the unrelated grantee keeps access
  });

  it('FAILS SAFE when the revokee cannot be resolved: falls back to roster-only (evicts them, loses the rest)', async () => {
    const bram = generateKeypair(); const cato = generateKeypair();
    const h = harnessWithContacts({});                              // no contact for anyone
    await h.enforcement.onShareCanonical({ ref, recipients: ['urn:bram'], recipientKeys: [bram.publicKey] });
    await h.enforcement.onShareCanonical({ ref, recipients: ['urn:cato'], recipientKeys: [cato.publicKey] });

    await h.enforcement.revokeCanonical({ ref, recipients: ['urn:bram'] });

    // Unresolvable ⇒ conservative: the revokee is DEFINITELY out (safety), other grantees are collateral.
    expect(canOpen(h.current(), bram.privateKey)).toBe(false);
    expect(canOpen(h.current(), cato.privateKey)).toBe(false);
    expect(canOpen(h.current(), h.member.privateKey)).toBe(true);   // never locks the circle out of its own item
  });

  it('an explicit remainingRecipients still wins (the app may override the computed base)', async () => {
    const bram = generateKeypair(); const cato = generateKeypair();
    const h = harnessWithContacts({ 'urn:bram': bram.publicKey, 'urn:cato': cato.publicKey });
    await h.enforcement.onShareCanonical({ ref, recipients: ['urn:bram'], recipientKeys: [bram.publicKey] });
    await h.enforcement.onShareCanonical({ ref, recipients: ['urn:cato'], recipientKeys: [cato.publicKey] });

    await h.enforcement.revokeCanonical({ ref, recipients: ['urn:bram'], remainingRecipients: [h.idKey.publicKey] });
    expect(canOpen(h.current(), cato.privateKey)).toBe(false);      // caller asked for exactly one holder
    expect(canOpen(h.current(), h.idKey.privateKey)).toBe(true);
  });
});
