/**
 * The egress gate at the box's waist, for a toolbox's tools (ledger L1035).
 *
 * @guard what leaves for a toolbox is exactly the tool and its input; a toolbox that is not on is refused before the call; every call is recorded with who, which toolbox and which tool, never the words
 *
 * The apps that reach outside are the ones whose manifest declares the reserved host `'@placed'` (the hosts a box's
 * operator places): the gate's list and the manifests agree by construction, never by a hand list.
 */
import { describe, it, expect, vi } from 'vitest';
import { wrapCallSkillWithEgressGate, isExternalEgressOp, externalOrigins } from '../src/core/agent/egressGate.js';
import { allManifests } from '../src/v2/manifestSources.js';

describe('the apps that reach outside are the manifests\' own word', () => {
  it('exactly the origins whose manifest declares \'@placed\'; the others (lists, assistant, params…) are local', () => {
    const placed = allManifests().filter((m) => (m.hosts ?? []).includes('@placed')).map((m) => m.app).sort();
    expect([...externalOrigins(allManifests())].sort()).toEqual(placed);
    expect(placed).toEqual(['tools']);
    for (const local of ['lists', 'assistant', 'params', 'pinboard', 'household', 'tasks', 'calendar']) expect(isExternalEgressOp(local, 'x', allManifests())).toBe(false);
    expect(isExternalEgressOp('tools', 'useTool', allManifests())).toBe(true);
  });
});

describe('a toolbox call through the gate', () => {
  const toolbox = { isOn: (name) => name === 'boodschappen' };
  const make = () => {
    const inner = vi.fn(async () => ({ ok: true, items: [] }));
    const records = [];
    const gated = wrapCallSkillWithEgressGate(inner, {
      isExternalEgress: (app) => app === 'tools',
      toolCall: { isOn: toolbox.isOn, record: (r) => records.push(r) },
    });
    return { inner, records, gated };
  };

  it('only the tool and its input leave; the call\'s context is kept', async () => {
    const { inner, gated } = make();
    const ctx = { caller: 'telegram:7', door: 'slash', lang: 'nl' };
    await gated('tools', 'useTool', { toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' }, circleId: 'c1', note: 'x' }, ctx);
    expect(inner).toHaveBeenCalledWith('tools', 'useTool', { toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'melk' } }, ctx);
  });

  it('a toolbox that is not on is refused before the call', async () => {
    const { inner, gated, records } = make();
    const r = await gated('tools', 'useTool', { toolbox: 'elders', tool: 't', input: {} }, { caller: 'telegram:7' });
    expect(r).toMatchObject({ ok: false, code: 'toolbox-off', name: 'elders' });
    expect(inner).not.toHaveBeenCalled();
    expect(records).toEqual([{ person: 'telegram:7', toolbox: 'elders', tool: 't', outcome: 'refused' }]);
  });

  it('every call is recorded: who, which toolbox and tool, how it ended; never the words', async () => {
    const { gated, records } = make();
    await gated('tools', 'useTool', { toolbox: 'boodschappen', tool: 'products.choices', input: { query: 'geheime boodschap' } }, { caller: 'telegram:7' });
    expect(records).toEqual([{ person: 'telegram:7', toolbox: 'boodschappen', tool: 'products.choices', outcome: 'ok' }]);
    expect(JSON.stringify(records)).not.toContain('geheime');
  });

  it('the toolbox\'s other ops (list, switch) are not calls out and pass untouched', async () => {
    const { inner, gated, records } = make();
    await gated('tools', 'listTools', { all: true }, { caller: 'telegram:1' });
    expect(inner).toHaveBeenCalledWith('tools', 'listTools', { all: true }, { caller: 'telegram:1' });
    expect(records).toEqual([]);
  });
});

describe('the record of a toolbox call', () => {
  it('whitelisted keys only: who, which toolbox, which tool, how it ended; never the words', async () => {
    const { makeToolCallEntry, TOOL_CALL_KIND } = await import('../src/v2/toolboxes.js');
    const { ENTRY_KINDS } = await import('@onderling/item-store');
    const e = makeToolCallEntry({ person: 'telegram:7', toolbox: 'boodschappen', tool: 'products.choices', outcome: 'ok', input: { query: 'geheim' }, ts: 1 });
    expect(e).toMatchObject({ type: TOOL_CALL_KIND, ts: 1, payload: { person: 'telegram:7', toolbox: 'boodschappen', tool: 'products.choices', outcome: 'ok' } });
    expect(JSON.stringify(e)).not.toContain('geheim');
    expect(ENTRY_KINDS[TOOL_CALL_KIND], 'the kind is declared').toBeTruthy();
  });
});
