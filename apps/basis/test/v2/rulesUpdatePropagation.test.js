/**
 * Rules-update propagation — the rules DOC rides the peer governance lane (V1 closing wave row 2,
 * the #80 tail), walked over the real harness:
 *
 *   editGroupRules on the admin → the store write + the signed `rules-update` statement on the
 *   governance lane → the circle-governance fan → the member's rail ingest (signature + declared
 *   kind + the set-aware roster binding) → the APPLY (receiver-verified ADMIN authority, highest
 *   version wins) → the member's local `group-rules` head → their OWN stale banner lights,
 *   pod-free. This closes the window the acceptance journey pinned honestly ("B's own
 *   current-version is still v1 there — the doc hasn't synced").
 *
 * Receivers are the harness's own production registrations (the governance handler carries the
 * apply hook, exactly as both shells do). Assertions read what a PERSON reads: the member rows'
 * current-rules version (the stale-banner input, stamped only from the device's own local doc)
 * and the rules text the getGroupRules surface renders — `getGroupRules`' raw item is reshaped to
 * display text on this composition, so the raw store is deliberately not poked.
 *
 * The enforceability posture, asserted as such: the writer-side admin check binds only where a
 * real roster backs the store (in this harness every node is admin of its OWN store), so the gate
 * that matters is the RECEIVER's — a member-authored update, however delivered, never applies on
 * anyone else's device.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { signSpine, InternalTransport } from '@onderling/core';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses,
  goOffline, goOnline, until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';
import { makeGovernanceRail } from '../../src/v2/governanceAppWiring.js';
import { makeGovernanceCatchUp } from '../../src/v2/governanceCatchUp.js';
import { applyRulesUpdates, preservedRulesStatementsFor } from '../../src/v2/rulesUpdateLane.js';
import { EventLog } from '../../src/eventLog.js';

const CIRCLE = 'rules-propagation-circle';
const SEND = { hold: true, firstSendTimeoutMs: 4000, retryDelays: [] };

/** The per-test membership receiver (the three-party-walk rule: riders are an explicit per-test
 *  act, never a harness default): fanned join/accept statements feed the node's own rail ingest —
 *  without it the fold admits nobody and the roster falls back to the display list, unstamped. */
function wireMembershipReceiver(node) {
  const handler = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) { handler(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
}

const members = async (n) => (await n.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE }))?.members ?? [];
/** The circle's CURRENT rules version as THIS device knows it — stamped on every roster row from
 *  the device's own local `group-rules` head (deriveRoster), which is exactly what the stale
 *  banner reads. 0 = the device holds no local doc. */
const currentVersionOn = async (n) => {
  const rows = await members(n);
  const v = rows.map((m) => m?.rulesCurrentVersion).find((x) => x != null);
  return v != null ? Number.parseInt(v, 10) : 0;
};
/** The rules TEXT the getGroupRules surface renders on this composition (the display reshape). */
const rulesTextOn = async (n) => String((await n.agent.callSkill('stoop', 'getGroupRules', { groupId: CIRCLE }))?.rules ?? '');

describe('rules-update propagation — the doc travels the governance lane, pod-free', () => {
  let A; let B; let C; let bus;
  afterAll(async () => { await teardown(A, B, C); });

  it('an admin edit reaches the member live: their local head advances and their OWN stale banner lights', async () => {
    [A, B] = await Promise.all([
      bootRealAgentNode('A', { taskLane: true }),
      bootRealAgentNode('B', { taskLane: true }),
    ]);
    bus = await connectNodesOverBus([A, B]);
    for (const n of [A, B]) wireMembershipReceiver(n);
    await createCircle(A, { groupId: CIRCLE, name: 'Rules propagation' });
    const okJoin = await joinExistingCircle(A, B, { groupId: CIRCLE, handle: 'bee' });
    expect(okJoin.joined?.ok, JSON.stringify(okJoin.joined)).toBe(true);
    await bindCircleAddresses([A, B], CIRCLE);
    await Promise.all([A, B].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));

    // This harness invite carries no rules payload, so B starts with NO local doc (the shells'
    // wizard forwards the doc at join) — which makes the arrival below unambiguous: whatever
    // version B ends up holding came over the PEER LANE.
    expect(await currentVersionOn(B)).toBe(0);

    // The admin raises the rules to v2. The doc + version now RIDE THE FAN — no pod anywhere.
    const edited = await A.agent.callSkill('stoop', 'editGroupRules', {
      groupId: CIRCLE, rules: { name: 'v2: be kind, now with feeling', purpose: 'v2: be kind, now with feeling', agreements: 'be kind', version: 1 },
    });
    expect(edited.version).toBe(2);

    const arrived = await until(async () => ((await currentVersionOn(B)) === 2 ? true : null), { timeout: 15000, step: 100 });
    expect(arrived, 'the v2 doc never reached B over the peer lane').toBe(true);
    expect(await rulesTextOn(B), 'the arrived doc is the admin\'s v2 CONTENT').toContain('v2: be kind, now with feeling');

    // B's OWN stale banner lights ON B's DEVICE — the exact line the member card paints: B
    // accepted v1 at join; the arrived doc says current is v2.
    const { normalizeCircleMembers } = await import('@onderling/kring-host/circleMembers');
    const painted = normalizeCircleMembers({ members: await members(B) });
    const bSelf = painted.find((m) => m.id === B.pubKey);
    expect(bSelf?.rules, 'B sees its own acceptance as stale against the arrived v2')
      .toEqual({ accepted: '1', current: '2', stale: true });
  }, 90_000);

  it('an offline member reconciles: the missed statement lands through the same gate and applies', async () => {
    await goOffline(B);
    const edited = await A.agent.callSkill('stoop', 'editGroupRules', {
      groupId: CIRCLE, rules: { name: 'v3: quiet hours after ten', purpose: 'v3: quiet hours after ten', agreements: 'be kind', version: 2 },
    });
    expect(edited.version).toBe(3);
    expect(await currentVersionOn(B), 'B is offline — still on v2').toBe(2);

    // B returns. The missed statement is re-delivered over the real wire — the shape a governance
    // catch-up batch takes — and passes the SAME ingest + apply gate as the live fan.
    await goOnline(B, { announceTo: A });
    const stmt = A.deviceLog.query({})
      .filter((e) => e?.type === 'governance' && e.circleId === CIRCLE && e.payload?.body?.kind === 'rules-update')
      .map((e) => e.payload)
      .find((s) => s.body.payload?.version === 3);
    expect(stmt, 'the v3 statement is on A\'s lane').toBeTruthy();
    await A.agent.sendPeerMessage(B.agent.circleAddressFor(CIRCLE), {
      subtype: 'circle-governance-broadcast', circleId: CIRCLE, event: stmt,
    }, SEND);

    const caughtUp = await until(async () => ((await currentVersionOn(B)) === 3 ? true : null), { timeout: 15000, step: 100 });
    expect(caughtUp, 'the reconnecting member never converged on v3').toBe(true);
    expect(await rulesTextOn(B)).toContain('v3: quiet hours after ten');
  }, 60_000);

  it('a NON-ADMIN cannot move anyone else\'s rules: member-authored updates are refused at apply', async () => {
    // The trustless half first: B signs a bare `rules-update` with its OWN per-circle key — a
    // VALID member binding (the rail admits the statement) — claiming version 9. The apply must
    // refuse on AUTHORITY: B's roster role is member, and only an admin-authored update lands.
    const bIdentity = await B.agent.circleIdentityFor(CIRCLE);
    const forged = signSpine(bIdentity, {
      kind: 'rules-update', circleId: CIRCLE, subject: 'rules-v9',
      payload: { authorRef: B.pubKey, rules: { name: 'hostile takeover', purpose: 'hostile takeover' }, version: 9 },
    });
    await B.agent.sendPeerMessage(A.agent.circleAddressFor(CIRCLE), {
      subtype: 'circle-governance-broadcast', circleId: CIRCLE, event: forged,
    }, SEND);
    await new Promise((r) => setTimeout(r, 800));   // let the ingest + apply settle
    expect(await currentVersionOn(A), 'a member-authored update must never apply').toBe(3);
    expect(await rulesTextOn(A)).not.toContain('hostile takeover');

    // And the full modified-client path: B runs editGroupRules for real. Its LOCAL store obeys
    // (its own device, its own harm — the enforceability posture: a different app version could
    // write its local store anyway), and the fanned statement carries B's member key — so A
    // refuses it at apply exactly like the bare forgery. Deliberately LAST: B's local head is
    // junk from here on.
    const localEdit = await B.agent.callSkill('stoop', 'editGroupRules', {
      groupId: CIRCLE, rules: { name: 'my house my rules', purpose: 'my house my rules', version: 3 },
    });
    expect(localEdit.version, 'the local write is not the gate').toBe(4);
    await new Promise((r) => setTimeout(r, 800));
    expect(await currentVersionOn(A), 'the fanned member edit must not apply at the admin').toBe(3);
    expect(await rulesTextOn(A)).toContain('v3: quiet hours after ten');
  }, 60_000);

  it('the final setting is never deletable: a member offline past the lane\'s audit window still converges from the preserved head', async () => {
    // The writer's head preserves the ORIGINAL signed statement (never re-signed).
    const aCall = (app, op, args) => A.agent.callSkill(app, op, args);
    const preserved = await aCall('stoop', 'getGroupRulesUpdateStatement', { groupId: CIRCLE });
    expect(preserved?.statement?.body?.kind, 'the admin\'s head carries the signed statement').toBe('rules-update');
    expect(preserved.statement.body.payload?.version).toBe(3);

    // C joins the circle NOW (a device with no doc — the shape of a member returning from a wipe
    // or a fresh enrollment long after the change).
    C = await bootRealAgentNode('C', { taskLane: true });
    const tx = new InternalTransport(bus, C.pubKey);   // join C onto the SAME bus
    await C.agent.sa.addSecureTransport('relay', tx);
    C._busTransport = tx;
    wireMembershipReceiver(C);
    const okJoin = await joinExistingCircle(A, C, { groupId: CIRCLE, handle: 'cee' });
    expect(okJoin.joined?.ok, JSON.stringify(okJoin.joined)).toBe(true);
    await bindCircleAddresses([A, C], CIRCLE);
    await Promise.all([A, C].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
    // C's join statement was fanned before C bound its per-circle address (the known
    // send-into-the-void window; production closes it on the next presence re-fan) — hand-carry
    // the membership lane through C's PRODUCTION ingest gate, as the reconnect flush would.
    for (const stmt of A.agent.membershipRail.storedStatements(CIRCLE)) {
      await C.agent.membershipRail.ingest(CIRCLE, stmt);
    }
    expect(await currentVersionOn(C)).toBe(0);

    // THE AGED-OUT WORLD: A serves catch-up from an EMPTY lane (every governance entry compacted
    // away) — the ONLY thing left is the durable head's preserved statement, via the serve hook
    // both shells wire.
    const emptyRail = makeGovernanceRail({
      eventLog: new EventLog({ initial: [] }),
      circleIdentityFor: A.agent.circleIdentityFor, myRef: A.pubKey, callSkill: aCall,
    });
    let served = null;
    const cuA = makeGovernanceCatchUp({
      rail: emptyRail,
      sendToPeer: (addr, payload) => { served = payload; },
      extraStatementsFor: (cid) => preservedRulesStatementsFor({ callSkill: aCall, circleId: cid }),
    });
    await cuA.onRequest('addr:C', { subtype: cuA.subtypes.request, circleId: CIRCLE });
    expect(served, 'nothing served from the aged-out lane').toBeTruthy();
    expect(served.statements.map((s) => s.body.kind)).toEqual(['rules-update']);

    // C receives the batch through the production gate: rail ingest (signature + declared kind +
    // the set-aware roster binding — the ORIGINAL admin signature verifies) + the apply.
    const cCall = (app, op, args) => C.agent.callSkill(app, op, args);
    const railC = makeGovernanceRail({
      eventLog: C.chatEventLog, circleIdentityFor: C.agent.circleIdentityFor, myRef: '', callSkill: cCall,
    });
    const cuC = makeGovernanceCatchUp({
      rail: railC,
      sendToPeer: () => {},
      onChange: (cid) => applyRulesUpdates({ rail: railC, callSkill: cCall, circleId: cid }).catch(() => {}),
    });
    await cuC.onBatch('addr:A', served);

    const converged = await until(async () => ((await currentVersionOn(C)) === 3 ? true : null), { timeout: 15000, step: 100 });
    expect(converged, 'the returning member never converged from the preserved head').toBe(true);
    expect(await rulesTextOn(C)).toContain('v3: quiet hours after ten');

    // …and C's own mirror preserves the statement in turn: ANY member can serve the head onward.
    const onC = await cCall('stoop', 'getGroupRulesUpdateStatement', { groupId: CIRCLE });
    expect(onC?.statement?.body?.hash).toBe(preserved.statement.body.hash);
  }, 90_000);
});
