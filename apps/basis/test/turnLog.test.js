/**
 * What the bot writes down about a conversation, and what the people in the house are told about it.
 *
 * The walk log recorded every turn in full — what a person typed, what went back — in a plain file next to the box's
 * data. On a shared bot that is a log of other people's words. Now turns are not logged unless the operator asks
 * (`--walk-log-turns redacted|full`), `redacted` passes every string through the platform's redaction rules, and
 * when turns ARE logged, the people talking to the bot are told so: one sentence in the greeting and in `/help`,
 * gone again when the log is off. `/help` always says how to turn memory off.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { mergeManifests } from '../src/manifestMerge.js';
import { createMockHouseholdAgent, mockHouseholdManifest } from '../src/core/agent/mockAgent.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { turnLogFor, TURN_LOG_MODES } from '../src/v2/turnLog.js';

const t = (k, p) => (p && typeof p === 'object' && Object.keys(p).length ? `${k}:${JSON.stringify(p)}` : k);

async function door(mode) {
  const records = [];
  const bridge = new InMemoryBridge({ id: 'telegram' });
  const agent = createMockHouseholdAgent();
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  const runner = createTelegramRunner({
    bridge, catalogue: mergeManifests([{ manifest: mockHouseholdManifest }]), manifestsByOrigin: { household: mockHouseholdManifest },
    t, allowedChatIds: '*', collectMs: 0, callSkill: (app, op, args) => agent.callSkill(app, op, args),
    admit: async (who) => `${who.channel}:${who.uid}`, threads,
    walkLog: turnLogFor(mode, (r) => records.push(r)), turnLogMode: mode,
  });
  await threads.load(); await runner.start();
  const say = async (text) => { bridge.clearOutbox(); await bridge.simulateIncoming({ chatId: '111', text, sender: { bridgeUid: '111' } }); await runner.idle(); return bridge.outbox.map((m) => m.text).join('\n'); };
  return { say, records };
}

describe('the turn log', () => {
  it('off unless asked: the default mode logs nothing', async () => {
    expect(TURN_LOG_MODES).toEqual(['off', 'redacted', 'full']);
    expect(turnLogFor(undefined, () => {})).toBeNull();
    const d = await door('off');
    await d.say('/help');
    expect(d.records).toEqual([]);
  });

  it('redacted: a mail address or a phone number never reaches the log', async () => {
    const d = await door('redacted');
    await d.say('mail me op anna@example.org of bel 06-12345678');
    const logged = JSON.stringify(d.records);
    expect(d.records.length).toBeGreaterThan(0);
    expect(logged).not.toContain('anna@example.org');
    expect(logged).not.toContain('12345678');
    expect(logged).toContain('[email]');
  });

  it('the sentence that says the log is read follows the flag — in the greeting and in /help', async () => {
    const on = await door('redacted');
    const first = await on.say('/help');
    expect(first).toContain('circle.bot.welcome');
    expect(first).toContain('circle.bot.log_disclosure');
    expect(await on.say('/help')).toContain('circle.bot.log_disclosure');
    expect(await on.say('/help'), 'greeted once').not.toContain('circle.bot.welcome');

    const off = await door('off');
    const offFirst = await off.say('/help');
    expect(offFirst).toContain('circle.bot.welcome');
    expect(offFirst).not.toContain('circle.bot.log_disclosure');
    // …and /help always says how to turn memory off
    expect(offFirst).toContain('circle.bot.help_memory');
  });
});
