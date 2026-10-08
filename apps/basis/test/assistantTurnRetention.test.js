/**
 * A person's turns with the household bot are not the record.
 *
 * What a turn DID — a line on a list, an appointment, a setting — is a store row and stays. The words of the turn are
 * plumbing to it: content whose durable head lives elsewhere, which is the chat retention class by the dictionary's
 * own definition. The record rule is for people's conversations with each other. So the turns are their own entry
 * kind (`assistant-turn`), they age out on the device's chat window through the log's own compactor, the bot's
 * memory reads the last turns inside that window, and `/vergeet` lets a person empty their own thread — the same
 * control a person on the web has in "Mijn gegevens".
 *
 * Through the real runner, engine, door ops and event log; the clock is the log's and the threads' own.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { createMockHouseholdAgent, mockHouseholdManifest } from '../src/core/agent/mockAgent.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { retentionFromDays } from '../src/v2/retentionPref.js';
import { ASSISTANT_MEMORY_TURNS } from '../src/v2/assistantEngine.js';

const DAY = 86_400_000;
const t = (k, p) => (p && typeof p === 'object' && Object.keys(p).length ? `${k}:${JSON.stringify(p)}` : k);
/** Every entry of one person's thread, whatever kind it was written as. */
const threadEntries = (log, id) => log.query({}).filter((e) => e?.payload?.threadId === id);

function door() {
  const clock = { now: 1_000 * DAY };
  const eventLog = new EventLog({ initial: [], muted: [], now: () => clock.now, retention: retentionFromDays(14) });
  const threads = createBotThreads({ eventLog, store: memoryThreadStore(), now: () => clock.now });
  const bridge = new InMemoryBridge({ id: 'telegram' });
  const mock = createMockHouseholdAgent();
  // the household's store: what a turn adds is a row here (the mock agent adds nothing of its own)
  const rows = [];
  const agent = {
    callSkill: async (app, op, args) => {
      if (app === 'household' && op === 'addItem') { rows.push({ id: `row-${rows.length + 1}`, type: args.type, label: args.text }); return { ok: true, message: `+ ${args.text}` }; }
      if (app === 'household' && op === 'listOpen' && args?.type && args.type !== 'chore') return { items: rows.filter((r) => r.type === args.type) };
      return mock.callSkill(app, op, args);
    },
  };
  const { catalogue, manifestsByOrigin } = composeAssistantCatalogue({ apps: ['household'], householdManifest: mockHouseholdManifest });
  const people = [{ id: 'telegram:111', channel: 'telegram', uid: '111' }, { id: 'telegram:222', channel: 'telegram', uid: '222' }];
  const runner = createTelegramRunner({
    bridge, catalogue, manifestsByOrigin, t, allowedChatIds: '*', collectMs: 0,
    callSkill: withAssistantOps({ callSkill: (app, op, args) => agent.callSkill(app, op, args), threads, t, admin: { users: async () => people } }),
    admit: async (who) => `${who.channel}:${who.uid}`, threads,
  });
  const say = async (uid, text, chatId = uid) => {
    bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId, text, sender: { bridgeUid: uid, displayName: uid } });
    await runner.idle();
    return bridge.outbox.map((m) => m.text).join('\n');
  };
  return { clock, eventLog, threads, agent, runner, say, start: async () => { await threads.load(); await runner.start(); } };
}

describe('a turn with the bot is chat-class content, not the record', () => {
  it('turns older than the window drop at compaction, while the items they made remain', async () => {
    const d = door();
    await d.start();
    await d.say('111', '/add-item');
    await d.say('111', 'shopping');
    await d.say('111', 'bread');
    const shopping = async () => (await d.agent.callSkill('household', 'listOpen', { type: 'shopping' }))?.items ?? [];
    expect((await shopping()).some((i) => /bread/i.test(i.label ?? i.text ?? '')), 'the turn made a list line').toBe(true);
    expect(threadEntries(d.eventLog, 'telegram:111').length, 'the turns were kept').toBeGreaterThan(0);

    d.clock.now += 15 * DAY;   // past the 14-day window
    d.eventLog.prune();        // the log's own housekeeping (every append runs it)

    expect(threadEntries(d.eventLog, 'telegram:111'), 'the words are gone').toEqual([]);
    expect(d.runner.recentTurns('telegram:111')).toEqual([]);
    expect((await shopping()).some((i) => /bread/i.test(i.label ?? i.text ?? '')), 'what the turn did stays').toBe(true);
  });

  it('a thread\'s memory after compaction is the last turns inside the window', () => {
    const d = door();
    for (const w of ['een', 'twee', 'drie', 'vier']) d.threads.memory.remember('telegram:111', 'you', `oud ${w}`);
    d.clock.now += 15 * DAY;
    d.threads.memory.remember('telegram:111', 'you', 'nieuw een');     // an append compacts
    d.threads.memory.remember('telegram:111', 'assistant', 'nieuw twee');
    expect(d.threads.memory.recent('telegram:111')).toEqual(['you: nieuw een', 'assistant: nieuw twee']);
    // inside the window it is still the last few, as before
    for (let i = 0; i < 8; i += 1) d.threads.memory.remember('telegram:111', 'you', `regel ${i}`);
    const recent = d.threads.memory.recent('telegram:111');
    expect(recent).toHaveLength(ASSISTANT_MEMORY_TURNS);
    expect(recent.at(-1)).toBe('you: regel 7');
  });

  it('memory off keeps nothing, as before', () => {
    const d = door();
    d.threads.setMode('telegram:111', 'off');
    d.threads.memory.remember('telegram:111', 'you', 'niet bewaren');
    expect(threadEntries(d.eventLog, 'telegram:111')).toEqual([]);
  });
});

describe('/vergeet — a person empties their own thread', () => {
  it('empties one person\'s thread and no one else\'s', async () => {
    const d = door();
    await d.start();
    await d.say('111', '/mine');
    await d.say('111', '/help');
    await d.say('222', '/mine');
    const before222 = threadEntries(d.eventLog, 'telegram:222').length;
    expect(threadEntries(d.eventLog, 'telegram:111').length).toBeGreaterThan(0);
    expect(before222).toBeGreaterThan(0);

    d.clock.now += 1;
    const reply = await d.say('111', '/vergeet');
    expect(reply).toContain('circle.bot.forget_done');
    // what was said before /vergeet is gone; the /vergeet line and its answer are the new thread's first turns
    const left = threadEntries(d.eventLog, 'telegram:111').map((e) => e.payload.text);
    expect(left.some((x) => /\/mine|\/help/.test(x)), JSON.stringify(left)).toBe(false);
    expect(threadEntries(d.eventLog, 'telegram:222')).toHaveLength(before222);
  });

  it('is said only in the person\'s own chat: from a group it forgets nothing', async () => {
    const d = door();
    await d.start();
    await d.say('111', '/mine', 'group');
    const before = threadEntries(d.eventLog, 'telegram:111').length;
    d.clock.now += 1;
    const reply = await d.say('111', '/vergeet', 'group');
    expect(reply).toContain('circle.bot.forget_not_private');
    expect(threadEntries(d.eventLog, 'telegram:111').length).toBeGreaterThanOrEqual(before);
    expect(threadEntries(d.eventLog, 'telegram:111').some((e) => e.payload.text === '/mine')).toBe(true);
  });
});
