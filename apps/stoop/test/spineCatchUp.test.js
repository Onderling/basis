import { describe, it, expect } from 'vitest';
import { AgentIdentity, signSpine, verifySpine, SPINE_STATEMENT_ITEM } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { ingestSpineItems } from '../src/lib/spineCatchUp.js';
import { deriveRoster } from '../src/lib/deriveRoster.js';

// A minimal id-preserving, idempotent circle store (put dedups by id; listOpen filters by type) — the exact
// contract ingestSpineItems relies on, matching CircleItemStore's id-preserving put.
function fakeStore() {
  const byId = new Map();
  return {
    async put(item) { if (item?.id) byId.set(item.id, item); return item; },
    async listOpen({ type } = {}) { return [...byId.values()].filter((i) => !type || i.type === type); },
  };
}

const CIRCLE = 'circle:c';
const spineItemFor = (stmt, kind, subject, author) => ({
  id: `spine:${stmt.body.hash}`,
  type: SPINE_STATEMENT_ITEM,
  source: { groupId: CIRCLE, kind, subject, author, hash: stmt.body.hash, statement: stmt },
});

describe('C — spine catch-up: fetch-shape → ingest → store → fold', () => {
  it('an offline device pulls an eviction, ingests it id-preserving, and the roster fold drops the member', async () => {
    const admin = await AgentIdentity.generate(new VaultMemory());   // founder
    const mel   = await AgentIdentity.generate(new VaultMemory());   // the member who gets evicted
    const redemptions  = [{ source: { groupId: CIRCLE, redeemedBy: mel.pubKey, redeemedAt: 1000 } }];
    const founderWebids = [admin.pubKey];

    // Before catch-up: this device sees mel as a member (trail), no spine yet.
    const before = deriveRoster({ redemptions, founderWebids });
    expect(before.map((r) => r.webid)).toContain(mel.pubKey);

    // The admin evicted mel while this device was offline. Catch-up pulls the statement (getSpineSince shape).
    const evict   = signSpine(admin, { kind: 'evict', circleId: CIRCLE, subject: mel.pubKey });
    const fetched = [spineItemFor(evict, 'evict', mel.pubKey, admin.pubKey)];

    const store = fakeStore();
    expect(await ingestSpineItems({ store, items: fetched })).toBe(1);
    expect(await ingestSpineItems({ store, items: fetched })).toBe(1);   // idempotent re-pull
    const stored = await store.listOpen({ type: SPINE_STATEMENT_ITEM });
    expect(stored).toHaveLength(1);                                       // id-preserving: no duplicate

    // The roster read verifies + folds the ingested spine → mel dropped (strengthen-only), admin (founder) stays.
    const verified = stored
      .map((it) => verifySpine(it.source.statement, { expectedCircleId: CIRCLE }))
      .filter((v) => v.ok).map((v) => v.body);
    const after = deriveRoster({ redemptions, founderWebids, spineStatements: verified });
    expect(after.map((r) => r.webid)).not.toContain(mel.pubKey);
    expect(after.map((r) => r.webid)).toContain(admin.pubKey);
  });

  it('a statement for a DIFFERENT circle is verified-and-ignored (never corrupts this roster)', async () => {
    const admin = await AgentIdentity.generate(new VaultMemory());
    const mel   = await AgentIdentity.generate(new VaultMemory());
    // An evict signed for ANOTHER circle — expectedCircleId gate must reject it on read.
    const foreign = signSpine(admin, { kind: 'evict', circleId: 'circle:other', subject: mel.pubKey });
    const store = fakeStore();
    await ingestSpineItems({ store, items: [spineItemFor(foreign, 'evict', mel.pubKey, admin.pubKey)] });
    const verified = (await store.listOpen({ type: SPINE_STATEMENT_ITEM }))
      .map((it) => verifySpine(it.source.statement, { expectedCircleId: CIRCLE }))
      .filter((v) => v.ok).map((v) => v.body);
    expect(verified).toHaveLength(0);   // wrong circle → not folded
    const roster = deriveRoster({
      redemptions: [{ source: { groupId: CIRCLE, redeemedBy: mel.pubKey, redeemedAt: 1000 } }],
      founderWebids: [admin.pubKey], spineStatements: verified,
    });
    expect(roster.map((r) => r.webid)).toContain(mel.pubKey);   // still a member — foreign spine ignored
  });

  it('ignores malformed / wrong-type items defensively', async () => {
    const store = fakeStore();
    const n = await ingestSpineItems({ store, items: [null, { id: 'x', type: 'chat-message' }, { type: SPINE_STATEMENT_ITEM }] });
    expect(n).toBe(0);
  });
});
