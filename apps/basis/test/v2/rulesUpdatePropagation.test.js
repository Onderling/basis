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
import { signSpine } from '@onderling/core';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses,
  goOffline, goOnline, until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';

const C = 'rules-propagation-circle';
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

const members = async (n) => (await n.agent.callSkill('stoop', 'listGroupMembers', { groupId: C }))?.members ?? [];
/** The circle's CURRENT rules version as THIS device knows it — stamped on every roster row from
 *  the device's own local `group-rules` head (deriveRoster), which is exactly what the stale
 *  banner reads. 0 = the device holds no local doc. */
const currentVersionOn = async (n) => {
  const rows = await members(n);
  const v = rows.map((m) => m?.rulesCurrentVersion).find((x) => x != null);
  return v != null ? Number.parseInt(v, 10) : 0;
};
/** The rules TEXT the getGroupRules surface renders on this composition (the display reshape). */
const rulesTextOn = async (n) => String((await n.agent.callSkill('stoop', 'getGroupRules', { groupId: C }))?.rules ?? '');

describe('rules-update propagation — the doc travels the governance lane, pod-free', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });

  it('an admin edit reaches the member live: their local head advances and their OWN stale banner lights', async () => {
    [A, B] = await Promise.all([
      bootRealAgentNode('A', { taskLane: true }),
      bootRealAgentNode('B', { taskLane: true }),
    ]);
    await connectNodesOverBus([A, B]);
    for (const n of [A, B]) wireMembershipReceiver(n);
    await createCircle(A, { groupId: C, name: 'Rules propagation' });
    const okJoin = await joinExistingCircle(A, B, { groupId: C, handle: 'bee' });
    expect(okJoin.joined?.ok, JSON.stringify(okJoin.joined)).toBe(true);
    await bindCircleAddresses([A, B], C);
    await Promise.all([A, B].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: C })));

    // This harness invite carries no rules payload, so B starts with NO local doc (the shells'
    // wizard forwards the doc at join) — which makes the arrival below unambiguous: whatever
    // version B ends up holding came over the PEER LANE.
    expect(await currentVersionOn(B)).toBe(0);

    // The admin raises the rules to v2. The doc + version now RIDE THE FAN — no pod anywhere.
    const edited = await A.agent.callSkill('stoop', 'editGroupRules', {
      groupId: C, rules: { name: 'v2: be kind, now with feeling', purpose: 'v2: be kind, now with feeling', agreements: 'be kind', version: 1 },
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
      groupId: C, rules: { name: 'v3: quiet hours after ten', purpose: 'v3: quiet hours after ten', agreements: 'be kind', version: 2 },
    });
    expect(edited.version).toBe(3);
    expect(await currentVersionOn(B), 'B is offline — still on v2').toBe(2);

    // B returns. The missed statement is re-delivered over the real wire — the shape a governance
    // catch-up batch takes — and passes the SAME ingest + apply gate as the live fan.
    await goOnline(B, { announceTo: A });
    const stmt = A.deviceLog.query({})
      .filter((e) => e?.type === 'governance' && e.circleId === C && e.payload?.body?.kind === 'rules-update')
      .map((e) => e.payload)
      .find((s) => s.body.payload?.version === 3);
    expect(stmt, 'the v3 statement is on A\'s lane').toBeTruthy();
    await A.agent.sendPeerMessage(B.agent.circleAddressFor(C), {
      subtype: 'circle-governance-broadcast', circleId: C, event: stmt,
    }, SEND);

    const caughtUp = await until(async () => ((await currentVersionOn(B)) === 3 ? true : null), { timeout: 15000, step: 100 });
    expect(caughtUp, 'the reconnecting member never converged on v3').toBe(true);
    expect(await rulesTextOn(B)).toContain('v3: quiet hours after ten');
  }, 60_000);

  it('a NON-ADMIN cannot move anyone else\'s rules: member-authored updates are refused at apply', async () => {
    // The trustless half first: B signs a bare `rules-update` with its OWN per-circle key — a
    // VALID member binding (the rail admits the statement) — claiming version 9. The apply must
    // refuse on AUTHORITY: B's roster role is member, and only an admin-authored update lands.
    const bIdentity = await B.agent.circleIdentityFor(C);
    const forged = signSpine(bIdentity, {
      kind: 'rules-update', circleId: C, subject: 'rules-v9',
      payload: { authorRef: B.pubKey, rules: { name: 'hostile takeover', purpose: 'hostile takeover' }, version: 9 },
    });
    await B.agent.sendPeerMessage(A.agent.circleAddressFor(C), {
      subtype: 'circle-governance-broadcast', circleId: C, event: forged,
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
      groupId: C, rules: { name: 'my house my rules', purpose: 'my house my rules', version: 3 },
    });
    expect(localEdit.version, 'the local write is not the gate').toBe(4);
    await new Promise((r) => setTimeout(r, 800));
    expect(await currentVersionOn(A), 'the fanned member edit must not apply at the admin').toBe(3);
    expect(await rulesTextOn(A)).toContain('v3: quiet hours after ten');
  }, 60_000);
});
