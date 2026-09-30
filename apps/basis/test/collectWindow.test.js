/**
 * The collect window, measured (2026-09-30): a rule-read the bot finished in 5 ms reached the person after 1.7–1.9 s,
 * 1.5 s of it the window every free-text line waited out. Fable's answer: a line a gate rule takes does not wait —
 * after the lines already waiting are flushed, so the order holds — and a line for the model waits ~0.8 s.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAssistantEngine } from '../src/v2/assistantEngine.js';
import { createTokenGate } from '../src/v2/tokenGate.js';
import { COLLECT_MS } from '../src/v2/assistantLane.js';

const catalogue = { opsById: new Map(), commandMenu: [] };
const RULES = [{ name: 'add', test: /^zet (.+) op de boodschappen$/i, command: (t) => ({ opId: 'addToList', args: { list: 'Boodschappen', text: /^zet (.+) op/i.exec(t)[1] } }) }];

describe('the collect window', () => {
  afterEach(() => vi.useRealTimers());

  it('is about 0.8 s for a line the model reads', () => {
    expect(COLLECT_MS).toBe(800);
  });

  it('a line a rule takes does not wait; a model line waiting before it is flushed first, in order', async () => {
    vi.useFakeTimers();
    const order = [];
    const interpret = vi.fn(async () => ({ opId: 'addToList', args: { list: 'Boodschappen', text: 'model' } }));
    const engine = createAssistantEngine({
      catalogue, llm: { invoke: async () => null }, interpret, collectMs: 800,
      gate: createTokenGate({ rules: RULES }),
      dispatch: (input) => { order.push(input.args.text); },
      onNoMatch: () => {},
    });
    const first = engine.ask('t', 'melk graag');                    // the model's line: would wait 800 ms…
    await vi.advanceTimersByTimeAsync(50);
    const second = engine.ask('t', 'zet kaas op de boodschappen');   // …a rule's line arrives: flush, then run it
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([first, second]);
    expect(order).toEqual(['model', 'kaas']);                       // in order, and well before the 800 ms were up
  });

  it('a rule\'s line on its own runs at once', async () => {
    vi.useFakeTimers();
    const order = [];
    const engine = createAssistantEngine({
      catalogue, llm: { invoke: async () => null }, interpret: async () => null, collectMs: 800,
      gate: createTokenGate({ rules: RULES }),
      dispatch: (input) => { order.push(input.args.text); }, onNoMatch: () => {},
    });
    const done = engine.ask('t', 'zet melk op de boodschappen');
    await vi.advanceTimersByTimeAsync(20);
    await done;
    expect(order).toEqual(['melk']);
  });
});
