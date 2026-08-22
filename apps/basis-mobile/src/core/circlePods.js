/**
 * basis-mobile — per-circle pod producers + content-seal strategies (RN parity
 * with web's `circleApp.js` S4 wiring). One producer per circle (sealing identity +
 * control agent over an in-memory pseudo-pod) lives OUTSIDE the single stoop agent;
 * `getCircleSealStrategy` resolves the circle's `{seal,open}` content strategy so
 * `scopeStoopCallSkill` can transparently seal a p2/p3 circle's noticeboard posts.
 *
 * The crypto is now pure-JS (tweetnacl + @noble/hashes — the RNG is polyfilled at app
 * entry via `react-native-get-random-values`), so this runs on Metro. The vault is
 * AsyncStorage-backed and injected via `initCirclePods` (kept off module scope so vitest
 * can import this without an AsyncStorage native module); the group-key resource persists
 * there for durability across reloads.
 */
import { VaultAsyncStorage } from '@onderling/react-native/identity/VaultAsyncStorage';
import { createAsBackend } from '@onderling/react-native/pseudo-pod-adapter';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { PodClient, generateKeypair as podGenerateKeypair, SolidOidcAuth,
  createSealedPodDataSource, podGroupPrefix,
  recipientStrategy as podRecipientStrategy,
  sealingPublicKeyFromNetworkKey as podSealingPublicKeyFromNetworkKey } from '@onderling/pod-client';
import { sealItem } from '@onderling/item-store';
import { makeCircleLists } from '@onderling/kring-host/circleLists';
import { makeKeyEventLogSink, recipientAddrsFromRoster } from '@onderling/kring-host/keyEventLogSink';
import { createKeyEventStore, wrapStrategyWithKeyEventFold } from '../../../basis/src/v2/keyEventStore.js';
import { KEY_STATEMENT_BROADCAST, projectKeyEventsIntoStore } from '../../../basis/src/v2/keyRail.js';
import { createCirclePodProducer, createCircleControlAgentRouter, seedCircleRoster } from '../../../basis/src/v2/circlePodProducer.js';
import { realPodRouting } from '../../../basis/src/v2/circleRealPod.js';
import { createCirclePodSharing } from '../../../basis/src/v2/circlePodSharing.js';
// the SHARED cross-circle SHARE logic + the platform-neutral enforcement assembly.
// Mobile calls the SAME builder + ops as web (circleApp.js) — invariant #1/#2, no mobile fork.
import { buildCircleShareEnforcement } from '../../../basis/src/v2/circleShareEnforcement.js';
import { recipientSealingKeyResolver } from '../../../basis/src/v2/shareRecipients.js';
import { shareItemAcrossCircles, shareItemToPublishedKey as sharedShareItemToPublishedKey, listSharedResolved, revokeItemShare } from '../../../basis/src/v2/circleShare.js';
// Cache-mode mirroring (RN parity): the SHARED custody-resolution + cache medium, fed by mobile's own
// ensureCirclePod / getCircleSealStrategy / policy resolver / AsyncStorage backend.
import { createCirclePodCustody } from '../../../basis/src/v2/circlePodCustody.js';
import { createCircleCacheMedium } from '../../../basis/src/v2/circleCacheMedium.js';
import { circleStoreMode } from '../../../basis/src/v2/circleDataPolicy.js';
import { buildHouseholdDataSource } from '../../../household/src/index.js';
// objective L follow-up — the mobile per-circle policy store (AsyncStorage-backed, `cc.circlePolicy.<id>`
// keys). Mirror of web circleApp.js's module-level `policyStore`: the composition-root's `policyOf` reads the
// LIVE per-circle `sharePosture` from here instead of the deny-by-default `{}`.
import { makeCirclePolicyStoreRN } from './circleStoresRN.js';
// pod versioning — the RN twin of web's src/web/circleVersioning.js (expo-crypto hash;
// crypto.subtle fallback for vitest/web). One store per circle, on the circle pod's own backend.
import { circleVersioningFor } from './circleVersioning.js';

let circleVault = null;                       // VaultAsyncStorage (durable) — set by initCirclePods
let podSessionRef = null;                     // App-owned OidcSessionRN ref — set by setCirclePodSession
let asyncStorageRef = null;                   // raw RN AsyncStorage — for the default (non-pod) lists DataSource
const circlePods = new Map();                 // circleId → producer
const circleSealStrategies = new Map();       // circleId → {seal,open} | null

/** Wire the durable AsyncStorage vault (call once at app boot with the RN AsyncStorage). */
export function initCirclePods(asyncStorage) {
  if (asyncStorage) asyncStorageRef = asyncStorage;
  if (asyncStorage && !circleVault) {
    circleVault = new VaultAsyncStorage({ prefix: 'cc-circle-pod:', asyncStorage });
  }
}

/** Share the App-owned OidcSessionRN (a ref or the session). When signed in, sealed circles
 *  route to the user's REAL pod via the session's authenticated fetch (else the pseudo-pod). */
export function setCirclePodSession(sessionOrRef) { podSessionRef = sessionOrRef; }

// Story 1.2 — the Contacten roster, injected by the shell (the launcher owns the bundle/peerGraph; this module
// doesn't). It backs `sealingKeyForRecipient`: an out-of-circle grantee's sealing key is RE-DERIVED from their
// published network key, so a revoke can evict exactly that grantee instead of rotating away from all of them.
// Absent ⇒ the enforcement falls back to the conservative roster-only rotation (safe, lossy).
let _contactsSource = null;
export function setCircleContactsSource(fn) { _contactsSource = typeof fn === 'function' ? fn : null; }

// ── No-pod group-key rotation (G11, RN parity with web circleApp.js) ────────────────────────────────
// The LOCAL per-circle key-event log this device holds: its OWN emitted key-events (recorded by the sink's
// `recordLocal` below) + every event fanned to it by another member (the `group-key-event` receive handler
// in ChatScreen's peer router → `recordCircleKeyEvent`). A content read folds these into the key chain, so
// a sealed circle stays readable with NO pod, and a removed member — never sent the rotation event —
// cannot open post-removal content. Same shared store module + handler as web (invariants #1/#2).
const circleKeyEventStore = createKeyEventStore();
export function recordCircleKeyEvent(groupId, event) {
  const recorded = circleKeyEventStore.record(groupId, event);
  // A key-event means the circle's key state MOVED (typically a rotation). Drop the cached seal strategy so
  // the next seal re-resolves against the new state — a stale cached strategy would keep sealing NEW content
  // under the OLD version, which the departed member still holds. Backward secrecy must not depend on a
  // cache's lifetime. (Rotation does not depend on the REMOVED client deleting anything — they never receive
  // the new key; this guards the REMAINING members' seal side.)
  if (recorded) circleSealStrategies.delete(groupId);
  return recorded;
}
// The lane-projection refresh (web parity): the local key-event store mirrors the KEY LANE's
// verified, dispute-discounted statement set — called by the statement handler and the lane
// catch-up's onChange in ChatScreen.
export function refreshCircleKeyEventsFromLane(rail, groupId) {
  return projectKeyEventsIntoStore({ rail, store: circleKeyEventStore, circleId: groupId })
    .then((n) => { if (n) circleSealStrategies.delete(groupId); return n; });
}

// The EMIT side's transport wiring — the peer sender + skill dispatch live in the agent bundle, which this
// module doesn't own; the bundle injects them at boot (mirror of web's lazy `_peerAgent`/`rawCallSkill`
// refs). The sink only fires on a later membership change, so late injection is safe; absent ⇒ the sink
// records locally and fans to nobody (single-device behaviour, unchanged).
let _keyEventWiring = null;   // { sendPeer(addr,payload,opts), callSkill(origin,opId,args) }
export function setCircleKeyEventWiring(wiring) { _keyEventWiring = wiring ?? null; }

/** The no-pod distribution sink for ONE circle — a membership change (notably a REMOVE → rotation) fans the
 * new versioned key AS a log key-event to the circle's REMAINING members over the SAME peer channel content
 * rides — sealed to them only, so the departed cannot open post-removal content with no shared pod. The pod
 * key resource is still written (defence-in-depth); the log is the source for a no-pod circle. */
function makeCircleKeyEventLog(circleId) {
  return makeKeyEventLogSink({
    groupId: circleId,
    // Through recordCircleKeyEvent so the EMIT side also drops the cached seal strategy (see there).
    recordLocal: (event) => recordCircleKeyEvent(circleId, event),
    // THE SIGNED LANE (web parity): each key-event is appended to the device log as a circle-signed,
    // chained statement, and the STATEMENT is what fans — receivers verify signature, chain and
    // rotateKey authority at their key rail. Contract with the sink: a wiring WITHOUT a key lane
    // (stub boots, log-less tests) returns `undefined` → the raw degrade; a lane that refuses to
    // sign returns `null` → fail closed, nothing fans bare.
    emitStatement: (gid, event) => (_keyEventWiring?.keyEmit
      ? (_keyEventWiring.keyEmit(gid ?? circleId, event) ?? null)
      : undefined),
    statementSubtype: KEY_STATEMENT_BROADCAST,
    sendPeer: (addr, payload, opts) => (typeof _keyEventWiring?.sendPeer === 'function'
      ? _keyEventWiring.sendPeer(addr, payload, opts)
      : Promise.resolve()),
    // Held (not lost) for an offline member, flushed on reconnect — the same channel content fans over.
    sendOptions: { hold: true, firstSendTimeoutMs: 0, retryDelays: [] },
    resolveRecipientAddrs: async (event) => {
      if (typeof _keyEventWiring?.callSkill !== 'function') return [];
      let members = [];
      try {
        const r = await _keyEventWiring.callSkill('stoop', 'listGroupMembers', { groupId: circleId });
        members = Array.isArray(r?.members) ? r.members : [];
      } catch { return []; }
      return recipientAddrsFromRoster(event, members);
    },
  });
}

/** The signed-in user's AUTHED fetch (OidcSessionRN bearer), or null when signed
 *  out. embed-ref resolution uses it to read the user's OWN private-pod items. */
export function getCirclePodFetch() {
  const s = podSessionRef?.current ?? podSessionRef;
  try {
    if (s && typeof s.isAuthenticated === 'function' && s.isAuthenticated()
        && typeof s.getAuthenticatedFetch === 'function') {
      return s.getAuthenticatedFetch();
    }
  } catch { /* best-effort */ }
  return null;
}

/** The signed-in member's WebID (the acting identity), or null when signed out. objective L — threaded as
 *  `by`/`recipient` into the share/read wrappers so the initiator + read gates see a REAL actor. Mirrors web's
 *  `circleOwnerWebId` (the signed-in webid). Lean: reads only the session's webid (no authenticated fetch). */
export function getCircleActorWebId() {
  const s = podSessionRef?.current ?? podSessionRef;
  try {
    if (s && typeof s.isAuthenticated === 'function' && s.isAuthenticated() && s.webid) return s.webid;
  } catch { /* best-effort */ }
  return null;
}

/** Adapt an OidcSessionRN → the {webid, isLoggedIn, fetch} shape realPodRouting expects. */
function sessionShape() {
  const s = podSessionRef?.current ?? podSessionRef;
  if (!s || typeof s.isAuthenticated !== 'function' || !s.isAuthenticated() || !s.webid) return null;
  let fetch;
  try { fetch = s.getAuthenticatedFetch(); } catch { return null; }
  return { webid: s.webid, isLoggedIn: true, fetch };
}

/** The active real-pod routing from the signed-in session (or null → pseudo-pod). */
export function getActiveRealPodRouting() {
  const shaped = sessionShape();
  return shaped ? realPodRouting(shaped, { PodClient, SolidOidcAuth }) : null;
}

/** A pseudo-pod client for one circle (no OIDC; group key persisted via the vault). Objective L: the
 * backend is AsyncStorage-persistent (scoped per circle) when the RN AsyncStorage was injected at boot
 * (initCirclePods), so the circle's items survive a restart; falls back to in-memory otherwise (tests). */
function makeCirclePodClient(circleId) {
  const deviceId = `circle-${circleId}`;
  const backend = asyncStorageRef
    ? createAsBackend({ AsyncStorage: asyncStorageRef, scope: `cc-circle-${circleId}` })
    : createMemoryBackend();
  // versioning: displaced bytes (overwrites · peer-updates · dropped
  // concurrent forks · deletes) land in `versions/` on the SAME backend —
  // the substrate under the my-data restore ops. Best-effort by design
  // (a throwing store never breaks a write).
  const versioning = circleVersioningFor(circleId, deviceId, backend);
  const pseudoPod = createPseudoPod({ backend, mode: 'standalone', deviceId, versioning });
  return new PodClient({ podRoot: `pseudo-pod://${deviceId}/`, auth: { getAuthHeaders: async () => ({}) }, pseudoPod });
}

/** Ensure a per-circle producer exists (idempotent). Best-effort; null when no vault / on failure. */
export async function ensureCirclePod(circleId, policy) {
  if (!circleId || !circleVault || circlePods.has(circleId)) return circlePods.get(circleId) ?? null;
  let producer = null;
  // Circle OIDC: when signed in, route a sealed circle to the user's REAL pod via the RN
  // session's authenticated fetch (the fetch is no longer hidden); else the pseudo-pod.
  const routing = getActiveRealPodRouting();
  // On a REAL pod, wire a real ACP `sharing` (member redeem → pod read grant) for true
  // multi-device. web parity (circleApp). Pseudo-pod keeps the no-op.
  const shaped = sessionShape();
  const sharing = (routing && shaped)
    ? createCirclePodSharing({ fetch: shaped.fetch, ownerWebId: shaped.webid })
    : undefined;
  try {
    producer = await createCirclePodProducer({
      circleId, storagePosture: policy?.storagePosture ?? 'p0', vault: circleVault,
      generateKeypair: podGenerateKeypair,
      makePodClient: routing ? routing.makePodClient : makeCirclePodClient,
      circleRootUri: routing ? routing.circleRootUri(circleId) : undefined,
      sharing,
      // G11 — no-pod key distribution: rotations fan as log key-events (web parity, see makeCircleKeyEventLog).
      keyEventLog: makeCircleKeyEventLog(circleId),
    });
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[circlePods] ensureCirclePod failed:', err?.message ?? err);
  }
  circlePods.set(circleId, producer);
  return producer;
}

// S4 — routes stoop membership events (redeem/leave) to the joined circle's producer for
// multi-member sealing (the joiner's sealing key is wrapped into the group key). Pass to
// bootAgentBundle as `stoopControlAgent`. V0: routes to a live (opened) circle's producer.
export const circleControlAgentRouter = createCircleControlAgentRouter((id) => circlePods.get(id) ?? null);

/** Ensure a circle's producer, then seed its group-key roster with prior members (web parity). */
export async function seedCircleRosterFor({ circleId, policy, callSkill }) {
  const prod = await ensureCirclePod(circleId, policy);
  if (!prod?.controlAgent) return 0;
  return seedCircleRoster({ callSkill, circleId, router: circleControlAgentRouter });
}

/** Resolve (+ cache) a circle's content seal/open strategy via the device's own sealing identity. */
export async function getCircleSealStrategy(circleId, policy) {
  if (circleSealStrategies.has(circleId)) return circleSealStrategies.get(circleId);
  let strat = null;
  try {
    const prod = await ensureCirclePod(circleId, policy);
    if (prod?.controlAgent && prod.sealingIdentity) {
      const idKey = await prod.sealingIdentity.ensure();
      strat = await prod.controlAgent.sealingStrategy(idKey.privateKey);
      // G11 — no-pod defence-in-depth: content sealed under a version carried only in the key-event LOG
      // (a rotation fanned to this device) still opens. Shared wrapper; lazy read at open time (web parity).
      if (strat && idKey?.privateKey) {
        strat = wrapStrategyWithKeyEventFold(strat, {
          listEvents: () => circleKeyEventStore.list(circleId), groupId: circleId, privateKey: idKey.privateKey,
        });
      }
    }
  } catch { strat = null; }
  circleSealStrategies.set(circleId, strat);
  return strat;
}

// ── · objective L — the cross-circle SHARE composition root (RN mirror of web circleApp.js) ────────
// Web≡mobile by construction: the SHARED share ops (circleShare.js) + the SHARED enforcement assembly
// (circleShareEnforcement.js) are wired here to the mobile pod objects (session/routing/producer). Absent a
// pod session + a sealing strategy the pod path declines (returns null) and the op degrades to the in-memory
// `shared-ref` behaviour — the same additive fallback web uses. No mobile-specific share/seal reimplementation.

// The app-wide DEFAULT lists service, persistent via an AsyncStorage-backed DataSource (in-memory fallback).
// Lazy + memoised. Mirrors web's getDefaultCircleLists (IDB there).
let _defaultListsPromise = null;
function getDefaultCircleLists() {
  if (!_defaultListsPromise) {
    _defaultListsPromise = (async () => {
      let dataSource;
      try {
        // AsyncStorage-backed on device (durable); in-memory when no store is wired (SSR/tests).
        dataSource = asyncStorageRef
          ? await buildHouseholdDataSource({ dbName: 'cc-circle-lists-state', asyncStorage: asyncStorageRef })
          : undefined;
      } catch { dataSource = undefined; }   // no store → in-memory (makeCircleLists' default)
      return makeCircleLists({ dataSource });
    })();
  }
  return _defaultListsPromise;
}

// A SEALED, POD-BACKED lists service per circle (opt-in). Present only when signed in (real-pod routing +
// authed fetch) AND the circle resolves a sealing strategy (p2/p3 with a group key). Absent → null and the
// caller keeps the default lists, so nothing breaks with no pod session (additive). Mirrors web getPodCircleLists.
const _podCircleListsByCircle = new Map();   // circleId → Promise<listsSvc | null>
export async function getPodCircleLists(circleId, policy) {
  const routing = getActiveRealPodRouting();
  const authedFetch = getCirclePodFetch();
  if (!circleId || !authedFetch || !routing?.podRoot) return null;
  if (!_podCircleListsByCircle.has(circleId)) {
    _podCircleListsByCircle.set(circleId, (async () => {
      try {
        const strategy = await getCircleSealStrategy(circleId, policy);
        if (!strategy) return null;   // p0/p1 or no group key → decline rather than write plaintext to the pod
        const dataSource = createSealedPodDataSource({ fetch: authedFetch, podUrl: routing.podRoot, strategy });
        return makeCircleLists({ dataSource, rootPrefix: podGroupPrefix(routing.podRoot) });
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[circlePods] pod-backed lists unavailable:', err?.message ?? err);
        return null;
      }
    })());
  }
  return _podCircleListsByCircle.get(circleId);
}

/** Resolve a circle's lists service: the sealed pod-backed one when available, else the app default. */
export async function getCircleLists(circleId, policy) {
  const pod = await getPodCircleLists(circleId, policy);
  return pod || getDefaultCircleLists();
}

// The POD-TIER enforcement binder for a circle's cross-circle SHARE — built from the SHARED assembly. Returns
// the `{onShare, onShareCanonical, revokeCanonical, policy}` binder when the pod path is ACTIVE (signed-in
// real-pod routing + the pod-client's ACP `sharing` + a resolved seal strategy); else null (memory path).
const _shareEnforcementByCircle = new Map();   // circleId → Promise<enforcement | null>
export async function getCircleShareEnforcement(circleId, policy) {
  if (!circleId) return null;
  const routing = getActiveRealPodRouting();
  const podRoot = routing?.podRoot;
  if (!podRoot) return null;                    // not signed in → memory path
  if (!_shareEnforcementByCircle.has(circleId)) {
    _shareEnforcementByCircle.set(circleId, (async () => {
      try {
        const prod     = await ensureCirclePod(circleId, policy);
        const strategy = await getCircleSealStrategy(circleId, policy);
        const sharing  = prod?.podClient?.sharing;   // client.sharing = { grant, list, revoke } (resourceUri shape)
        let idKey = null;
        try { idKey = prod?.sealingIdentity ? await prod.sealingIdentity.ensure() : null; } catch { idKey = null; }
        // The SAME platform-neutral builder web uses — requires a real ACP sharing + seal strategy, wires the
        // canonical controller from the control agent's group-key resource + this device's sealing identity.
        return buildCircleShareEnforcement({
          sharing, strategy, podRoot, controlAgent: prod?.controlAgent, idKey,
          // web parity — the same shared resolver, over the shell-injected Contacten roster.
          sealingKeyForRecipient: recipientSealingKeyResolver({
            contacts: () => (_contactsSource ? _contactsSource() : []),
            deriveSealingKey: podSealingPublicKeyFromNetworkKey,
          }),
        });
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[circlePods] share enforcement unavailable:', err?.message ?? err);
        return null;
      }
    })());
  }
  return _shareEnforcementByCircle.get(circleId);
}

// objective L follow-up — the composition-root's per-circle policy SOURCE, mirroring web circleApp.js's
// module-level `policyStore` + `_circlePolicy`. Lazily built from the AsyncStorage wired via `initCirclePods`;
// reads the SAME `cc.circlePolicy.<id>` keys the launcher's store writes, so the initiator gate sees the LIVE
// per-circle `sharePosture` (normalized via normalizeCirclePolicy inside the store's `.get`). Null until a
// store is wired (no AsyncStorage) — then `policyOf` falls back to {} (deny-by-default), unchanged + safe.
let _circlePolicyStore = null;
function getCirclePolicyStore() {
  if (!_circlePolicyStore && asyncStorageRef) {
    try { _circlePolicyStore = makeCirclePolicyStoreRN(asyncStorageRef); } catch { _circlePolicyStore = null; }
  }
  return _circlePolicyStore;
}

// Read a circle's REAL policy (`sharePosture`/`admins`/`storagePosture`) best-effort — the mobile mirror of
// web's `_circlePolicy`. Absent a store (no session/AsyncStorage) it returns {} → normalizeCirclePolicy →
// 'closed' (deny-by-default), the same safe fallback as before.
const _defaultPolicyOf = async (circleId) => {
  const store = getCirclePolicyStore();
  if (!store || !circleId) return {};
  try { return (await store.get(circleId)) ?? {}; } catch { return {}; }
};

// Build the resolveService / enforcementFor pair for a share op, closing over the effective policy lookup so
// each circle picks its own pod-vs-default lists + enforcement (mirrors web's _circleServiceFor / _shareEnforcementFor).
function _shareResolvers(policyOf) {
  const pol = typeof policyOf === 'function' ? policyOf : _defaultPolicyOf;
  const resolveService = async (id) => getCircleLists(id, await pol(id));
  const enforcementFor = async (id) => {
    try { return await getCircleShareEnforcement(id, await pol(id)); } catch { return null; }
  };
  return { resolveService, enforcementFor, policyOf: pol };
}

/**
 * SHARE one item from `fromCircleId` into `toCircleId`'s audience — the mobile-wired path into the shared
 * `shareItemAcrossCircles`. Canonical posture grants IN PLACE (no copy) via the enforcement's onShareCanonical;
 * the copy postures re-seal via `sealCopy` + `recipientKeys`. Callers may inject `resolveService`/`enforcementFor`
 * (the composition root's own by default) and MUST pass `policyOf` (the source circle's admin policy) for the
 * initiator gate. There is no mobile SHARE UI screen yet — this is the invocable composition-root wiring.
 */
export async function shareItemIntoCircle({
  itemId, fromCircleId, toCircleId, by, recipient, recipients, recipientKeys, sealCopy,
  resolveService, enforcementFor, policyOf,
} = {}) {
  const r = _shareResolvers(policyOf);
  return shareItemAcrossCircles({
    resolveService: resolveService ?? r.resolveService,
    enforcementFor: enforcementFor ?? r.enforcementFor,
    policyOf: r.policyOf,
    recipientKeys, sealCopy,
    // objective L — thread the signed-in member's WebID as the initiator (mirrors web's `by ?? LOCAL_ACTOR`),
    // so the source circle's initiator gate sees a real actor. Null when signed out ⇒ deny-by-default holds.
    itemId, fromCircleId, toCircleId, by: by ?? getCircleActorWebId() ?? undefined, recipient, recipients,
  });
}

/**
 * objective L · Phase 2 — SHARE one canonical item OUT to an OUT-OF-CIRCLE recipient by their PUBLISHED
 * network key (the mobile mirror of web circleApp.js's `shareItemToContact`). Thin pass-through to the SHARED
 * `shareItemToPublishedKey` — no mobile fork of the share/grant logic. The `recipientNetworkKey` is the
 * contact's `pubKey`/`peerAddr` the recipient picker read off the roster row (see `pickableRecipients`).
 */
export async function shareItemToPublishedKey({
  itemId, fromCircleId, toCircleId, by, recipient, recipientNetworkKey, verify, includeHistory,
  resolveService, enforcementFor, policyOf,
} = {}) {
  const r = _shareResolvers(policyOf);
  const resolveSvc = resolveService ?? r.resolveService;
  return sharedShareItemToPublishedKey({
    resolveService: resolveSvc,
    enforcementFor: enforcementFor ?? r.enforcementFor,
    policyOf: r.policyOf,
    // The `silent` policy path's injected pod-layer crypto (mirror of web circleApp.js — the seal is a shell
    // adapter, kept out of shared src). `sealingKeyFromNetworkKey` derives the recipient's sealing key.
    sealCopy: _sealCopyToRecipients,
    sealingKeyFromNetworkKey: podSealingPublicKeyFromNetworkKey,
    // NOTICE emitters routed by the circle's `notifyOutOfCircle` setting (mirror of web circleApp.js).
    // `notify` (admins) → @onderling/notify-envelope wiring is a follow-up; today it records the event.
    notify: (payload) => { try { console.info?.('[share] out-of-circle', payload); } catch { /* noop */ } },
    // `post` → write the tagged post to the source circle's noticeboard item store (reuses `type:'post'`).
    // The `category:'permission-log'` tag lets a future logging section filter it out of the main board.
    post: async (taggedPost) => {
      try {
        const svc = await resolveSvc(taggedPost.fromCircleId);
        const store = svc?.stores?.getStore?.(taggedPost.fromCircleId);
        if (store && typeof store.put === 'function') await store.put(taggedPost, { by: taggedPost.by });
      } catch { /* best-effort */ }
    },
    itemId, fromCircleId, toCircleId, by: by ?? getCircleActorWebId() ?? undefined,
    recipient, recipientNetworkKey, verify, includeHistory,
  });
}

// The injected COPY re-sealer (recipientStrategy + item-store sealItem) — mirror of web's sealCopyToRecipients.
// A pod-layer adapter (kept out of shared src by design); both shells inject the same 3-line shape.
function _sealCopyToRecipients(item, keys) {
  const strat = podRecipientStrategy({ recipients: keys });
  return sealItem(item, (text) => strat.seal(text));
}

/** The READ path: everything shared INTO `circleId`, resolved deny-by-default (a non-recipient's ref is dropped). */
export async function listSharedItems(circleId, { recipient, resolveService, enforcementFor, policyOf } = {}) {
  const r = _shareResolvers(policyOf);
  return listSharedResolved({
    resolveService: resolveService ?? r.resolveService,
    enforcementFor: enforcementFor ?? r.enforcementFor,
    // objective L — default the read subject to the signed-in member's WebID (mirrors web's
    // `recipient ?? circleOwnerWebId`), so the deny-by-default read gate resolves against a real identity.
    circleId, recipient: recipient ?? getCircleActorWebId() ?? undefined,
  });
}

/** UN-SHARE (revoke) a recipient's canonical access — rotate the group key + ACP-revoke. `not-canonical` otherwise. */
export async function unshareItemFromCircle({
  itemId, fromCircleId, toCircleId, recipient, recipients, remainingRecipients,
  resolveService, enforcementFor, policyOf,
} = {}) {
  const r = _shareResolvers(policyOf);
  return revokeItemShare({
    resolveService: resolveService ?? r.resolveService,
    enforcementFor: enforcementFor ?? r.enforcementFor,
    policyOf: r.policyOf,
    itemId, fromCircleId, toCircleId, recipient, recipients, remainingRecipients,
  });
}

// ── Cache-mode mirroring — the store MEDIUM for a pod-backed circle (RN parity with web's circleApp) ──────
// The circle-pod custody, reusing the SHARED resolver over mobile's own ensureCirclePod + seal-strategy +
// policy resolver. Lazy so all three are defined by call time.
let _circlePodCustodyRN = null;
function circlePodCustodyRN() {
  if (!_circlePodCustodyRN) {
    _circlePodCustodyRN = createCirclePodCustody({
      ensureCirclePod,
      policyFor:       _defaultPolicyOf,
      sealStrategyFor: getCircleSealStrategy,
    });
  }
  return _circlePodCustodyRN;
}

/**
 * Provision a pod-backed circle's store MEDIUM (a cache-mode PseudoPod that seals→write-throughs to the
 * circle's pod). realAgent calls this once per circle at circle-open, BEFORE the store is built. A no-pod
 * circle → null → the shared local backing, unchanged. RN parity with web's circleApp `provisionCircleMedium`.
 */
export async function provisionCircleMedium(circleId) {
  try {
    const policy = await _defaultPolicyOf(circleId);
    if (circleStoreMode(policy?.pod) !== 'cache') return null;   // no-pod → shared local backing
    const localBackend = asyncStorageRef
      ? createAsBackend({ AsyncStorage: asyncStorageRef, scope: `cc-circle-cache-${circleId}` })
      : createMemoryBackend();
    const medium = createCircleCacheMedium({
      localBackend,
      deviceId:   `circle-cache-${circleId}`,
      resolvePod: () => circlePodCustodyRN().resolveCirclePodCustody(circleId),
    });
    // Restore-robustness, RN parity with web: tag the medium with WHERE this circle's wrapped
    // group-key resource lives, so a wiped device re-attaches by an explicit pointer (survives a
    // routing/scheme change), not only by re-deriving the URI. realAgent upserts it into the registry.
    try {
      const custody = await circlePodCustodyRN().resolveCirclePodCustody(circleId);
      if (custody?.circleRootUri) medium.keyRef = { ref: `${custody.circleRootUri}/.keys/group.json`, posture: policy?.storagePosture };
    } catch { /* the pointer is optional — never break the medium */ }
    return medium;
  } catch { return null; }   // any failure → local-only (honest degrade)
}

// ── Connectivity Phase 3 — LIVE shared-pod key-custody seams (member-side, keyed by circleId) ────────────
// RN parity with web's circleApp, which threads `stoopCircleDataMove`/`stoopPodWrite`/`stoopPodReadSince`
// into the agent + `resolveRef` into the chat inbox. Thin LAZY wrappers over the SAME shared custody the
// cache medium already uses (`circlePodCustodyRN()` → `createCirclePodCustody`), so a shared/hybrid circle
// WITH a pod + group key really seals→writes the pod + fans a ref (pod-signal), and catch-up range-
// queries→opens it; a no-pod circle keeps fan-out-full / local-mirror reads unchanged. realAgent maps the
// three into circleDataMove/podWrite/podReadSince; the inbox uses circleResolveRef to resolve a REF envelope.
// Lazy (resolve at call time) because the custody's ensureCirclePod/policy/seal seams settle after boot.
export const circleSendDataMove = (circleId)          => circlePodCustodyRN().circleSendDataMove(circleId);
export const circlePodWrite     = (circleId, envelope) => circlePodCustodyRN().circlePodWrite(circleId, envelope);
export const circlePodReadSince = (circleId, q)        => circlePodCustodyRN().circlePodReadSince(circleId, q);
export const circleResolveRef   = (refEnvelope)        => circlePodCustodyRN().circleResolveRef(refEnvelope);
