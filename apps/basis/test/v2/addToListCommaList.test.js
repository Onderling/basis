/**
 * WHAT IS ONE ITEM IS THE MODEL'S CALL, not a comma rule's (Frits 2026-10-18: "dishes need to be done, but pans should
 * be done first" is ONE thing; a rule of exceptions would never be right). So the deterministic gate leaves a line with
 * a comma list to the model, the op stores what it is given as one line, and the model's tool says: one call per thing,
 * a sentence stays one.
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeListsOps } from '../../src/v2/listsOps.js';
import { listsGateRules } from '../../src/v2/circleGate.js';
import { templateLists } from '../../src/v2/householdTemplate.js';
import { listsManifest } from '../../../lists/manifest.js';

function listsWorld() {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
  const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
  return makeListsOps({ storeFor: (cid) => stores.getStore(cid), t, activeCircle: () => 'c1' });
}
const texts = async (ops, list) => ((await ops.listEntries({ list }))?.items ?? []).map((i) => i.text ?? i.label).sort();
const names = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const rules = listsGateRules('nl', templateLists((k) => names[k] ?? k));
const take = (text) => { for (const r of rules) { const c = r.command(text); if (c) return c; } return null; };

describe('one item or several — the model decides', () => {
  it('the op stores what it is given as one line — a sentence with a comma stays one', async () => {
    const ops = listsWorld();
    await ops.createList({ text: 'Klusjes', defaultChild: 'task' });
    await ops.addToList({ list: 'Klusjes', text: 'de afwas moet gedaan, maar eerst de pannen' });
    expect(await texts(ops, 'Klusjes')).toEqual(['de afwas moet gedaan, maar eerst de pannen']);
  });
  it('the gate leaves a comma line to the model; a single thing it still takes', () => {
    expect(take('zet melk, brood en eieren op de boodschappen'), 'a comma list is the model\'s').toBe(null);
    expect(take('zet melk op de boodschappen')).toMatchObject({ opId: 'addToList', args: { text: 'melk' } });
  });
  it('the model is told: one call per thing, a sentence stays one', () => {
    const hint = listsManifest.operations.find((o) => o.id === 'addToList')?.surfaces?.chat?.hint ?? '';
    expect(hint).toMatch(/one call per/i);
    expect(hint).toMatch(/sentence/i);
  });
});
