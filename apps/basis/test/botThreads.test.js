/**
 * Each person's conversation with the bot is theirs, and it outlives a restart.
 *
 * The Telegram door kept its memory in a Map in the engine and its pending ask in a Map in the runner: a restart
 * forgot every conversation and every half-answered question, and the thread was the CHAT, so two people in one
 * group chat shared one memory. Now a thread is the admitted person's (their contact id); its turns are
 * `chat-message` entries on the device log and its settings one row in a store the host hands in.
 *
 * Through the real runner and engine; the "restart" is a new runner and a new thread set over the same log and store.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { mergeManifests } from '../src/manifestMerge.js';
import { createMockHouseholdAgent, mockHouseholdManifest } from '../src/core/agent/mockAgent.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';

const t = (k, p) => (p && typeof p === 'object' && Object.keys(p).length ? `${k}:${JSON.stringify(p)}` : k);

function door({ eventLog, store, memoryDefault, llm = null, interpret = null }) {
  const bridge = new InMemoryBridge({ id: 'telegram' });
  const agent = createMockHouseholdAgent();
  const threads = createBotThreads({ eventLog, store, ...(memoryDefault ? { memoryDefault } : {}) });
  const runner = createTelegramRunner({
    bridge, catalogue: mergeManifests([{ manifest: mockHouseholdManifest }]), manifestsByOrigin: { household: mockHouseholdManifest },
    t, allowedChatIds: '*', collectMs: 0, callSkill: (app, op, args) => agent.callSkill(app, op, args),
    admit: async (who) => `${who.channel}:${who.uid}`, threads,
    ...(llm ? { llm, interpret: interpret ?? (async () => null) } : {}),
  });
  const say = async (uid, text, chatId = uid) => {
    bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId, text, sender: { bridgeUid: uid, displayName: uid } });
    await runner.idle();
    return bridge.outbox.map((m) => m.text).join('\n');
  };
  return { runner, threads, say, start: async () => { await threads.load(); await runner.start(); } };
}

describe('the bot\'s threads', () => {
  it('one thread per person, even in one group chat; the turns are chat-message entries on the log, not the circle\'s', async () => {
    const eventLog = new EventLog({ initial: [], muted: [] });
    const d = door({ eventLog, store: memoryThreadStore() });
    await d.start();
    await d.say('111', '/help', 'group');
    await d.say('222', '/mine', 'group');
    const ann = d.runner.recentTurns('telegram:111');
    const bo = d.runner.recentTurns('telegram:222');
    expect(ann.some((l) => l === 'you: /help')).toBe(true);
    expect(ann.some((l) => l === 'you: /mine'), 'Bo\'s line is not in Ann\'s thread').toBe(false);
    expect(bo.some((l) => l === 'you: /mine')).toBe(true);
    const entries = eventLog.query({}).filter((e) => e.type === 'chat-message');
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.payload.scope).toBe('self');
      expect(e.payload.circleId).toBeUndefined();
      expect(['telegram:111', 'telegram:222']).toContain(e.payload.threadId);
    }
  });

  it('after a restart the thread remembers, and a half-answered ask goes on', async () => {
    const eventLog = new EventLog({ initial: [], muted: [] });
    const store = memoryThreadStore();
    const first = door({ eventLog, store });
    await first.start();
    await first.say('111', '/help');
    const ask = await first.say('111', '/add-item');
    expect(ask).toContain('circle.telegram.needs_form');
    await first.runner.stop();

    const second = door({ eventLog, store });
    await second.start();
    expect(second.runner.recentTurns('telegram:111').some((l) => l === 'you: /help')).toBe(true);
    expect(second.runner.pendingFor('telegram:111')).toBe('form');
    await second.say('111', 'shopping');
    await second.say('111', 'bread');
    expect(second.runner.pendingFor('telegram:111')).toBeNull();
  });

  it('memory off: nothing is kept and nothing is sent — a follow-up reaches the model without the line before it', async () => {
    const eventLog = new EventLog({ initial: [], muted: [] });
    const seen = [];
    const llm = { invoke: async () => ({ text: 'Welke lijst bedoel je?' }) };
    const interpret = async (text, o = {}) => { seen.push({ text, o }); return null; };
    const d = door({ eventLog, store: memoryThreadStore(), llm, interpret });
    await d.start();
    d.threads.setMode('telegram:111', 'off');
    await d.say('111', 'zet kwartelei op de boodschappen');
    await d.say('111', 'en broccoli ook');
    expect(eventLog.query({}).filter((e) => e.type === 'chat-message' && e.payload.threadId === 'telegram:111')).toEqual([]);
    expect(d.runner.recentTurns('telegram:111')).toEqual([]);
    // the follow-up reached the interpreter, and nothing of the line before it came along
    const followUp = seen.find((s0) => String(s0.text).includes('broccoli'));
    expect(followUp, 'the follow-up reached the interpreter').toBeTruthy();
    expect(JSON.stringify(followUp.o)).not.toContain('kwartelei');
    // …while with memory on, it would have: the same two lines with the default mode
    const seen2 = [];
    const d2 = door({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore(), llm,
      interpret: async (text, o = {}) => { seen2.push({ text, o }); return null; } });
    await d2.start();
    await d2.say('111', 'zet kwartelei op de boodschappen');
    await d2.say('111', 'en broccoli ook');
    expect(JSON.stringify(seen2.find((s0) => String(s0.text).includes('broccoli'))?.o)).toContain('kwartelei');
  });

  it('the admin\'s default applies until the person chooses; their choice wins', async () => {
    const eventLog = new EventLog({ initial: [], muted: [] });
    const d = door({ eventLog, store: memoryThreadStore(), memoryDefault: () => 'off' });
    await d.start();
    await d.say('111', '/help');
    expect(d.runner.recentTurns('telegram:111')).toEqual([]);
    d.threads.setMode('telegram:111', 'short');
    await d.say('111', '/help');
    expect(d.runner.recentTurns('telegram:111').some((l) => l === 'you: /help')).toBe(true);
  });
});
