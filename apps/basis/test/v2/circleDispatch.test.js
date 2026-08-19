import { describe, it, expect, vi } from 'vitest';
import { createCircleDispatch, addressesBot } from '../../src/v2/circleDispatch.js';

// A minimal harness: records what the shell would have done.
function harness({ policy = { llmTool: 'off' }, providers = {}, interpret, botName, userDefault, gate, recentTurns, onLlmUnavailable, onNoMatch } = {}) {
  const dispatched = [];
  const posted = [];
  const unavailable = [];
  const noMatched = [];
  const cd = createCircleDispatch({
    policy,
    userDefault,
    llmProviders: providers,
    interpret,
    botName,
    gate,
    recentTurns,
    dispatch: (slash) => { dispatched.push(slash); },
    postToCircle: (text) => { posted.push(text); },
    ...(onLlmUnavailable ? { onLlmUnavailable: (text, ctx, info) => { unavailable.push({ text, info }); } } : {}),
    ...(onNoMatch ? { onNoMatch: (text, ctx, opts) => { noMatched.push({ text, reply: opts && opts.reply }); } } : {}),
  });
  return { cd, dispatched, posted, unavailable, noMatched };
}

describe('createCircleDispatch — routing', () => {
  it('dispatches an explicit slash command verbatim', async () => {
    const { cd, dispatched, posted } = harness();
    const r = await cd.handle('/done milk');
    expect(r.via).toBe('slash');
    expect(dispatched).toEqual(['/done milk']);
    expect(posted).toEqual([]);
  });

  it('posts free text to the circle when llmTool is off', async () => {
    const interpret = vi.fn();
    const { cd, dispatched, posted } = harness({ policy: { llmTool: 'off' }, interpret });
    const r = await cd.handle('@bot add milk to the list');
    expect(r.via).toBe('circle');
    expect(interpret).not.toHaveBeenCalled();   // no LLM when off — never accidentally invoked
    expect(dispatched).toEqual([]);
    expect(posted).toEqual(['@bot add milk to the list']);
  });

  it('posts free text to the circle when the bot is NOT addressed (even with llmTool on)', async () => {
    const interpret = vi.fn();
    const { cd, dispatched, posted } = harness({
      policy: { llmTool: 'local' }, providers: { local: { invoke: vi.fn() } }, interpret,
    });
    const r = await cd.handle('anyone going to the shop later?');
    expect(r.via).toBe('circle');
    expect(interpret).not.toHaveBeenCalled();   // bystander chatter is never sent to the LLM
    expect(posted).toEqual(['anyone going to the shop later?']);
  });

  it('interprets addressed free text → slash → dispatch when llmTool is on', async () => {
    const interpret = vi.fn(async () => ({ opId: 'addTask', args: { title: 'milk' } }));
    const { cd, dispatched, posted } = harness({
      policy: { llmTool: 'local' }, providers: { local: { invoke: vi.fn() } }, interpret, botName: 'helper',
    });
    const r = await cd.handle('@helper add milk to the list');
    expect(r.via).toBe('llm');
    expect(interpret).toHaveBeenCalledTimes(1);
    // the bot tag is stripped before it reaches the interpreter
    expect(interpret.mock.calls[0][0]).not.toMatch(/@helper/i);
    // the LLM path dispatches by {opId,args} (like a button tap), not a fabricated slash string
    expect(dispatched).toEqual([{ opId: 'addTask', args: { title: 'milk' } }]);
    expect(posted).toEqual([]);
  });

  it('threads recentTurns into the interpret context (conversation memory)', async () => {
    const interpret = vi.fn(async () => ({ opId: 'addTask', args: { title: 'bread' } }));
    const { cd, dispatched } = harness({
      policy: { llmTool: 'local' }, providers: { local: { invoke: vi.fn() } }, interpret, botName: 'helper',
      recentTurns: () => ['you: add milk', 'assistant: Added milk to the list'],
    });
    await cd.handle('@helper and bread too');
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(interpret.mock.calls[0][1].context).toEqual(['you: add milk', 'assistant: Added milk to the list']);
    expect(dispatched).toEqual([{ opId: 'addTask', args: { title: 'bread' } }]);
  });

  it('prepends recentTurns IN FRONT of any gate context', async () => {
    const interpret = vi.fn(async () => null);
    const { cd } = harness({
      policy: { llmTool: 'local' }, providers: { local: { invoke: vi.fn() } }, interpret, botName: 'helper',
      gate: { evaluate: async () => ({ via: 'context', context: ['rag: list has eggs'] }) },
      recentTurns: () => ['you: add milk'],
    });
    await cd.handle('@helper and bread');
    expect(interpret.mock.calls[0][1].context).toEqual(['you: add milk', 'rag: list has eggs']);
  });

  it('falls back to a circle post when the interpreter returns null', async () => {
    const interpret = vi.fn(async () => null);
    const { cd, dispatched, posted } = harness({
      policy: { llmTool: 'cloud' }, providers: { cloud: { invoke: vi.fn() } }, interpret,
    });
    const r = await cd.handle('@bot what do you think of the weather');
    expect(r.via).toBe('circle');
    expect(dispatched).toEqual([]);
    expect(posted).toEqual(['@bot what do you think of the weather']);
  });

  it('surfaces the LLM conversational reply (no tool) via onNoMatch → via:llm-reply', async () => {
    const interpret = vi.fn(async () => ({ reply: 'Which list — tasks or items?' }));
    const { cd, noMatched, dispatched } = harness({
      policy: { llmTool: 'cloud' }, providers: { cloud: { invoke: vi.fn() } }, interpret,
      onNoMatch: true, botName: 'bot',
    });
    const r = await cd.handle('@bot what is on the list');
    expect(r.via).toBe('llm-reply');
    expect(dispatched).toEqual([]);
    expect(noMatched).toEqual([{ text: 'what is on the list', reply: 'Which list — tasks or items?' }]);
  });

  it('no tool AND no reply → onNoMatch with no reply → via:llm-nomatch', async () => {
    const interpret = vi.fn(async () => null);
    const { cd, noMatched } = harness({
      policy: { llmTool: 'cloud' }, providers: { cloud: { invoke: vi.fn() } }, interpret,
      onNoMatch: true, botName: 'bot',
    });
    const r = await cd.handle('@bot hii');
    expect(r.via).toBe('llm-nomatch');
    expect(noMatched).toEqual([{ text: 'hii', reply: undefined }]);
  });

  it('forwards ctx.history to interpret (conversational follow-up memory)', async () => {
    const interpret = vi.fn(async () => ({ opId: 'listOpen', args: { type: 'shopping' } }));
    const { cd, dispatched } = harness({
      policy: { llmTool: 'cloud' }, providers: { cloud: { invoke: vi.fn() } }, interpret, botName: 'bot',
    });
    const history = [{ role: 'user', content: 'what is on the list' }, { role: 'assistant', content: 'which list?' }];
    await cd.handle('@bot shopping', { history });
    expect(interpret).toHaveBeenCalledOnce();
    expect(interpret.mock.calls[0][1].history).toEqual(history);
    expect(dispatched).toEqual([{ opId: 'listOpen', args: { type: 'shopping' } }]);
  });

  it("circle 'user' delegates to the member's default", async () => {
    const interpret = vi.fn(async () => ({ opId: 'addTask', args: { title: 'milk' } }));
    // user mode local + provider present → interprets
    const on = harness({ policy: { llmTool: 'user' }, providers: { local: { invoke: vi.fn() } }, interpret, userDefault: { mode: 'local' }, botName: 'helper' });
    expect((await on.cd.handle('@helper add milk')).via).toBe('llm');
    // user mode off → no LLM, posts to circle
    const off = harness({ policy: { llmTool: 'user' }, providers: { local: { invoke: vi.fn() } }, interpret: vi.fn(), userDefault: { mode: 'off' }, botName: 'helper' });
    expect((await off.cd.handle('@helper add milk')).via).toBe('circle');
  });

  it('token gate: a rule routes directly (via rule, no interpret); a skip → circle', async () => {
    const providers = { local: { invoke: vi.fn() } };
    const interpretRule = vi.fn();
    const rule = harness({ policy: { llmTool: 'local' }, providers, interpret: interpretRule, botName: 'helper',
      gate: { evaluate: async () => ({ via: 'rule', command: { opId: 'listOpen', args: {} } }) } });
    const r1 = await rule.cd.handle('@helper open?');
    expect(r1.via).toBe('rule');
    expect(rule.dispatched).toEqual([{ opId: 'listOpen', args: {} }]);
    expect(interpretRule).not.toHaveBeenCalled();

    const interpretSkip = vi.fn();
    const skip = harness({ policy: { llmTool: 'local' }, providers, interpret: interpretSkip, botName: 'helper',
      gate: { evaluate: async () => ({ via: 'skip' }) } });
    const r2 = await skip.cd.handle('@helper hi there');
    expect(r2.via).toBe('circle');
    expect(skip.posted).toEqual(['@helper hi there']);
    expect(interpretSkip).not.toHaveBeenCalled();
  });

  it('BASIC MODE — the deterministic gate routes even when smart chat is OFF (no LLM)', async () => {
    // The gate is deterministic; "add milk" must work without an LLM configured.
    const interpret = vi.fn();
    const { cd, dispatched } = harness({
      policy: { llmTool: 'off' }, interpret, botName: 'helper',
      gate: { evaluate: async () => ({ via: 'rule', command: { opId: 'addItem', args: { text: 'milk' } } }) },
    });
    const r = await cd.handle('@helper add milk');
    expect(r.via).toBe('rule');
    expect(dispatched).toEqual([{ opId: 'addItem', args: { text: 'milk' } }]);
    expect(interpret).not.toHaveBeenCalled();   // never touched the (absent) LLM
  });

  it('BASIC MODE — free text the gate cannot route, smart chat OFF → onLlmUnavailable(reason:off)', async () => {
    const interpret = vi.fn();
    const { cd, unavailable, posted } = harness({
      policy: { llmTool: 'off' }, interpret, botName: 'helper',
      gate: { evaluate: async () => ({ via: 'context', context: [] }) },   // no rule, no skip
      onLlmUnavailable: true,
    });
    const r = await cd.handle('@helper what do I still need from the shop?');
    expect(r.via).toBe('llm-unavailable');
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0].info.reason).toBe('off');
    expect(interpret).not.toHaveBeenCalled();
    expect(posted).toEqual([]);                 // replied basic-mode, did NOT silently post
  });

  it('UNREACHABLE — smart chat configured but the endpoint throws → onLlmUnavailable(reason:unreachable)', async () => {
    const interpret = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const { cd, unavailable } = harness({
      policy: { llmTool: 'local' }, providers: { local: { invoke: vi.fn() } }, interpret, botName: 'helper',
      onLlmUnavailable: true,
    });
    const r = await cd.handle('@helper summarise the list');
    expect(r.via).toBe('llm-unavailable');
    expect(unavailable[0].info.reason).toBe('unreachable');
  });

  it('back-compat — interpret throwing with NO onLlmUnavailable hook still propagates', async () => {
    const interpret = vi.fn(async () => { throw new Error('down'); });
    const { cd } = harness({ policy: { llmTool: 'local' }, providers: { local: { invoke: vi.fn() } }, interpret, botName: 'helper' });
    await expect(cd.handle('@helper hi')).rejects.toThrow('down');
  });

  it('treats blank input as a no-op', async () => {
    const { cd, dispatched, posted } = harness();
    const r = await cd.handle('   ');
    expect(r.via).toBe('none');
    expect(dispatched).toEqual([]);
    expect(posted).toEqual([]);
  });

  it('requires dispatch (the unhandled sink — postToCircle/onUnhandled — is optional)', () => {
    expect(() => createCircleDispatch({ postToCircle: () => {} })).toThrow();      // no dispatch → throws
    expect(() => createCircleDispatch({ dispatch: () => {} })).not.toThrow();     // dispatch alone is enough now
  });
});

describe('addressesBot', () => {
  it('matches @bot / @assistent / @assistant', () => {
    expect(addressesBot('@bot do x', 'helper')).toBe(true);
    expect(addressesBot('hey @assistent voeg toe', 'helper')).toBe(true);
    expect(addressesBot('@assistant add', 'helper')).toBe(true);
  });
  it('matches the configured name as @tag or leading address', () => {
    expect(addressesBot('@helper add milk', 'helper')).toBe(true);
    expect(addressesBot('helper, add milk', 'helper')).toBe(true);
    expect(addressesBot('helper add milk', 'helper')).toBe(true);
  });
  it('does not match bystander chatter', () => {
    expect(addressesBot('is the helper coming?', 'helper')).toBe(false);
    expect(addressesBot('anyone going to the shop?', 'helper')).toBe(false);
  });
});
