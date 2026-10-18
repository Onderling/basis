/**
 * "WAT IS ER DEZE WEEK GEDAAN" — the household's history (Frits 2026-10-15: "what was done last week" must stay
 * answerable; 2026-10-18: "history would be nice"). A done entry stays in the store (the bot's "passed" setting hides
 * it from the list, never deletes it unless the admin chose `delete`), so the read is over what was done in the last
 * days: what, on which list, when — and who, as the reader may see them (the door's ceiling names people; the op hands
 * over only the doer's id, never a name of its own).
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeListsOps } from '../../src/v2/listsOps.js';
import { replyLine } from '../../src/v2/replyLine.js';
import { listsGateRules } from '../../src/v2/circleGate.js';
import { templateLists } from '../../src/v2/householdTemplate.js';

const DAY = 86_400_000;
function world(nowMs) {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
  const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
  let clock = nowMs;
  const ops = makeListsOps({ storeFor: (cid) => stores.getStore(cid), t, activeCircle: () => 'c1', now: () => clock, passed: () => ({ mode: 'hide', days: 0 }) });
  return { ops, at: (ms) => { clock = ms; } };
}

describe('what was done in the last days', () => {
  it('the ticked and completed entries of the window — what, which list, when; open ones and older ones not', async () => {
    const now = Date.parse('2026-10-18T12:00:00Z');
    const { ops } = world(now);
    await ops.createList({ text: 'Boodschappen' });
    await ops.createList({ text: 'Reparaties' });
    for (const x of ['melk', 'brood', 'kaas']) await ops.addToList({ list: 'Boodschappen', text: x });
    await ops.addToList({ list: 'Reparaties', text: 'lamp' });
    await ops.markListItemDone({ item: 'melk' });
    await ops.markListItemDone({ item: 'lamp' });
    const r = await ops.listDone({ days: 7 });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.items.map((i) => [i.label, i.list]).sort()).toEqual([['lamp', 'Reparaties'], ['melk', 'Boodschappen']]);
    expect(r.items.every((i) => typeof i.doneAt === 'string')).toBe(true);
    expect((await ops.listDone({ days: 7, list: 'Reparaties' })).items.map((i) => i.label)).toEqual(['lamp']);
    // the read never deletes, and the list itself still hides them
    expect((await ops.listEntries({ list: 'Boodschappen' })).items.map((i) => i.label)).toEqual(['brood', 'kaas']);
    expect((await ops.listDone({ days: 7 })).items).toHaveLength(2);
  });

  it('the reply: one line per thing done, with its list; none → said so', () => {
    const t = (k, v) => `${k}${v ? ' ' + JSON.stringify(v) : ''}`;
    const line = replyLine({ ok: true, days: 7, items: [{ label: 'melk', list: 'Boodschappen', doneAt: '2026-10-17T10:00:00Z', by: { name: 'Ann' } }] }, { opId: 'listDone', t });
    expect(line).toContain('circle.reply.history_head');
    expect(line).toContain('melk');
    expect(line).toContain('Boodschappen');
    expect(replyLine({ ok: true, days: 7, items: [] }, { opId: 'listDone', t })).toContain('circle.reply.history_none');
  });

  it('the gate takes "wat is er deze week gedaan"', () => {
    const names = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
    const rules = listsGateRules('nl', templateLists((k) => names[k] ?? k));
    const take = (text) => { for (const r of rules) { const c = r.command(text); if (c) return c; } return null; };
    for (const line of ['Wat is er deze week allemaal gedaan', 'wat is er gedaan', 'wat is er vandaag gedaan']) expect(take(line), line).toMatchObject({ opId: 'listDone' });
    expect(take('wat is er vandaag gedaan').args.days).toBe(1);
  });
});
