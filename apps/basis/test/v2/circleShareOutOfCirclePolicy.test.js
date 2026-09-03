/**
 * out-of-circle SHARING POLICY (shareOutOfCircle axis) — the per-circle governance of sharing a canonical item
 * OUT to an OUT-OF-CIRCLE recipient (known only by their PUBLISHED network key). Proves the policy routing on
 * top of the shipped Phase-2 published-key substrate, with REAL sealing crypto where a recipient opens:
 *
 *   • prohibit → REFUSED ({ok:false, error:'share-prohibited'}); nothing written, nothing granted.
 *   • notify   → REVOCABLE CANONICAL in-place grant (no copy) AND a best-effort notify() is emitted.
 *   • silent   → a COPY sealed to the recipient's network-derived key; NO canonical ACP/key trace on the item;
 *                the recipient opens the copy, a stranger does not.
 *   • toCircleId is OPTIONAL — a pure person-share grants on the source resource, no circle pointer needed.
 *   • includeHistory (default FALSE) — the recipient gets the CURRENT group-key version only; the retained
 *                pre-grant history is re-wrapped to them ONLY when includeHistory is set.
 *
 * Everything routes through the SHARED op (`shareItemToPublishedKey`) + the ONE shared enforcement builder both
 * shells call — no shell fork (invariant #1/#2).
 */
import { describe, it, expect, vi } from 'vitest';
import { outOfCircleShareOffered } from '../../src/v2/circleShare.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import nacl from 'tweetnacl';
import {
  generateKeypair, generateGroupKey, unwrapGroupKey, recipientStrategy, groupKeyStrategy, isSealed,
  buildGroupKeyResource, rotateGroupKeyResource, readableGroupKeys,
  sealingPublicKeyFromNetworkKey, sealingKeyPairFromNetworkKey,
} from '@onderling/pod-client/sealing';
import { sealItem } from '@onderling/item-store';
import { makeResourceUriResolver, sharedRefResourceUri } from '@onderling/pod-onboarding/resourceUri';
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import { buildCircleShareEnforcement } from '../../src/v2/circleShareEnforcement.js';
import { shareItemToPublishedKey, listSharedResolved } from '../../src/v2/circleShare.js';

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function fakeNetworkIdentity() {
  const kp = nacl.sign.keyPair();
  return { publicKey: b64u(kp.publicKey), secretKey: b64u(kp.secretKey) };
}

function fakeSharing() {
  const table = new Map();
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

function memKeyStore(initial = null) {
  let stored = initial;
  return { read: async () => stored, write: async (r) => { stored = r; }, current: () => stored };
}

const POD = 'https://pod.example/';
const uriFor = sharedRefResourceUri(makeResourceUriResolver({ podUri: POD }));

// The injected pod-layer crypto the `silent` path needs (mirror of what the shells inject).
const sealCopyToRecipients = (item, keys) => sealItem(item, (t) => recipientStrategy({ recipients: keys }).seal(t));

function buildEnforcement({ sharing, keyStore, controllerKey, roster }) {
  return buildCircleShareEnforcement({
    sharing,
    // A REAL group-key opener for the source's at-rest content: it passes plaintext through but THROWS on a
    // foreign envelope — so a granted NON-recipient of a sealed copy is dropped (no ciphertext leak), exactly
    // like a p2 source circle. (An identity opener would pass ciphertext through — not the realistic seam.)
    // The SCHEME tag says 'pairwise' (a scoped circle): these tests pin the out-of-circle POLICY semantics
    // (notify default / toCircleId / includeHistory), which since batch 4 require a scoped scheme — the D2
    // gate refuses out-of-circle grants on group-key-sealed content outright (circleSharePublishedKey.test
    // pins THAT). The opener's throw-on-foreign behaviour is scheme-independent and stays.
    strategy: { scheme: 'pairwise', open: groupKeyStrategy({ groupKey: generateGroupKey() }).open },
    podRoot: POD,
    controlAgent: { keyStore, members: () => roster.map((publicKey) => ({ publicKey })) },
    idKey: { publicKey: controllerKey.publicKey, privateKey: controllerKey.privateKey },
  });
}

function world({ roster, keyStore = memKeyStore(), controllerKey = generateKeypair(), alice = generateKeypair() } = {}) {
  const svc = makeCircleLists();
  const sharing = fakeSharing();
  const enforcement = buildEnforcement({ sharing, keyStore, controllerKey, roster: roster ?? [alice.publicKey] });
  return {
    svc, controllerKey, alice, sharing, keyStore, enforcement,
    resolveService: async () => svc,
    enforcementFor: async () => enforcement,
  };
}

describe('shareOutOfCircle — prohibit', () => {
  it('REFUSES the share outright; no store touched, no grant', async () => {
    const { svc, resolveService, enforcementFor, sharing, keyStore } = world();
    const dave = fakeNetworkIdentity();
    const src = await svc.createList('A', 'body', 'alice');

    const r = await shareItemToPublishedKey({
      resolveService, enforcementFor, policyOf: () => ({ shareOutOfCircle: 'prohibit' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey,
    });
    expect(r).toEqual({ ok: false, error: 'share-prohibited' });
    expect(await svc.stores.getStore('B').listByType('shared-ref')).toHaveLength(0);
    expect(keyStore.current()).toBe(null);
    expect(sharing.has(uriFor({ sourceCircle: 'A', sourceId: src.id }), 'did:dave')).toBe(false);
  });
});

describe('shareOutOfCircle — notify', () => {
  it('grants the CANONICAL item IN PLACE (no copy) AND emits a notify; the recipient opens it', async () => {
    const { svc, resolveService, enforcementFor, controllerKey, alice, sharing, keyStore } = world();
    const dave = fakeNetworkIdentity();
    const notify = vi.fn();
    const src = await svc.createList('A', 'canonical plan', 'alice');

    const r = await shareItemToPublishedKey({
      resolveService, enforcementFor, policyOf: () => ({ shareOutOfCircle: 'notify' }), notify,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey,
    });
    expect(r.ok).toBe(true);

    // NO copy in A; exactly ONE shared-ref pointer in B.
    const aItems = await svc.stores.getStore('A').list();
    expect(aItems).toHaveLength(1);
    expect(aItems.some((it) => it.sharedCopyOf)).toBe(false);
    const bRefs = await svc.stores.getStore('B').listByType('shared-ref');
    expect(bRefs).toHaveLength(1);

    // The notify fired with the out-of-circle event.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({
      event: 'item-shared-out-of-circle', itemId: src.id, fromCircleId: 'A', toCircleId: 'B', recipient: 'did:dave',
    });

    // Canonical KEY grant: dave (from his published key) + alice + controller can unwrap; ACP grant landed.
    const daveSealing = sealingKeyPairFromNetworkKey(dave.secretKey);
    const kr = keyStore.current();
    expect(unwrapGroupKey(kr, daveSealing.privateKey)).toBeTruthy();
    expect(unwrapGroupKey(kr, alice.privateKey)).toBeTruthy();
    expect(unwrapGroupKey(kr, controllerKey.privateKey)).toBeTruthy();
    expect(sharing.has(uriFor(bRefs[0]), 'did:dave')).toBe(true);

    // READ in place: dave resolves the canonical item; a stranger is denied.
    const forDave = await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'did:dave' });
    expect(forDave.map((x) => x.item.text)).toEqual(['canonical plan']);
    expect(forDave[0].item.sharedCopyOf).toBeUndefined();
    expect(await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'did:eve' })).toHaveLength(0);
  });

  it('is NOT the default any more: a policy with no shareOutOfCircle set is REFUSED (prohibit) — decided 2026-09-03', async () => {
    // The `notify` default was flagged in circlePolicy.js as a product decision never taken. Taken on
    // 2026-09-03 (Frits): OFF for the alpha — the one core circle event with no end-to-end journey stays
    // gated until it has one. `notify`/`silent` still work when an admin sets them (the tests above).
    const { svc, resolveService, enforcementFor, keyStore } = world();
    const dave = fakeNetworkIdentity();
    const src = await svc.createList('A', 'x', 'alice');
    const r = await shareItemToPublishedKey({
      resolveService, enforcementFor, policyOf: () => ({}),   // no shareOutOfCircle ⇒ default prohibit
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('share-prohibited');
    // …and nothing was granted: refused BEFORE any store touch, so no key resource was ever written.
    expect(keyStore.current()).toBeFalsy();
  });

});

describe('shareOutOfCircle — silent (privacy COPY)', () => {
  it('mints a COPY sealed to the recipient; NO canonical ACP/key trace; recipient opens it, stranger cannot', async () => {
    const { svc, resolveService, enforcementFor, sharing, keyStore } = world();
    const dave = fakeNetworkIdentity();
    const src = await svc.createList('A', 'secret plan', 'alice');

    const r = await shareItemToPublishedKey({
      resolveService, enforcementFor, policyOf: () => ({ shareOutOfCircle: 'silent' }),
      sealCopy: sealCopyToRecipients, sealingKeyFromNetworkKey: sealingPublicKeyFromNetworkKey,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey,
    });
    expect(r.ok).toBe(true);

    // The SOURCE canonical item is untouched (still plaintext); a SEPARATE sealed copy was minted.
    expect((await svc.stores.getStore('A').get(src.id)).text).toBe('secret plan');
    const copyId = r.ref.sourceId;
    expect(copyId).not.toBe(src.id);
    const copyAtRest = await svc.stores.getStore('A').get(copyId);
    expect(copyAtRest.sharedCopyOf).toBe(src.id);
    expect(isSealed(copyAtRest.text)).toBe(true);
    expect(copyAtRest.text).not.toContain('secret plan');

    // NO canonical trace: the item's group key was never granted (keyStore untouched) and there is NO ACP grant
    // on the CANONICAL resource for dave — only on the copy resource.
    expect(keyStore.current()).toBe(null);
    expect(sharing.has(uriFor({ sourceCircle: 'A', sourceId: src.id }), 'did:dave')).toBe(false);
    expect(sharing.has(uriFor(r.ref), 'did:dave')).toBe(true);

    // The recipient (network-derived key) opens the copy; a stranger with the wrong key does not (no leak).
    const daveSealing = sealingKeyPairFromNetworkKey(dave.secretKey);
    const daveOpen = (t) => recipientStrategy({ privateKey: daveSealing.privateKey }).open(t);
    const forDave = await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'did:dave', readerOpen: daveOpen });
    expect(forDave.map((x) => x.item.text)).toEqual(['secret plan']);

    const eve = generateKeypair();
    await sharing.grant({ resourceUri: uriFor(r.ref), agent: 'did:eve', modes: ['read'] });
    const eveOpen = (t) => recipientStrategy({ privateKey: eve.privateKey }).open(t);
    expect(await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'did:eve', readerOpen: eveOpen })).toEqual([]);
  });
});

describe('shareItemToPublishedKey — toCircleId OPTIONAL', () => {
  it('notify with NO toCircleId: grants on the SOURCE resource, writes NO circle pointer, returns the ref', async () => {
    const { svc, resolveService, enforcementFor, sharing, keyStore } = world();
    const dave = fakeNetworkIdentity();
    const notify = vi.fn();
    const src = await svc.createList('A', 'body', 'alice');

    const r = await shareItemToPublishedKey({
      resolveService, enforcementFor, policyOf: () => ({ shareOutOfCircle: 'notify' }), notify,
      itemId: src.id, fromCircleId: 'A', by: 'alice',           // NO toCircleId
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey,
    });
    expect(r.ok).toBe(true);
    expect(r.ref).toMatchObject({ type: 'shared-ref', sourceCircle: 'A', sourceId: src.id });

    // No pointer persisted anywhere (A still has only its one item), but the grant DID land on the source.
    expect(await svc.stores.getStore('A').list()).toHaveLength(1);
    const daveSealing = sealingKeyPairFromNetworkKey(dave.secretKey);
    expect(unwrapGroupKey(keyStore.current(), daveSealing.privateKey)).toBeTruthy();
    expect(sharing.has(uriFor({ sourceCircle: 'A', sourceId: src.id }), 'did:dave')).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('rejects a toCircleId equal to fromCircleId, but accepts an absent one', async () => {
    const { svc, resolveService, enforcementFor } = world();
    const dave = fakeNetworkIdentity();
    const src = await svc.createList('A', 'body', 'alice');
    const base = {
      resolveService, enforcementFor, policyOf: () => ({ shareOutOfCircle: 'notify' }),
      itemId: src.id, fromCircleId: 'A', recipient: 'did:dave', recipientNetworkKey: dave.publicKey,
    };
    expect(await shareItemToPublishedKey({ ...base, toCircleId: 'A' })).toEqual({ ok: false, error: 'same-circle' });
    expect((await shareItemToPublishedKey({ ...base })).ok).toBe(true);
  });
});

describe('shareItemToPublishedKey — includeHistory (pre-grant history withheld by default)', () => {
  // Seed a group-key resource that has ALREADY rotated once, so it carries a retained v1 in history[].
  function seededWorld() {
    const controllerKey = generateKeypair();
    const alice = generateKeypair();
    const v1 = buildGroupKeyResource({ version: 1, groupKey: generateGroupKey(), recipients: [controllerKey.publicKey, alice.publicKey] });
    const v2 = rotateGroupKeyResource({ previous: v1, recipients: [controllerKey.publicKey, alice.publicKey] });
    const keyStore = memKeyStore(v2);   // current v2, history=[v1]
    return world({ roster: [alice.publicKey], keyStore, controllerKey, alice });
  }

  it('DEFAULT (includeHistory off): the recipient gets the CURRENT version only — not the pre-grant v1', async () => {
    const w = seededWorld();
    const dave = fakeNetworkIdentity();
    const src = await w.svc.createList('A', 'body', 'alice');

    const r = await shareItemToPublishedKey({
      resolveService: w.resolveService, enforcementFor: w.enforcementFor, policyOf: () => ({ shareOutOfCircle: 'notify' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey,   // no includeHistory
    });
    expect(r.ok).toBe(true);

    const daveSealing = sealingKeyPairFromNetworkKey(dave.secretKey);
    const versions = readableGroupKeys(w.keyStore.current(), daveSealing.privateKey).map((k) => k.version).sort();
    expect(versions).toEqual([2]);   // current only — NO retroactive access to v1
  });

  it('includeHistory=true: the retained pre-grant v1 is re-wrapped to the recipient too', async () => {
    const w = seededWorld();
    const dave = fakeNetworkIdentity();
    const src = await w.svc.createList('A', 'body', 'alice');

    const r = await shareItemToPublishedKey({
      resolveService: w.resolveService, enforcementFor: w.enforcementFor, policyOf: () => ({ shareOutOfCircle: 'notify' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipient: 'did:dave', recipientNetworkKey: dave.publicKey, includeHistory: true,
    });
    expect(r.ok).toBe(true);

    const daveSealing = sealingKeyPairFromNetworkKey(dave.secretKey);
    const versions = readableGroupKeys(w.keyStore.current(), daveSealing.privateKey).map((k) => k.version).sort();
    expect(versions).toEqual([1, 2]);   // opted in ⇒ both the current AND the retained pre-grant version
  });
});


describe('out-of-circle sharing is OFF by default and the shells ask ONE shared predicate', () => {
  it('the default policy prohibits it — decided 2026-09-03 for the alpha', () => {
    expect(normalizeCirclePolicy({}).shareOutOfCircle).toBe('prohibit');
    expect(outOfCircleShareOffered({})).toBe(false);
    expect(outOfCircleShareOffered(undefined)).toBe(false);
  });
  it('an admin who turns the axis on per circle gets the affordance back', () => {
    expect(outOfCircleShareOffered({ shareOutOfCircle: 'notify' })).toBe(true);
    expect(outOfCircleShareOffered({ shareOutOfCircle: 'silent' })).toBe(true);
    expect(outOfCircleShareOffered({ shareOutOfCircle: 'prohibit' })).toBe(false);
  });
});
