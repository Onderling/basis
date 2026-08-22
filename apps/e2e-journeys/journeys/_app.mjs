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
import { makeGovernanceCatchUp, GOV_CATCHUP_REQUEST } from '../../basis/src/v2/governanceCatchUp.js';
import { bindCircleGovernance, makeGovernanceRail } from '../../basis/src/v2/governanceAppWiring.js';
import { makeCircleGovernancePeerHandler } from '../../basis/src/v2/circleLogReceiver.js';
import { createCircleCacheMedium } from '../../basis/src/v2/circleCacheMedium.js';

/**
 * A CENTRAL POD every member's cache medium writes through — the "with a pod" half of the mode
 * matrix. In-memory on purpose: the point of a mode journey is that the SAME corridor holds whether
 * a circle keeps its content peer-to-peer or on a shared pod, not that CSS works (the `.css` tier
 * covers that against a real server).
 */
/** The three methods a backend owes; written out rather than pulled from a package this app does
 *  not depend on. */
function memBackend() {
  const store = new Map();
  return {
    store,
    put:  async (uri, v) => { store.set(uri, v); },
    get:  async (uri) => (store.has(uri) ? store.get(uri) : null),
    list: async (prefix = '') => [...store.keys()].filter((k) => k.startsWith(prefix)),
  };
}

export function makeSharedPod() {
  const backend = memBackend();
  return {
    store: backend.store,
    backend,
    // A visible seal, so a journey can assert that what lands at rest is not plaintext.
    strategy: { seal: (v) => `SEALED(${v})`, open: (v) => String(v).replace(/^SEALED\((.*)\)$/, '$1') },
  };
}

const mediumFor = (label, pod, circleId) => (id) => (id === circleId
  ? createCircleCacheMedium({
    localBackend: memBackend(),
    deviceId:     `${label}-${id}`,
    resolvePod:   async () => ({ backend: pod.backend, sealed: true, strategy: pod.strategy }),
  })
  : null);

/** Register the receive halves a shell registers, so fanned lane statements actually land. */
function wireLanes(node) {
  const inner = node._routerRef.fn;
  // GOVERNANCE — the rail a fanned decision statement must verify at before it lands, plus the
  // pull-all catch-up. Built here rather than per journey because the shells build it once per boot.
  const govRail = makeGovernanceRail({
    eventLog: node.chatEventLog,
    circleIdentityFor: node.agent.circleIdentityFor,
    myRef: node.pubKey,
    callSkill: (app, op, args) => node.agent.callSkill(app, op, args),
  });
  const govHandler = makeCircleGovernancePeerHandler({ eventLog: node.chatEventLog, rail: govRail, onChange: () => {} });
  const govCatchUp = makeGovernanceCatchUp({
    rail: govRail,
    sendToPeer: (addr, payload) => node.agent.sendPeerMessage(addr, payload),
  });
  node._govRail = govRail;
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
    if (st === 'circle-governance-broadcast') { govHandler(env?.from, env.payload); return undefined; }
    if (st === GOV_CATCHUP_REQUEST) { govCatchUp.onRequest(env?.from, env.payload); return undefined; }
    if (st === govCatchUp.subtypes.batch) { govCatchUp.onBatch(env?.from, env.payload); return undefined; }
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
 * @param {object|null} [a.pod]  a `makeSharedPod()` — every member's circle store then write-throughs
 *   to it (the "with a central pod" mode). Omit for the pod-less mode.
 * @returns {Promise<{people: object[], admin: object, circleId: string, pod: object|null, close: () => Promise<void>}>}
 */
export async function bootAppCircle({ relayUrl, circleId, handles, pod = null }) {
  const people = await Promise.all(
    handles.map((h) => bootRealAgentNode(h, {
      taskLane: true,                                              // composes the DEVICE LOG
      ...(pod ? { agentOpts: { provisionCircleMedium: mediumFor(h, pod, circleId) } } : {}),
    })),
  );
  await connectNodesOverRelay(people, { relayUrl });
  for (const n of people) wireLanes(n);

  const [admin, ...joiners] = people;
  // A circle's storage mode is chosen AT CREATION — `setCircleStoragePolicy` cannot move an existing
  // circle onto a pod (`storage-policy-writer-unavailable`; the code records why: "the only way a
  // basis circle becomes pod-backed is to be CREATED that way"). So the pod mode creates it that way.
  if (pod) {
    const created = await admin.agent.callSkill('stoop', 'createGroupV2', {
      groupId: circleId, name: circleId, rules: {},
      storagePolicy: 'centralised', groupPodUri: `mem://${circleId}/`,
    });
    if (created?.error) throw new Error(`pod-backed create failed: ${JSON.stringify(created)}`);
  } else {
    await createCircle(admin, { groupId: circleId, name: circleId });
  }
  for (let i = 0; i < joiners.length; i += 1) {
    const r = await joinExistingCircle(admin, joiners[i], { groupId: circleId, handle: handles[i + 1] });
    if (!r?.joined?.ok) throw new Error(`join failed for ${handles[i + 1]}: ${JSON.stringify(r?.joined)}`);
  }
  await bindCircleAddresses(people, circleId);
  await Promise.all(people.map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId })));

  return {
    people, admin, circleId, pod,
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


/**
 * The governance handle for one person, wired exactly as a shell wires it: events ride the device
 * log's governance lane, are signed with the per-circle key, and fan through the real stoop op.
 *
 * `policy` lets a journey choose the decision-class map under test — the default map makes
 * `removeMember` any-admin, which never needs a vote, so a journey that wants to exercise VOTING
 * passes e.g. `{ governance: { removeMember: 'member-vote' } }`.
 */
export function governanceFor(node, { policy = {} } = {}) {
  return bindCircleGovernance({
    eventLog: node.chatEventLog,
    callSkill: (app, op, args) => node.agent.callSkill(app, op, args),
    getPolicy: () => policy,
    myRef: node.pubKey,
    genId: () => `gov-${Math.random().toString(36).slice(2, 10)}`,
    circleIdentityFor: node.agent.circleIdentityFor,
    broadcast: (channel, circleId, event) => {
      const op = channel === 'report' ? 'broadcastCircleReport' : 'broadcastCircleGovernance';
      node.agent.callSkill('stoop', op, {
        groupId: circleId, event,
        msgId: event?.body?.hash ? `gov:${event.body.hash}` : `gov-${Math.random().toString(36).slice(2, 10)}`,
        ts: Date.now(),
      }).catch(() => { /* the fan is best-effort; catch-up reconciles */ });
    },
  });
}
