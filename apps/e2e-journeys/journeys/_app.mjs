// _app.mjs — boot the APP's composition inside the journey runner.
//
// WHY THIS EXISTS (Frits, 2026-08-23: "the headless e2e runner should just act like the app,
// without a full browser needed").
//
// The journeys in this directory historically build **stoop agents over the substrate mirror**. That
// composition is real, but it is not the one the product ships: it has no device log, and therefore
// none of the rails — membership, governance, keys, tasks, chat. A journey written against it can
// only measure what that harness can do, which produced a false negative the day a `leave` "failed"
// here and passed in the app (finding F-002).
//
// The app's composition is `createRealHouseholdAgent` — the same factory the web and mobile shells
// boot — and the basis test harness already assembles it faithfully (device log, rails, waist, the
// stoop agent inside it, per-circle signing identities). That harness is vitest-free and imports
// cleanly under plain node, so the journey runner can use it directly. No browser, no vitest.
//
// WHICH HARNESS FOR WHAT:
//   • stoop + mirror (the older journeys) — fine for transport, noticeboard, offerings, bots: things
//     that live in the item store and do not depend on a lane.
//   • the APP composition (this file) — required for anything lane-shaped: membership folds, rules
//     propagation, key rotation, catch-up, enrolment. If a journey asserts one of those against the
//     mirror harness, it is measuring the harness.
//
// Everything here runs against WHATEVER relay the runner was given, so an app-composition journey
// works locally and against a deployment (`node run.mjs wss://relay.example.com`) unchanged.
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle,
  bindCircleAddresses, teardown,
} from '../../basis/test/support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../basis/src/v2/householdRosterPairing.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST, MEMBERSHIP_CATCHUP_SUBTYPES } from '../../basis/src/v2/membershipRail.js';
import { makeGovernanceCatchUp } from '../../basis/src/v2/governanceCatchUp.js';

/** Register the receive halves a shell registers, so fanned lane statements actually land. */
function wireLanes(node) {
  const inner = node._routerRef.fn;
  const membership = node.agent.membershipRail
    ? makeMembershipPeerHandler({ rail: node.agent.membershipRail })
    : null;
  const memCatchUp = node.agent.membershipRail
    ? makeGovernanceCatchUp({
      rail: node.agent.membershipRail,
      sendToPeer: (addr, payload) => node.agent.sendPeerMessage(addr, payload),
      subtypes: MEMBERSHIP_CATCHUP_SUBTYPES,
    })
    : null;
  node._routerRef.fn = (env) => {
    const st = env?.payload?.subtype;
    if (membership && st === MEMBERSHIP_BROADCAST) { membership(env?.from, env.payload); return undefined; }
    if (memCatchUp && st === memCatchUp.subtypes.request) { memCatchUp.onRequest(env?.from, env.payload); return undefined; }
    if (memCatchUp && st === memCatchUp.subtypes.batch) { memCatchUp.onBatch(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
  return { memCatchUp };
}

/**
 * Boot N people in one circle, in the APP's composition, over the runner's relay.
 *
 * @param {object} a
 * @param {string} a.relayUrl
 * @param {string} a.circleId
 * @param {string[]} a.handles  one per person; the FIRST is the circle's creator/admin
 * @returns {Promise<{people: object[], admin: object, circleId: string, close: () => Promise<void>}>}
 */
export async function bootAppCircle({ relayUrl, circleId, handles }) {
  const people = await Promise.all(
    handles.map((h) => bootRealAgentNode(h, { taskLane: true })),   // taskLane composes the DEVICE LOG
  );
  await connectNodesOverRelay(people, { relayUrl });
  for (const n of people) wireLanes(n);

  const [admin, ...joiners] = people;
  await createCircle(admin, { groupId: circleId, name: circleId });
  for (let i = 0; i < joiners.length; i += 1) {
    const r = await joinExistingCircle(admin, joiners[i], { groupId: circleId, handle: handles[i + 1] });
    if (!r?.joined?.ok) throw new Error(`join failed for ${handles[i + 1]}: ${JSON.stringify(r?.joined)}`);
  }
  await bindCircleAddresses(people, circleId);
  await Promise.all(people.map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId })));

  return {
    people, admin, circleId,
    close: () => teardown(...people),
  };
}

/** The circle's roster as that person's own device projects it. */
export async function rosterOf(node, circleId) {
  const r = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId: circleId });
  return Array.isArray(r?.members) ? r.members : [];
}

export const hasMember = (rows, pubKey) =>
  rows.some((m) => (m.webid ?? m.addr ?? m.ref) === pubKey);

/** Poll until `pred()` is truthy, or give up — propagation is asynchronous. */
export async function untilTrue(pred, ms = 15000, step = 200) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try { if (await pred()) return true; } catch { /* keep waiting */ }
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
}
