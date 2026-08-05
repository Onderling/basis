/**
 * Concurrent canonical grants — story 1.5 of `plans/NOTE-multi-device-user-stories.md`.
 *
 * Two ADMINS grant access to the same item in the same window. Each does read → `grantMember` → write on the
 * one group-key resource, with no compare-and-swap between them, so the second write is computed from a base
 * that predates the first: a textbook LOST UPDATE. Story 1.1 covered the SEQUENTIAL case (fixed by widening
 * the grant base); this is the multi-writer case that widening cannot reach, because the first grant isn't in
 * the resource yet when the second one reads it.
 *
 * Cast: Anna + Bram (both admins) · Cato + Dirk (the two grantees).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createCanonicalShare, generateKeypair, unwrapGroupKey, buildGroupKeyResource, generateGroupKey,
} from '@onderling/pod-client';

const canOpen = (resource, privateKey) => {
  try { return !!unwrapGroupKey(resource, privateKey); } catch { return false; }
};

function twoAdmins() {
  const anna = generateKeypair();
  const bram = generateKeypair();
  let stored = buildGroupKeyResource({
    version: 1, groupKey: generateGroupKey(), recipients: [anna.publicKey, bram.publicKey],
  });
  const keyStore = { read: async () => stored, write: async (r) => { stored = r; } };
  const sharing = { grant: vi.fn(async () => {}), revoke: vi.fn(async () => {}) };
  return {
    anna, bram,
    current: () => stored,
    annaShare: createCanonicalShare({ sharing, keyStore, controllerKey: anna, resourceUri: 'https://pod/x/item' }),
    bramShare: createCanonicalShare({ sharing, keyStore, controllerKey: bram, resourceUri: 'https://pod/x/item' }),
  };
}

describe('1.5 — two admins grant the same item concurrently', () => {
  it('SEQUENTIAL grants both survive (the base-widening fix; the regression anchor)', async () => {
    const h = twoAdmins();
    const cato = generateKeypair();
    const dirk = generateKeypair();

    // Each grant reads the CURRENT recipients — the sequential case story 1.1 fixed.
    await h.annaShare.share({ recipient: 'cato', recipientKey: cato.publicKey, currentRecipients: h.current().recipients });
    await h.bramShare.share({ recipient: 'dirk', recipientKey: dirk.publicKey, currentRecipients: h.current().recipients });

    expect(canOpen(h.current(), cato.privateKey)).toBe(true);
    expect(canOpen(h.current(), dirk.privateKey)).toBe(true);
    expect(canOpen(h.current(), h.anna.privateKey)).toBe(true);
    expect(canOpen(h.current(), h.bram.privateKey)).toBe(true);
  });

  // ✅ FIXED 2026-07-26 (Frits's call: CAS detects the race, the union resolves it). Re-reading before the
  // write was NOT enough — both callers can re-read before either writes (TOCTOU), which is how this
  // reproduced. The grant critical section is now serialised per KEY STORE, and each attempt recomputes on
  // the newest base, so a grant is a pure union and none can be lost.
  it('CONCURRENT grants both survive — neither admin\'s grantee is lost', async () => {
    const h = twoAdmins();
    const cato = generateKeypair();
    const dirk = generateKeypair();
    const base = h.current().recipients;          // both admins read the same base — the concurrency window

    await Promise.all([
      h.annaShare.share({ recipient: 'cato', recipientKey: cato.publicKey, currentRecipients: base }),
      h.bramShare.share({ recipient: 'dirk', recipientKey: dirk.publicKey, currentRecipients: base }),
    ]);

    expect(canOpen(h.current(), cato.privateKey)).toBe(true);   // ← lost today: last write wins
    expect(canOpen(h.current(), dirk.privateKey)).toBe(true);
  });

  it('a whole batch of concurrent grants all survive (the queue is not just a two-way fix)', async () => {
    const h = twoAdmins();
    const peers = [generateKeypair(), generateKeypair(), generateKeypair(), generateKeypair()];
    const base = h.current().recipients;

    await Promise.all(peers.map((p, i) => (i % 2 ? h.bramShare : h.annaShare)
      .share({ recipient: `p${i}`, recipientKey: p.publicKey, currentRecipients: base })));

    for (const p of peers) expect(canOpen(h.current(), p.privateKey)).toBe(true);
    expect(canOpen(h.current(), h.anna.privateKey)).toBe(true);
    expect(canOpen(h.current(), h.bram.privateKey)).toBe(true);
  });

  it('the members are never harmed by a concurrent grant', async () => {
    const h = twoAdmins();
    const cato = generateKeypair();
    await h.annaShare.share({ recipient: 'cato', recipientKey: cato.publicKey, currentRecipients: h.current().recipients });
    expect(canOpen(h.current(), h.anna.privateKey)).toBe(true);
    expect(canOpen(h.current(), h.bram.privateKey)).toBe(true);
  });
});

describe('1.5 — revoke wins over a racing grant, and a concurrent grant SURVIVES', () => {
  // grant+grant = union (above). grant+revoke = REVOKE WINS: a grant unions from the AUTHORITATIVE stored
  // resource, and a revoke — given the REVOKED keys — rotates to the LIVE set MINUS them, inside the same
  // serialized-CAS section. So the revoked subject is out regardless of interleaving, AND a concurrent grant
  // (Eve) that landed meanwhile is PRESERVED (it stays in the live set). Cast: Anna admin · Cato (revoked) ·
  // Eve (a concurrent grantee).
  function oneAdmin() {
    const anna = generateKeypair();
    let stored = buildGroupKeyResource({ version: 1, groupKey: generateGroupKey(), recipients: [anna.publicKey] });
    const keyStore = { read: async () => stored, write: async (r) => { stored = r; } };
    const sharing = { grant: vi.fn(async () => {}), revoke: vi.fn(async () => {}) };
    return {
      anna, current: () => stored,
      share: createCanonicalShare({ sharing, keyStore, controllerKey: anna, resourceUri: 'https://pod/x/item' }),
    };
  }

  it('a later grant with a STALE snapshot cannot re-add a revoked recipient (the re-add hole)', async () => {
    const h = oneAdmin();
    const cato = generateKeypair();
    const eve = generateKeypair();

    await h.share.share({ recipient: 'cato', recipientKey: cato.publicKey, currentRecipients: h.current().recipients });
    expect(canOpen(h.current(), cato.privateKey)).toBe(true);
    const staleSnapshot = h.current().recipients;                 // includes Cato — the snapshot a caller might reuse
    await h.share.revoke({ recipient: 'cato', revokedKeys: [cato.publicKey] });
    expect(canOpen(h.current(), cato.privateKey)).toBe(false);    // rotated out

    // Grant Eve, passing the STALE snapshot that still lists Cato. Cato must NOT come back.
    await h.share.share({ recipient: 'eve', recipientKey: eve.publicKey, currentRecipients: staleSnapshot });
    expect(canOpen(h.current(), eve.privateKey)).toBe(true);      // Eve granted
    expect(canOpen(h.current(), h.anna.privateKey)).toBe(true);   // Anna kept
    expect(canOpen(h.current(), cato.privateKey)).toBe(false);    // ← revoke wins: Cato is NOT re-added
  });

  it('revoke ∥ grant — Cato is OUT and the concurrent grantee Eve SURVIVES, regardless of interleaving', async () => {
    const h = oneAdmin();
    const cato = generateKeypair();
    const eve = generateKeypair();
    await h.share.share({ recipient: 'cato', recipientKey: cato.publicKey, currentRecipients: h.current().recipients });
    const base = h.current().recipients;                          // both ops read this base

    await Promise.all([
      h.share.revoke({ recipient: 'cato', revokedKeys: [cato.publicKey] }),
      h.share.share({ recipient: 'eve', recipientKey: eve.publicKey, currentRecipients: base }),
    ]);

    expect(canOpen(h.current(), cato.privateKey)).toBe(false);    // ← revoke wins in either interleaving
    expect(canOpen(h.current(), eve.privateKey)).toBe(true);      // ← the concurrent grant is PRESERVED
    expect(canOpen(h.current(), h.anna.privateKey)).toBe(true);
  });

  it('TWO DEVICES over a compare-and-swap backend — revoke wins, Eve survives (the cross-device story)', async () => {
    // Two devices hold SEPARATE key stores over ONE shared, CAS-capable backend — so they are NOT serialised
    // in-process; they genuinely race and resolve through `writeIfUnchanged`. Device A revokes Cato while
    // device B grants Eve, at the same instant.
    const anna = generateKeypair();
    let stored = buildGroupKeyResource({ version: 1, groupKey: generateGroupKey(), recipients: [anna.publicKey] });
    const makeStore = () => ({
      read: async () => stored,
      write: async (r) => { stored = r; },
      writeIfUnchanged: async (next, prev) => { if (stored !== prev) return false; stored = next; return true; },
    });
    const sharing = () => ({ grant: vi.fn(async () => {}), revoke: vi.fn(async () => {}) });
    const deviceA = createCanonicalShare({ sharing: sharing(), keyStore: makeStore(), controllerKey: anna, resourceUri: 'https://pod/x/item' });
    const deviceB = createCanonicalShare({ sharing: sharing(), keyStore: makeStore(), controllerKey: anna, resourceUri: 'https://pod/x/item' });

    const cato = generateKeypair();
    const eve = generateKeypair();
    await deviceA.share({ recipient: 'cato', recipientKey: cato.publicKey, currentRecipients: stored.recipients });

    await Promise.all([
      deviceA.revoke({ recipient: 'cato', revokedKeys: [cato.publicKey] }),
      deviceB.share({ recipient: 'eve', recipientKey: eve.publicKey, currentRecipients: stored.recipients }),
    ]);

    expect(canOpen(stored, cato.privateKey)).toBe(false);         // revoke wins across devices
    expect(canOpen(stored, eve.privateKey)).toBe(true);           // the concurrent cross-device grant survives
    expect(canOpen(stored, anna.privateKey)).toBe(true);
  });
});
