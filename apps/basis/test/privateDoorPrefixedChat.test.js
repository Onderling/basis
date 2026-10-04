/**
 * The person's PRIVATE door, as the box sees it: the box answers Telegram and its inbox with one runner, and the
 * multiplexer prefixes every chat id with its door (`telegram::42`). The private-chat checks compared that with the
 * person's Telegram id (`42`) and never matched — on the real box the screen's code, `/koppel`, the step-up yes and
 * `/kring` all said "not in your own chat" in the person's own chat (Frits, 2026-10-04). Tests composed without the
 * multiplexer never saw the prefix. A group (`telegram::-100777`) and another door's chat (`web::42`) stay not private.
 */
import { describe, it, expect } from 'vitest';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotUsers } from '../src/v2/botUsers.js';
import { createBotCircles } from '../src/v2/botCircles.js';
import { multiplexBridges } from '../src/v2/doorBridges.js';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
const ADMIN = 'telegram:42';
const invite = `onderling-invite://${Buffer.from(JSON.stringify({ groupId: 'circle-1', code: 'C0DE', name: 'Huize Rood' })).toString('base64url')}`;

function memStore() {
  const m = new Map();
  return { get: async (id) => m.get(id) ?? null, put: async (row) => { m.set(row.id, { ...row }); return row; }, list: async () => [...m.values()], hide: async () => {}, remove: async (id) => { m.delete(id); } };
}

async function door() {
  const users = createBotUsers({ store: memStore() });
  await users.admit({ channel: 'telegram', uid: '42', displayName: 'Frits' });
  const asked = [];
  const screens = {
    confirm: async (person, answer, { isPrivate }) => (isPrivate ? { ok: true } : { ok: false, reason: 'not-private' }),
  };
  const circles = createBotCircles({
    store: memStore(), join: async () => ({ ok: true, circleId: 'circle-1' }), leave: async () => ({ ok: true }), forget: async () => ({ ok: true }),
    ask: async (person, q) => { asked.push(q); return { ok: true }; }, handle: () => 'huisbot-van-frits',
  });
  const call = withAssistantOps({ callSkill: async () => ({}), t, threads: { langOf: () => null }, admin: { users: async () => users.list(), screens, circles } });
  return { call, asked };
}

// the chat ids exactly as the box's multiplexer hands them on
let seen = null;
const mux = multiplexBridges([{ id: 'telegram', start: async () => {}, stop: async () => {}, onMessage: (h) => { seen = h; } }]);
const chatIdsAsTheBoxHasThem = async (chatId) => { let out = null; mux.onMessage((m) => { out = m.chatId; }); seen({ chatId, text: 'x' }); return out; };

describe('the private door through the box\'s multiplexer', () => {
  it('the person\'s own Telegram chat, prefixed by its door, is private: the screen code and /kring are taken', async () => {
    const own = await chatIdsAsTheBoxHasThem('42');
    expect(own).toBe('telegram::42');
    const d = await door();
    expect((await d.call('assistant', 'assistant-screen-confirm', { answer: 'ABCD' }, { caller: ADMIN, threadId: ADMIN, chatId: own })).ok).toBe(true);
    expect((await d.call('assistant', 'assistant-circle', { spec: invite }, { caller: ADMIN, threadId: ADMIN, chatId: own })).ok).toBe(true);
    expect(d.asked).toHaveLength(1);
  });

  it('a group, or another door\'s chat with the same digits, is not', async () => {
    const d = await door();
    for (const chatId of [await chatIdsAsTheBoxHasThem('-100777'), 'web::42', 'telegram::420']) {
      const r = await d.call('assistant', 'assistant-screen-confirm', { answer: 'ABCD' }, { caller: ADMIN, threadId: ADMIN, chatId });
      expect(r.ok, chatId).toBe(false);
    }
  });
});
