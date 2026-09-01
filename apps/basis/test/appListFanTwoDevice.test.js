/**
 * A list entry created on one device reaches another device's store — the SAME corridor a task takes.
 *
 * @guard a circle owns ONE store: a list entry is an item in the circle's `CircleItemStore`, so it rides
 *        the one fan-out path with no lane code of its own
 * @guard an entry added on A arrives on B
 *
 * WHY THIS EXISTS. The composable lists built their own store registry over their own DataSource, beside
 * the one the rail mirrors. Two stores for one circle — which `docs/architecture.md` names outright as a
 * defect, not a design — so nothing carried a list to anybody. The feature had a private pod path instead,
 * which is the same document's other rule broken: "a type that reaches a peer some other way is a second
 * implementation of sync". Neither failed anything: on one device, with one member, lists worked.
 *
 * This is `appTaskFanTwoDevice`'s twin, deliberately: same harness, same inbound seam, same shape of
 * assertion. If lists ever grow a store of their own again, this goes red where nothing else would.
 *
 * All in-process (one shared InternalBus — no NKN / relay / browser).
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  bootRealAgentNode, connectAgentsOverBus, pairCircle, until, teardown,
} from './support/pairRealAgents.js';
import { makeListsOps } from '../src/v2/listsOps.js';
import { listsManifest } from '../../lists/manifest.js';

const CIRCLE_ID = 'list-fan-circle';

/**
 * The production inbound step the node harness omits: the shells route peer messages through
 * `connectPeerTransport`, whose `routedOnPeerMessage` calls `householdSync.handleInbound` BEFORE the
 * shell router — that is what drives a fanned item-sync envelope into the receiver's stores. Without it
 * nothing ingests on B and this test would prove nothing. (Lifted verbatim from the task-fan twin.)
 */
function wireInboundLikeShell(node) {
  const shellRouter = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    try { if (node.agent.householdSync.handleInbound(env?.from, env?.payload)) return; }
    catch { /* fall through to the shell router */ }
    return shellRouter?.(env);
  };
}

/** Mount the lists ops exactly as a shell mounts them, so this drives the production path end to end. */
const mountListsOn = (node) => {
  node.agent.mountAppOps('lists', makeListsOps({
    storeFor: (cid) => node.agent.circleStoreFor(cid),
    t: (k) => k,
    activeCircle: () => CIRCLE_ID,
    localActor: node.pubKey,
  }), listsManifest);
};

/** Every container + entry this device holds for the circle, read from the circle store itself. */
const listItemsOn = async (node) => {
  const store = node.agent.circleStoreFor(CIRCLE_ID);
  const rows = await store.list();
  return rows.filter((r) => r?.type === 'list' || r?.type === 'list-item');
};

describe('a list entry created on one device reaches another device (the circle store fan)', () => {
  let A; let B;

  afterAll(async () => { await teardown(A, B); });

  it('crosses a list + its entry from A to B — the store lists ride is the store every item rides', async () => {
    // `taskLane: true` composes the DEVICE LOG, which is what makes the fan real: without it there is no
    // emitter, `routeTaskMirror` publishes nothing, and the test would pass or fail for a harness reason
    // rather than a product one. (The repo has paid for this once already — a day of "product defects"
    // that were a harness booted without it.)
    [A, B] = await Promise.all([
      bootRealAgentNode('A', { taskLane: true }), bootRealAgentNode('B', { taskLane: true }),
    ]);
    await connectAgentsOverBus(A, B);
    await pairCircle(A, B, { groupId: CIRCLE_ID, name: 'List Fan', handle: 'lister' });
    wireInboundLikeShell(B);

    expect(await listItemsOn(B), 'B holds no list items for the circle yet').toEqual([]);

    // A makes a list and puts something on it — THROUGH THE WAIST, which is the door every surface uses.
    mountListsOn(A);
    const made = await A.agent.callSkill('lists', 'createList', { circleId: CIRCLE_ID, text: 'Boodschappen' });
    expect(made?.ok, 'the list op succeeded').toBe(true);
    const added = await A.agent.callSkill('lists', 'addToList', { circleId: CIRCLE_ID, list: 'Boodschappen', text: 'melk' });
    expect(added?.ok, 'the entry op succeeded').toBe(true);
    const list = { id: made.itemId };
    const entry = { id: added.itemId };
    expect(entry.id, 'the entry was created').toBeTruthy();

    // …and it arrives on B, in B's own circle store, by the ordinary item fan.
    const seen = await until(async () => (await listItemsOn(B)).find((r) => r.id === entry.id));
    expect(seen, "the entry created on A reached B's circle store").toBeTruthy();
    expect(seen.text).toBe('melk');

    const container = (await listItemsOn(B)).find((r) => r.id === list.id);
    expect(container, 'and so did the list it belongs to').toBeTruthy();
    expect(container.text).toBe('Boodschappen');
  }, 30_000);

  it('the containment edge survives the crossing — B can read the list back as a list', async () => {
    // A ref plus a back-ref is how containment travels (`item-store/containment.js`); if only the rows
    // crossed and not the edges, B would hold two loose items rather than a list with something on it.
    const rows = await listItemsOn(B);
    const list = rows.find((r) => r.type === 'list');
    const entry = rows.find((r) => r.type === 'list-item');
    expect(list?.embeds?.some((e) => e?.ref === entry.id && e?.rel === 'contains'),
      "B's list carries the containment edge to the entry").toBe(true);
    expect(Array.isArray(entry?.containedBy) && entry.containedBy.includes(list.id),
      "and the entry's back-reference names the list").toBe(true);
  }, 20_000);
});
