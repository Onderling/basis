import { describe, it, expect, vi } from 'vitest';
import { rehydrateKringChatsFromStoop } from '../../src/v2/kringChatRehydrate.js';

function fakeEventLog() {
  const events = [];
  return { events, append: (e) => { events.push(e); } };
}

function item(over = {}) {
  return {
    id:    over.id ?? `it-${over.msgId ?? 'x'}`,
    type:  'kring-chat-message',
    text:  over.text ?? 'hello',
    source: {
      circleId:  over.circleId ?? 'g1',
      msgId:     over.msgId    ?? 'm1',
      ts:        over.ts       ?? 1735_000_000_000,
      fromActor: over.fromActor ?? 'webid:anne',
      ...over.source,
    },
  };
}

const silentLogger = { warn: () => {}, info: () => {}, debug: () => {} };

describe('rehydrateKringChatsFromStoop · SP-13.2.2 boot rehydrator', () => {
  it('returns an error shape when callSkill is missing', async () => {
    const r = await rehydrateKringChatsFromStoop({
      eventLog: fakeEventLog(), logger: silentLogger,
    });
    expect(r.error).toMatch(/callSkill/);
    expect(r.rehydrated).toBe(0);
  });

  it('returns an error shape when eventLog.append is missing', async () => {
    const r = await rehydrateKringChatsFromStoop({
      callSkill: async () => ({ items: [] }),
      logger: silentLogger,
    });
    expect(r.error).toMatch(/eventLog/);
  });

  it('projects each item into a chat-message event with the right shape', async () => {
    const eventLog = fakeEventLog();
    const callSkill = vi.fn(async () => ({ items: [
      item({ msgId: 'mA', text: 'first',  ts: 100 }),
      item({ msgId: 'mB', text: 'second', ts: 200 }),
    ] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, eventLog, logger: silentLogger });

    expect(callSkill).toHaveBeenCalledWith('stoop', 'listCircleChats', expect.any(Object));
    expect(r.rehydrated).toBe(2);
    expect(eventLog.events).toHaveLength(2);
    expect(eventLog.events[0].id).toBe('mA');
    expect(eventLog.events[0].app).toBe('kring');
    expect(eventLog.events[0].type).toBe('chat-message');
    expect(eventLog.events[0].ts).toBe(100);
    expect(eventLog.events[0].actor).toBe('webid:anne');
    expect(eventLog.events[0].payload).toMatchObject({
      circleId: 'g1', text: 'first', kind: 'chat-message',
    });
  });

  it('passes groupId / sinceTs / limit through to the skill', async () => {
    const callSkill = vi.fn(async () => ({ items: [] }));
    await rehydrateKringChatsFromStoop({
      callSkill, eventLog: fakeEventLog(),
      groupId: 'oosterpoort', sinceTs: 999, limit: 50, logger: silentLogger,
    });
    expect(callSkill.mock.calls[0][2]).toEqual({
      groupId: 'oosterpoort', sinceTs: 999, limit: 50,
    });
  });

  it('skips items already in the shared dedup set + populates dedup on append', async () => {
    const eventLog = fakeEventLog();
    const dedup = new Set(['mA']);
    const callSkill = vi.fn(async () => ({ items: [
      item({ msgId: 'mA' }),
      item({ msgId: 'mB' }),
    ] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, eventLog, dedup, logger: silentLogger });
    expect(r.rehydrated).toBe(1);
    expect(r.skipped).toBe(1);
    expect(dedup.has('mB')).toBe(true);
    expect(eventLog.events.map((e) => e.id)).toEqual(['mB']);
  });

  it('drops malformed items (counts them in skipped)', async () => {
    const eventLog = fakeEventLog();
    const callSkill = vi.fn(async () => ({ items: [
      item({ msgId: 'ok' }),
      { id: 'bad-no-source', type: 'kring-chat-message', text: 'oops' },                    // no source
      { id: 'bad-no-text',   type: 'kring-chat-message', source: { circleId: 'g', msgId: 'x', ts: 1 } }, // no text
      item({ msgId: '',  text: 'bad msgId' }),
      item({ circleId: '', msgId: 'no-circle' }),
    ] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, eventLog, logger: silentLogger });
    expect(r.rehydrated).toBe(1);
    expect(r.skipped).toBe(4);
    expect(eventLog.events).toHaveLength(1);
  });

  it('returns an error shape on callSkill failure without throwing', async () => {
    const callSkill = vi.fn(async () => { throw new Error('callSkill down'); });
    const r = await rehydrateKringChatsFromStoop({
      callSkill, eventLog: fakeEventLog(),
      logger: { warn: () => {}, info: () => {}, debug: () => {} },
    });
    expect(r.error).toBe('callSkill down');
    expect(r.rehydrated).toBe(0);
  });

  it('handles an empty result without appending anything', async () => {
    const eventLog = fakeEventLog();
    const callSkill = vi.fn(async () => ({ items: [] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, eventLog, logger: silentLogger });
    expect(r.rehydrated).toBe(0);
    expect(eventLog.events).toHaveLength(0);
  });

  /* ── ε.1 — inbox routing ── */

  it('routes through the inbox with source: rehydrator when an inbox is provided', async () => {
    const inboxCalls = [];
    const inbox = {
      ingestChatMessage: vi.fn(async (env, opts) => {
        inboxCalls.push({ env, opts });
        return { result: 'inserted' };
      }),
    };
    const callSkill = vi.fn(async () => ({ items: [
      item({ msgId: 'mA', text: 'a', ts: 1 }),
      item({ msgId: 'mB', text: 'b', ts: 2 }),
    ] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, inbox, logger: silentLogger });
    expect(r.rehydrated).toBe(2);
    expect(inbox.ingestChatMessage).toHaveBeenCalledTimes(2);
    expect(inboxCalls[0].opts.source).toBe('rehydrator');
    expect(inboxCalls[0].env).toMatchObject({
      subtype:  'kring-chat-message',
      circleId: 'g1',
      msgId:    'mA',
      text:     'a',
      ts:       1,
    });
  });

  it('carries a stored source.media onto the envelope — absent stays absent (media P1)', async () => {
    const inboxCalls = [];
    const inbox = {
      ingestChatMessage: vi.fn(async (env, opts) => { inboxCalls.push({ env, opts }); return { result: 'inserted' }; }),
    };
    const media = {
      kind: 'media-card', pointer: { type: 'media', ref: 'urn:dec:item:mr' },
      snapshot: { type: 'media', id: 'mr', source: { type: 'blob', ref: 'blob://kr', enc: { sealed: true } } },
    };
    const callSkill = vi.fn(async () => ({ items: [
      item({ msgId: 'plain', text: 'hoi', ts: 1 }),
      item({ msgId: 'photo', text: '📷 photo.jpg', ts: 2, source: { media } }),
    ] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, inbox, logger: silentLogger });
    expect(r.rehydrated).toBe(2);
    expect(inboxCalls[0].env).not.toHaveProperty('media');   // legacy item → legacy envelope
    expect(inboxCalls[1].env.media).toEqual(media);          // chip survives the reload
  });

  it('counts inbox-deduped items as skipped (not rehydrated)', async () => {
    const inbox = {
      ingestChatMessage: vi.fn(async () => ({ result: 'deduped' })),
    };
    const callSkill = vi.fn(async () => ({ items: [
      item({ msgId: 'mA' }), item({ msgId: 'mB' }),
    ] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, inbox, logger: silentLogger });
    expect(r.rehydrated).toBe(0);
    expect(r.skipped).toBe(2);
  });

  /* ── the relaunch journey: my own history must come back as MINE ── */

  it('re-attributes MY stored messages to me on a relaunch, and leaves the others alone', async () => {
    // End-to-end over the real pieces the boot path wires: stoop's stored items → the strict
    // envelope projection → the real inbox → the real per-circle self-check. Before the fix every
    // one of these events came back with `actor: 'webid:me'`, so a relaunch rendered your own side
    // of the conversation left-aligned, sender-labelled and reportable.
    const { createChatMessageInbox } = await import('../../src/v2/chatMessageInbox.js');
    const { createSelfAuthorCheck } = await import('../../src/v2/chatSelfAuthor.js');
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({
      eventLog,
      isSelfAuthored: createSelfAuthorCheck({
        whoAmI: async () => ({ webid: 'webid:me', pubKey: 'pk-me' }),
        circleAddressFor: (cid) => (cid === 'g1' ? 'addr-in-g1' : null),
      }),
      logger: silentLogger,
    });
    const callSkill = vi.fn(async () => ({ items: [
      item({ msgId: 'm1', text: 'hoi allemaal', fromActor: 'webid:anne' }),
      item({ msgId: 'm2', text: 'zie ik je zaterdag?', fromActor: 'webid:me' }),     // stoop's local mirror
      item({ msgId: 'm3', text: 'en zondag ook', fromActor: 'addr-in-g1' }),         // per-circle address
    ] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, inbox, logger: silentLogger });

    expect(r.rehydrated).toBe(3);
    expect(eventLog.events.map((e) => e.actor)).toEqual(['webid:anne', 'me', 'me']);
    // …and my own bubbles carry no sender name, exactly like the live optimistic append.
    expect(eventLog.events[1].payload).not.toHaveProperty('senderDisplay');
    expect(eventLog.events[2].payload).not.toHaveProperty('senderDisplay');
    expect(eventLog.events[0].payload.senderDisplay).toBe('webid:anne');
  });

  it('a MIGRATED message never double-renders when its signed statement later arrives at the rail', async () => {
    // The migration inserts store-era entries WITHOUT statements (id = msgId). If the same message later
    // arrives on the signed path (a peer's catch-up serving pre-cutover history it re-signed on send, or
    // an overlap during the cutover window), the rail's id-replace lands the SIGNED copy over the
    // migrated one — one bubble, upgraded with its proof, never two.
    const { createChatMessageInbox } = await import('../../src/v2/chatMessageInbox.js');
    const { makeChatRail } = await import('../../src/v2/chatRail.js');
    const { EventLog } = await import('../../src/eventLog.js');
    const { AgentIdentity } = await import('@onderling/core');
    const { VaultMemory } = await import('@onderling/vault');

    const eventLog = new EventLog({ initial: [] });
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const callSkill = vi.fn(async () => ({ items: [ item({ msgId: 'mShared', text: 'rehydrated' }) ] }));
    const r = await rehydrateKringChatsFromStoop({ callSkill, inbox, logger: silentLogger });
    expect(r.rehydrated).toBe(1);

    const senderCid = await AgentIdentity.generate(new VaultMemory());
    const sender = makeChatRail({
      eventLog: new EventLog({ initial: [] }),
      circleIdentityFor: async () => senderCid, myRef: 'webid:anne',
      callSkill: async () => ({}), verifyBinding: async () => true,
    });
    const { statement } = await sender.appendMessage('g1', { msgId: 'mShared', ts: 9999, text: 'rehydrated' });

    const receiverCid = await AgentIdentity.generate(new VaultMemory());
    const rail = makeChatRail({
      eventLog, circleIdentityFor: async () => receiverCid, myRef: 'webid:bob',
      callSkill: async () => ({}), verifyBinding: async ({ author }) => author === senderCid.pubKey,
    });
    const res = await rail.ingest('g1', statement);
    expect(res.ok).toBe(true);

    const entries = eventLog.query({}).filter((e) => e.id === 'mShared');
    expect(entries).toHaveLength(1);                          // one bubble
    expect(entries[0].payload.statement?.sig).toBeTruthy();   // …upgraded with its proof
  });
});
