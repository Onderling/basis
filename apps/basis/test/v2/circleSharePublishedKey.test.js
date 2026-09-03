/**
 * circleSharePublishedKey (objective L · Phase 2) — grant an OUT-OF-CIRCLE recipient (NOT in the origin
 * roster, known ONLY by their PUBLISHED Ed25519 network key) revocable IN-PLACE access to a canonical item,
 * wired end-to-end at the app seam (no DOM, no live pod). Proves the vertical slice the app wiring adds on top
 * of the shipped substrate (`createCanonicalShare.shareToPublishedKey` + the shared assembly's new hook):
 *
 *   • SHARE (grant, NOT copy): `shareItemToPublishedKey` rides `enforcement.onShareToPublishedKey`, which
 *     derives the recipient's sealing key from their published network key, re-wraps the item's group key to
 *     it + lands the ACP read grant. Exactly ONE `shared-ref` pointer is written into the target; NO copy.
 *   • OPEN in place: the out-of-circle recipient — deriving their sealing PRIVATE key from the same network
 *     identity — unwraps the group key and resolves the CANONICAL item through the deny-by-default read gate;
 *     a stranger (their own network identity, never granted) resolves to null and is dropped.
 *   • REVOKE (forward secrecy) reuses `revokeItemShare` unchanged: rotate the group key away from the
 *     out-of-circle recipient + ACP-revoke ⇒ they can't open the new key and their read resolves to null.
 *   • No-op guard: with no canonical controller (no control agent / sealing identity) the shared builder omits
 *     the hook and the app op degrades to a plain `shared-ref` write (no grant), byte-for-byte the pre-L path.
 *
 * The op + hook live ONCE in shared src (`circleShare.js` / `circleShareEnforcement.js`), so BOTH shells (web
 * `circleApp.js`, mobile `circlePods.js`) that import them + call `buildCircleShareEnforcement` get it by
 * construction (invariant #2, web≡mobile) — asserted below via the ONE shared builder, no shell fork.
 *
 * Uses the REAL sealing primitives + REAL createCanonicalShare (like circleShareCanonical.test.js and
 * packages/pod-client/test/canonicalShare.test.js) with an injected FAKE ACP `sharing` surface.
 */
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import { generateKeypair, unwrapGroupKey } from '@onderling/pod-client';
import { sealingPublicKeyFromNetworkKey, sealingKeyPairFromNetworkKey } from '@onderling/pod-client/sealing';
import { makeResourceUriResolver, sharedRefResourceUri } from '@onderling/pod-onboarding/resourceUri';
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import { buildCircleShareEnforcement } from '../../src/v2/circleShareEnforcement.js';
import {
  shareItemToPublishedKey, listSharedResolved, revokeItemShare,
} from '../../src/v2/circleShare.js';

// b64url (no padding) — matches core's AgentIdentity encoding + the sealing envelope.
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// An OUT-OF-CIRCLE party known ONLY by their PUBLISHED network key (core `AgentIdentity`): an Ed25519 keypair.
// `publicKey` is what a granter reads; `secretKey` is what the recipient holds to derive their sealing key. No
// sealing key is ever shared out-of-band.
function fakeNetworkIdentity() {
  const kp = nacl.sign.keyPair();
  return { publicKey: b64u(kp.publicKey), secretKey: b64u(kp.secretKey) };
}

// A fake ACP `sharing` surface — grant/revoke mutate an in-memory table; list answers deny-by-default from it.
function fakeSharing() {
  const table = new Map();   // resourceUri → Set(agent)
  const key = (uri) => { if (!table.has(uri)) table.set(uri, new Set()); return table.get(uri); };
  return {
    table,
    has: (uri, agent) => key(uri).has(agent),
    async grant({ resourceUri, agent }) { key(resourceUri).add(agent); return { resourceUri, agent }; },
    async revoke({ resourceUri, agent }) { key(resourceUri).delete(agent); return { resourceUri, agent }; },
    async list({ resourceUri, agentsToQuery = [] }) {
      const set = key(resourceUri);
      return agentsToQuery.filter((a) => set.has(a)).map((agent) => ({ subject: 'agent', agent, modes: ['read'] }));
    },
  };
}

// A one-resource in-memory keyStore for the item's group key (mirrors the canonicalShare/controlAgent tests).
function memKeyStore(initial = null) {
  let stored = initial;
  return { read: async () => stored, write: async (r) => { stored = r; }, current: () => stored };
}

const POD = 'https://pod.example/';
const uriFor = sharedRefResourceUri(makeResourceUriResolver({ podUri: POD }));
const canonicalPolicyOf = () => ({ sharePosture: 'canonical', shareOutOfCircle: 'notify' /* these tests exercise a PERMITTED share; the default is now prohibit */});

// Build the enforcement through the ONE SHARED builder both shells call — real createCanonicalShare over a
// fake ACP surface + memKeyStore, the origin roster's sealing keys resolved from the control agent's members.
function buildEnforcement({ sharing, keyStore, controllerKey, roster, scheme = 'pairwise' }) {
  return buildCircleShareEnforcement({
    sharing,
    // Content is plaintext in this memory seam test; the SCHEME tag is what the D2 gate (batch 4) reads
    // on the out-of-circle path — a scoped scheme passes, group-key/absent throws (tested below).
    strategy: { scheme, open: (text) => text },
    podRoot: POD,
    controlAgent: { keyStore, members: () => roster.map((publicKey) => ({ publicKey })) },
    idKey: { publicKey: controllerKey.publicKey, privateKey: controllerKey.privateKey },
  });
}

describe('circleShare — shareItemToPublishedKey (grant an OUT-OF-CIRCLE recipient by published network key)', () => {
  it('SHARE grants IN PLACE (no copy): one shared-ref, ACP + key grant, the out-of-circle recipient OPENS it', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const controllerKey = generateKeypair();       // this device (always a group-key recipient)
    const alice = generateKeypair();               // an origin member who must KEEP access
    const dave = fakeNetworkIdentity();            // OUTSIDE the circle — only his PUBLISHED key is known
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    const enforcement = buildEnforcement({ sharing, keyStore, controllerKey, roster: [alice.publicKey] });
    const enforcementFor = async () => enforcement;

    const src = await svc.createList('A', 'canonical plan body', 'alice');

    const r = await shareItemToPublishedKey({
      resolveService, enforcementFor, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey,
    });
    expect(r.ok).toBe(true);

    // NO copy: source circle A still has exactly its ONE original item; nothing has `sharedCopyOf`.
    const aItems = await svc.stores.getStore('A').list();
    expect(aItems).toHaveLength(1);
    expect(aItems.some((it) => it.sharedCopyOf)).toBe(false);

    // Target circle B holds exactly ONE `shared-ref` pointer (not a duplicated item).
    const bRefs = await svc.stores.getStore('B').listByType('shared-ref');
    expect(bRefs).toHaveLength(1);
    expect(bRefs[0]).toMatchObject({ type: 'shared-ref', sourceCircle: 'A', sourceId: src.id });

    // KEY grant sourced from the PUBLISHED network key: Dave derives his sealing PRIVATE key from the SAME
    // network identity and unwraps the item's group key; the origin member alice + controller keep it too.
    const daveSealing = sealingKeyPairFromNetworkKey(dave.secretKey);
    expect(daveSealing.publicKey).toBe(sealingPublicKeyFromNetworkKey(dave.publicKey));   // granter used only his published key
    const kr = keyStore.current();
    expect(unwrapGroupKey(kr, daveSealing.privateKey)).toBeTruthy();
    expect(unwrapGroupKey(kr, alice.privateKey)).toBeTruthy();                            // origin member NOT dropped
    expect(unwrapGroupKey(kr, controllerKey.privateKey)).toBeTruthy();

    // ACP grant landed on the canonical source resource for did:dave (not a copy resource).
    expect(sharing.has(uriFor(bRefs[0]), 'did:dave')).toBe(true);

    // READ in place: Dave resolves the CANONICAL item; a stranger (never granted) is denied (deny-by-default).
    const forDave = await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'did:dave' });
    expect(forDave).toHaveLength(1);
    expect(forDave[0].item.text).toBe('canonical plan body');
    expect(forDave[0].item.sharedCopyOf).toBeUndefined();

    const forStranger = await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'did:eve' });
    expect(forStranger).toHaveLength(0);
  });

  it('G-P1 (Q2) — a GROUP-KEY out-of-circle person share FALLS BACK to a COPY, never an in-place group-key grant (D2, Frits 2026-08-06)', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const controllerKey = generateKeypair();
    const dave = fakeNetworkIdentity();
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    // The circle's content is sealed under the GROUP key — an in-place grant would hand Dave every piece of it,
    // so the share re-seals a COPY to Dave instead (the SAME procedure as a circle→circle share). The copy
    // machinery is host-blind (needs only the recipient's derived key), so it's stubbed here — the real crypto
    // re-seal is proven in circleShareReseal.test.js; this asserts the ROUTING (copy, not group-key grant).
    const enforcement = buildEnforcement({ sharing, keyStore, controllerKey, roster: [], scheme: 'group-key' });
    const enforcementFor = async () => enforcement;
    const sealCopy = (item, keys) => ({ ...item, _sealedTo: keys });
    const sealingKeyFromNetworkKey = (nk) => `sealkey:${nk}`;

    const src = await svc.createList('A', 'the whole circle history', 'alice');
    const r = await shareItemToPublishedKey({
      resolveService, enforcementFor, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey,
      sealCopy, sealingKeyFromNetworkKey,
    });
    // NOT refused, NOT an in-place grant — a re-sealed COPY, tagged so the UI can show outside-sharing differs.
    expect(r.ok).toBe(true);
    expect(r.via).toBe('copy');
    expect(r.revocable).toBe(false);
    // A SEPARATE object (sharedCopyOf) was minted; the source item is untouched.
    const aItems = await svc.stores.getStore('A').list();
    expect(aItems.some((it) => it.sharedCopyOf === src.id)).toBe(true);
    // The outsider never received the SOURCE group key (the leak the router closes): no group-key grant Dave
    // can unwrap ever landed.
    const daveSealing = sealingKeyPairFromNetworkKey(dave.secretKey);
    const kr = keyStore.current();
    expect(kr == null || unwrapGroupKey(kr, daveSealing.privateKey) == null).toBe(true);
  });

  it('G-P1 — deny-by-default: a strategy that does not NAME its scheme is refused too', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const controllerKey = generateKeypair();
    const dave = fakeNetworkIdentity();
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    const enforcement = buildEnforcement({
      sharing, keyStore, controllerKey, roster: [], scheme: undefined,
    });
    // buildEnforcement defaults scheme to 'pairwise' — pass an explicit schemeless strategy instead.
    const bare = buildCircleShareEnforcement({
      sharing, strategy: { open: (t) => t }, podRoot: POD,
      controlAgent: { keyStore, members: () => [] },
      idKey: { publicKey: controllerKey.publicKey, privateKey: controllerKey.privateKey },
    });
    const src = await svc.createList('A', 'body', 'alice');
    const r = await shareItemToPublishedKey({
      resolveService, enforcementFor: async () => bare, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey,
    });
    expect(r.ok).toBe(false);
    expect(String(r.cause?.message)).toMatch(/no seal scheme resolved/);
    void enforcement;
  });

  it('REVOKE (forward secrecy) reuses revokeItemShare: key rotated away + ACP revoked → read resolves to null', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const controllerKey = generateKeypair();
    const alice = generateKeypair();               // stays granted
    const dave = fakeNetworkIdentity();            // out-of-circle — granted then revoked
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    const enforcement = buildEnforcement({ sharing, keyStore, controllerKey, roster: [alice.publicKey] });
    const enforcementFor = async () => enforcement;

    const src = await svc.createList('A', 'secret', 'alice');
    await shareItemToPublishedKey({
      resolveService, enforcementFor, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey,
    });
    const daveSealing = sealingKeyPairFromNetworkKey(dave.secretKey);
    // Sanity: Dave resolves before revoke.
    expect(await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'did:dave' })).toHaveLength(1);
    expect(unwrapGroupKey(keyStore.current(), daveSealing.privateKey)).toBeTruthy();

    // The Phase-2 revoke IS the existing rotate — same op, revoking by WebID + rotating to the remaining roster.
    const rev = await revokeItemShare({
      resolveService, enforcementFor, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', recipient: 'did:dave',
      remainingRecipients: [alice.publicKey],
    });
    expect(rev.ok).toBe(true);

    // Group key rotated: Dave can no longer unwrap it; alice (remaining) still can.
    const rotated = keyStore.current();
    expect(rotated.version).toBe(2);
    expect(() => unwrapGroupKey(rotated, daveSealing.privateKey)).toThrow();
    expect(unwrapGroupKey(rotated, alice.privateKey)).toBeTruthy();

    // ACP revoked + pointer cleaned up ⇒ Dave's read resolves to nothing (deny-by-default, forward-secret).
    expect(sharing.has(uriFor({ sourceCircle: 'A', sourceId: src.id }), 'did:dave')).toBe(false);
    expect(await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'did:dave' })).toHaveLength(0);
  });

  it('optional handshake: `verify` returning false ABORTS the grant — nothing written, nothing ACP-granted', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const controllerKey = generateKeypair();
    const dave = fakeNetworkIdentity();
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    const enforcement = buildEnforcement({ sharing, keyStore, controllerKey, roster: [] });
    const src = await svc.createList('A', 'body', 'alice');

    const r = await shareItemToPublishedKey({
      resolveService, enforcementFor: async () => enforcement, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey, verify: () => false,
    });
    // The hook throws ⇒ shareIntoAudience surfaces it as a failed share (never silently landed without a grant).
    expect(r.ok).toBe(false);
    expect(r.error).toBe('share-grant-failed');
    expect(keyStore.current()).toBe(null);                                            // no key resource written
    expect(sharing.has(uriFor({ sourceCircle: 'A', sourceId: src.id }), 'did:dave')).toBe(false);  // no ACP grant
  });

  it('governed by shareOutOfCircle: prohibit REFUSES; a missing recipient is refused before any store touch', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const src = await svc.createList('A', 'body', 'alice');
    const base = { resolveService, itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice' };

    // prohibit ⇒ the admin blocked out-of-circle sharing — refused outright.
    expect(await shareItemToPublishedKey({ ...base, recipient: 'did:dave', recipientNetworkKey: 'k', policyOf: () => ({ shareOutOfCircle: 'prohibit' }) }))
      .toEqual({ ok: false, error: 'share-prohibited' });
    // A permitted policy but no recipient / no published key ⇒ refused before touching any store.
    expect(await shareItemToPublishedKey({ ...base, recipientNetworkKey: 'k', policyOf: canonicalPolicyOf }))
      .toEqual({ ok: false, error: 'missing-recipient' });
    expect(await shareItemToPublishedKey({ ...base, recipient: 'did:dave', policyOf: canonicalPolicyOf }))
      .toEqual({ ok: false, error: 'missing-recipient' });
  });
});

describe('circleShare — the published-key hook lives in shared code (web≡mobile by construction) + no-op guard', () => {
  it('the ONE shared builder exposes onShareToPublishedKey when a canonical controller resolved', () => {
    const enforcement = buildEnforcement({
      sharing: fakeSharing(), keyStore: memKeyStore(), controllerKey: generateKeypair(), roster: [],
    });
    // Both shells call THIS builder + import shareItemToPublishedKey from the shared op module — so both get
    // the hook + op by construction (no shell fork).
    expect(typeof enforcement.onShareToPublishedKey).toBe('function');
    expect(typeof enforcement.onShareCanonical).toBe('function');
    expect(typeof enforcement.revokeCanonical).toBe('function');
    expect(typeof shareItemToPublishedKey).toBe('function');
  });

  it('no-ops cleanly when canonicalShare is unavailable: hook omitted, op degrades to a plain shared-ref write', async () => {
    const sharing = fakeSharing();
    // No control agent / sealing identity ⇒ createCanonicalShare is skipped ⇒ no canonical hooks at all.
    const enforcement = buildCircleShareEnforcement({
      sharing, strategy: { open: (t) => t }, podRoot: POD,
    });
    expect(enforcement).toBeTruthy();                              // the copy/read enforcement still builds
    expect(enforcement.onShareToPublishedKey).toBeUndefined();
    expect(enforcement.onShareCanonical).toBeUndefined();

    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const src = await svc.createList('A', 'body', 'alice');
    const r = await shareItemToPublishedKey({
      resolveService, enforcementFor: async () => enforcement, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: 'ignored-no-hook',
    });
    expect(r.ok).toBe(true);                                       // ref still written
    const bRefs = await svc.stores.getStore('B').listByType('shared-ref');
    expect(bRefs).toHaveLength(1);
    expect(sharing.has(uriFor(bRefs[0]), 'did:dave')).toBe(false); // but NO grant landed (memory path)
  });
});
