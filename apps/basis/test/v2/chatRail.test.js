import { describe, it, expect } from 'vitest';

describe('owedChatStatements — the outbox as a projection of the one log', () => {
  const CHAT = 'chat-message';
  const stmt = (authorRef) => ({ body: { payload: { authorRef } }, sig: 'sig' });
  const entry = (id, circleId, authorRef, ts) => ({
    id, type: CHAT, ts, payload: { circleId, statement: stmt(authorRef) },
  });

  it('selects my own, recent, unreceipted statements — oldest first; everything else is excluded', async () => {
    const { owedChatStatements } = await import('../../src/v2/chatRail.js');
    const now = Date.now();
    const log = { query: () => [
      entry('m-2', 'c-1', 'me-ref', now - 1000),                       // owed (newer)
      entry('m-1', 'c-1', 'me-ref', now - 2000),                      // owed (older)
      entry('m-receipted', 'c-1', 'me-ref', now - 3000),              // confirmed → not owed
      entry('m-foreign', 'c-1', 'their-ref', now - 1000),             // not mine
      entry('m-elsewhere', 'c-2', 'me-ref', now - 1000),              // another circle
      entry('m-ancient', 'c-1', 'me-ref', now - 48 * 3600 * 1000),    // the hold promise expired
      { type: 'delivery-state', ts: now - 500, payload: { msgId: 'm-receipted', state: 'stored', from: 'addr-b' } },
    ] };
    const owed = owedChatStatements({ eventLog: log, circleId: 'c-1', myRef: 'me-ref' });
    expect(owed.map((o) => o.msgId)).toEqual(['m-1', 'm-2']);
    expect(owed[0].statement.body.payload.authorRef).toBe('me-ref');
  });

  it('degrades to [] on a missing log / circle / ref — the re-fan is never the thing that breaks boot', async () => {
    const { owedChatStatements } = await import('../../src/v2/chatRail.js');
    expect(owedChatStatements({})).toEqual([]);
    expect(owedChatStatements({ eventLog: { query: () => { throw new Error('x'); } }, circleId: 'c', myRef: 'r' })).toEqual([]);
  });
});

describe('checkEntry — a stored chat line judged as an arrival (what a history restore runs)', () => {
  async function railWithOne() {
    const { makeChatRail } = await import('../../src/v2/chatRail.js');
    const { AgentIdentity } = await import('@onderling/core');
    const { VaultMemory } = await import('@onderling/vault');
    const { EventLog } = await import('../../src/eventLog.js');
    const identity = await AgentIdentity.generate(new VaultMemory());
    const log = new EventLog({ initial: [], muted: [] });
    const rail = makeChatRail({ eventLog: log, circleIdentityFor: async () => identity, myRef: identity.pubKey, callSkill: async () => null });
    const { entry } = await rail.appendMessage('c-1', { msgId: 'm-1', ts: Date.now(), text: 'hallo' });
    return { rail, entry };
  }

  it('a signed line whose text is the signed text passes; the lane is named', async () => {
    const { rail, entry } = await railWithOne();
    expect(rail.entryKind).toBe('chat-message');
    expect(rail.checkEntry(entry)).toBe(true);
  });
  it('a signed line whose shown text was changed is refused', async () => {
    const { rail, entry } = await railWithOne();
    expect(rail.checkEntry({ ...entry, payload: { ...entry.payload, text: 'iets anders' } })).toBe(false);
  });
  it('a line whose statement was changed is refused', async () => {
    const { rail, entry } = await railWithOne();
    const st = entry.payload.statement;
    const forged = { ...st, body: { ...st.body, payload: { ...st.body.payload, text: 'iets anders' } } };
    expect(rail.checkEntry({ ...entry, payload: { ...entry.payload, text: 'iets anders', statement: forged } })).toBe(false);
  });
  it("a local line that never fanned (no statement) passes when it is this person's own or the local bot's", async () => {
    const { rail, entry } = await railWithOne();
    const { statement: _s, ...local } = entry.payload;
    expect(rail.checkEntry({ ...entry, actor: 'me', payload: local })).toBe(true);     // the shells' own optimistic line
    expect(rail.checkEntry({ ...entry, actor: 'bot', payload: local })).toBe(true);    // a local bot bubble or notice
    expect(rail.checkEntry({ ...entry, payload: local })).toBe(true);                  // this device's self in the circle
  });
  it('an unsigned line naming ANOTHER member is refused: it would show as their message', async () => {
    const { rail, entry } = await railWithOne();
    const { statement: _s, ...local } = entry.payload;
    expect(rail.checkEntry({ ...entry, actor: 'b'.repeat(64), payload: local })).toBe(false);
    expect(rail.checkEntry({ ...entry, actor: undefined, payload: local })).toBe(false);
  });
});

describe('makePodChatCatchUp — reads what the shared pod custody hands it', () => {
  // The shells hand `circlePodReadSince` (circlePodCustody.js), which answers `{items, truncated}`; the catch-up
  // iterated the answer as an array, so on a pod-only circle it threw before ingesting a single row.
  const row = (msgId) => ({ event: { body: { payload: { msgId } }, sig: 'sig' } });
  it("ingests every row of the custody's {items, truncated}", async () => {
    const { makePodChatCatchUp } = await import('../../src/v2/chatRail.js');
    const ingested = [];
    const rail = { ingest: async (cid, st) => { ingested.push(st.body.payload.msgId); return { ok: true }; } };
    const up = makePodChatCatchUp({ rail, podReadSince: async () => ({ items: [row('m1'), row('m2')], truncated: false }), eventLog: { query: () => [] } });
    const r = await up.catchUpCircle('c1');
    expect(ingested).toEqual(['m1', 'm2']);
    expect(r.ingested).toBe(2);
  });

  it('after a long absence it reads EVERY row on the pod, not only the freshest page', async () => {
    // over the real sealed log: 201 rows, one more than the reader's page
    const { MemoryStorageBackend } = await import('@onderling/core');
    const { writeSealedMessage, readSealedMessagesSince } = await import('@onderling/pod-client');
    const { makePodChatCatchUp } = await import('../../src/v2/chatRail.js');
    const backend = new MemoryStorageBackend();
    for (let i = 0; i < 201; i += 1) {
      await writeSealedMessage(backend, null, { circleId: 'c1', msgId: `m${i}`, ts: 1_000 + i, event: { body: { payload: { msgId: `m${i}` } }, sig: 'sig' } });
    }
    const ingested = new Set();
    const rail = { ingest: async (cid, st) => { const id = st.body.payload.msgId; const existed = ingested.has(id); ingested.add(id); return { ok: true, existed }; } };
    const up = makePodChatCatchUp({ rail, podReadSince: (cid, q) => readSealedMessagesSince(backend, null, { circleId: cid, ...q }), eventLog: { query: () => [] } });
    const r = await up.catchUpCircle('c1');
    expect(ingested.size, 'rows the catch-up never read').toBe(201);
    expect(r.ingested).toBe(201);
  });
});
