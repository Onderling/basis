/**
 * share-policy — the CRITICAL real-key proof for cross-circle recipient re-seal.
 *
 * The whole point of the slice: a recipient whose sealing key is DIFFERENT from the source group's key can
 * decrypt a shared sealed item, and a non-recipient (a third, distinct keypair) CANNOT — even if granted the
 * ACP read (no ciphertext/plaintext leak). We use REAL, DISTINCT keypairs from `@onderling/pod-client` sealing —
 * NOT matching mocks — so the test actually exercises the crypto that fixes the bug.
 *
 *   • source group key  (groupKeyStrategy)      — the source circle's at-rest posture (bob is NOT in it)
 *   • bob   keypair     (recipientStrategy)      — the cross-circle RECIPIENT (a different key)
 *   • eve   keypair     (recipientStrategy)      — a NON-recipient (a third, distinct key)
 *
 * Two mechanisms are proven:
 *   1. COPY mode (the clean, any-posture path) — a separate object sealed to bob; source untouched.
 *   2. CANONICAL in-place re-seal — recipientKeys threaded to the enforcement's injected `seal`.
 * Plus the slice-3a roster lookup (`recipientSealKeyFromMembers`): a key for a roster member, null otherwise.
 */
import { describe, it, expect } from 'vitest';
import {
  generateKeypair, generateGroupKey, recipientStrategy, groupKeyStrategy, isSealed,
} from '@onderling/pod-client';
import { makeCircleShareEnforcement, sealItem } from '@onderling/item-store';
import { makeResourceUriResolver, sharedRefResourceUri } from '@onderling/pod-onboarding/resourceUri';
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import {
  shareItemAcrossCircles, listSharedResolved, composeReaderOpen,
} from '../../src/v2/circleShare.js';
import { recipientSealKeyFromMembers } from '@onderling/kring-host/circleMembers';

const resourceUriFor = sharedRefResourceUri(makeResourceUriResolver({ podUri: 'https://pod.example/' }));

// Fake ACP `sharing` ({ grant, list }) — records grants; `list` answers from them (the deny-by-default gate).
function fakeSharing() {
  const grants = [];
  return {
    grants,
    async grant({ resourceUri, agent, modes }) { grants.push({ resourceUri, agent, modes }); },
    async list({ resourceUri, agentsToQuery = [] }) {
      return grants
        .filter((g) => g.resourceUri === resourceUri && agentsToQuery.includes(g.agent))
        .map((g) => ({ subject: 'agent', agent: g.agent, modes: g.modes }));
    },
  };
}

// The injected copy re-sealer, exactly as circleApp wires it (recipientStrategy + item-store's sealItem).
const sealCopyToRecipients = (item, keys) =>
  sealItem(item, (text) => recipientStrategy({ recipients: keys }).seal(text));

const openPolicyOf = () => ({ sharePosture: 'copy' });

describe('slice 3 — REAL-KEY cross-circle recipient re-seal (COPY mode)', () => {
  it('a recipient with a DIFFERENT key than the source group decrypts; a non-recipient (granted) cannot', async () => {
    // Distinct real keys — the crux: bob/eve are NOT the source group.
    const groupKey = generateGroupKey();
    const source = groupKeyStrategy({ groupKey });          // source at-rest posture (p2)
    const bob = generateKeypair();                          // cross-circle recipient
    const eve = generateKeypair();                          // non-recipient (third key)

    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const sharing = fakeSharing();
    // The source enforcement: open = the source's GROUP opener (its own posture). Copy adds bob's opener on read.
    const enforcement = makeCircleShareEnforcement({ sharing, resourceUriFor, open: source.open });
    const enforcementFor = (cid) => (cid === 'A' ? enforcement : null);

    // A source item. (In memory it's plaintext; a real sealed pod opens it at rest before the copy re-seal —
    // either way bob's ability to read is INDEPENDENT of the source group key, which is the property we want.)
    const src = await svc.createList('A', 'secret plan', 'alice');

    // Share bob-only, COPY mode: writes a SEPARATE object sealed to bob; source A untouched.
    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor, policyOf: openPolicyOf,
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipients: ['webid:bob'], recipientKeys: [bob.publicKey], sealCopy: sealCopyToRecipients,
    });
    expect(r.ok).toBe(true);

    // The SOURCE item is untouched (still its own plaintext/at-rest form) — copy never rewrote it.
    expect((await svc.stores.getStore('A').get(src.id)).text).toBe('secret plan');
    // The copy resource IS a real sealed envelope at rest (host sees ciphertext, not 'secret plan').
    const copyId = r.ref.sourceId;
    const copyAtRest = await svc.stores.getStore('A').get(copyId);
    expect(copyId).not.toBe(src.id);
    expect(isSealed(copyAtRest.text)).toBe(true);
    expect(copyAtRest.text).not.toContain('secret plan');

    // BOB (recipient) — granted + holds the matching private key → decrypts to the plaintext.
    const bobOpen = (t) => recipientStrategy({ privateKey: bob.privateKey }).open(t);
    const forBob = await listSharedResolved({
      resolveService, enforcementFor, circleId: 'B', recipient: 'webid:bob', readerOpen: bobOpen,
    });
    expect(forBob.map((x) => x.item.text)).toEqual(['secret plan']);

    // EVE — even if we GRANT her the ACP read, her WRONG key can't open the envelope → dropped, no leak.
    await sharing.grant({ resourceUri: resourceUriFor(r.ref), agent: 'webid:eve', modes: ['read'] });
    const eveOpen = (t) => recipientStrategy({ privateKey: eve.privateKey }).open(t);
    const forEve = await listSharedResolved({
      resolveService, enforcementFor, circleId: 'B', recipient: 'webid:eve', readerOpen: eveOpen,
    });
    expect(forEve).toEqual([]);                              // ciphertext never leaks to the non-recipient
  });
});

describe('slice 3 — REAL-KEY re-seal (CANONICAL in-place via the enforcement seal)', () => {
  it('recipientKeys thread to the injected seal; bob decrypts, eve (wrong key) → null', async () => {
    const bob = generateKeypair();
    const eve = generateKeypair();
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const sharing = fakeSharing();

    // Enforcement whose injected `seal` re-wraps content to the recipientKeys it is HANDED at share time,
    // and whose `open` is the READER's key (bob) — the substrate seam under test.
    const enforcement = makeCircleShareEnforcement({
      sharing, resourceUriFor,
      open: (t) => recipientStrategy({ privateKey: bob.privateKey }).open(t),
      seal: (item, { recipientKeys }) => sealItem(item, (t) => recipientStrategy({ recipients: recipientKeys }).seal(t)),
    });
    const src = await svc.createList('A', 'confidential note', 'alice');

    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor: (cid) => (cid === 'A' ? enforcement : null),
      policyOf: () => ({ sharePosture: 'trusted' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipients: ['webid:bob'], recipientKeys: [bob.publicKey],
    });
    expect(r.ok).toBe(true);
    // In-place re-seal: the source item is now a real envelope sealed to bob (host-blind).
    expect(isSealed((await svc.stores.getStore('A').get(src.id)).text)).toBe(true);

    // bob decrypts via his key…
    const forBob = await listSharedResolved({ resolveService, enforcementFor: () => enforcement, circleId: 'B', recipient: 'webid:bob' });
    expect(forBob.map((x) => x.item.text)).toEqual(['confidential note']);

    // …eve's enforcement (her key) opens nothing → null (no leak). Grant her the read to prove it's the CRYPTO.
    await sharing.grant({ resourceUri: resourceUriFor(r.ref), agent: 'webid:eve', modes: ['read'] });
    const eveEnf = makeCircleShareEnforcement({ sharing, resourceUriFor, open: (t) => recipientStrategy({ privateKey: eve.privateKey }).open(t) });
    const forEve = await listSharedResolved({ resolveService, enforcementFor: () => eveEnf, circleId: 'B', recipient: 'webid:eve' });
    expect(forEve).toEqual([]);
  });
});

describe('option 2 — trusted/registered ride the COPY re-seal mechanism (real distinct keys)', () => {
  // Shared real-key setup: a source group key (bob/eve NOT in it), a recipient (bob), a non-recipient (eve).
  function makeWorld() {
    const groupKey = generateGroupKey();
    const source = groupKeyStrategy({ groupKey });
    const bob = generateKeypair();
    const eve = generateKeypair();
    const svc = makeCircleLists();
    const resolveService = async () => svc;
    const sharing = fakeSharing();
    const enforcement = makeCircleShareEnforcement({ sharing, resourceUriFor, open: source.open });
    const enforcementFor = (cid) => (cid === 'A' ? enforcement : null);
    return { svc, resolveService, sharing, enforcement, enforcementFor, bob, eve };
  }

  it('TRUSTED posture: writes a recipient-sealed copy; bob (recipient) decrypts, eve (non-recipient, granted) cannot', async () => {
    const { svc, resolveService, sharing, enforcementFor, bob, eve } = makeWorld();
    const src = await svc.createList('A', 'trusted plan', 'alice');

    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor, policyOf: () => ({ sharePosture: 'trusted' }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipients: ['webid:bob'], recipientKeys: [bob.publicKey], sealCopy: sealCopyToRecipients,
    });
    expect(r.ok).toBe(true);

    // Source untouched; a SEPARATE sealed copy was minted (host sees ciphertext, not plaintext).
    expect((await svc.stores.getStore('A').get(src.id)).text).toBe('trusted plan');
    const copyId = r.ref.sourceId;
    expect(copyId).not.toBe(src.id);
    const copyAtRest = await svc.stores.getStore('A').get(copyId);
    expect(isSealed(copyAtRest.text)).toBe(true);
    expect(copyAtRest.text).not.toContain('trusted plan');

    // Bob decrypts with HIS key.
    const bobOpen = (t) => recipientStrategy({ privateKey: bob.privateKey }).open(t);
    const forBob = await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'webid:bob', readerOpen: bobOpen });
    expect(forBob.map((x) => x.item.text)).toEqual(['trusted plan']);

    // Eve — granted the ACP read, but her wrong key can't open → dropped, no leak.
    await sharing.grant({ resourceUri: resourceUriFor(r.ref), agent: 'webid:eve', modes: ['read'] });
    const eveOpen = (t) => recipientStrategy({ privateKey: eve.privateKey }).open(t);
    const forEve = await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'webid:eve', readerOpen: eveOpen });
    expect(forEve).toEqual([]);
  });

  it('REGISTERED posture (admin initiator): writes a recipient-sealed copy; bob decrypts, eve (granted) cannot', async () => {
    const { svc, resolveService, sharing, enforcementFor, bob, eve } = makeWorld();
    const src = await svc.createList('A', 'registered plan', 'alice');

    // alice IS an admin → registered gate passes → copy re-seal fires.
    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor,
      policyOf: () => ({ sharePosture: 'registered', admins: ['alice'] }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice',
      recipients: ['webid:bob'], recipientKeys: [bob.publicKey], sealCopy: sealCopyToRecipients,
    });
    expect(r.ok).toBe(true);

    expect((await svc.stores.getStore('A').get(src.id)).text).toBe('registered plan');
    const copyId = r.ref.sourceId;
    expect(copyId).not.toBe(src.id);
    expect(isSealed((await svc.stores.getStore('A').get(copyId)).text)).toBe(true);

    const bobOpen = (t) => recipientStrategy({ privateKey: bob.privateKey }).open(t);
    const forBob = await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'webid:bob', readerOpen: bobOpen });
    expect(forBob.map((x) => x.item.text)).toEqual(['registered plan']);

    await sharing.grant({ resourceUri: resourceUriFor(r.ref), agent: 'webid:eve', modes: ['read'] });
    const eveOpen = (t) => recipientStrategy({ privateKey: eve.privateKey }).open(t);
    const forEve = await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'webid:eve', readerOpen: eveOpen });
    expect(forEve).toEqual([]);
  });

  it('REGISTERED posture (NON-admin initiator): slice-2 gate refuses; NO copy is written, nothing surfaces to B', async () => {
    const { svc, resolveService, enforcementFor, bob } = makeWorld();
    const src = await svc.createList('A', 'registered plan', 'alice');
    const beforeIds = (await svc.stores.getStore('A').list()).map((x) => x.id);

    // mallory is NOT in admins → registered gate refuses BEFORE any re-seal.
    const r = await shareItemAcrossCircles({
      resolveService, enforcementFor,
      policyOf: () => ({ sharePosture: 'registered', admins: ['alice'] }),
      itemId: src.id, fromCircleId: 'A', toCircleId: 'B', by: 'mallory',
      recipients: ['webid:bob'], recipientKeys: [bob.publicKey], sealCopy: sealCopyToRecipients,
    });
    expect(r).toEqual({ ok: false, error: 'sharing-admin-only' });

    // No copy object was minted in the source store, and nothing surfaced into B.
    const afterIds = (await svc.stores.getStore('A').list()).map((x) => x.id);
    expect(afterIds).toEqual(beforeIds);
    const bobOpen = (t) => recipientStrategy({ privateKey: bob.privateKey }).open(t);
    const forBob = await listSharedResolved({ resolveService, enforcementFor, circleId: 'B', recipient: 'webid:bob', readerOpen: bobOpen });
    expect(forBob).toEqual([]);
  });
});

describe('slice 3a — recipientSealKeyFromMembers (roster lookup, deny-by-default)', () => {
  const bob = generateKeypair();
  it('returns the sealing pubkey for a roster member (pinboard listGroupMembers shape)', () => {
    const roster = { members: [{ webid: 'webid:bob', sealingPublicKey: bob.publicKey }, { webid: 'webid:carol' }] };
    expect(recipientSealKeyFromMembers(roster, 'webid:bob')).toBe(bob.publicKey);
  });
  it('returns the sealing pubkey from the control-agent roster shape ({webId, publicKey})', () => {
    const roster = [{ webId: 'webid:bob', publicKey: bob.publicKey }];
    expect(recipientSealKeyFromMembers(roster, 'webid:bob')).toBe(bob.publicKey);
  });
  it('returns null when the recipient is NOT in the target roster (→ share refused)', () => {
    const roster = { members: [{ webid: 'webid:bob', sealingPublicKey: bob.publicKey }] };
    expect(recipientSealKeyFromMembers(roster, 'webid:eve')).toBeNull();
  });
  it('returns null when the member is present but has no sealing key yet', () => {
    expect(recipientSealKeyFromMembers({ members: [{ webid: 'webid:bob' }] }, 'webid:bob')).toBeNull();
  });
});

describe('composeReaderOpen — deny-by-default when neither opener fits', () => {
  it('passes plaintext through and opens the reader envelope, but throws (→ null) for a foreign envelope', async () => {
    const bob = generateKeypair();
    const eve = generateKeypair();
    const sealedForBob = recipientStrategy({ recipients: [bob.publicKey] }).seal('hi bob');

    // eve's reader open, no group fallback → a bob-only envelope cannot be opened → the composed open throws.
    const policy = composeReaderOpen({ open: (item) => item }, (t) => recipientStrategy({ privateKey: eve.privateKey }).open(t));
    await expect(policy.open({ type: 'note', text: sealedForBob })).rejects.toThrow();

    // bob's reader open → decrypts, and plaintext structural fields pass through.
    const bobPolicy = composeReaderOpen({ open: (item) => item }, (t) => recipientStrategy({ privateKey: bob.privateKey }).open(t));
    expect(await bobPolicy.open({ type: 'note', text: sealedForBob })).toEqual({ type: 'note', text: 'hi bob' });
  });
});
