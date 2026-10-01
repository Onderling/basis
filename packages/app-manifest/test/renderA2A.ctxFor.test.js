/**
 * A shell that answers a door AS a person (a household bot) decides who a peer's call runs as: `ctxFor` reads the
 * verified call (its token's `actingAs`) and returns the waist's ctx — or nothing, and the call is refused before the
 * op (`not-bound`). Without `ctxFor` nothing changes (a person's own agent: its screen IS the owner). `never` adds the
 * shell's own withheld ops to the kernel's list.
 */
import { describe, it, expect } from 'vitest';
import { renderA2A } from '../src/renderA2A.js';

const manifest = { appId: 'lists', operations: [
  { id: 'addToList', verb: 'add', params: [{ name: 'list' }, { name: 'text' }] },
  { id: 'removeList', verb: 'remove', params: [{ name: 'list' }], surfaces: { ui: { confirm: { preview: true } } } },
] };

describe('renderA2A — ctxFor and never', () => {
  it('passes the ctx ctxFor gives; refuses when it gives none; unchanged without it', async () => {
    const calls = [];
    const callSkill = async (app, op, args, ctx) => { calls.push({ app, op, args, ctx: ctx ?? null }); return { ok: true }; };
    const ctxFor = async (h) => (h.envelope?.payload?._token?.constraints?.actingAs ? { caller: h.envelope.payload._token.constraints.actingAs } : null);
    const [add] = renderA2A(manifest, { callSkill }, { ctxFor });
    await add.handler({ parts: [{ data: { list: 'B', text: 'melk' } }], envelope: { payload: { _token: { constraints: { actingAs: 'telegram:1' } } } } });
    expect(calls[0].ctx).toEqual({ caller: 'telegram:1' });
    const refused = await add.handler({ parts: [{ data: {} }], envelope: { payload: { _token: {} } } });
    expect(refused).toMatchObject({ ok: false, error: 'not-bound' });
    expect(calls).toHaveLength(1);
    const [plain] = renderA2A(manifest, { callSkill });
    await plain.handler({ parts: [{ data: { x: 1 } }] });
    expect(calls[1].ctx).toBeNull();
  });

  it('with ctxFor, only the op\'s declared params reach the waist (plus `preview` where the op declares one)', async () => {
    const calls = [];
    const callSkill = async (app, op, args) => { calls.push(args); return { ok: true }; };
    const ctxFor = async () => ({ caller: 'telegram:1' });
    const [add, remove] = renderA2A(manifest, { callSkill }, { ctxFor });
    const sneaky = { circleId: 'pair-2', groupId: 'g', actor: 'telegram:9', caller: 'telegram:9', threadId: 'telegram:9', createdBy: 'telegram:9' };
    await add.handler({ parts: [{ data: { list: 'B', text: 'melk', preview: true, ...sneaky } }] });
    await remove.handler({ parts: [{ data: { list: 'B', preview: true, ...sneaky } }] });
    expect(calls[0]).toEqual({ list: 'B', text: 'melk' });
    expect(calls[1]).toEqual({ list: 'B', preview: true });
    // without ctxFor (a person's own agent, whose screen IS the owner) the args pass as before
    const [plain] = renderA2A(manifest, { callSkill });
    await plain.handler({ parts: [{ data: { list: 'B', extra: 1 } }] });
    expect(calls[2]).toEqual({ list: 'B', extra: 1 });
  });

  it('`never` withholds the shell\'s own ops besides the kernel\'s', () => {
    const defs = renderA2A(manifest, { callSkill: async () => ({}) }, { never: ['lists.removeList'] });
    expect(defs.find((d) => d.id === 'lists.removeList').policy).toBe('never');
    expect(defs.find((d) => d.id === 'lists.addToList').policy).toBe('requires-token');
  });
});
