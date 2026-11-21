/**
 * Cross-circle share — on-substrate ACP/seal enforcement of the shared-ref cross-circle READ.
 *
 * `resolveSharedRef` gains an injected, DENY-BY-DEFAULT enforcement policy. These tests exercise the seam
 * against the memory substrate with FAKE `sharing` + `open` surfaces (mimicking `client.sharing.list` and
 * sealing/`open`) — no live pod, no dependency on @onderling/pod-client:
 *   • grant present  → resolves to the source item
 *   • grant absent   → null (denied)
 *   • sealed content → unsealed on the way out; a non-recipient reader → null (never leaks ciphertext)
 *   • memory-modeled posture floor enforced on the read (makePosturePolicy)
 *   • backward-compat: no policy ⇒ behaviour unchanged
 */
import { describe, it, expect } from 'vitest';
import {
  createCircleStores, memoryDataSource,
  shareIntoAudience, resolveSharedRef, listShared,
  makeSharedRefPolicy, makePosturePolicy,
  makeCircleShareEnforcement, makeCanonicalShareHook,
} from '../src/index.js';

function mkStores() {
  const registry = { validate: () => ({ ok: true }) };
  return createCircleStores({ dataSource: memoryDataSource(), registry });
}

/* ── Fakes standing in for the pod layer (no @onderling/pod-client import) ──────────────────────────── */

// Fake `client.sharing`: an in-memory ACP table keyed by resourceUri → [{subject, agent, modes}].
// Mirrors the real `sharing.list({ resourceUri, agentsToQuery })` return shape.
function fakeSharing(table = {}) {
  return {
    grants: table,
    async list({ resourceUri, agentsToQuery = [] }) {
      const rows = table[resourceUri] ?? [];
      return rows.filter((r) => r.subject === 'public' || agentsToQuery.includes(r.agent));
    },
  };
}

// Fake sealing envelope: `SEAL[rid]:plaintext`. `open(reader)` returns plaintext only for the named
// recipient; throws for anyone else (mimics sealing/`open` "not a recipient"); passes plaintext through.
const SENTINEL = 'SEAL[';
const fakeSeal = (rid, text) => `${SENTINEL}${rid}]:${text}`;
function fakeOpener(reader) {
  return (text) => {
    if (typeof text !== 'string' || !text.startsWith(SENTINEL)) return text;   // plaintext passes through
    const m = text.match(/^SEAL\[([^\]]+)\]:([\s\S]*)$/);
    if (!m) return text;
    if (m[1] !== reader) throw new Error('sealing: not a recipient');
    return m[2];
  };
}

describe('resolveSharedRef — injected ACP grant enforcement (makeSharedRefPolicy)', () => {
  it('grant present → resolves to the source item', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'secret plan' });
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B', by: 'alice' });

    const resourceUri = `A/${item.id}`;
    const sharing = fakeSharing({ [resourceUri]: [{ subject: 'agent', agent: 'bob', modes: ['read'] }] });
    const policy = makeSharedRefPolicy({ sharing, recipient: 'bob' });

    const got = await resolveSharedRef(stores, ref, { policy });
    expect(got.text).toBe('secret plan');
  });

  it('grant absent → null (deny-by-default)', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'secret plan' });
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B' });

    // ACP table is empty for this resource → no grant.
    const sharing = fakeSharing({});
    const policy = makeSharedRefPolicy({ sharing, recipient: 'bob' });
    expect(await resolveSharedRef(stores, ref, { policy })).toBeNull();
  });

  it('grant to a DIFFERENT agent → null; wrong mode (append only) → null', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'x' });
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B' });
    const resourceUri = `A/${item.id}`;

    const sharing = fakeSharing({
      [resourceUri]: [
        { subject: 'agent', agent: 'carol', modes: ['read'] },   // granted to carol, not bob
        { subject: 'agent', agent: 'bob', modes: ['append'] },   // bob has append, not read
      ],
    });
    expect(await resolveSharedRef(stores, ref, { policy: makeSharedRefPolicy({ sharing, recipient: 'bob' }) })).toBeNull();
  });

  it('public read grant → resolves for any recipient', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'note', text: 'town notice' });
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B' });
    const sharing = fakeSharing({ [`A/${item.id}`]: [{ subject: 'public', modes: ['read'] }] });
    const got = await resolveSharedRef(stores, ref, { policy: makeSharedRefPolicy({ sharing, recipient: 'anyone' }) });
    expect(got.text).toBe('town notice');
  });

  it('no recipient identity → null (deny-by-default)', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'x' });
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B' });
    const sharing = fakeSharing({ [`A/${item.id}`]: [{ subject: 'public', modes: ['read'] }] });
    const policy = makeSharedRefPolicy({ sharing });   // no recipient supplied
    expect(await resolveSharedRef(stores, ref, { policy })).toBeNull();
  });

  it('honours an injected resourceUriFor (real pod storage-layout URI)', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'y' });
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B' });
    const podUri = `https://alice.pod/circles/A/items/${item.id}.json`;
    const sharing = fakeSharing({ [podUri]: [{ subject: 'agent', agent: 'bob', modes: ['read'] }] });
    const policy = makeSharedRefPolicy({
      sharing, recipient: 'bob',
      resourceUriFor: (r) => `https://alice.pod/circles/${r.sourceCircle}/items/${r.sourceId}.json`,
    });
    expect((await resolveSharedRef(stores, ref, { policy })).text).toBe('y');
  });
});

describe('resolveSharedRef — seal/unseal enforcement', () => {
  it('sealed content → unsealed for the recipient; plaintext fields pass through', async () => {
    const stores = mkStores();
    // Body is stored SEALED to recipient "bob".
    const item = await stores.getStore('A').put({ type: 'note', body: fakeSeal('bob', 'confidential body') });
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B' });

    const sharing = fakeSharing({ [`A/${item.id}`]: [{ subject: 'agent', agent: 'bob', modes: ['read'] }] });
    const policy = makeSharedRefPolicy({ sharing, open: fakeOpener('bob'), recipient: 'bob' });

    const got = await resolveSharedRef(stores, ref, { policy });
    expect(got.body).toBe('confidential body');   // unsealed
    expect(got.type).toBe('note');                // plaintext untouched
  });

  it('granted but NOT a seal recipient → null (never leak ciphertext)', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'note', body: fakeSeal('bob', 'for bob only') });
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B' });
    // ACP grants carol a read, but the envelope is sealed to bob → carol can't open it.
    const sharing = fakeSharing({ [`A/${item.id}`]: [{ subject: 'agent', agent: 'carol', modes: ['read'] }] });
    const policy = makeSharedRefPolicy({ sharing, open: fakeOpener('carol'), recipient: 'carol' });
    expect(await resolveSharedRef(stores, ref, { policy })).toBeNull();
  });
});

describe('resolveSharedRef — memory-modeled posture floor (makePosturePolicy)', () => {
  const postureOf = (c) => ({ A: 3, Public: 0, Trusted: 3, Secret: 5 }[c] ?? 0);

  it('recipient meets the posture floor → resolves; below floor → null', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'confidential', posture: 3 });
    // shared-ref carries the required posture (3).
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'Trusted', posture: 3 });

    // A recipient circle that meets the floor reads it…
    expect((await resolveSharedRef(stores, ref, { policy: makePosturePolicy({ postureOf, recipient: 'Trusted' }) })).text)
      .toBe('confidential');
    // …a less-confidential recipient is denied.
    expect(await resolveSharedRef(stores, ref, { policy: makePosturePolicy({ postureOf, recipient: 'Public' }) }))
      .toBeNull();
  });
});

describe('resolveSharedRef — backward compatibility', () => {
  it('no policy ⇒ resolves exactly as before', async () => {
    const stores = mkStores();
    const item = await stores.getStore('A').put({ type: 'task', text: 'plain' });
    const { ref } = await shareIntoAudience(stores, { itemId: item.id, fromCircleId: 'A', toCircleId: 'B' });
    expect((await resolveSharedRef(stores, ref)).text).toBe('plain');       // 2-arg call unchanged
    expect((await listShared(stores, 'B')).length).toBe(1);
    expect(await resolveSharedRef(stores, { type: 'task' })).toBeNull();    // invalid ref still null
  });
});

/* ── objective L — canonical share/revoke binder branch (share-as-grant, no copy) ────────────────── */

// A fake createCanonicalShare controller recording share/revoke calls (the pod-client crypto is out of scope
// here — item-store only orchestrates the per-recipient loop + roster bookkeeping).
function fakeCanonicalShare() {
  const shares = []; const revokes = [];
  return {
    shares, revokes,
    async share(args) { shares.push(args); return { keyResource: {}, resourceUri: 'u' }; },
    async revoke(args) { revokes.push(args); return { keyResource: {}, resourceUri: 'u' }; },
  };
}

describe('makeCircleShareEnforcement — canonical branch (objective L)', () => {
  it('WITHOUT canonicalShare: the binder shape is { onShare, policy, resealsInPlace } and no canonical hooks', () => {
    const enf = makeCircleShareEnforcement({ sharing: { grant() {}, list() {} }, resourceUriFor: () => 'u' });
    expect(Object.keys(enf).sort()).toEqual(['onShare', 'policy', 'resealsInPlace']);
    // the grant hook rewrites the source in place only with a re-sealer (a share asks the source a change then)
    expect(enf.resealsInPlace).toBe(false);
    expect(makeCircleShareEnforcement({ sharing: { grant() {}, list() {} }, resourceUriFor: () => 'u', seal: (x) => x }).resealsInPlace).toBe(true);
    expect(enf.onShareCanonical).toBeUndefined();
    expect(enf.revokeCanonical).toBeUndefined();
  });

  it('WITH canonicalShare: adds onShareCanonical + revokeCanonical, leaving onShare/policy intact', () => {
    const enf = makeCircleShareEnforcement({
      sharing: { grant() {}, list() {} }, resourceUriFor: () => 'u', canonicalShare: fakeCanonicalShare(),
    });
    expect(typeof enf.onShare).toBe('function');       // the four postures' hook — unchanged
    expect(typeof enf.policy.checkGrant).toBe('function');
    expect(typeof enf.onShareCanonical).toBe('function');
    expect(typeof enf.revokeCanonical).toBe('function');
  });
});

describe('makeCanonicalShareHook (objective L)', () => {
  it('onShare grants each recipient IN, seeding + accumulating the roster so origin members are not dropped', async () => {
    const canon = fakeCanonicalShare();
    const hook = makeCanonicalShareHook({ canonicalShare: canon, currentRecipients: () => ['origin-key'] });
    const ref = { type: 'shared-ref', sourceCircle: 'A', sourceId: 'x' };
    await hook.onShare({ ref, recipients: ['did:bob', 'did:carol'], recipientKeys: ['bob-key', 'carol-key'] });

    expect(canon.shares).toHaveLength(2);
    // First grant re-wraps to the origin roster + bob; second to origin + bob + carol (never drops earlier keys).
    expect(canon.shares[0]).toMatchObject({ recipient: 'did:bob', recipientKey: 'bob-key', currentRecipients: ['origin-key'], ref });
    expect(canon.shares[1]).toMatchObject({ recipient: 'did:carol', recipientKey: 'carol-key', currentRecipients: ['origin-key', 'bob-key'] });
  });

  it('onShare denies a keyless recipient (deny-by-default) and refuses a recipient-less share', async () => {
    const hook = makeCanonicalShareHook({ canonicalShare: fakeCanonicalShare() });
    await expect(hook.onShare({ ref: {}, recipients: ['did:bob'], recipientKeys: [] })).rejects.toThrow(/sealing public key/);
    await expect(hook.onShare({ ref: {}, recipients: [] })).rejects.toThrow(/at least one recipient/);
  });

  it('revoke rotates to the remaining recipients (defaulting to the origin roster) + ACP-revokes each departing WebID', async () => {
    const canon = fakeCanonicalShare();
    const hook = makeCanonicalShareHook({ canonicalShare: canon, currentRecipients: () => ['origin-key'] });
    const ref = { sourceCircle: 'A', sourceId: 'x' };
    await hook.revoke({ ref, recipient: 'did:bob' });                                  // default remaining = roster
    expect(canon.revokes[0]).toMatchObject({ recipient: 'did:bob', remainingRecipients: ['origin-key'], ref });

    await hook.revoke({ ref, recipients: ['did:bob'], remainingRecipients: ['k1', 'k2'] });  // explicit remaining
    expect(canon.revokes[1]).toMatchObject({ recipient: 'did:bob', remainingRecipients: ['k1', 'k2'] });
  });

  it('validates its injected controller', () => {
    expect(() => makeCanonicalShareHook({})).toThrow(/canonicalShare/);
    expect(() => makeCanonicalShareHook({ canonicalShare: { share() {} } })).toThrow(/share, revoke/);
  });
});
