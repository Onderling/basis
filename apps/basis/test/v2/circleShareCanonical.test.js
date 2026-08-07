/**
 * circleShareCanonical (objective L) — the `canonical` sharePosture wired end-to-end at the substrate seam
 * (no DOM, no live pod). Proves the vertical slice the app wiring adds on top of the shipped substrate
 * (`createCanonicalShare` + item-store's `makeCircleShareEnforcement` canonical branch):
 *
 *   • SHARE (grant, NOT copy): a circle with sharePosture:'canonical' shares an item OUT → `shareItemAcrossCircles`
 *     routes through `enforcement.onShareCanonical` (isCanonicalPosture), which grants the recipient into the
 *     item's group-key resource (key re-wrap) + lands the ACP read grant. Exactly ONE `shared-ref` pointer is
 *     written into the target; NO copy is minted (no `sharedCopyOf`, the source circle keeps just its one item).
 *   • READ in place: the granted recipient resolves the CANONICAL source item through the deny-by-default gate;
 *     a non-recipient resolves to null and is dropped (no leak).
 *   • REVOKE (rotate + ACP revoke): `revokeItemShare` denies the recipient — the group key rotates away from
 *     them (they can't unwrap the new key) and the ACP grant is dropped, so their read now resolves to null.
 *   • The four shipped postures (closed/copy/trusted/registered) are UNCHANGED: closed refuses, and copy still
 *     mints a SEPARATE sealed object (sharedCopyOf) — canonical is the complement (no copy).
 *
 * Uses the REAL sealing primitives + REAL createCanonicalShare (like packages/pod-client/test/canonicalShare.test.js)
 * with an injected FAKE ACP `sharing` (grant/list/revoke over resourceUri) — the exact deny-by-default gate a
 * real pod enforces, without a pod.
 */
import { describe, it, expect } from 'vitest';
import { makeCircleShareEnforcement } from '@onderling/item-store';
import {
  createCanonicalShare, generateKeypair, unwrapGroupKey,
} from '@onderling/pod-client';
import { makeResourceUriResolver, sharedRefResourceUri } from '@onderling/pod-onboarding/resourceUri';
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import {
  shareItemAcrossCircles, listSharedResolved, revokeItemShare,
} from '../../src/v2/circleShare.js';

// A fake ACP `sharing` surface — grant/revoke mutate an in-memory table; list answers deny-by-default from it.
// Mirrors both the enforcement read gate ({ list }) and the canonical controller ({ grant, revoke }).
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

// Build the pod-tier enforcement the app builds at its pod site, but hermetic: real createCanonicalShare over
// a fake ACP surface + memKeyStore, the origin roster's sealing keys as currentRecipients.
function buildCanonicalEnforcement({ sharing, keyStore, controllerKey, currentRecipients }) {
  const resourceUriFor = sharedRefResourceUri(makeResourceUriResolver({ podUri: 'https://pod.example/' }));
  const canonicalShare = createCanonicalShare({ sharing, keyStore, controllerKey, resourceUriFor });
  return makeCircleShareEnforcement({
    sharing, resourceUriFor,
    open: (text) => text,            // content is plaintext in this memory seam test
    canonicalShare,
    currentRecipients,
  });
}

const canonicalPolicyOf = () => ({ sharePosture: 'canonical' });

describe('circleShare — canonical posture (objective L)', () => {
  it('SHARE grants the recipient IN PLACE (no copy): one shared-ref, ACP + key grant, read resolves', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const controllerKey = generateKeypair();   // the origin device (always a group-key recipient)
    const alice = generateKeypair();           // an origin member who must KEEP access
    const bob = generateKeypair();             // the outside recipient
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    const enforcement = buildCanonicalEnforcement({
      sharing, keyStore, controllerKey, currentRecipients: () => [alice.publicKey],
    });
    const enforcementFor = async () => enforcement;

    const src = await svc.createList('A', 'canonical plan body', 'alice');

    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipients: ['did:bob'], recipientKeys: [bob.publicKey],
    });
    expect(r.ok).toBe(true);

    // NO copy: the source circle A still has exactly its ONE original item; nothing has `sharedCopyOf`.
    const aItems = await svc.stores.getStore('A').list();
    expect(aItems).toHaveLength(1);
    expect(aItems.some((it) => it.sharedCopyOf)).toBe(false);

    // The target circle B holds exactly ONE `shared-ref` pointer (not a duplicated item).
    const bRefs = await svc.stores.getStore('B').listByType('shared-ref');
    expect(bRefs).toHaveLength(1);
    expect(bRefs[0]).toMatchObject({ type: 'shared-ref', sourceCircle: 'A', sourceId: src.id });
    const bItems = await svc.stores.getStore('B').list();
    expect(bItems).toHaveLength(1);            // only the ref — no copied content item

    // KEY grant: bob (and the origin member alice + controller) can unwrap the item's group key.
    const kr = keyStore.current();
    expect(unwrapGroupKey(kr, bob.privateKey)).toBeTruthy();
    expect(unwrapGroupKey(kr, alice.privateKey)).toBeTruthy();      // origin member NOT dropped
    expect(unwrapGroupKey(kr, controllerKey.privateKey)).toBeTruthy();

    // ACP grant landed on the canonical source resource for bob (not a copy resource).
    const resourceUriFor = sharedRefResourceUri(makeResourceUriResolver({ podUri: 'https://pod.example/' }));
    const uri = resourceUriFor(bRefs[0]);
    expect(sharing.has(uri, 'did:bob')).toBe(true);

    // READ in place: bob resolves the CANONICAL item; a non-recipient (carol) is denied (deny-by-default).
    const forBob = await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'did:bob' });
    expect(forBob).toHaveLength(1);
    expect(forBob[0].item.text).toBe('canonical plan body');
    expect(forBob[0].item.sharedCopyOf).toBeUndefined();

    const forCarol = await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'did:carol' });
    expect(forCarol).toHaveLength(0);
  });

  it('REVOKE denies the recipient: key rotated away + ACP revoked → read resolves to null', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const controllerKey = generateKeypair();
    const alice = generateKeypair();
    const bob = generateKeypair();
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    const enforcement = buildCanonicalEnforcement({
      sharing, keyStore, controllerKey, currentRecipients: () => [alice.publicKey],
    });
    const enforcementFor = async () => enforcement;

    const src = await svc.createList('A', 'secret', 'alice');
    await shareItemAcrossCircles({
      resolveService, enforcementFor, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipients: ['did:bob'], recipientKeys: [bob.publicKey],
    });
    // Sanity: bob resolves before revoke.
    expect(await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'did:bob' })).toHaveLength(1);

    const rev = await revokeItemShare({
      resolveService, enforcementFor, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', recipient: 'did:bob',
    });
    expect(rev.ok).toBe(true);

    // Group key rotated: bob can no longer unwrap it; alice (remaining) still can.
    const rotated = keyStore.current();
    expect(rotated.version).toBe(2);
    expect(() => unwrapGroupKey(rotated, bob.privateKey)).toThrow();
    expect(unwrapGroupKey(rotated, alice.privateKey)).toBeTruthy();

    // ACP revoked + pointer cleaned up ⇒ bob's read resolves to nothing (deny-by-default).
    const resourceUriFor = sharedRefResourceUri(makeResourceUriResolver({ podUri: 'https://pod.example/' }));
    expect(sharing.has(resourceUriFor({ sourceCircle: 'A', sourceId: src.id }), 'did:bob')).toBe(false);
    expect(await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'did:bob' })).toHaveLength(0);
  });

  it('revoke refuses a non-canonical posture (the copy/closed postures have no in-place grant to rotate)', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const rev = await revokeItemShare({
      resolveService, enforcementFor: async () => null, policyOf: () => ({ sharePosture: 'copy' }),
      itemId: 'x', fromCircleId: 'A', toCircleId: 'B', recipient: 'did:bob',
    });
    expect(rev).toEqual({ ok: false, error: 'not-canonical' });
  });

  it('Q1 — a CANONICAL circle with GROUP-KEY content shares cross-circle as a COPY, never an in-place group-key grant (D2, Frits 2026-08-06)', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const controllerKey = generateKeypair();
    const alice = generateKeypair();
    const bob = generateKeypair();                 // the other circle's member
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    const enforcement = buildCanonicalEnforcement({
      sharing, keyStore, controllerKey, currentRecipients: () => [alice.publicKey],
    });
    // Content is GROUP-KEY sealed → the D2 router forces a copy (the flag `buildCircleShareEnforcement` sets in
    // production from `strategy.scheme === group-key`; set directly here since this harness uses the substrate
    // builder without the app wrapper).
    enforcement.leaveAudienceNeedsCopy = true;
    const enforcementFor = async () => enforcement;

    const src = await svc.createList('A', 'the whole circle history', 'alice');
    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipients: ['did:bob'], recipientKeys: [bob.publicKey],
      sealCopy: (item, keys) => ({ ...item, _sealedTo: keys }),   // host-blind stub; real crypto in circleShareReseal
    });
    expect(r.ok).toBe(true);

    // A separate COPY was minted (sharedCopyOf) — NOT the in-place canonical grant the same posture does for
    // scoped content. The target gets a shared-ref to the COPY, not to the source.
    const aItems = await svc.stores.getStore('A').list();
    expect(aItems.some((it) => it.sharedCopyOf === src.id)).toBe(true);

    // The group key was NEVER re-wrapped to bob (the leak the router closes): no in-place grant landed.
    const kr = keyStore.current();
    const bobLocked = kr == null || (() => { try { return unwrapGroupKey(kr, bob.privateKey) == null; } catch { return true; } })();
    expect(bobLocked).toBe(true);
  });

  it('Q1 fail-loud — a group-key canonical share with NO copy machinery REFUSES, never falls through to an in-place re-wrap', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const controllerKey = generateKeypair();
    const bob = generateKeypair();
    const sharing = fakeSharing();
    const keyStore = memKeyStore();
    const enforcement = buildCanonicalEnforcement({
      sharing, keyStore, controllerKey, currentRecipients: () => [],
    });
    enforcement.leaveAudienceNeedsCopy = true;
    const enforcementFor = async () => enforcement;

    const src = await svc.createList('A', 'secret', 'alice');
    const r = await shareItemAcrossCircles({          // NO sealCopy injected → copy branch can't run
      resolveService, enforcementFor, policyOf: canonicalPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipients: ['did:bob'], recipientKeys: [bob.publicKey],
    });
    expect(r).toEqual({ ok: false, error: 'seal-scope-copy-unavailable' });
    // No in-place re-wrap happened: bob holds nothing.
    expect(keyStore.current()).toBeNull();
  });
});

describe('circleShare — the four shipped postures are unchanged by the canonical wiring', () => {
  it('closed still refuses; copy still mints a SEPARATE sealed copy (sharedCopyOf) — canonical mints none', async () => {
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const src = await svc.createList('A', 'plan', 'alice');

    // closed — external sharing off (unchanged).
    const closed = await shareItemAcrossCircles({
      resolveService, policyOf: () => ({ sharePosture: 'closed' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
    });
    expect(closed).toEqual({ ok: false, error: 'sharing-closed' });

    // copy — a fresh sealed COPY is written into the source store (sharedCopyOf), shared-ref points at IT.
    const sharing = fakeSharing();
    const resourceUriFor = sharedRefResourceUri(makeResourceUriResolver({ podUri: 'https://pod.example/' }));
    const enforcement = makeCircleShareEnforcement({ sharing, resourceUriFor, open: (t) => t });
    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor: async () => enforcement, policyOf: () => ({ sharePosture: 'copy' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipients: ['did:bob'], recipientKeys: ['bob-seal-key'],
      sealCopy: (item) => ({ ...item, text: `SEALED(${item.text})` }),   // stand-in re-sealer
    });
    expect(r.ok).toBe(true);
    const aItems = await svc.stores.getStore('A').list();
    expect(aItems.some((it) => it.sharedCopyOf === src.id)).toBe(true);   // copy posture DID mint a copy
  });
});
