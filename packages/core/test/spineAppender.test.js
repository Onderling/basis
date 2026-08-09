/**
 * spineAppender — the WRITE side of membership-on-the-log. It sources an author's own parentHash frontier from
 * the store, signs the transition, and appends it under the spine item type — the inverse of verifySpine +
 * foldRoster. These tests pin the frontier chaining, the foldability of what it writes, and the one guard: a
 * leave it cannot self-author is never persisted (the fold would discard it).
 */
import { describe, it, expect } from 'vitest';
import { createSpineAppender, SPINE_STATEMENT_ITEM } from '../src/security/spineAppender.js';
import { verifySpine } from '../src/security/spineStatement.js';
import { foldRoster } from '../src/security/rosterFold.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';

/** A tiny in-memory circle store (duck-typed: addItems/listOpen), like the writers use. */
function memStore() {
  let seq = 0; const items = [];
  return {
    items,
    async addItems(parts, ctx = {}) {
      const made = parts.map((p) => ({ id: `i${++seq}`, addedBy: ctx.actor ?? null, ...p }));
      items.push(...made); return made;
    },
    async listOpen(filter = {}) { return items.filter((i) => !filter.type || i.type === filter.type); },
  };
}

describe('createSpineAppender — put a signed spine statement on the circle log', () => {
  it('chains each of an author\'s statements to their OWN frontier (parentHash) — null for the first', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const append = createSpineAppender({ store: memStore(), signer: id });
    const first  = await append({ kind: 'join',  circleId: 'c', subject: id.pubKey });
    const second = await append({ kind: 'leave', circleId: 'c', subject: id.pubKey });
    expect(first.body.parentHash).toBe(null);
    expect(second.body.parentHash).toBe(first.body.hash);   // frontier sourced from the store
  });

  it('sources the CROSS-AUTHOR frontier into deps — a concurrent other-author tip in the store, then a merge', async () => {
    const a = await AgentIdentity.generate(new VaultMemory());
    const b = await AgentIdentity.generate(new VaultMemory());
    const store = memStore();                                   // ONE shared circle store
    const appendA = createSpineAppender({ store, signer: a });
    const appendB = createSpineAppender({ store, signer: b });
    const sA = await appendA({ kind: 'join', circleId: 'c', subject: a.pubKey });
    expect(sA.body.parentHash).toBe(null);
    expect('deps' in sA.body).toBe(false);                      // A is the only writer → single-parent, no deps

    // B appends having seen A's statement in the store → A's head is B's cross-author frontier.
    const sB = await appendB({ kind: 'join', circleId: 'c', subject: b.pubKey });
    expect(sB.body.parentHash).toBe(null);                      // B's own first (own chain independent of A)
    expect(sB.body.deps).toEqual([sA.body.hash]);               // …but it references A's tip as a seen dep

    // A writes again: two live tips now (sA, sB) → A extends its own (parentHash) and MERGES B's tip into deps.
    const sA2 = await appendA({ kind: 'evict', circleId: 'c', subject: b.pubKey });
    expect(sA2.body.parentHash).toBe(sA.body.hash);             // A's own head advances
    expect(sA2.body.deps).toEqual([sB.body.hash]);              // the merge collapses the concurrent tip
  });

  it('appends a VERIFIABLE, foldable statement under the spine item type', async () => {
    const founder = await AgentIdentity.generate(new VaultMemory());
    const mel     = await AgentIdentity.generate(new VaultMemory());
    const store = memStore();
    await createSpineAppender({ store, signer: mel })({ kind: 'join', circleId: 'c', subject: mel.pubKey });
    const items = await store.listOpen({ type: SPINE_STATEMENT_ITEM });
    expect(items).toHaveLength(1);
    expect(items[0].source.groupId).toBe('c');
    const v = verifySpine(items[0].source.statement, { expectedCircleId: 'c' });
    expect(v.ok).toBe(true);
    expect(foldRoster([v.body], { founders: [founder.pubKey] }).members).toContain(mel.pubKey);
  });

  it('refuses to persist a LEAVE it cannot self-author (a leave must have author === subject)', async () => {
    const admin = await AgentIdentity.generate(new VaultMemory());
    const store = memStore();
    const out = await createSpineAppender({ store, signer: admin })({ kind: 'leave', circleId: 'c', subject: 'someone-else' });
    expect(out).toBe(null);
    expect(await store.listOpen({ type: SPINE_STATEMENT_ITEM })).toHaveLength(0);
  });

  it('rejects a missing store or signer at bind time', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    expect(() => createSpineAppender({ store: null, signer: id })).toThrow();
    expect(() => createSpineAppender({ store: memStore(), signer: {} })).toThrow();
  });
});
