/**
 * SOMEONE WHO JOINS AFTER A MEMBER CHANGED THEIR PICTURE TWICE SEES THE SAME CIRCLE AS EVERYONE ELSE.
 *
 * A device compacts a `member-props` statement the fold called dead into a TOMBSTONE: its chain fields stay, its
 * payload and its signature go. A member who was there when the statements landed holds them all; a member who joins
 * LATER gets the circle's history by catch-up from devices that hold tombstones, and a tombstone carries no signature,
 * so the newcomer cannot accept it. The claim to prove or refute: the late joiner then holds a different set of
 * statements, and its fold (the order, the causal depth, the values) may differ from the others'.
 *
 * Admin + bram over a real relay. Bram sets a name three times and a face twice; the admin's device tombstones the
 * dead ones. THEN dave joins. Acceptance: dave's roster equals the admin's, member by member, on every field a person
 * sees (name, handle, face, role), and the membership list is the same.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from '../support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, readRoster, until, teardown } from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { primeCircleSecurity } from '../../src/v2/circleSecurityPriming.js';
import { EventLog } from '../../src/eventLog.js';
import { COMPACT_SUPERSEDED_PROPS } from '../../src/v2/membershipRail.js';

const CIRCLE = 'circle-late-joiner-after-compaction';
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const settleMember = async (node, circleId) => { await bindCircleAddresses([node], circleId); await bindCircleAddressKeysFor({ agent: node.agent, circleId }); };
const face = (tag) => ({ type: 'blob', ref: `blob://${tag}`, enc: { sealed: true, keyRef: 'k', format: 'b', bytes: 9, thumb: tag.repeat(1200) } });
/** What a person sees of each member, comparable across devices. */
const seen = (roster) => [...roster]
  .map((m) => ({ webid: m?.webid, role: m?.role ?? null, handle: m?.handle ?? null, displayName: m?.displayName ?? null, face: m?.personaProperties?.profilePicture?.enc?.thumb?.slice(0, 1) ?? null }))
  .sort((a, b) => String(a.webid).localeCompare(String(b.webid)));

describe('a late joiner after a compaction sees the same circle', () => {
  let relay; let admin; let bram; let dave; const logs = {};

  beforeAll(async () => {
    relay = await startJourneyRelay();
    const opts = (name) => { logs[name] = new EventLog({ initial: [], muted: [] }); return { agentOpts: { allowAddressFallback: false, deviceLog: logs[name] } }; };
    [admin, bram, dave] = await Promise.all([bootRealAgentNode('admin', opts('admin')), bootRealAgentNode('bram', opts('bram')), bootRealAgentNode('dave', opts('dave'))]);
    await connectNodesOverRelay([admin, bram, dave], { relayUrl: relay.url });
    await createCircle(admin, { groupId: CIRCLE, name: 'L' });
    await settleMember(admin, CIRCLE);
    expect((await joinExistingCircle(admin, bram, { groupId: CIRCLE, handle: 'bram' })).joined.ok).toBe(true);
    await settleMember(bram, CIRCLE);
    await Promise.all([admin, bram].map((n) => primeCircleSecurity({ agent: n.agent, onWarn: () => {} })));
    await settle(1500);
    for (const node of [admin, bram]) await bindCircleAddressKeysFor({ agent: node.agent, circleId: CIRCLE });
  }, 180000);

  afterAll(async () => {
    try { await teardown(admin, bram, dave); } catch { /* */ }
    try { await relay?.stop(); } catch { /* */ }
  });

  it('bram changes name and face; the admin tombstones the dead statements; THEN dave joins and sees what the admin sees', async () => {
    for (const [name, pic] of [['Bram Een', 'A'], ['Bram Twee', 'B'], ['Bram Drie', null]]) {
      const props = pic ? { displayName: name, personaProperties: { profilePicture: face(pic) } } : { displayName: name };
      await bram.agent.emitMemberProps({ circleIds: [CIRCLE], props });
      await settle(800);
    }
    // compaction is PAUSED (COMPACT_SUPERSEDED_PROPS, membershipRail.js; why: lateJoinerFoldOrder.test.js), so the
    // admin keeps the dead statements whole and serves them to dave like any other; when it turns back on, this walk
    // must still pass with tombstones on the admin's side
    await readRoster(admin, CIRCLE); await settle(1500); await readRoster(admin, CIRCLE);
    const tombstones = logs.admin.query({}).filter((e) => e.type === 'membership' && e.circleId === CIRCLE && e.payload?.tombstone === true);
    expect(tombstones.length > 0, 'the admin compacts only when compaction is on').toBe(COMPACT_SUPERSEDED_PROPS);

    // dave joins AFTER the compaction and catches up from devices that hold tombstones
    expect((await joinExistingCircle(admin, dave, { groupId: CIRCLE, handle: 'dave' })).joined.ok).toBe(true);
    await settleMember(dave, CIRCLE);
    await primeCircleSecurity({ agent: dave.agent, onWarn: () => {} });
    for (const node of [admin, bram, dave]) await bindCircleAddressKeysFor({ agent: node.agent, circleId: CIRCLE });

    const agreed = await until(async () => {
      const a = seen(await readRoster(admin, CIRCLE));
      const d = seen(await readRoster(dave, CIRCLE));
      return JSON.stringify(a) === JSON.stringify(d) ? { a, d } : null;
    }, { timeout: 30_000, step: 500 });
    if (!agreed) {
      const a = seen(await readRoster(admin, CIRCLE));
      const d = seen(await readRoster(dave, CIRCLE));
      const daveHolds = logs.dave.query({}).filter((e) => e.type === 'membership' && e.circleId === CIRCLE).map((e) => `${e.payload?.body?.kind}${e.payload?.tombstone ? '(tomb)' : ''}`);
      expect({ admin: a, dave: d, daveHolds }, 'dave sees the circle the admin sees').toEqual({ admin: a, dave: a, daveHolds });
    }
    expect(agreed).toBeTruthy();
  }, 120_000);
});
