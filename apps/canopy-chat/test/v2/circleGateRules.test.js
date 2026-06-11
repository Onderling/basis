import { describe, it, expect, vi } from 'vitest';
import { defaultCircleGateRules } from '../../src/v2/circleGateRules.js';
import { createTokenGate } from '../../src/v2/tokenGate.js';
import { createCircleDispatch } from '../../src/v2/circleDispatch.js';

const gate = () => createTokenGate({ rules: defaultCircleGateRules() });
const route = (text) => gate().evaluate(text, {});

describe('circle gate rules — deterministic routing (no LLM)', () => {
  it('"add X to the list" → addTask{text:X}, dropping the list qualifier', async () => {
    const r = await route('add milk to the list');
    expect(r.via).toBe('rule');
    expect(r.command).toEqual({ opId: 'addTask', args: { text: 'milk' } });
  });

  it('add without a qualifier keeps the whole item', async () => {
    expect((await route('add buy fresh milk')).command).toEqual({ opId: 'addTask', args: { text: 'buy fresh milk' } });
  });

  it('todo verb routes to addTask', async () => {
    expect((await route('todo call the dentist')).command).toEqual({ opId: 'addTask', args: { text: 'call the dentist' } });
  });

  it('Dutch: "voeg melk toe" and "zet melk op de lijst" → addTask', async () => {
    expect((await route('voeg melk toe')).command).toEqual({ opId: 'addTask', args: { text: 'melk' } });
    expect((await route('zet melk op de lijst')).command).toEqual({ opId: 'addTask', args: { text: 'melk' } });
  });

  it('"done X" / "mark X as done" → completeTask{id:X}', async () => {
    expect((await route('done the dishes')).command).toEqual({ opId: 'completeTask', args: { id: 'the dishes' } });
    expect((await route('mark the dishes as done')).command).toEqual({ opId: 'completeTask', args: { id: 'the dishes' } });
  });

  it('Dutch: "klaar met afwas" → completeTask', async () => {
    expect((await route('klaar met afwas')).command).toEqual({ opId: 'completeTask', args: { id: 'afwas' } });
  });

  it('"claim X" / "I\'ll take X" → claimTask{id:X}', async () => {
    expect((await route('claim the dishes')).command).toEqual({ opId: 'claimTask', args: { id: 'the dishes' } });
    expect((await route("I'll take the trash")).command).toEqual({ opId: 'claimTask', args: { id: 'the trash' } });
  });

  it('Dutch: "ik pak de afwas" → claimTask', async () => {
    expect((await route('ik pak de afwas')).command).toEqual({ opId: 'claimTask', args: { id: 'de afwas' } });
  });

  it('unmatched free text falls through to the LLM', async () => {
    expect((await route('what should we cook tonight?')).via).toBe('llm');
  });

  it('a bare verb with no target falls through to the LLM (rule returns null)', async () => {
    expect((await route('add')).via).toBe('llm');
    expect((await route('done')).via).toBe('llm');
  });

  it('op-id overrides are honoured', async () => {
    const g = createTokenGate({ rules: defaultCircleGateRules({ addOp: 'app:add' }) });
    expect((await g.evaluate('add milk', {})).command.opId).toBe('app:add');
  });
});

describe('circle bot + token gate — routing precedence', () => {
  function setup() {
    const dispatched = [];
    const interpret = vi.fn(async () => ({ opId: 'fromLlm', args: {} }));
    const bot = createCircleDispatch({
      policy: { llmTool: 'local' },
      llmProviders: { local: { chat: async () => '' } },          // truthy llm so the gate path runs
      interpret,
      dispatch: (cmd) => dispatched.push(cmd),
      postToKring: () => {},
      gate: gate(),
    });
    return { bot, dispatched, interpret };
  }

  it('a matched rule routes BEFORE the LLM (interpret never called)', async () => {
    const { bot, dispatched, interpret } = setup();
    const r = await bot.handle('@assistant add milk to the list');
    expect(r.via).toBe('rule');
    expect(dispatched).toEqual([{ opId: 'addTask', args: { text: 'milk' } }]);
    expect(interpret).not.toHaveBeenCalled();
  });

  it('unmatched free text still reaches the LLM', async () => {
    const { bot, dispatched, interpret } = setup();
    const r = await bot.handle('@assistant what is for dinner');
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(r.via).toBe('llm');
    expect(dispatched).toEqual([{ opId: 'fromLlm', args: {} }]);
  });
});
