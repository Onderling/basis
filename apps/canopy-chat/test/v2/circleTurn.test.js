import { describe, it, expect, vi } from 'vitest';
import { createCircleTurn } from '../../src/v2/circleTurn.js';

const CATALOG = { opsById: new Map([['addTask', { op: { id: 'addTask', params: [{ name: 'title', kind: 'string', required: true }] } }]]) };

function setup({ llmTool = 'local', providers = { local: { invoke: vi.fn() } }, interpret, userDefault } = {}) {
  const dispatched = [];
  const handle = createCircleTurn({
    policyFor: (scope) => scope?.policy ?? { llmTool },
    llmProviders: providers,
    catalog: () => CATALOG,
    botName: 'helper',
    userDefault,
    interpret: interpret ?? (async () => ({ opId: 'addTask', args: { title: 'milk' } })),
    dispatchCommand: (cmd, scope) => { dispatched.push({ cmd, scope }); },
  });
  return { handle, dispatched };
}

describe('createCircleTurn (web interceptor)', () => {
  it('intercepts addressed free text → dispatches the interpreted command (scoped)', async () => {
    const { handle, dispatched } = setup();
    const scope = { id: 'thread-1' };
    const r = await handle('@helper add milk', scope);
    expect(r).toBe(true);
    expect(dispatched).toEqual([{ cmd: { opId: 'addTask', args: { title: 'milk' } }, scope }]);
  });

  it('falls through (false) for slash commands — the shell handles them', async () => {
    const { handle, dispatched } = setup();
    expect(await handle('/done milk', {})).toBe(false);
    expect(dispatched).toEqual([]);
  });

  it('falls through when the bot is not addressed', async () => {
    const { handle, dispatched } = setup();
    expect(await handle('anyone going to the shop?', {})).toBe(false);
    expect(dispatched).toEqual([]);
  });

  it('falls through when the circle llmTool is off (LLM never consulted)', async () => {
    const interpret = vi.fn();
    const { handle, dispatched } = setup({ llmTool: 'off', interpret });
    expect(await handle('@helper add milk', {})).toBe(false);
    expect(interpret).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
  });

  it('falls through when the interpreter finds no command', async () => {
    const { handle, dispatched } = setup({ interpret: async () => null });
    expect(await handle('@helper how are you?', {})).toBe(false);
    expect(dispatched).toEqual([]);
  });

  it('reads policy per-scope (one circle on, another off)', async () => {
    const { handle, dispatched } = setup();
    expect(await handle('@helper add milk', { policy: { llmTool: 'off' } })).toBe(false);
    expect(await handle('@helper add milk', { policy: { llmTool: 'local' } })).toBe(true);
    expect(dispatched.length).toBe(1);
  });

  it('requires dispatchCommand', () => {
    expect(() => createCircleTurn({})).toThrow();
  });

  it("circle 'user' delegates to the member's default (mode local → dispatches)", async () => {
    const { handle, dispatched } = setup({ providers: { local: { invoke: vi.fn() } }, userDefault: { mode: 'local' } });
    expect(await handle('@helper add milk', { policy: { llmTool: 'user' } })).toBe(true);
    expect(dispatched).toHaveLength(1);
  });

  it("circle 'user' with no member default → falls through (off)", async () => {
    const interpret = vi.fn();
    const { handle, dispatched } = setup({ providers: { local: { invoke: vi.fn() } }, interpret });
    expect(await handle('@helper add milk', { policy: { llmTool: 'user' } })).toBe(false);
    expect(interpret).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
  });

  it("circle 'off' beats the member default (privacy hard-stop)", async () => {
    const interpret = vi.fn();
    const { handle, dispatched } = setup({ providers: { local: { invoke: vi.fn() } }, interpret, userDefault: { mode: 'local' } });
    expect(await handle('@helper add milk', { policy: { llmTool: 'off' } })).toBe(false);
    expect(interpret).not.toHaveBeenCalled();
    expect(dispatched).toEqual([]);
  });

  it('accepts userDefault as a getter (read fresh each turn)', async () => {
    let mode = 'off';
    const { handle, dispatched } = setup({ providers: { local: { invoke: vi.fn() } }, userDefault: () => ({ mode }) });
    expect(await handle('@helper add milk', { policy: { llmTool: 'user' } })).toBe(false);  // off
    mode = 'local';
    expect(await handle('@helper add milk', { policy: { llmTool: 'user' } })).toBe(true);   // now on
    expect(dispatched).toHaveLength(1);
  });
});
