/**
 * A member's signed planned row, between two real nodes: Anna's node writes a row into the circle's store, signed with
 * her circle key; it syncs to the other node, which checks it against ITS roster (the real key↔ref binding) — it runs
 * as Anna there, and a copy changed on the way, or one claiming to be someone else, does not.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, connectAgentsOverBus, pairCircle, bindCircleAddresses, until, teardown } from '../support/pairRealAgents.js';
import { createIntentionBook } from '../../src/v2/intentionBook.js';
import { createOwnDevicesStore } from '../../src/v2/ownDevicesStore.js';
import { createCircleRowGate } from '../../src/v2/circleRowGate.js';
import { rosterBindingVerifier } from '../../src/v2/membershipRail.js';
import { memoryDataSource } from '@onderling/item-store';

const CIRCLE = 'signed-rows';

describe('a member\'s signed row, checked against the real roster', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });

  it('runs as its author on the other node; changed on the way, or naming another, it does not', async () => {
    [A, B] = await Promise.all([bootRealAgentNode('anna', { taskLane: true }), bootRealAgentNode('box', { taskLane: true })]);
    await connectAgentsOverBus(A, B);
    await pairCircle(A, B, { groupId: CIRCLE, name: 'Signed', handle: 'signed' });
    await bindCircleAddresses([A, B], CIRCLE);
    await A.agent.ensureCircleSync?.(CIRCLE);
    await B.agent.ensureCircleSync?.(CIRCLE);
    // Anna's node writes the row, signed with her circle key
    const annaBook = createIntentionBook({
      store: createOwnDevicesStore({ dataSource: memoryDataSource() }),
      circles: async () => [{ scope: CIRCLE, store: A.agent.circleStoreFor(CIRCLE) }], actor: A.pubKey,
      signerFor: async (c) => ({ identity: await A.agent.circleIdentityFor(c), ref: A.pubKey }),
    });
    await annaBook.load();
    const row = await annaBook.intend({ trigger: { every: 'week', on: 'sun', at: '18:00' }, op: 'sendWeekOverview', appOrigin: 'assistant', args: {}, actsAs: A.pubKey, scope: CIRCLE });
    expect(row.authorSig?.ref).toBe(A.pubKey);
    // the other node holds it now, and judges it by its own roster
    const there = await until(async () => (await B.agent.circleStoreFor(CIRCLE).get(row.id)) ?? null, { timeout: 10_000 });
    expect(there?.authorSig?.sig).toBe(row.authorSig.sig);
    const gate = createCircleRowGate({
      hostRef: B.pubKey, circleKeyFor: (c) => B.agent.circleIdentityFor(c),
      rosterBinding: rosterBindingVerifier((...a) => B.agent.callSkill(...a)),
      people: async () => [{ id: 'telegram:anna', pubKey: A.pubKey }],
    });
    expect(await gate.mayRun({ rowId: row.id }, CIRCLE, there), 'Anna\'s own row, her key bound on the roster').toBe(true);
    expect(await gate.callerFor(there.actsAs)).toBe('telegram:anna');
    expect(await gate.mayRun({ rowId: row.id }, CIRCLE, { ...there, args: { to: 'all' } })).toBe('signature');
    // a well-signed row by Anna claiming to act as the box's person: refused
    const claim = await annaBook.intend({ trigger: { every: 'day', at: '08:00' }, op: 'sendWeekOverview', appOrigin: 'assistant', args: {}, actsAs: B.pubKey, scope: CIRCLE });
    expect(await gate.mayRun({ rowId: claim.id }, CIRCLE, claim)).toBe('acts-as-another');
  }, 90_000);
});
