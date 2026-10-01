/**
 * The assistant's per-thread lane and its collect window.
 *
 * Lane: the lines of one thread (a Telegram chat, a circle) are taken one turn at a time. Two quick lines used to run
 * side by side: the second went to the model before the first's op result was in memory, and a form answer typed
 * while the first turn was still under way was read as a new request (the ask it answered came after it). Lines of
 * two different threads still run side by side.
 *
 * Collect window: lines that arrive within a short window ("melk", "brood", "eieren", typed in a second) are one turn:
 * one model call with the lines as one member message, one dispatch per item. A lone line waits no longer than the
 * window. The gate still reads each line on its own: a line a fixed rule takes is dispatched by the rule, the rest go
 * to the model together.
 *
 * The box: the Telegram runner hands a line to the lane and lets the bridge go, so a long-polling bridge can deliver
 * the next line (of this chat or another) while a turn runs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryBridge } from '@onderling/chat-agent';
import { mergeManifests } from '../src/manifestMerge.js';
import { householdManifest } from '../../household/manifest.js';
import { listsManifest } from '../../lists/manifest.js';
import { createMockHouseholdAgent, mockHouseholdManifest } from '../src/core/agent/mockAgent.js';
import { createAssistantEngine } from '../src/v2/assistantEngine.js';
import { interpretToCommand } from '../src/v2/interpretCommand.js';
import { createTelegramRunner } from '../src/telegram/runner.js';
import { followUpClaim } from '../src/v2/assistantFollowUp.js';
import { resolveDispatch } from '../src/router.js';
import { beginFollowUp } from '@onderling/kring-host/followUp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

afterEach(() => { vi.useRealTimers(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A model that makes one addItem call per line of the member's message, after `ms`. */
function lineModel({ ms = 100 } = {}) {
  const seen = [];
  let running = 0;
  let maxRunning = 0;
  return {
    seen,
    get maxRunning() { return maxRunning; },
    llm: {
      invoke: async (req) => {
        running += 1; maxRunning = Math.max(maxRunning, running);
        seen.push(req);
        if (ms) await sleep(ms);
        running -= 1;
        const text = req.messages.at(-1).content;
        const calls = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ id: 'addItem', args: { type: 'shopping', text: l } }));
        return { toolCall: calls[0] ?? null, toolCalls: calls };
      },
    },
  };
}

const catalogue = mergeManifests([{ manifest: householdManifest }, { manifest: listsManifest }]);

function engineWith(model, extra = {}) {
  const dispatched = [];
  const posted = [];
  const engine = createAssistantEngine({
    catalogue, lang: 'nl', llm: model.llm, interpret: interpretToCommand,
    dispatch: (input) => { dispatched.push(input); },
    postToCircle: (text) => { posted.push(text); },
    onLlmUnavailable: () => {}, onNoMatch: () => {},
    ...extra,
  });
  return { engine, dispatched, posted };
}

/** The box: the Telegram runner over an in-memory bridge, the mock household agent behind it. */
async function box({ interpret, collectMs = 20, llm = { invoke: async () => null } } = {}) {
  const bridge = new InMemoryBridge({ id: 'telegram' });
  const agent = createMockHouseholdAgent();
  const calls = [];
  const callSkill = async (app, op, args) => { calls.push({ app, op, args }); return agent.callSkill(app, op, args); };
  const log = [];
  const runner = createTelegramRunner({
    bridge, callSkill, catalogue: mergeManifests([{ manifest: mockHouseholdManifest }]),
    manifestsByOrigin: { household: mockHouseholdManifest },
    allowedChatIds: '*', t: (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k),
    gate: { evaluate: async () => ({ via: 'llm' }) }, interpret, llm, collectMs,
    walkLog: (e) => log.push(e),
  });
  await runner.start();
  const send = (text, chatId = '42') => bridge.simulateIncoming({ chatId, text, sender: { bridgeUid: chatId, displayName: 'Frits' } });
  return { bridge, runner, calls, log, send };
}

describe('the per-thread lane', () => {
  it('two lines in one chat 50 ms apart run one after the other, and the second sees the first\'s op result in memory', async () => {
    vi.useFakeTimers();
    const seen = [];
    let running = 0; let maxRunning = 0;
    const interpret = async (text, { history }) => {
      running += 1; maxRunning = Math.max(maxRunning, running);
      seen.push({ text, history: history ?? [] });
      await sleep(100);
      running -= 1;
      return { opId: 'listOpen', args: {} };
    };
    const { runner, send } = await box({ interpret });
    const sent = [send('wat staat er open')];
    await vi.advanceTimersByTimeAsync(50);
    sent.push(send('en nu?'));
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all(sent);
    await runner.idle?.('42');

    // A read is looked at and handed back once (the turn may act on it), so each turn asks the model twice — the
    // first turn's both calls before the second turn's.
    expect(seen.map((s) => s.text)).toEqual(['wat staat er open', 'wat staat er open', 'en nu?', 'en nu?']);
    expect(maxRunning).toBe(1);
    // the first turn's op result reached the second turn as the app's note
    const second = seen.find((s) => s.text === 'en nu?');
    expect(second.history.some((m) => m.role === 'user' && m.content.startsWith('(the app answered:'))).toBe(true);
  });

  it('a form answer arriving while a run is in flight is queued behind it and answers the form, not lost', async () => {
    vi.useFakeTimers();
    let interpreted = 0;
    // the model picks addItem without a list, so the turn ends by asking "which list?"
    const interpret = async () => { interpreted += 1; await sleep(100); return { opId: 'addItem', args: { text: 'melk' } }; };
    const { runner, calls, send } = await box({ interpret });
    const sent = [send('zet melk erop')];
    await vi.advanceTimersByTimeAsync(50);
    sent.push(send('boodschappen'));   // typed before the ask came back
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all(sent);
    await runner.idle?.('42');

    expect(interpreted).toBe(1);
    expect(calls.filter((c) => c.op === 'addItem')).toEqual([expect.objectContaining({ args: expect.objectContaining({ type: 'shopping', text: 'melk' }) })]);
    expect(runner.pendingFor('42')).toBeNull();
  });

  it('lines in two different threads run side by side', async () => {
    vi.useFakeTimers();
    const model = lineModel({ ms: 100 });
    const { engine, dispatched } = engineWith(model, { collectMs: 10 });
    const both = Promise.all([engine.ask('a', 'melk'), engine.ask('b', 'brood')]);
    await vi.advanceTimersByTimeAsync(200);
    await both;
    expect(model.maxRunning).toBe(2);
    expect(dispatched.map((d) => d.args.text).sort()).toEqual(['brood', 'melk']);
  });

  it('the box lets the bridge go while a turn runs, so the next line (this chat or another) can be delivered', async () => {
    vi.useFakeTimers();
    const interpret = async () => { await sleep(500); return { opId: 'listOpen', args: {} }; };
    const { runner, send } = await box({ interpret });
    let delivered = false;
    const p = send('wat staat er open').then(() => { delivered = true; });
    await vi.advanceTimersByTimeAsync(100);
    expect(delivered).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    await runner.idle?.('42');
  });
});

describe('the collect window', () => {
  it('"melk", "brood", "eieren" within the window are one turn: one model call with the three lines, three dispatches', async () => {
    vi.useFakeTimers();
    const model = lineModel();
    const { engine, dispatched } = engineWith(model);   // the default window
    const turns = [engine.ask('t', 'melk')];
    await vi.advanceTimersByTimeAsync(300);
    turns.push(engine.ask('t', 'brood'));
    await vi.advanceTimersByTimeAsync(300);
    turns.push(engine.ask('t', 'eieren'));
    await vi.advanceTimersByTimeAsync(2000);
    const results = await Promise.all(turns);

    expect(model.seen).toHaveLength(1);
    expect(model.seen[0].messages.at(-1)).toEqual({ role: 'user', content: 'melk\nbrood\neieren' });
    expect(dispatched.map((d) => [d.opId, d.args.text])).toEqual([['addItem', 'melk'], ['addItem', 'brood'], ['addItem', 'eieren']]);
    // every line's caller gets the one turn's result
    expect(results.every((r) => r === results[0] && r.via === 'llm')).toBe(true);
  });

  it('a lone line for the model waits for the window and no longer (default 800 ms)', async () => {
    vi.useFakeTimers();
    const model = lineModel({ ms: 0 });
    const { engine, dispatched } = engineWith(model);
    const turn = engine.ask('t', 'kun je nog wat melk halen');   // no rule takes it: the model's line
    await vi.advanceTimersByTimeAsync(799);
    expect(dispatched).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await turn;
    expect(dispatched.map((d) => d.args.text)).toEqual(['kun je nog wat melk halen']);
  });

  it('the gate reads each line on its own: a rule line is dispatched by its rule, the other lines go to the model together', async () => {
    vi.useFakeTimers();
    const model = lineModel();
    const { engine, dispatched } = engineWith(model, { collectMs: 100 });
    const turns = [engine.ask('t', 'zet kaas op de boodschappenlijst'), engine.ask('t', 'melk'), engine.ask('t', 'brood')];
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all(turns);

    expect(model.seen).toHaveLength(1);
    expect(model.seen[0].messages.at(-1).content).toBe('melk\nbrood');
    expect(dispatched.map((d) => d.args.text)).toEqual(['kaas', 'melk', 'brood']);
  });

  it('in a circle, addressed lines are collected with their tags taken off; a line for the circle is not held back', async () => {
    vi.useFakeTimers();
    const model = lineModel();
    const { engine, dispatched, posted } = engineWith(model, { collectMs: 100 });
    const chat = engine.handle('ik koop straks melk', { id: 'c1' });
    await vi.advanceTimersByTimeAsync(0);
    await chat;
    expect(posted).toEqual(['ik koop straks melk']);

    const turns = [engine.handle('@assistant melk', { id: 'c1' }), engine.handle('@assistant brood', { id: 'c1' })];
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all(turns);
    expect(model.seen).toHaveLength(1);
    expect(model.seen[0].messages.at(-1).content).toBe('melk\nbrood');
    expect(dispatched.map((d) => d.args.text)).toEqual(['melk', 'brood']);
  });

  it('on the box: three quick lines are one turn, one walk-log record, three adds, and memory holds the turn as the member sent it', async () => {
    vi.useFakeTimers();
    let interpreted = 0;
    const interpret = async (text) => {
      interpreted += 1;
      const [first, ...rest] = text.split('\n').map((l) => ({ opId: 'addItem', args: { type: 'shopping', text: l } }));
      return { ...first, ...(rest.length ? { more: rest } : {}) };
    };
    const { runner, calls, log, send } = await box({ interpret, collectMs: 200 });
    const sent = [send('melk')];
    await vi.advanceTimersByTimeAsync(50);
    sent.push(send('brood'));
    await vi.advanceTimersByTimeAsync(50);
    sent.push(send('eieren'));
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all(sent);
    await runner.idle?.('42');

    expect(interpreted).toBe(1);
    expect(calls.filter((c) => c.op === 'addItem').map((c) => c.args.text)).toEqual(['melk', 'brood', 'eieren']);
    expect(log).toHaveLength(1);
    expect(log[0].text).toBe('melk\nbrood\neieren');
    expect(runner.recentTurns('tg:42')[0]).toBe('you: melk\nbrood\neieren');
  });
});

describe('the circle doors: their pending ask is a claim on the lane', () => {
  const t = (k) => k;
  /** A circle door's composition: the ask a needsForm route makes, held by the door; the circle posts; no window. */
  function circleDoor(model) {
    let pending = null;
    const ran = [];
    const posted = [];
    const engine = createAssistantEngine({
      catalogue, lang: 'nl', llm: model.llm, interpret: interpretToCommand, collectMs: 0,
      dispatch: (input) => {
        const route = resolveDispatch({ kind: 'slash', opId: input.opId, args: input.args ?? {} }, catalogue);
        if (route.kind === 'needsForm') { pending = beginFollowUp({ dispatch: route, t }); return; }
        ran.push({ opId: input.opId, args: input.args });
      },
      postToCircle: (text) => { posted.push(text); },
      onLlmUnavailable: () => {}, onNoMatch: () => {},
      claim: followUpClaim({ pending: () => pending, clear: () => { pending = null; }, dispatchReady: (cmd) => { ran.push(cmd); }, catalogue }),
    });
    return { engine, ran, posted, pendingNow: () => pending };
  }
  /** The model picks addItem without a list, after 100 ms, so the turn ends by asking which list. */
  const untypedAdd = () => {
    const seen = [];
    return { seen, llm: { invoke: async (req) => { seen.push(req); await sleep(100); return { toolCall: { id: 'addItem', args: { text: 'melk' } }, toolCalls: [{ id: 'addItem', args: { text: 'melk' } }] }; } } };
  };

  it('an answer typed while the turn that asks is still running answers the ask: not posted to the circle, not a new request', async () => {
    vi.useFakeTimers();
    const model = untypedAdd();
    const { engine, ran, posted, pendingNow } = circleDoor(model);
    const turn = engine.handle('@assistant ik heb melk nodig', { id: 'c1' });   // no rule takes it: the model, 100 ms
    await vi.advanceTimersByTimeAsync(50);
    const answer = engine.handle('boodschappen', { id: 'c1' });   // no tag: a line the circle would otherwise get
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all([turn, answer]);

    expect(posted).toEqual([]);
    expect(model.seen).toHaveLength(1);
    expect(ran).toEqual([{ opId: 'addItem', args: { text: 'melk', type: 'shopping' } }]);
    expect(pendingNow()).toBeNull();
  });

  it('with nothing asked, a line for the circle still goes to the circle at once', async () => {
    const { engine, posted } = circleDoor(untypedAdd());
    await engine.handle('ik koop straks melk', { id: 'c1' });
    expect(posted).toEqual(['ik koop straks melk']);
  });

  it('the claim: only with an ask pending, never a slash command; it completes the ask once, in the list\'s declared value', async () => {
    let pending = beginFollowUp({ dispatch: resolveDispatch({ kind: 'slash', opId: 'addItem', args: { text: 'melk' } }, catalogue), t });
    const ran = [];
    const claim = followUpClaim({ pending: () => pending, clear: () => { pending = null; }, dispatchReady: (cmd) => { ran.push(cmd); }, catalogue });
    expect(claim('/mine')).toBeNull();
    const own = claim('boodschappen');
    expect(typeof own).toBe('function');
    expect(ran).toEqual([]);   // deciding does not act
    await own();
    expect(ran).toEqual([{ opId: 'addItem', args: { text: 'melk', type: 'shopping' } }]);
    expect(pending).toBeNull();
    expect(claim('brood')).toBeNull();
  });
});

describe('which door collects', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  /** The `createAssistantEngine({ … })` call in a shell, up to its closing `})`. */
  const engineCall = (src) => { const i = src.indexOf('createAssistantEngine({'); return i < 0 ? '' : src.slice(i, src.indexOf('\n  }', i) + 4); };

  it('the circle composers do not wait (a person types one line on purpose there) and hand their pending ask to the lane', () => {
    for (const shell of ['../web/v2/circleApp.js', '../../basis-mobile/src/screens/v2/CircleLauncherScreen.js']) {
      const call = engineCall(read(shell));
      expect(call, shell).toMatch(/collectMs:\s*0\b/);
      expect(call, shell).toMatch(/claim:\s*followUpClaim\(/);
    }
  });

  it('the box keeps the default window: quick lines arrive as separate messages on a chat app', () => {
    const src = read('../bin/device-runner.mjs');
    const i = src.indexOf('createTelegramRunner({');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, src.indexOf('});', i))).not.toMatch(/collectMs/);
  });
});
