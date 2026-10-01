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

async function boot({ allowedChatIds = ['42'], gate = null, interpret = null, walkLog = null, admit = null, ...extra } = {}) {
  const bridge = new InMemoryBridge({ id: 'telegram' });
  const agent = createMockHouseholdAgent();
  const calls = [];
  const callSkill = async (app, op, args, ctx) => { calls.push({ app, op, args, ...(ctx ? { ctx } : {}) }); return agent.callSkill(app, op, args); };
  const catalogue = mergeManifests([{ manifest: mockHouseholdManifest }]);
  const runner = createTelegramRunner({
    bridge, callSkill, catalogue,
    manifestsByOrigin: { household: mockHouseholdManifest },
    allowedChatIds, t, gate, interpret, llm: interpret ? { invoke: async () => null } : null, walkLog, admit,
    collectMs: 0,   // one line at a time here; the collect window has its own test (assistantLane.test.js)
    ...extra,
  });
  await runner.start();
  const say = async (text, chatId = '42') => {
    bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId, text, sender: { bridgeUid: chatId, displayName: 'Frits' } });
    await runner.idle(chatId);   // the bridge is let go at once; the turn runs in the chat's lane
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

  it('a slow model is said honestly: "even geduld", and when it does not come back, not "ik begreep je niet"', async () => {
    const abort = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const interpret = async (_text, o) => { o.onSlow?.(); throw abort(); };
    const { say } = await boot({ interpret });
    const out = (await say('hoe gaat het eigenlijk met de planten')).map((m) => m.text);   // past the gate: the model's
    expect(out).toContain('circle.bot.slow');
    expect(out).toContain('circle.bot.model_down');
    expect(out).not.toContain('circle.telegram.unknown');
  });

  it('a reply\'s buttons obey the person\'s map: an op their role does not reach is never offered', async () => {
    // a member's map without the complete op (the household bot's slim map scopes per role the same way)
    const scopeToRole = (cat, role) => (role === 'member'
      ? { ...cat, opsById: new Map([...cat.opsById].filter(([, e]) => (e?.op?.id ?? '') !== 'markComplete')) }
      : cat);
    const { say } = await boot({ roleFor: () => 'member', scopeToRole });
    const out = await say('/mine');
    const ids = out.flatMap((m) => m.buttons.map((b) => b.id.split(':')[0]));
    expect(ids).not.toContain('markComplete');
    const admin = await boot({ roleFor: () => 'admin', scopeToRole });
    const theirs = (await admin.say('/mine')).flatMap((m) => m.buttons.map((b) => b.id.split(':')[0]));
    expect(theirs).toContain('markComplete');
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

  it('a door that admits people: every call of the turn carries the person, and the log does not', async () => {
    const admitted = [];
    const records = [];
    const admit = async (who) => { admitted.push(who); return `${who.channel}:${who.uid}`; };
    const { say, calls, bridge, runner } = await boot({ admit, walkLog: (r) => records.push(r) });
    await say('/mine');
    expect(admitted[0]).toMatchObject({ channel: 'telegram', uid: '42', displayName: 'Frits' });
    expect(calls.length).toBeGreaterThan(0);
    // the person, and the thread that is theirs
    for (const c of calls) expect(c.ctx).toEqual({ caller: 'telegram:42', threadId: 'telegram:42' });
    expect(JSON.stringify(records)).not.toContain('telegram:42');
    // the PERSON, not the chat: in a group chat the sender is who asks
    calls.length = 0;
    await bridge.simulateIncoming({ chatId: '42', text: '/mine', sender: { bridgeUid: '7', displayName: 'Ann' } });
    await runner.idle('42');
    expect(calls.at(-1).ctx).toEqual({ caller: 'telegram:7', threadId: 'telegram:7' });
  });

  it('a door whose admission fails runs nothing', async () => {
    const { say, calls } = await boot({ admit: async () => null });
    const out = await say('/mine');
    expect(calls).toHaveLength(0);
    expect(out[0].text).toBe('circle.telegram.unknown');
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

  it('an enum ask comes with buttons for its values, and a tap answers it', async () => {
    const { say, calls } = await boot();
    const ask = await say('/add-item');   // type + text missing → the first field, type, is an enum
    expect(ask[0].buttons.map((b) => b.id)).toEqual(['shopping', 'errand', 'repair', 'schedule']);
    await say('shopping');
    await say('olie');
    expect(calls.at(-1)).toMatchObject({ op: 'addItem', args: { type: 'shopping', text: 'olie' } });
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

describe('a door dispatches only what it offers', () => {
  // An op with no surface is not offered on any door — the owner's recovery phrase, device enrolment and the like
  // sit on the manifest with `surfaces: {}` so the host can call them, never a chat. A button tap arrives as its
  // callbackData `opId:itemId`, and anyone can TYPE that text: the tap path must accept only ops that are offered as
  // a button, and a slash only ops offered as a command.
  // the mock household manifest plus one op that no door offers (the shape of the owner-only ops)
  const withHidden = { ...mockHouseholdManifest, operations: [...mockHouseholdManifest.operations, { id: 'revealSecret', verb: 'get', params: [], surfaces: {} }] };
  async function bootWithHidden() {
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const agent = createMockHouseholdAgent();
    const calls = [];
    const callSkill = async (app, op, args) => { calls.push({ app, op }); return op === 'revealSecret' ? { mnemonic: 'the root phrase' } : agent.callSkill(app, op, args); };
    const catalogue = mergeManifests([{ manifest: withHidden }]);
    const runner = createTelegramRunner({ bridge, callSkill, catalogue, manifestsByOrigin: { household: withHidden }, allowedChatIds: '*', t });
    await runner.start();
    const say = async (text) => { bridge.clearOutbox(); await bridge.simulateIncoming({ chatId: '9', text, sender: { bridgeUid: '9', displayName: 'X' } }); await runner.idle?.('9'); return bridge.outbox.map((m) => m.text).join('\n'); };
    return { say, calls };
  }

  it('a typed tap for an op with no surface is not dispatched', async () => {
    const { say, calls } = await bootWithHidden();
    const reply = await say('revealSecret:');
    expect(calls.map((c) => c.op)).not.toContain('revealSecret');
    expect(reply).not.toContain('the root phrase');
  });

  it('a slash for an op with no slash surface is not dispatched', async () => {
    const { say, calls } = await bootWithHidden();
    const reply = await say('/revealSecret');
    expect(calls.map((c) => c.op)).not.toContain('revealSecret');
    expect(reply).not.toContain('the root phrase');
  });
});

describe('the box\'s own catalogue: no op without a button can be tapped', () => {
  it('every surface-less op the box composes (the owner-only ones among them) is refused as a typed tap', async () => {
    const { composeAssistantCatalogue } = await import('../../src/telegram/assistantCatalogue.js');
    const { householdManifest } = await import('../../../household/manifest.js');
    const { catalogue, manifestsByOrigin } = composeAssistantCatalogue({ apps: ['household', 'lists'], householdManifest });
    const hidden = [...catalogue.opsById.entries()].filter(([, e]) => !((e.op ?? e)?.surfaces?.ui?.control === 'button')).map(([id]) => id);
    expect(hidden).toContain('revealOwnerPhrase');
    const bridge = new InMemoryBridge({ id: 'telegram' });
    const calls = [];
    const runner = createTelegramRunner({ bridge, callSkill: async (app, op) => { calls.push(op); return { ok: true }; }, catalogue, manifestsByOrigin, allowedChatIds: '*', t, collectMs: 0 });
    await runner.start();
    for (const id of hidden) {
      await bridge.simulateIncoming({ chatId: '9', text: `${id}:`, sender: { bridgeUid: '9', displayName: 'X' } });
      await runner.idle?.('9');
    }
    expect(calls.filter((op) => hidden.includes(op))).toEqual([]);
  });
});
