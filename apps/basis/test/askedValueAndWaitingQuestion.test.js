/**
 * From Frits' first chat with the real bot (2026-10-02):
 *  - `/herinneringen` alone asked "Wat is je mode?" with buttons labelled `circle.telegram.list_on`;
 *  - after that, "Halloo 🥬🍅🥑🥒" (sent later, across a restart) was taken as the answer and refused with the usage line.
 * Now a person's switch without a value shows how it stands with a button per value; a question asked for a missing
 * enum value labels its buttons with words, never keys; and a waiting question takes only one of its values — anything
 * else drops the question and the line goes on as usual. Through the real Telegram runner.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { mergeManifests } from '../src/index.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { EventLog } from '../src/eventLog.js';
import nl from '../src/locales/circle.nl.json' with { type: 'json' };

const tr = (k, p) => { const v = k.split('.').slice(1).reduce((o, x) => o?.[x], nl); const s = typeof v === 'string' ? v : (v?.text ?? k); return s.replace(/\{\{(\w+)\}\}/g, (_, n) => String(p?.[n] ?? '')); };
const ANN = 'telegram:42';
// an op with a required enum, as any app may declare one
const demo = { app: 'demo', itemTypes: [], operations: [{ id: 'pick', verb: 'set', params: [{ name: 'color', kind: 'enum', of: ['red', 'blue'], required: true }], surfaces: { slash: { command: '/kies', body: 'argline' }, chat: { hint: 'pick a color' } } }] };

function bot() {
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  const calls = [];
  const callSkill = async (app, op, args) => { calls.push({ app, op, args }); return { ok: true, message: `done ${op}` }; };
  const doorCall = withAssistantOps({ callSkill, threads, t: tr, refusal: async () => null, admin: { users: async () => [{ id: ANN, channel: 'telegram', uid: '42', role: 'member' }] } });
  const base = composeAssistantCatalogue({ apps: ['lists'], slim: true });
  const catalogue = mergeManifests([...Object.values(base.manifestsByOrigin), demo].map((manifest) => ({ manifest })));
  const bridge = new InMemoryBridge({ id: 'telegram' });
  const runner = createTelegramRunner({
    bridge, catalogue, manifestsByOrigin: { ...base.manifestsByOrigin, demo }, t: tr, callSkill: doorCall, allowedChatIds: '*', threads,
    llm: { invoke: async () => null }, interpret: async () => null, admit: async () => ANN,
  });
  const say = async (text) => {
    await runner.start?.();
    bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId: '42', text, sender: { bridgeUid: '42', displayName: 'Ann' } });
    await runner.idle('42');
    return bridge.outbox.at(-1) ?? {};
  };
  return { say, threads, calls };
}

describe('a value asked for, and a question left waiting', () => {
  it('/herinneringen alone: how it stands, a button per value in words', async () => {
    const { say, threads } = bot();
    const r = await say('/herinneringen');
    expect(r.text).toContain('Herinneringen: aan');
    expect(r.text).not.toMatch(/mode/i);
    const labels = (r.buttons ?? []).map((b) => b.label).join(' | ');
    expect(labels).not.toContain('circle.');
    expect((r.buttons ?? []).map((b) => b.id)).toContain('/herinneringen off');
    await say('/herinneringen off');
    expect(threads.remindersOn(ANN)).toBe(false);
  });

  it('a question for a missing enum value: buttons in words; an unrelated line drops it and goes on as usual', async () => {
    const { say, calls } = bot();
    const q = await say('/kies');
    expect((q.buttons ?? []).map((b) => b.label)).toEqual(['red', 'blue']);
    const r = await say('Halloo 🥬🍅🥑🥒');
    expect(calls.find((c) => c.op === 'pick'), 'the greeting is not taken as the answer').toBeUndefined();
    expect(r.text ?? '').not.toContain('Gebruik');
    // the question is gone: a later "blue" on its own is not taken as its answer
    await say('blue');
    expect(calls.find((c) => c.op === 'pick'), 'the dropped question answers nothing').toBeUndefined();
    // and a real answer still answers
    await say('/kies');
    await say('blue');
    expect(calls.find((c) => c.op === 'pick')?.args).toMatchObject({ color: 'blue' });
  });
});
