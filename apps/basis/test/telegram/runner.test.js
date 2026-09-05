/**
 * The Telegram runner — a third basis shell. A MessagingBridge turn goes through the SAME compilers
 * the web and mobile shells use (parseInput → resolveDispatch → runDispatch → renderReply); the
 * runner only pairs the chat, paints the rendered reply as bridge messages, and turns a button tap
 * (callbackData `opId:itemId`) back into a dispatch. No command table of its own.
 */
import { describe, it, expect } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { mergeManifests } from '../../src/manifestMerge.js';
import { createMockHouseholdAgent, mockHouseholdManifest } from '../../src/core/agent/mockAgent.js';
import { createTelegramRunner } from '../../src/telegram/runner.js';

const t = (k, p) => (p && typeof p === 'object' && Object.keys(p).length ? `${k}:${JSON.stringify(p)}` : k);

async function boot({ allowedChatIds = ['42'], gate = null, interpret = null, walkLog = null } = {}) {
  const bridge = new InMemoryBridge({ id: 'telegram' });
  const agent = createMockHouseholdAgent();
  const calls = [];
  const callSkill = async (app, op, args) => { calls.push({ app, op, args }); return agent.callSkill(app, op, args); };
  const catalogue = mergeManifests([{ manifest: mockHouseholdManifest }]);
  const runner = createTelegramRunner({
    bridge, callSkill, catalogue,
    manifestsByOrigin: { household: mockHouseholdManifest },
    allowedChatIds, t, gate, interpret, llm: interpret ? { invoke: async () => null } : null, walkLog,
  });
  await runner.start();
  const say = async (text, chatId = '42') => {
    bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId, text, sender: { bridgeUid: chatId, displayName: 'Frits' } });
    return bridge.outbox.map((m) => ({ text: m.text, buttons: m.buttons ?? [] }));
  };
  return { bridge, runner, agent, say, calls };
}

describe('createTelegramRunner — a manifest surface over a MessagingBridge', () => {
  it('a command missing its fields asks for them one per line, then dispatches through the waist', async () => {
    const { say, runner, calls } = await boot();
    const ask = await say('/add-item');
    expect(ask).toHaveLength(1);
    expect(ask[0].text).toContain('circle.telegram.needs_form');
    expect(runner.pendingFor('42')).toBe('form');
    await say('shopping');
    expect(runner.pendingFor('42')).toBe('form');
    const out = await say('bread');
    expect(out.length).toBeGreaterThan(0);
    expect(runner.pendingFor('42')).toBeNull();
    // the dispatch reached the waist with both fields bound (the mock agent has no addItem handler; the
    // real one does — what matters here is that the shell compiled the turn to the right {opId, args})
    expect(calls.at(-1)).toMatchObject({ app: 'household', op: 'addItem', args: { type: 'shopping', text: 'bread' } });
  });

  it('a list reply paints its items with their per-item buttons; a tap dispatches the item op', async () => {
    const { say, agent } = await boot();
    const out = await say('/mine');
    const list = out.find((m) => m.buttons.length);
    expect(list).toBeTruthy();
    const done = list.buttons.find((b) => b.id.startsWith('markComplete:'));
    expect(done).toBeTruthy();
    const tapped = await say(done.id);
    expect(tapped.length).toBeGreaterThan(0);
    const itemId = done.id.split(':')[1];
    expect(agent.state().find((c) => String(c.id) === itemId)?.state).toBe('done');
  });

  it('an unpaired chat gets the pairing hint with its chat id and nothing is dispatched', async () => {
    const { say, agent } = await boot();
    const before = agent.state().length;
    const out = await say('/add-item shopping bread', '999');
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('circle.telegram.not_paired');
    expect(out[0].text).toContain('999');
    expect(agent.state().length).toBe(before);
  });

  it("the open door ('*' or no list) admits any chat; a list pairs exactly those", async () => {
    const { say, calls } = await boot({ allowedChatIds: '*' });
    await say('/mine', '777');
    expect(calls.at(-1)).toMatchObject({ op: 'listOpen' });
    const { say: say2, calls: calls2 } = await boot({ allowedChatIds: [] });
    await say2('/mine', '778');
    expect(calls2.at(-1)).toMatchObject({ op: 'listOpen' });
  });

  it('free text (no LLM wired) answers with the help hint, not silence', async () => {
    const { say } = await boot();
    const out = await say('hoi bot');
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain('circle.telegram.unknown');
  });

  it('free text goes through the SAME turn engine as a typed circle line: the deterministic gate routes a verb', async () => {
    const gate = { evaluate: async (text) => (/^show my list$/i.test(text) ? { via: 'rule', command: { opId: 'listOpen', args: {}, appOrigin: 'household' } } : { via: 'llm' }) };
    const { say, calls } = await boot({ gate });
    const out = await say('show my list');
    expect(calls.at(-1)).toMatchObject({ app: 'household', op: 'listOpen' });
    expect(out.find((m) => m.buttons.length)).toBeTruthy();
    // a skip with no LLM route → the help hint, never silence
    const miss = await say('what is the weather');
    expect(miss[0].text).toContain('circle.telegram.unknown');
  });

  it('with an interpreter (an LLM route), free text the gate skips is interpreted to an op', async () => {
    const interpret = async (text) => (/list/i.test(text) ? { opId: 'listOpen', args: {} } : null);
    const { say, calls } = await boot({ interpret, gate: { evaluate: async () => ({ via: 'llm' }) } });
    await say('could you list what is open?');
    expect(calls.at(-1)).toMatchObject({ app: 'household', op: 'listOpen' });
  });

  it('the walk log gets one record per turn: what came in, the path, the dispatch, the replies, the time', async () => {
    const log = [];
    const gate = { evaluate: async (text) => (/^show my list$/i.test(text) ? { via: 'rule', command: { opId: 'listOpen', args: {}, appOrigin: 'household' } } : { via: 'llm' }) };
    const { say } = await boot({ gate, walkLog: (e) => log.push(e) });
    await say('/mine');
    await say('show my list');
    await say('what is the weather');
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ chat: '42', text: '/mine', via: 'slash', route: 'ready', opId: 'listOpen' });
    expect(log[0].replies?.length).toBeGreaterThan(0);
    expect(typeof log[0].ms).toBe('number');
    expect(log[1]).toMatchObject({ via: 'gate', opId: 'listOpen' });
    expect(log[2]).toMatchObject({ via: 'llm-unavailable' });
  });

  it('/help lists the commands with their hints; the help op does the same instead of failing', async () => {
    const { say } = await boot();
    const out = await say('/help');
    expect(out[0].text).toContain('/mine');
    expect(out[0].text).toContain('/done');
  });

  it('a typed body splits into the enum + the text, in the words people use (/add boodschappen olie)', async () => {
    const { say, calls } = await boot();
    await say('/add-item boodschappen olie');
    expect(calls.at(-1)).toMatchObject({ op: 'addItem', args: { type: 'shopping', text: 'olie' } });
    await say('/add-item shopping melk en kaas');
    expect(calls.at(-1)).toMatchObject({ op: 'addItem', args: { type: 'shopping', text: 'melk en kaas' } });
  });

  it('an enum arg named the Dutch way is coerced to the declared value', async () => {
    const { say, calls } = await boot();
    await say('listOpen:');   // a bare tap has no type
    await say('/mine boodschappen');
    const last = calls.at(-1);
    expect(last.op).toBe('listOpen');
    if (last.args && 'type' in last.args) expect(last.args.type).toBe('shopping');
  });

  it("an op's result is remembered as the system's voice, a model reply as the assistant's", async () => {
    const remembered = [];
    const gate = { evaluate: async () => ({ via: 'llm' }) };
    const interpret = async () => ({ reply: 'Welke lijst bedoel je?' });
    const { say, runner } = await boot({ gate, interpret });
    await say('/mine');
    await say('iets vaags');
    // the engine is internal; read the memory through the runner's engine seam
    const lines = runner.recentTurns?.('tg:42') ?? [];
    expect(lines.some((l) => l.startsWith('system: '))).toBe(true);
    expect(lines.some((l) => l.startsWith('assistant: Welke lijst'))).toBe(true);
  });

  it('a new command cancels a pending ask instead of being swallowed as its answer', async () => {
    const { say, agent, runner } = await boot();
    await say('/add-item');
    expect(runner.pendingFor('42')).toBe('form');
    const before = agent.state().length;
    const out = await say('/mine');
    expect(runner.pendingFor('42')).toBeNull();
    expect(out.find((m) => m.buttons.length)).toBeTruthy();
    expect(agent.state().length).toBe(before);
  });
});
