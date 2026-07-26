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

  // ⚠ KNOWN GAP (found 2026-07-26 by this story — see REMAINING-WORK). `it.fails` asserts the test below
  // currently FAILS: with both admins reading the SAME base before either writes, the later write is computed
  // without the earlier grantee and silently overwrites it — the first grantee never gets access, with no
  // error on either side. Widening the grant base cannot fix this (the first grant isn't in the resource yet
  // when the second reads); it needs real concurrency control. When that lands, this flips to passing and
  // `.fails` must be dropped.
  it.fails('CONCURRENT grants both survive — neither admin\'s grantee is lost', async () => {
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

  it('documents the CURRENT behaviour: exactly one grantee survives, the members are never harmed', async () => {
    const h = twoAdmins();
    const cato = generateKeypair();
    const dirk = generateKeypair();
    const base = h.current().recipients;

    await Promise.all([
      h.annaShare.share({ recipient: 'cato', recipientKey: cato.publicKey, currentRecipients: base }),
      h.bramShare.share({ recipient: 'dirk', recipientKey: dirk.publicKey, currentRecipients: base }),
    ]);

    // The failure is a silent LOST GRANT, not corruption: one grantee lands, the circle keeps its own access.
    const survivors = [cato, dirk].filter((g) => canOpen(h.current(), g.privateKey));
    expect(survivors).toHaveLength(1);
    expect(canOpen(h.current(), h.anna.privateKey)).toBe(true);
    expect(canOpen(h.current(), h.bram.privateKey)).toBe(true);
  });
});
