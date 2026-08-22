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
  bindCircleAddresses, teardown, sendCircleChat,
} from '../../basis/test/support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../basis/src/v2/householdRosterPairing.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST, MEMBERSHIP_CATCHUP_SUBTYPES } from '../../basis/src/v2/membershipRail.js';
import { makeGovernanceCatchUp, GOV_CATCHUP_REQUEST } from '../../basis/src/v2/governanceCatchUp.js';
import { bindCircleGovernance, makeGovernanceRail } from '../../basis/src/v2/governanceAppWiring.js';
import { makeCircleGovernancePeerHandler } from '../../basis/src/v2/circleLogReceiver.js';
import { createCircleCacheMedium } from '../../basis/src/v2/circleCacheMedium.js';
import { makeKeyEventLogSink, recipientAddrsFromRoster, recipientWebidsFromRoster } from '@onderling/kring-host/keyEventLogSink';
import {
  invokeAgentSkill, DataPart, InternalBus, InternalTransport,
  Agent, AgentIdentity, PolicyEngine, TrustRegistry, defineSkill, PeerGraph,
} from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { sealingPublicKeyFromNetworkKey } from '@onderling/pod-client';
import { KEY_STATEMENT_BROADCAST, makeKeyPeerHandler } from '../../basis/src/v2/keyRail.js';
import { CHAT_CATCHUP_SUBTYPES } from '../../basis/src/v2/chatRail.js';
import { makeFrontierReplay } from '../../basis/src/v2/frontierReplay.js';
import { TASK_CATCHUP_SUBTYPES } from '../../basis/src/v2/taskRail.js';
import { applyRulesUpdates } from '../../basis/src/v2/rulesUpdateLane.js';

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

/**
 * THE ONE LANE LOG. A shell composes every lane over a single event log; the node harness happens to
 * create two (`deviceLog` for the agent's own riders, `chatEventLog` for its internal rails). Rules
 * updates are emitted by the agent onto the DEVICE log, so a governance rail built over the other
 * one serves catch-up from a log the statements were never written to — the lane looks alive and
 * replays nothing. Everything governance-shaped here uses the same log the agent does.
 */
const laneLog = (node) => node.deviceLog ?? node.chatEventLog;

/** Register the receive halves a shell registers, so fanned lane statements actually land. */
function wireLanes(node) {
  const inner = node._routerRef.fn;
  // GOVERNANCE — the rail a fanned decision statement must verify at before it lands, plus the
  // pull-all catch-up. Built here rather than per journey because the shells build it once per boot.
  const govRail = makeGovernanceRail({
    eventLog: laneLog(node),
    circleIdentityFor: node.agent.circleIdentityFor,
    myRef: node.pubKey,
    callSkill: (app, op, args) => node.agent.callSkill(app, op, args),
  });
  const govChanged = (cid) => {
    // The rules head is a FOLD over the governance lane — a rules-update statement that lands (live
    // or by catch-up) only becomes the circle's rules once this runs. The shells wire it the same way.
    applyRulesUpdates({ rail: govRail, callSkill: (a, o, args) => node.agent.callSkill(a, o, args), circleId: cid })
      .catch(() => { /* best-effort; the next change re-folds */ });
  };
  const govHandler = makeCircleGovernancePeerHandler({ eventLog: laneLog(node), rail: govRail, onChange: govChanged });
  const govCatchUp = makeGovernanceCatchUp({
    rail: govRail,
    sendToPeer: (addr, payload) => node.agent.sendPeerMessage(addr, payload),
    onChange: govChanged,
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
  // CHAT CATCH-UP — the windowed frontier replay both shells wire, with the consent rung. This is how
  // a device that missed a conversation asks for it back, so an absence journey needs it to exist.
  const chatReplay = (node.chatRail ?? node.agent.chatRail)
    ? makeFrontierReplay({
      rail: node.chatRail ?? node.agent.chatRail,
      sendToPeer: (addr, payload) => node.agent.sendPeerMessage(addr, payload),
      subtypes: CHAT_CATCHUP_SUBTYPES,
      // Auto-allow anything at journey scale — the consent rung has its own coverage; what is under
      // test here is whether the backlog arrives at all.
      onOffer: ({ allow }) => { try { allow(); } catch { /* the offer stands */ } },
    })
    : null;
  node._chatReplay = chatReplay;
  const taskReplay = node.agent.taskRail
    ? makeFrontierReplay({
      rail: node.agent.taskRail,
      sendToPeer: (addr, payload) => node.agent.sendPeerMessage(addr, payload),
      subtypes: TASK_CATCHUP_SUBTYPES,
      statementsFor: (cid) => node.agent.taskRail.catchUpStatements(cid),
    })
    : null;
  node._taskReplay = taskReplay;

  // KEYS — the receive half the shells register. Without it a fanned rotation has nowhere to land,
  // and a journey would be measuring the harness instead of the lane.
  const keyHandler = node.agent.keyRail
    ? makeKeyPeerHandler({ rail: node.agent.keyRail })
    : null;
  node._routerRef.fn = (env) => {
    const st = env?.payload?.subtype;
    if (keyHandler && st === KEY_STATEMENT_BROADCAST) { keyHandler(env?.from, env.payload); return undefined; }
    if (chatReplay && st === CHAT_CATCHUP_SUBTYPES.request) { chatReplay.onRequest(env?.from, env.payload); return undefined; }
    if (chatReplay && st === CHAT_CATCHUP_SUBTYPES.batch)   { chatReplay.onBatch(env?.from, env.payload); return undefined; }
    if (chatReplay && st === CHAT_CATCHUP_SUBTYPES.offer)   { chatReplay.onOffer(env?.from, env.payload); return undefined; }
    if (taskReplay && st === TASK_CATCHUP_SUBTYPES.request) { taskReplay.onRequest(env?.from, env.payload); return undefined; }
    if (taskReplay && st === TASK_CATCHUP_SUBTYPES.batch)   { taskReplay.onBatch(env?.from, env.payload); return undefined; }
    if (taskReplay && st === TASK_CATCHUP_SUBTYPES.offer)   { taskReplay.onOffer(env?.from, env.payload); return undefined; }
    if (st === 'circle-governance-broadcast') { govHandler(env?.from, env.payload); return undefined; }
    if (st === GOV_CATCHUP_REQUEST) { govCatchUp.onRequest(env?.from, env.payload); return undefined; }
    if (st === govCatchUp.subtypes.batch) { govCatchUp.onBatch(env?.from, env.payload); return undefined; }
    if (membership && st === MEMBERSHIP_BROADCAST) { membership(env?.from, env.payload); return undefined; }
    if (memCatchUp && st === memCatchUp.subtypes.request) { memCatchUp.onRequest(env?.from, env.payload); return undefined; }
    if (memCatchUp && st === memCatchUp.subtypes.batch) { memCatchUp.onBatch(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
  node._memCatchUp = memCatchUp;
  node._govCatchUp = govCatchUp;
  return { memCatchUp, govCatchUp };
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
 * @param {string[]} [a.outsiders]  handles booted onto the same relay but NOT joined — the people a
 *   safety journey needs in order to ask "what can someone who was never let in actually do?"
 * @returns {Promise<{people: object[], admin: object, outsiders: object[], circleId: string, pod: object|null, close: () => Promise<void>}>}
 */
export async function bootAppCircle({ relayUrl, circleId, handles, pod = null, outsiders = [] }) {
  const people = await Promise.all(
    [...handles, ...outsiders].map((h) => bootRealAgentNode(h, {
      taskLane: true,                                              // composes the DEVICE LOG
      ...(pod ? { agentOpts: { provisionCircleMedium: mediumFor(h, pod, circleId) } } : {}),
    })),
  );
  await connectNodesOverRelay(people, { relayUrl });
  for (const n of people) wireLanes(n);

  const guests = people.slice(handles.length);   // on the relay, deliberately not in the circle
  const members = people.slice(0, handles.length);
  const [admin, ...joiners] = members;
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
  await bindCircleAddresses(members, circleId);
  await Promise.all(members.map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId })));

  return {
    people: members, admin, outsiders: guests, circleId, pod,
    close: () => teardown(...people),
  };
}

/** Send a circle chat message the way a shell does: append the signed render entry AND fan the
 *  statement through the real stoop op. (`chatRail.appendMessage` alone only writes locally.) */
export { sendCircleChat };

/**
 * Take a device DARK — inbound envelopes are dropped on the floor, exactly as they are for a phone
 * that is off. Returns the function that brings it back. Deliberately NOT a socket close: a real
 * absence outlasts the relay's hold window, so what must carry the backlog is the catch-up, and a
 * held-message replay would quietly pass the test for the wrong reason.
 */
export function goDark(node) {
  const live = node._routerRef.fn;
  node._routerRef.fn = () => undefined;
  return function comeBack() { node._routerRef.fn = live; };
}

/**
 * The circle's KEY SINK, wired exactly as `circleApp.js` wires it: every key-event the sealing
 * machinery emits is signed on the key lane, appended to this device's log, and the STATEMENT is
 * fanned to the event's recipients — who verify signature, chain and the rotateKey authority at
 * their own rail before anything folds. Fail-closed: an event the lane will not sign is not fanned.
 *
 * The journey drives `sink.append(event)` directly, which is exactly what the control agent does.
 */
const keyFanRoster = async (node, circleId) => {
  const r = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId: circleId }).catch(() => null);
  return Array.isArray(r?.members) ? r.members : [];
};

export function keySinkFor(node, circleId) {
  const recorded = [];
  const sink = makeKeyEventLogSink({
    groupId: circleId,
    recordLocal: (event) => recorded.push(event),
    emitStatement: (gid, event) => node.agent.keyEmit?.(gid ?? circleId, event) ?? null,
    statementSubtype: KEY_STATEMENT_BROADCAST,
    // Through the waist, exactly as both shells now do.
    fanStatement: (gid, statement, only) => node.agent.callSkill('stoop', 'broadcastCircleKeyStatement', {
      groupId: gid ?? circleId, event: statement,
      msgId: `key:${statement?.body?.hash ?? statement?.body?.subject}`, ts: Date.now(),
      ...(only ? { only } : {}),
    }),
    sendPeer: (addr, payload, opts) => node.agent.sendPeerMessage(addr, payload, opts),
    sendOptions: { hold: true, firstSendTimeoutMs: 0, retryDelays: [] },
    resolveRecipientAddrs: async (event) => recipientAddrsFromRoster(
      event, await keyFanRoster(node, circleId), { deriveSealingKey: sealingPublicKeyFromNetworkKey },
    ),
    resolveRecipientWebids: async (event) => recipientWebidsFromRoster(
      event, await keyFanRoster(node, circleId), { deriveSealingKey: sealingPublicKeyFromNetworkKey },
    ),
  });
  return { sink, recorded };
}

/**
 * Form ANOTHER circle out of nodes that are already booted and connected — so the same device can be
 * in two circles, which is the only way to ask an unlinkability question honestly. (Booting a second
 * `bootAppCircle` gives you a second SET of people; comparing their addresses proves nothing.)
 */
export async function formCircle({ admin, joiners = [], circleId, handles = [] }) {
  await createCircle(admin, { groupId: circleId, name: circleId });
  for (let i = 0; i < joiners.length; i += 1) {
    const r = await joinExistingCircle(admin, joiners[i], {
      groupId: circleId, handle: handles[i] ?? `member-${i}`,
    });
    if (!r?.joined?.ok) throw new Error(`join failed for ${circleId}: ${JSON.stringify(r?.joined)}`);
  }
  const all = [admin, ...joiners];
  await bindCircleAddresses(all, circleId);
  await Promise.all(all.map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId })));
  return { circleId, people: all };
}

/* ─── THE PEER DOOR ───────────────────────────────────────────────────────────────────────────────
 * Everything else in this harness reaches a device through `callSkill` — which is the LOCAL waist,
 * i.e. the person acting on their own device. That can never test what a *peer* is allowed to make
 * my device do, because it never crosses the door where that is decided.
 *
 * The door is `runGatedSkill` (`@onderling/core` protocol/taskExchange): it runs
 * `PolicyEngine.checkInbound` — trust tier of the caller × visibility of the skill, failing closed in
 * BOTH directions (an unknown caller drops to the lowest tier, an unknown visibility rises to the
 * highest) — then the skill lookup, then the group-visibility gate. `invokeAgentSkill` is the caller
 * side of exactly that path, so these helpers add no test-only door: they knock on the real one.
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * A DOOR AGENT — a core agent standing on the real relay with a real `PolicyEngine`, so a journey
 * can knock on it from another device and see what the gate does.
 *
 * This is the composition the door actually needs, and it is the one the reachability journey
 * already uses for the same reason: a core Agent whose DEFAULT transport is the relay. The app's
 * `realAgent` gives its core agents a device-local bus and routes inbound peer traffic to the app's
 * message router, so a device-to-device A2A invocation never reaches a skill dispatcher there —
 * which is why the app-composition journeys cannot ask this question and this helper exists.
 *
 * `skills` is a list of `defineSkill(...)` results; `trust` maps a peer pubKey to a tier, so a
 * journey can set up "this caller is trusted, that one is a stranger" and watch the tier ladder work.
 *
 * @returns {{agent, address, pubKey, setTier, stop}}
 */
export async function bootDoorAgent({ relayUrl, skills = [], trust = {} } = {}) {
  const identity = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({
    identity, transport: new RelayTransport({ relayUrl, identity }), peers: new PeerGraph(),
  });
  for (const skill of skills) agent.register(skill.id, skill.handler, skill);
  const trustRegistry = new TrustRegistry(new VaultMemory());
  agent.policyEngine = new PolicyEngine({
    trustRegistry,
    skillRegistry: agent.skills,
    agentPubKey: identity.pubKey,
  });
  for (const [pubKey, tier] of Object.entries(trust)) await trustRegistry.setTier(pubKey, tier);
  await agent.start();
  return {
    agent,
    address: agent.address,
    pubKey: identity.pubKey,
    setTier: (pubKey, tier) => trustRegistry.setTier(pubKey, tier),
    stop: () => agent.stop?.().catch?.(() => {}) ?? agent.stop?.(),
  };
}

/**
 * Introduce door agents to each other. Without this every knock fails with "No pubKey registered
 * for recipient — send HI first", which looks exactly like a refusal and would make a door journey
 * pass for the wrong reason: the gate would never run at all.
 */
export function linkDoorAgents(...agents) {
  for (const a of agents) {
    for (const b of agents) {
      if (a === b) continue;
      a.agent.addPeer(b.address, b.address);
    }
  }
}

/** Knock on a door agent (or any core agent) directly, without a booted node in between. */
export async function knockDirect(callerAgent, address, skillId, args = {}, { timeout = 8000 } = {}) {
  try {
    const task = invokeAgentSkill(callerAgent, address, skillId, [DataPart(args)], { timeout });
    const res = await task.done();
    if (res?.status && res.status !== 'completed') {
      return { ok: false, error: String(res.error ?? res.status), status: res.status };
    }
    return { ok: true, result: res?.parts?.[0]?.data ?? null };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export { defineSkill };

/**
 * Put every node's CORE agent on one shared bus, so a peer can actually knock.
 *
 * Why this is needed: each device's `realAgent` builds its own in-process bus for its own agents
 * (chat · host · household), so two booted devices' core agents cannot address each other even
 * though their SECURE agents are talking happily over the relay. Without this, an A2A invocation
 * just times out and a journey would read "the door refused me" when nothing ever reached a door.
 *
 * What this does and does not prove. The transport here is in-process — the same `InternalTransport`
 * the harness's own `connectAgentsOverBus` and the reachability journey use. The GATE is not:
 * `runGatedSkill` → `PolicyEngine.checkInbound` → the skill lookup → the group-visibility gate is
 * the same code on any transport. So a journey built on this tests **who is allowed through the
 * door**, which is transport-independent, and does not test the relay path to it.
 */
export async function connectCoreAgents(nodes, { transportName = 'a2a-bus' } = {}) {
  const bus = new InternalBus({ presenceAware: true });
  const cores = nodes.filter(Boolean).map(coreAgentOf).filter(Boolean);
  for (const core of cores) core.addTransport(transportName, new InternalTransport(bus, core.address));
  // A hello binds the peer to the transport that can reach it — without it the sender keeps routing
  // over its own device-local default bus, where the other device does not exist, and every knock
  // times out looking like a refusal.
  for (const a of cores) {
    for (const b of cores) {
      if (a === b) continue;
      try { await a.hello(b.address); } catch { /* best-effort, like the shells' own hello */ }
    }
  }
  return bus;
}

/** The core Agent behind a booted node — the thing that actually holds skills and a policy engine. */
export const coreAgentOf = (node) => node.agent?.sa?.agent ?? null;

/** The address a peer addresses that node by. */
export const addressOf = (node) => coreAgentOf(node)?.address ?? null;

/**
 * Knock on another device's door: invoke `skillId` on `target` AS `caller`, over the real transport
 * and through the real inbound gate.
 *
 * Returns `{ok, result, error}` rather than throwing, because a refusal is the expected answer to
 * most of these and a thrown refusal reads as a crash. `error` carries the door's own words
 * (`Unknown skill: "x"`, a policy denial, a disabled skill) so a journey can assert WHICH refusal it
 * got, not merely that something went wrong.
 */
export async function knockOn(caller, target, skillId, args = {}, { timeout = 8000 } = {}) {
  const from = coreAgentOf(caller);
  const to = addressOf(target);
  if (!from || !to) return { ok: false, error: 'no-core-agent' };
  try {
    const task = invokeAgentSkill(from, to, skillId, [DataPart(args)], { timeout });
    const res = await task.done();
    if (res?.status && res.status !== 'completed') {
      return { ok: false, error: String(res.error ?? res.status), status: res.status };
    }
    const data = res?.parts?.[0]?.data ?? res?.parts?.[0] ?? null;
    return { ok: true, result: data, status: res?.status ?? 'completed' };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** What that device is willing to expose to a peer at all. */
export const skillIdsOf = (node) => {
  const core = coreAgentOf(node);
  const reg = core?.skills;
  try {
    if (typeof reg?.list === 'function') return reg.list().map((s) => s.id ?? s.skillId ?? s);
    if (typeof reg?.keys === 'function') return [...reg.keys()];
    if (typeof reg?.all === 'function') return reg.all().map((s) => s.id ?? s);
  } catch { /* fall through */ }
  return [];
};

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
    eventLog: laneLog(node),
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
