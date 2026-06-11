import { describe, it, expect, vi } from 'vitest';
import { createCircleDispatch, addressesBot } from '../../src/v2/circleDispatch.js';

// A minimal harness: records what the shell would have done.
function harness({ policy = { llmTool: 'off' }, providers = {}, interpret, botName, userDefault, gate } = {}) {
  const dispatched = [];
  const posted = [];
  const cd = createCircleDispatch({
    policy,
    userDefault,
    llmProviders: providers,
    interpret,
    botName,
    gate,
    dispatch: (slash) => { dispatched.push(slash); },
    postToKring: (text) => { posted.push(text); },
  });
  return { cd, dispatched, posted };
}

describe('createCircleDispatch — routing', () => {
  it('dispatches an explicit slash command verbatim', async () => {
    const { cd, dispatched, posted } = harness();
    const r = await cd.handle('/done milk');
    expect(r.via).toBe('slash');
    expect(dispatched).toEqual(['/done milk']);
    expect(posted).toEqual([]);
  });

  it('posts free text to the kring when llmTool is off', async () => {
    const interpret = vi.fn();
    const { cd, dispatched, posted } = harness({ policy: { llmTool: 'off' }, interpret });
    const r = await cd.handle('@bot add milk to the list');
    expect(r.via).toBe('kring');
    expect(interpret).not.toHaveBeenCalled();   // no LLM when off — never accidentally invoked
    expect(dispatched).toEqual([]);
    expect(posted).toEqual(['@bot add milk to the list']);
  });

  it('posts free text to the kring when the bot is NOT addressed (even with llmTool on)', async () => {
    const interpret = vi.fn();
    const { cd, dispatched, posted } = harness({
      policy: { llmTool: 'local' }, providers: { local: { invoke: vi.fn() } }, interpret,
    });
    const r = await cd.handle('anyone going to the shop later?');
    expect(r.via).toBe('kring');
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

  it('falls back to a kring post when the interpreter returns null', async () => {
    const interpret = vi.fn(async () => null);
    const { cd, dispatched, posted } = harness({
      policy: { llmTool: 'cloud' }, providers: { cloud: { invoke: vi.fn() } }, interpret,
    });
    const r = await cd.handle('@bot what do you think of the weather');
    expect(r.via).toBe('kring');
    expect(dispatched).toEqual([]);
    expect(posted).toEqual(['@bot what do you think of the weather']);
  });

  it("circle 'user' delegates to the member's default", async () => {
    const interpret = vi.fn(async () => ({ opId: 'addTask', args: { title: 'milk' } }));
    // user mode local + provider present → interprets
    const on = harness({ policy: { llmTool: 'user' }, providers: { local: { invoke: vi.fn() } }, interpret, userDefault: { mode: 'local' }, botName: 'helper' });
    expect((await on.cd.handle('@helper add milk')).via).toBe('llm');
    // user mode off → no LLM, posts to kring
    const off = harness({ policy: { llmTool: 'user' }, providers: { local: { invoke: vi.fn() } }, interpret: vi.fn(), userDefault: { mode: 'off' }, botName: 'helper' });
    expect((await off.cd.handle('@helper add milk')).via).toBe('kring');
  });

  it('token gate: a rule routes directly (via rule, no interpret); a skip → kring', async () => {
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
    expect(r2.via).toBe('kring');
    expect(skip.posted).toEqual(['@helper hi there']);
    expect(interpretSkip).not.toHaveBeenCalled();
  });

  it('treats blank input as a no-op', async () => {
    const { cd, dispatched, posted } = harness();
    const r = await cd.handle('   ');
    expect(r.via).toBe('none');
    expect(dispatched).toEqual([]);
    expect(posted).toEqual([]);
  });

  it('requires dispatch (the unhandled sink — postToKring/onUnhandled — is optional)', () => {
    expect(() => createCircleDispatch({ postToKring: () => {} })).toThrow();      // no dispatch → throws
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
