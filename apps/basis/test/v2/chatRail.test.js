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
  it('a local line that never fanned (no statement) has nothing to check and passes', async () => {
    const { rail, entry } = await railWithOne();
    const { statement: _s, ...local } = entry.payload;
    expect(rail.checkEntry({ ...entry, payload: local })).toBe(true);
  });
});
