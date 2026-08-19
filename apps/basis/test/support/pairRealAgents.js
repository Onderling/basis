/**
 * pairRealAgents — wire two REAL basis app agents together in-process over a
 * shared InternalBus and drive the full application-level circle join between
 * them, deterministically, in node.
 *
 * This is the node-level analogue of the browser pairing journey
 * (`test-browser/journeys.spec.js` + `peerHarness.js`): instead of two isolated
 * browser contexts talking over NKN, it boots two `createRealHouseholdAgent()`
 * instances and connects their chat secure-mesh agents with a genuine
 * `InternalTransport` on ONE shared `InternalBus` — the exact wiring pattern
 * `packages/secure-agent/test/sendRouteResolution.test.js` uses. Delivery is
 * in-process microtask-async (no sockets / relay / network), so the full app
 * join runs in seconds and never flakes.
 *
 * It reuses the SAME production op/handler modules the web + mobile shells use —
 * no bespoke re-implementation of the join protocol:
 *   - create + invite   : createGroupState.finalSubmit → stoop.createGroupV2,
 *                         then v2/circleInvite.buildCircleInviteUri.
 *   - join / redeem      : v2/circleInvite.joinCircleFromInvite →
 *                         joinGroupState.finalSubmit (setMyHandle →
 *                         redeemMembershipCode → sendPeerRedeem fallback →
 *                         recordRemoteRedemption mirror).
 *   - peer bridge        : the real inbound router (handlers/peerRouter) + the
 *                         real group-redeem request/response handlers
 *                         (handlers/groupRedeem) + mesh intros (handlers/meshIntros).
 *
 * The ONE test-only seam: the browser shell wires the inbound peer router inside
 * `realAgent.connectPeerTransport({ nknLib, onPeerMessage })`. We don't call that
 * (there is no nknLib in node), so we hand `onPeerMessage` to the factory via its
 * existing `secureAgentOpts` pass-through (a late-binding ref, so the router — which
 * needs the booted agent's callSkill/sendPeerMessage — is attached after boot). No
 * production code changed; this uses only already-exported seams.
 */

import { InternalBus, InternalTransport } from '@onderling/core';
import {
  sealingPublicKeyFromNetworkKey,
  establishKeyEvent, rotateKeyEvent, readKeyChain, currentGroupKey,
  sealForAudience,
  PodClient, generateKeypair as podGenerateKeypair,
} from '@onderling/pod-client';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { VaultMemory } from '@onderling/vault';
import { makeKeyEventLogSink } from '@onderling/kring-host/keyEventLogSink';

import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
// G13 step C — the harness must do what the app does at boot, or every send routes to a per-circle
// address nobody bound. See `registerCirclePresence` in circleApp.js / agentBundle.js.
import { registerCircleAddresses } from '../../src/v2/circleAddressRegistration.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { createCirclePodProducer, createCircleControlAgentRouter } from '../../src/v2/circlePodProducer.js';
import { openerForIdentity } from '../../src/v2/sharedCopyOpener.js';
import { createKeyEventStore, openViaKeyEvents } from '../../src/v2/keyEventStore.js';
import { makePeerRouter } from '../../src/core/handlers/peerRouter.js';
import { makeHandleGroupKeyEvent } from '../../src/core/handlers/groupKeyEvent.js';
import {
  makeHandleGroupRedeemRequest,
  makeSendGroupRedeemRequest,
  makeHandleGroupRedeemResponse,
} from '../../src/core/handlers/groupRedeem.js';
import { makePropagateMeshIntros, makeHandleBuurtPeerIntro } from '../../src/core/handlers/meshIntros.js';
// B2 — the exact per-circle address announcing wiring both shells use.
import {
  makeCircleAddressAnnouncePeerHandler, propagateCircleAddressesAfterJoin,
} from '../../src/v2/circleAddressAnnounce.js';
import { EventLog } from '../../src/eventLog.js';
import { createChatMessageInbox } from '../../src/v2/chatMessageInbox.js';
import { makeChatRail, makeChatPeerHandler, CHAT_STATEMENT_BROADCAST } from '../../src/v2/chatRail.js';
import { rosterBindingVerifier } from '../../src/v2/membershipRail.js';
import { makeKringGovernancePeerHandler, makeKringReportPeerHandler } from '../../src/v2/kringLogReceiver.js';
import { makeGovernanceRail } from '../../src/v2/governanceAppWiring.js';

import {
  initialState as createGroupInitialState,
  finalSubmit as createGroupFinalSubmit,
} from '../../src/core/wizards/createGroupState.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../../src/v2/circleInvite.js';

/** Quiet logger so the handler modules don't spam the test output. */
const QUIET = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * Resolve once `pred()` is truthy, polling briefly. Keeps the in-process async
 * (HI handshake + peer-bridge round-trip) deterministic without a fixed sleep.
 * Mirrors the helper in sendRouteResolution.test.js.
 */
export async function until(pred, { timeout = 4000, step = 10 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - start >= timeout) return v;
    await new Promise((r) => setTimeout(r, step));
  }
}

/**
 * Boot ONE real app agent with a late-bound inbound peer router. The router is
 * attached AFTER boot (it closes over the agent's callSkill/sendPeerMessage), so
 * the factory receives a ref-indirecting `onPeerMessage` at construction.
 *
 * @returns {Promise<{
 *   agent: object,
 *   pubKey: string,
 *   received: Array<{from: string, payload: object}>,
 *   sendPeerRedeem: Function,
 *   pendingMap: Map<string, object>,
 * }>}
 */
/** Every live node this process booted — the harness default chat-binding resolves through it. */
const LIVE_NODES = new Set();

export async function bootRealAgentNode(label = 'agent', { redeemTimeoutMs = 8000, agentOpts = {}, verifyGovernanceBinding = null, verifyChatBinding = null } = {}) {
  const routerRef = { fn: null };
  const received = [];
  // A sealed circle's log carries key-events + sealed content over the real transport. Key-events are recorded
  // by the PRODUCTION receive handler (`makeHandleGroupKeyEvent`) into the PRODUCTION per-circle key-event log
  // (`createKeyEventStore`) — the exact modules circleApp.js wires. No harness stand-in records the key-event:
  // the real peer-router → real handler → real store is what makes the removed-member scenario pass. (Sealed
  // CONTENT delivery still lands in a plain list here — that is transport/hold-forward, a separate concern.)
  const keyEventStore = createKeyEventStore();
  const sealedContent = [];

  // S4 — a per-node control-agent router over this node's own circle-producer map, wired as the stoop
  // agent's `controlAgent`. For an UNSEALED (p0) circle the map stays empty → getProducer returns null →
  // the redeem/leave membership hooks no-op (the pre-S4 behaviour the default harness relies on). A SEALED
  // circle (`sealCircleViaProducer`) registers a producer here, so the REAL `removeMember` op routes into
  // the producer's control agent, which fans the rotation key-event through the injected sink.
  const circlePods = new Map();
  const circleControlAgentRouter = createCircleControlAgentRouter((id) => circlePods.get(id) ?? null);

  const agent = await createRealHouseholdAgent({
    // Test-only seam: the browser wires this inside connectPeerTransport; in node
    // we hand it in via the existing secureAgentOpts pass-through. Ref-indirected
    // so the router can be built after boot with the live callSkill/sendPeerMessage.
    secureAgentOpts: { onPeerMessage: (env) => routerRef.fn?.(env) },
    // The real per-circle control-agent router (S4) — the same one circleApp.js wires as stoopControlAgent.
    stoopControlAgent: circleControlAgentRouter,
    // A fresh, code-minting REAL circle must show only real members — keep demo
    // scaffolding off so rosters carry exactly the creator + real joiners.
    seedDemoData: false,
    // Per-test agent options, threaded straight into the production factory. The one this exists
    // for today is `allowAddressFallback: false` — the per-user "rather undeliverable than routed
    // over my one global key" setting. A test that claims to prove per-circle addressing works
    // must be able to turn the escape hatch OFF; with it on, every such test also passes when the
    // addressing is broken, which is the failure mode this whole area keeps producing.
    ...agentOpts,
  });

  const pubKey = agent.identity.chat.pubKey;
  const callSkill = (app, op, args) => agent.callSkill(app, op, args);
  const sendPeer = (addr, payload) => agent.sendPeerMessage(addr, payload);

  const pendingMap = new Map();
  const propagateMeshIntros = makePropagateMeshIntros({ callSkill, sendPeer, logger: QUIET });
  // The REAL kring-chat receiver — the exact wiring circleApp.js uses (inbox + peer handler).
  // The harness previously had NO 'kring-chat-message' handler, so chat fell to the defaultHandler
  // stub: the blind spot that let a broken chat-receive pass node tests. Wire it for real.
  const chatEventLog = new EventLog({ initial: [], muted: [] });
  const chatInbox = createChatMessageInbox({
    eventLog: chatEventLog,
    // The MIGRATION gate only (the store copy's one-time carry-over): live receive is the signed
    // statement path below.
    ingest: (payload, fromPeerAddr) => callSkill('stoop', 'ingestCircleMessage', { payload, fromPeerAddr }),
    logger: QUIET,
  });
  // The chat RAIL — the exact receive wiring the shells use: a fanned statement verifies (signature +
  // key↔ref binding) and lands as the ONE render entry. The harness's LEGACY pairing records no
  // circleAddress roster rows, so the DEFAULT binding here resolves through the live in-process node
  // registry: it asks the claimed member's OWN agent for its circle key and compares — the same fact a
  // roster row attests, established through the test process's omniscience instead of the announce flow.
  // A test probing binding FAILURE overrides with `verifyChatBinding`.
  const rosterBinding = rosterBindingVerifier(callSkill);
  const chatRail = makeChatRail({
    eventLog: chatEventLog,
    circleIdentityFor: agent.circleIdentityFor,
    myRef: agent.identity.chat.pubKey,
    callSkill,
    verifyBinding: verifyChatBinding ?? (async (q) => {
      const { author, ref, circleId } = q ?? {};
      // IN-PROCESS first: the test-process omniscience (ask the claimed member's OWN agent for its
      // circle key) — authoritative and constant-time for every node in THIS process, so the legacy
      // pairing tests keep their exact ingest timing (a variable-latency verify reorders a
      // concurrent flush burst — the offline-hold walk pinned that).
      for (const n of LIVE_NODES) {
        if (n.pubKey !== ref) continue;
        try { return (await n.agent.circleIdentityFor(circleId))?.pubKey === author; } catch { return false; }
      }
      // CROSS-PROCESS: the node is not in this process — the derived roster's proven address set is
      // the only fact that exists here, and it is exactly what a real device holds. This is the
      // three-party walk's receive half: three OS processes, one relay, no shared registry.
      try { return await rosterBinding(q); } catch { return false; }
    }),
  });
  const handlers = {
    [CHAT_STATEMENT_BROADCAST]: makeChatPeerHandler({ rail: chatRail }),
    // ADMIN side: verify the joiner's code + reply, then propagate mesh intros.
    'group-redeem-request': makeHandleGroupRedeemRequest({
      callSkill, sendPeer, propagateMeshIntros, logger: QUIET,
      // The ADMIN half of per-circle addressing (web ≡ mobile ≡ harness): the reply carries OUR proven
      // per-circle address, so the joiner records it instead of knowing us only by our global key.
      circleAddressFor: (gid) => agent.circleAddressFor?.(gid) ?? null,
      signCircleAddress: (gid, addr) => agent.signCircleLink?.(gid, gid, addr) ?? null,
      // B2 (web ≡ mobile ≡ harness): after admitting a member, hand the circle their proven
      // per-circle address and hand them the circle's — the step neither joiner can do for itself.
      propagateCircleAddresses: ({ circleId, newMemberWebid }) =>
        propagateCircleAddressesAfterJoin({ agent, circleId, newMemberWebid, logger: QUIET }),
    }),
    // JOINER side: resolve the pending redeem promise.
    'group-redeem-response': makeHandleGroupRedeemResponse({ pendingMap, logger: QUIET }),
    // Both sides: record a mesh-introduced peer into the local roster.
    'buurt-peer-intro': makeHandleBuurtPeerIntro({ callSkill, logger: QUIET }),
    // B2 receive half — record an announced per-circle address, then refresh the binding + the
    // authorize snapshot from one roster read.
    'circle-address-announce': makeCircleAddressAnnouncePeerHandler({ agent, logger: QUIET }),
    // Sealed circle — the PRODUCTION receive handler records a fanned key-event into the PRODUCTION per-circle
    // key-event log (the no-pod key-chain carrier), de-duped by version. This is the real app's receive path,
    // dispatched by the real `makePeerRouter` — not a harness stand-in. Folding happens on read (`readSealed`).
    'group-key-event': makeHandleGroupKeyEvent({ recordKeyEvent: (gid, event) => keyEventStore.record(gid, event), logger: QUIET }),
    // Sealed content still lands in a plain list (transport/hold-forward — out of scope for the key-event work).
    'sealed-content':  (_from, payload) => { if (payload?.env) sealedContent.push(payload); },
    // Wave C tail A — the REAL governance/report ingest handlers (the exact wiring the shells
    // use): a fanned vote/report lands in THIS node's EventLog, so a headless two-agent run can
    // assert cross-device replication over a genuine transport (not a simulated fan).
    'kring-governance-broadcast': makeKringGovernancePeerHandler({
      eventLog: chatEventLog,
      // Verify-before-land, exactly as the shells: the rail off THIS node's real per-circle signer +
      // the roster's circleAddress rows for foreign bindings.
      // The key↔ref binding source: the default roster-row lookup, or a test-supplied resolver. This
      // harness's LEGACY-group pairing records no circleAddress on its roster rows (the trail-recorded
      // binding for this path lands with the membership rider) — a repro that fans signed governance
      // supplies the binding explicitly rather than weakening the verify.
      rail: makeGovernanceRail({ eventLog: chatEventLog, circleIdentityFor: agent.circleIdentityFor, myRef: '', callSkill, verifyBinding: verifyGovernanceBinding ?? undefined }),
    }),
    'kring-report-broadcast':     makeKringReportPeerHandler({ eventLog: chatEventLog }),
  };
  const sendPeerRedeem = makeSendGroupRedeemRequest({
    sendPeer,
    pendingMap,
    circleAddressFor: agent.circleAddressFor,
    // …and prove it (web ≡ mobile ≡ harness): a fresh per-circle address is signed with its own key.
    signCircleAddress: (gid, addr) => agent.signCircleLink?.(gid, gid, addr) ?? null,
    // The redeem is a full round-trip (request → admin → response). Over a mesh
    // transport (real NKN) each leg pays a several-second cold-start, so the
    // in-process default (8s) is too tight; the NKN gate boots with a larger
    // budget. Bus/relay gates keep the fast default.
    timeoutMs: redeemTimeoutMs,
    logger: QUIET,
  });

  routerRef.fn = makePeerRouter({
    handlers,
    // Everything else (plain chat-message bubbles, etc.) lands here for assertions.
    defaultHandler: (from, payload) => { received.push({ from, payload }); },
    logger: QUIET,
  });

  const node = { agent, pubKey, received, sendPeerRedeem, pendingMap, label, keyEventStore, sealedContent, circlePods, circleControlAgentRouter, chatEventLog, chatInbox, chatRail, _routerRef: routerRef };
  LIVE_NODES.add(node);
  // Live view of the REAL ingested kring chats (the browser reads the same eventLog for its bubble list).
  Object.defineProperty(node, 'chatEvents', { enumerable: true, get: () => chatEventLog.query({ excludeMuted: true }) });
  // `keyEvents` is a LIVE VIEW of the production store (all circles this node holds), so assertions like
  // `B.keyEvents.some(e => e.version === 2)` reflect exactly what the production receive handler recorded.
  Object.defineProperty(node, 'keyEvents', { enumerable: true, get: () => keyEventStore.all() });
  return node;
}

/**
 * Connect two booted node agents so their chat secure-mesh agents can reach each
 * other in-process. Registers a genuine `InternalTransport(bus, <chatPubKey>)`
 * into EACH agent's unified router via `sa.addSecureTransport` — the wire address
 * IS the chat pubKey, so `sa.peer.sendTo(peerPubKey, …)` routes over the shared
 * bus with no PeerGraph needed (the peer's transport is registered under that
 * exact address). Mirrors sendRouteResolution.test.js.
 */
export async function connectAgentsOverBus(a, b, { transportName = 'relay' } = {}) {
  // A presence-aware bus so a `disconnect()` is a real "unreachable" signal
  // (membership-based `canReach`) — the offline/reconnect helpers rely on it.
  const bus = new InternalBus({ presenceAware: true });
  const txA = new InternalTransport(bus, a.pubKey);
  const txB = new InternalTransport(bus, b.pubKey);
  await a.agent.sa.addSecureTransport(transportName, txA);
  await b.agent.sa.addSecureTransport(transportName, txB);
  // Stash each node's bus transport so the offline/reconnect helpers can toggle
  // it (a disconnect on the shared bus = that node goes offline).
  a._busTransport = txA;
  b._busTransport = txB;
  return bus;
}

/**
 * Connect two booted node agents over a REAL relay (a running ws relay server) via the
 * browser's OWN `connectPeerTransport` path — so the node gate exercises the real relay
 * transport AND the real `handleInbound → router` receive, not just InternalTransport
 * (where wire-address == pubKey and no receive filtering runs). This closes the harness
 * blind spot that let a transport-specific chat-receive bug pass in-process node tests.
 */
export async function connectAgentsOverRelay(a, b, { relayUrl }) {
  for (const n of [a, b]) {
    await n.agent.connectPeerTransport({
      relayUrl,
      onPeerMessage: (env) => n._routerRef.fn?.(env),
    });
  }
}

/**
 * Connect two booted node agents over REAL public NKN (the browser's other transport),
 * via `connectPeerTransport({ nknLib })`. Uses the actual `nkn-sdk` (node-importable).
 * NB: NKN cold-routing can be slow/flaky from a sandbox — a hang here is itself a signal
 * that NKN one-way delivery is the unreliable path (the both-mode failure mode).
 */
export async function connectAgentsOverNkn(a, b) {
  const mod = await import('nkn-sdk');
  const nknLib = mod.default ?? mod;
  for (const n of [a, b]) {
    await n.agent.connectPeerTransport({
      nknLib,
      onPeerMessage: (env) => n._routerRef.fn?.(env),
    });
  }
}

/**
 * Connect N booted node agents over a REAL relay — the N-agent generalisation of
 * `connectAgentsOverRelay`, through each node's own production `connectPeerTransport` path.
 */
export async function connectNodesOverRelay(nodes, { relayUrl }) {
  for (const n of nodes.filter(Boolean)) {
    await n.agent.connectPeerTransport({
      relayUrl,
      onPeerMessage: (env) => n._routerRef.fn?.(env),
    });
  }
}

/**
 * Connect N booted node agents onto ONE shared presence-aware bus (the three-agent generalisation of
 * `connectAgentsOverBus`). Each node's chat transport is registered under its chat pubKey, so any node can
 * `sendPeerMessage(peer.pubKey, …)` to any other; each node's `_busTransport` is stashed for goOffline/goOnline.
 */
export async function connectNodesOverBus(nodes, { transportName = 'relay' } = {}) {
  const bus = new InternalBus({ presenceAware: true });
  for (const n of nodes) {
    const tx = new InternalTransport(bus, n.pubKey);
    await n.agent.sa.addSecureTransport(transportName, tx);
    n._busTransport = tx;
  }
  return bus;
}

/**
 * Take a node OFFLINE by disconnecting its shared-bus transport. It removes the
 * node's `msg:<addr>` listener + its `__peers` entry, so a peer's `canReach`
 * toward it now reports false — the transport-neutral "unreachable" signal the
 * send path's hold-forward rung keys on. (An InternalBus disconnect stands in
 * for a device that drops off the mesh.)
 */
export async function goOffline(node) {
  if (node?._busTransport) await node._busTransport.disconnect();
}

/**
 * Bring a node back ONLINE and emit a PRESENCE signal to `announceTo`: it
 * reconnects the bus transport (re-registering it) and sends a HI to the peer,
 * standing in for an agent re-announcing itself to known peers on reconnect.
 * That inbound HI is the presence signal that flushes anything the peer held
 * for this node. Pass no `announceTo` to reconnect silently (e.g. to then drive
 * the explicit `presenceSignal(addr)` reachability hook instead).
 */
export async function goOnline(node, { announceTo = null } = {}) {
  if (node?._busTransport) await node._busTransport.connect();
  if (announceTo && node?._busTransport) {
    try { await node._busTransport.sendHello(announceTo.pubKey, { pubKey: node.pubKey }); }
    catch { /* presence is best-effort; the explicit presenceSignal() hook is the fallback */ }
  }
}

/**
 * Drive the REAL app-level pairing: `admin` creates a circle + produces an invite;
 * `joiner` redeems it over the in-process transport. Returns everything the test
 * needs to assert (the invite URI, the join result, the resolved groupId).
 */
export async function pairCircle(admin, joiner, {
  groupId = 'peer-circle',
  name = 'Peer Circle',
  handle = 'peerbee',
  purpose = 'node pairing test',
} = {}) {
  const { created } = await createCircle(admin, { groupId, name, purpose });
  const { invite, joined } = await joinExistingCircle(admin, joiner, { groupId, handle });
  // Both sides now do exactly what the shells do after a join:
  //   1. bind their per-circle address on the transport (the boot-call half), and
  //   2. bind every OTHER member's `circleAddress → pubKey` in the security layer (the G12 half —
  //      without it a send to a per-circle address throws `No pubKey registered` above the transport).
  // (2) calls the SAME shared function production calls via `feedHouseholdRoster`, so this harness
  // exercises the real path rather than a test-only shortcut.
  await bindCircleAddresses([admin, joiner], groupId);
  await Promise.all([admin, joiner].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: groupId })));
  return { created, invite, joined, groupId };
}

/**
 * Bind each node's per-circle address on its bus/relay transport — the harness half of G13 step C.
 *
 * Production does this at boot and after every join (`registerCirclePresence`); without it a flipped
 * `preferCircleAddress` resolves to an address no transport is listening on, and every cross-peer test
 * fails for a reason that has nothing to do with what it is testing. Doing it HERE (rather than relaxing
 * the assertions) keeps the harness a faithful model of the app: if a send works in these tests, the same
 * registration made it work.
 *
 * Idempotent and best-effort: a node with no alias-capable transport is skipped, which is the same
 * degradation the shells have.
 */
export async function bindCircleAddresses(nodes, ...circleIds) {
  const ids = circleIds.flat().filter(Boolean);
  for (const n of nodes.filter(Boolean)) {
    // Decision 4 — the per-circle SIGNING identity, exactly as both shells install it, and BEFORE
    // the transport check: it is needed to open inbound circle traffic even where no alias is bound.
    await n.agent?.installCircleIdentities?.(ids);
    const transport = n._busTransport ?? n.agent?.relay ?? null;
    if (!transport?.supportsAliases) continue;
    await registerCircleAddresses({
      transport,
      relayUrl: 'internal://bus',          // single-transport world: everything rides the one socket
      circleIds: ids,
      circleAddressFor: (cid) => n.agent?.circleAddressFor?.(cid) ?? null,
      circleAddressSignerFor: (cid) => n.agent?.circleAddressSignerFor?.(cid) ?? null,
    });
  }
}

/**
 * Create a circle via the real create-wizard op path (createGroupState.finalSubmit → stoop.createGroupV2).
 * The single-admin creator step, split out so ONE circle can then take MULTIPLE joiners (the sealed-circle
 * three-member case) instead of `pairCircle` minting a fresh circle per pair.
 */
export async function createCircle(admin, { groupId = 'peer-circle', name = 'Peer Circle', purpose = 'node pairing test' } = {}) {
  const adminCallSkill = (app, op, args) => admin.agent.callSkill(app, op, args);
  const state = createGroupInitialState();
  state.groupId = groupId;
  state.name = name;
  state.purpose = purpose;
  const { result: created, state: outState } = await createGroupFinalSubmit({ state, callSkill: adminCallSkill });
  if (!created) throw new Error(`createGroupV2 failed: ${outState?.submitError ?? 'unknown'}`);
  return { created, groupId };
}

/**
 * Join an EXISTING circle: the admin mints a fresh invite for the current code, the joiner redeems it over the
 * in-process transport (the real join wizard op path → group-redeem peer bridge → membership trail). Callable
 * repeatedly against one circle to admit several members.
 */
export async function joinExistingCircle(admin, joiner, { groupId = 'peer-circle', handle = 'peerbee' } = {}) {
  const adminCallSkill = (app, op, args) => admin.agent.callSkill(app, op, args);
  const joinerCallSkill = (app, op, args) => joiner.agent.callSkill(app, op, args);

  const invite = await buildCircleInviteUri({ callSkill: adminCallSkill, circleId: groupId, adminPeerAddr: admin.pubKey });
  if (invite?.error) throw new Error(`buildCircleInviteUri failed: ${invite.error}`);

  const joined = await joinCircleFromInvite({
    inviteUri: invite.uri,
    callSkill: joinerCallSkill,
    sendPeerRedeem: joiner.sendPeerRedeem,
    handle,
  });
  return { invite, joined, groupId };
}

// ── Sealed circle (posture p2) — a group key + rotations carried in the log, no pod ─────────────────────────
//
// The default harness circle is UNSEALED (no group key). These helpers boot a SEALED circle over the SAME real
// agents + transport: a member's stable sealing PUBLIC key is derived from its published network key
// (`sealingPublicKeyFromNetworkKey`), and its sealing PRIVATE key stays encapsulated behind an opener closure
// (`openerForIdentity` → AgentIdentity.sharedCopyOpener) — the exact app seam, no secret ever surfaced. Key
// establishment/rotation ride the log as key-events fanned over `sendPeerMessage` (real hold-forward when a peer
// is offline); content is sealed by the seal resolver under the current version and fanned the same way. This is
// the no-pod key-rotation mechanism end-to-end, with the harness standing in only for the stoop skill that would
// emit/record the events (as it already stands in for the browser's connectPeerTransport wiring).

/** A member's stable sealing PUBLIC key — derived from its published network key (deterministic, no trail dependency). */
export function memberSealingPubKey(node) {
  return sealingPublicKeyFromNetworkKey(node.pubKey);
}

/** A member's sealing OPENER: `(sealedText) => plaintext` bound to its sealing PRIVATE key, which never escapes
 *  the closure (the encapsulated `AgentIdentity.sharedCopyOpener` path the app uses for shared copies). */
export function memberOpener(node) {
  return openerForIdentity(node.agent.sa.agent.identity);
}

// Hold-forward on: a key-event/content send to an offline member is HELD (not lost), then flushed on reconnect.
const SEALED_SEND = { hold: true, firstSendTimeoutMs: 0, retryDelays: [] };

/** Fan a key-event to each recipient node over the real transport (offline recipients are held). */
async function fanKeyEvent(from, toNodes, groupId, event) {
  await Promise.all(toNodes.map((n) =>
    from.agent.sendPeerMessage(n.pubKey, { type: 'group-key-event', subtype: 'group-key-event', groupId, event }, SEALED_SEND)));
}

/**
 * Boot a sealed circle: the admin ESTABLISHES version-1 group key sealed to every member's sealing key and fans
 * that key-event to the members over the log/transport. The admin keeps its own copy in its key-event log.
 */
export async function bootSealedCircle({ admin, members = [], groupId }) {
  const recipients = [memberSealingPubKey(admin), ...members.map(memberSealingPubKey)];
  const { event } = establishKeyEvent({ groupId, recipients });
  admin.keyEventStore.record(groupId, event);
  await fanKeyEvent(admin, members, groupId, event);
  return { groupId, recipients };
}

/**
 * The admin seals `text` under the CURRENT group-key version (folded from its own key-event log) via the seal
 * resolver, then fans the sealed envelope to `members`. Returns the tagged envelope (also recorded on receipt).
 */
export async function postSealed({ admin, members = [], groupId, text }) {
  const chain = readKeyChain(admin.keyEventStore.list(groupId), { groupId, opener: memberOpener(admin) });
  const groupKey = currentGroupKey(chain);
  if (!groupKey) throw new Error('postSealed: the admin holds no current group key to seal with');
  const env = sealForAudience(text, { groupKey }, { audience: 'circle' });
  await Promise.all(members.map((n) =>
    admin.agent.sendPeerMessage(n.pubKey, { type: 'sealed-content', subtype: 'sealed-content', groupId, env }, SEALED_SEND)));
  return env;
}

// ── Sealed circle via the REAL producer + control agent (drives the LIVE removeMember op) ───────────────────
//
// `bootSealedCircle`/`removeAndRotate` above stand in for the control agent (they call the key-event builders
// directly). The helpers below instead stand up the REAL per-circle producer + control agent — the same
// `createCirclePodProducer` the web shell builds — wired with the same `makeKeyEventLogSink`. A membership
// change then flows through the production path: the admin's stoop `removeMember` op → the control-agent
// router → the producer's control agent → `emitKeyEvent` → the sink → the fan. No harness stand-in on the
// remove path; the sink records the admin's own copy + fans the rotation to the remaining members over the bus.

/** A node-shaped in-memory pod client (createPseudoPod + PodClient), the node analogue of the web host's
 *  `makeCirclePodClient` — an ephemeral per-circle pseudo-pod, no OIDC/CSS. */
function makeNodePodClient(circleId) {
  const deviceId = `circle-${circleId}`;
  const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId });
  return new PodClient({ podRoot: `pseudo-pod://${deviceId}/`, auth: { getAuthHeaders: async () => ({}) }, pseudoPod });
}

/**
 * Seal a circle through the REAL producer: build a per-circle control agent (over an in-memory pseudo-pod)
 * wired with a `makeKeyEventLogSink` that records the admin's own key-events + fans each to the member
 * nodes, register it in the admin's control-agent router, then seed the group key to the admin + each
 * member using their NETWORK-derived sealing key (the family the harness openers use). After this, the
 * admin + every member hold the establishing key-event, and the REAL `removeMember` op will rotate from it.
 */
export async function sealCircleViaProducer({ admin, members = [], groupId }) {
  const memberNodes = members;
  // The sink: the control agent hands us each versioned key-event; we record the admin's own copy (so the
  // admin's chain advances for sealing NEW content) and fan it to exactly the member nodes whose sealing
  // key is among the event's recipients (a removed member is absent from a rotation → not fanned).
  const keyEventLog = makeKeyEventLogSink({
    groupId,
    recordLocal: (event) => { admin.keyEventStore.record(groupId, event); },
    sendPeer: (addr, payload, opts) => admin.agent.sendPeerMessage(addr, payload, opts),
    sendOptions: SEALED_SEND,
    resolveRecipientAddrs: (event) => {
      const recips = new Set(Array.isArray(event?.recipients) ? event.recipients : []);
      return memberNodes.filter((n) => recips.has(memberSealingPubKey(n))).map((n) => n.pubKey);
    },
  });

  const producer = await createCirclePodProducer({
    circleId: groupId, storagePosture: 'p2', vault: new VaultMemory(),
    generateKeypair: podGenerateKeypair, makePodClient: makeNodePodClient,
    keyEventLog,
  });
  admin.circlePods.set(groupId, producer);

  // Seed the group key to the admin + each member under their network-derived sealing key, via the router
  // (the same addMember path a redeem drives). Each grant re-wraps the SAME v1 key to one more recipient +
  // emits a key-event through the sink (recorded locally; fanned to the members who are recipients so far).
  await admin.circleControlAgentRouter.addMember({ webId: admin.pubKey, publicKey: memberSealingPubKey(admin), role: 'admin', groupId });
  for (const n of memberNodes) {
    await admin.circleControlAgentRouter.addMember({ webId: n.pubKey, publicKey: memberSealingPubKey(n), role: 'member', groupId });
  }
  return producer;
}

/**
 * Remove a member + rotate: the admin mints the NEXT-version key sealed to the REMAINING recipients only (the
 * departed omitted → backward secrecy) and fans that rotation key-event to `keep` alone. Returns the new event.
 */
export async function removeAndRotate({ admin, keep = [], groupId }) {
  const recipients = [memberSealingPubKey(admin), ...keep.map(memberSealingPubKey)];
  const { event } = rotateKeyEvent({ groupId, priorEvents: admin.keyEventStore.list(groupId), recipients });
  admin.keyEventStore.record(groupId, event);
  await fanKeyEvent(admin, keep, groupId, event);   // the removed member is NOT among the recipients of this fan
  return { event };
}

/** A member reads a sealed envelope across the versions it holds: the PRODUCTION no-pod reader folds its
 *  per-circle key-event log (`keyEventStore`) into the key chain and opens by authenticated trial. */
export function readSealed(node, env, groupId) {
  return openViaKeyEvents(env, { events: node.keyEventStore.list(groupId), groupId, opener: memberOpener(node) });
}

/** Read a circle roster via the real listGroupMembers op. */
export async function readRoster(node, groupId) {
  const res = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId });
  return Array.isArray(res?.members) ? res.members : [];
}

/** Best-effort shutdown of the underlying secure-mesh agents. */
export async function teardown(...nodes) {
  for (const n of nodes) { try { LIVE_NODES.delete(n); } catch { /* */ } }
  for (const n of nodes) {
    try { await n?.agent?.sa?.shutdown?.(); } catch { /* defensive */ }
  }
}

/**
 * Send one kring chat over the SIGNED path — the exact production shape: append the signed render entry
 * on the sender's own log (`chatRail.appendMessage`), then fan the STATEMENT through the real stoop core
 * (`broadcastCircleChatStatement` → transport / pod routing per the circle's policy). The drop-in
 * replacement for the deleted plain-envelope `broadcastCircleMessage` in every journey test.
 */
export async function sendKringChat(node, { groupId, msgId, text, ts = Date.now(), media } = {}) {
  const res = await node.chatRail.appendMessage(groupId, { msgId, ts, text, actor: node.pubKey, media });
  if (!res) return { error: 'no-circle-signer' };
  return node.agent.callSkill('stoop', 'broadcastCircleChatStatement', { groupId, event: res.statement, msgId, ts });
}
