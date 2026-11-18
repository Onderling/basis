/**
 * A list entry carries a REFERENCE to a thing and a QUANTITY (a circle uses an outside tool, ledger L1035).
 *
 * @guard an entry added with a ref and a quantity on A arrives on B with both (the item travels whole)
 * @guard a second add of the same thing raises the quantity, never a second entry; the reply says so
 * @guard the list never learns what the thing is: nothing branches on the reference's type
 *
 * The reference sits in the entry's own `embeds` as a plain reference (`rel: 'refers'`), beside the containment
 * edges a list keeps on itself (`rel: 'contains'`); the quantity beside the words. Same harness as
 * `appListFanTwoDevice` (one shared InternalBus, the device log composed so the fan is real).
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  bootRealAgentNode, connectAgentsOverBus, pairCircle, until, teardown,
} from './support/pairRealAgents.js';
import { makeListsOps } from '../src/v2/listsOps.js';
import { listsManifest } from '../../lists/manifest.js';

const CIRCLE_ID = 'entry-ref-circle';
const MILK = { type: 'shop.product', ref: 'ah:wi1525' };

function wireInboundLikeShell(node) {
  const shellRouter = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    try { if (node.agent.householdSync.handleInbound(env?.from, env?.payload)) return; }
    catch { /* fall through to the shell router */ }
    return shellRouter?.(env);
  };
}

const mountListsOn = (node) => {
  node.agent.mountAppOps('lists', makeListsOps({
    storeFor: (cid) => node.agent.circleStoreFor(cid),
    t: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
    activeCircle: () => CIRCLE_ID,
    localActor: node.pubKey,
  }), listsManifest);
};

const refersTo = (row, thing) => (row?.embeds ?? []).some((e) => e?.rel === 'refers' && e?.type === thing.type && e?.ref === thing.ref);

describe('a list entry carries a reference to a thing and a quantity', () => {
  let A; let B; let entryId;

  afterAll(async () => { await teardown(A, B); });

  it('added on A with a ref and a quantity, it arrives on B with both', async () => {
    [A, B] = await Promise.all([
      bootRealAgentNode('A', { itemsLane: true }), bootRealAgentNode('B', { itemsLane: true }),
    ]);
    await connectAgentsOverBus(A, B);
    await pairCircle(A, B, { groupId: CIRCLE_ID, name: 'Ref Fan', handle: 'lister' });
    wireInboundLikeShell(B);
    mountListsOn(A);

    expect((await A.agent.callSkill('lists', 'createList', { circleId: CIRCLE_ID, text: 'Boodschappen' }))?.ok).toBe(true);
    const added = await A.agent.callSkill('lists', 'addToList', {
      circleId: CIRCLE_ID, list: 'Boodschappen', text: 'Halfvolle melk 1 L', ref: MILK, quantity: 2,
    });
    expect(added?.ok, JSON.stringify(added)).toBe(true);
    entryId = added.itemId;

    const onA = await A.agent.circleStoreFor(CIRCLE_ID).get(entryId);
    expect(refersTo(onA, MILK), 'A holds the reference in the entry\'s embeds, as a plain reference').toBe(true);
    expect(onA.quantity).toBe(2);

    const onB = await until(async () => {
      const row = await B.agent.circleStoreFor(CIRCLE_ID).get(entryId);
      return row && refersTo(row, MILK) ? row : null;
    }, { timeout: 8000, step: 50 });
    expect(onB, 'the entry reached B WITH its reference').toBeTruthy();
    expect(onB.quantity).toBe(2);
  }, 30_000);

  it('a second add of the same thing raises the quantity and says so; no second entry', async () => {
    const again = await A.agent.callSkill('lists', 'addToList', {
      circleId: CIRCLE_ID, list: 'Boodschappen', text: 'halfvolle melk', ref: MILK, quantity: 1,
    });
    expect(again?.ok, JSON.stringify(again)).toBe(true);
    expect(again.itemId).toBe(entryId);
    expect(again.quantity).toBe(3);
    expect(again.message).toContain('circle.lists.quantity_raised');
    const rows = (await A.agent.circleStoreFor(CIRCLE_ID).list()).filter((r) => r.type === 'list-item');
    expect(rows).toHaveLength(1);
  });

  it('the same words WITHOUT a ref stay the words\' own check (an entry with no thing behind it)', async () => {
    const plain = await A.agent.callSkill('lists', 'addToList', { circleId: CIRCLE_ID, list: 'Boodschappen', text: 'brood' });
    expect(plain?.ok).toBe(true);
    const twice = await A.agent.callSkill('lists', 'addToList', { circleId: CIRCLE_ID, list: 'Boodschappen', text: 'brood' });
    expect(twice?.duplicate).toBe(true);
  });

  it('listEntries gives each entry its quantity and its reference', async () => {
    const r = await A.agent.callSkill('lists', 'listEntries', { circleId: CIRCLE_ID, list: 'Boodschappen' });
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    const milk = r.items.find((i) => i.id === entryId);
    expect(milk.quantity).toBe(3);
    expect(milk.ref).toEqual(MILK);
    expect(milk.label, 'every door shows how many: the one formatter').toBe('3× Halfvolle melk 1 L');
    expect(r.items.find((i) => i.label === 'brood')?.quantity ?? 1).toBe(1);
  });

  it('a bad quantity or ref is refused, not stored', async () => {
    for (const bad of [{ quantity: 0 }, { quantity: 1.5 }, { quantity: 'veel' }, { ref: { type: 'shop.product' } }, { ref: 'ah:1' }]) {
      const r = await A.agent.callSkill('lists', 'addToList', { circleId: CIRCLE_ID, list: 'Boodschappen', text: 'kaas', ...bad });
      expect(r?.ok, `refused: ${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('a thing of a type nothing has ever named is handled the same: the list does not know kinds of thing', async () => {
    const odd = { type: 'nobody.ever.named-this', ref: '42' };
    const a = await A.agent.callSkill('lists', 'addToList', { circleId: CIRCLE_ID, list: 'Boodschappen', text: 'iets', ref: odd, quantity: 2 });
    const b = await A.agent.callSkill('lists', 'addToList', { circleId: CIRCLE_ID, list: 'Boodschappen', text: 'iets anders', ref: odd });
    expect(a?.ok && b?.ok).toBe(true);
    expect(b.itemId).toBe(a.itemId);
    expect(b.quantity).toBe(3);
    // the same reference under another type word is another thing
    const c = await A.agent.callSkill('lists', 'addToList', { circleId: CIRCLE_ID, list: 'Boodschappen', text: 'iets', ref: { type: 'other.kind', ref: '42' } });
    expect(c.itemId).not.toBe(a.itemId);
  });

  it('made a chore, the entry keeps its reference and quantity', async () => {
    const r = await A.agent.callSkill('lists', 'makeChore', { circleId: CIRCLE_ID, item: entryId });
    expect(r?.ok, JSON.stringify(r)).toBe(true);
    const row = await A.agent.circleStoreFor(CIRCLE_ID).get(entryId);
    expect(row.type).toBe('task');
    expect(refersTo(row, MILK)).toBe(true);
    expect(row.quantity).toBe(3);
  });
});
