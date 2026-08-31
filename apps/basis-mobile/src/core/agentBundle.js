/**
 * basis-mobile — in-process agent bundle.
 *
 * Composition shell: the same `createRealHouseholdAgent` factory
 * that powers web basis (lifted to portable code in)
 * gets booted here with RN-friendly opts.  Cross-peer mesh wires
 * the RN NknTransport when a runtime nkn-sdk module is
 * available.
 *
 * Portable: zero RN, zero DOM at import time.  The actual factory
 * boot may need browser-globals (createRealHouseholdAgent uses
 * `typeof globalThis.localStorage` guards), so on RN the caller
 * passes `opts.chatVault` + `opts.hostVault` to bypass the
 * localStorage default. See (AsyncStorage adapter follow
 * up) for the production storage path.
 *
 * Three boot modes, picked by opts:
 *   1. `opts.skillStub` — test-only stub; bypasses the real factory.
 *      Returned bundle's callSkill delegates straight to the stub.
 *   2. Real boot with `opts.chatVault` (+ optional opts.hostVault) —
 *      the production path.  createRealHouseholdAgent runs; the
 *      returned controller exposes its callSkill verbatim.
 *   3. No vaults + no stub — the factory tries `makeBrowserVault`,
 *      which uses localStorage; on Hermes this throws.  We catch
 *      and surface a clear error rather than crash silently.
 *
 * The V0 'agent-not-booted' stub fell away in V1 (replaced by
 * boot-failure error or the real factory's reply).
 */
import { composeManifests, buildManifestsByOrigin } from './composeManifests.js';
import { connectionManifests } from '../../../basis/src/v2/connectionManifests.js';
import { getCircleVersionStore } from './circleVersioning.js';
// Shared extension-mapping loader (feedback-extension) — web≡mobile core.
import { loadVerifyMappings } from '../../../basis/src/v2/mappingsLoader.js';
import { getActiveCircle } from '../../../basis/src/v2/activeCircle.js';
// Shared contact/bot exposed-skill registry (feedback-extension) — web≡mobile core.
import { createContactSkillRegistry } from '../../../basis/src/v2/contactSkillsLive.js';
import { createContactThreadChannel } from '../../../basis/src/v2/contactThreadChannel.js';
// Calendar cross-peer fan-out — wrap the bundle callSkill so a successful calendar
// op fans its invite/RSVP envelopes out over the peer transport (web parity).
import { withCalendarOutbound } from '../../../basis/src/core/handlers/calendarOutbound.js';
// OBJ-2 membership — shared joiner-side peer-redeem sender (correlated by the bundle's pending-map).
import { makeSendGroupRedeemRequest } from '../../../basis/src/core/handlers/groupRedeem.js';
// personas#2 — post-join "share to this circle" sender (member → admin roster-property push).
import { makeSendPersonaPropsUpdate, createDisclosureShareMemo } from '../../../basis/src/core/handlers/personaPropsUpdate.js';
import { sendA2ATask } from '@onderling/core';
// The Nearby SURFACE — one control over every discovering transport, and one merged peer list. App code
// must go through these rather than reaching into `bundle.mdns` (`CLAUDE.md`): reaching for a transport is
// the signal the surface is missing an affordance, and the Nearby screen doing exactly that is why it was
// mDNS-only and blind to BLE.
import { createMeshSurface } from '@onderling/core';
import { createNearbyRoomBinding } from '../../../basis/src/v2/nearbyRoomBinding.js';
import { SHARE_NKN_ADDRESS_PARAM_KEY } from '../../../basis/src/v2/addressSharing.js';
import { readNearbyFace, readNearbyRadio } from './nearbyAllowsStore.js';
import { PeerGraph } from '@onderling/core';
import { AsyncStorageAdapter } from '@onderling/react-native/storage/AsyncStorageAdapter';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveRelayUrl, asyncStorageRelayIo } from '../../../basis/src/v2/relayPref.js';
import { registerCircleAddresses } from '../../../basis/src/v2/circleAddressRegistration.js';
import { makeCircleReachable } from '../../../basis/src/v2/householdRosterPairing.js';
import { createConnectionPoints, bootRelayUrl, asyncStorageConnectionPointsIo } from '../../../basis/src/v2/connectionPoints.js';
// SILENT out-of-circle delivery — the per-user "shared with me" store (TIERED: AsyncStorage canonical + pod
// mirror) and THIS device's network-derived sealing OPENER. Both are shared-src logic (web≡mobile): the store
// factory mirrors web's tiered wiring in circleApp.js; the opener bridge injects the pod-client sealing adapter
// into the ENCAPSULATED identity secret (only the closure escapes).
import { makeSharedWithMeStoreRN } from './circleStoresRN.js';
import { openerForIdentity } from '../../../basis/src/v2/sharedCopyOpener.js';
import { primeCircleSecurity, announceCircleAddresses } from '../../../basis/src/v2/circleSecurityPriming.js';

// The relay URL to connect with: the in-app setting (Settings → Mij) wins over the build-time env var,
// so the no-server cross-device relay is configurable without a rebuild. Async (AsyncStorage) — boot +
// the /peer-connect reconnect both read it fresh. Empty setting ⇒ env fallback. web≡mobile (relayPref.js).
export async function resolveMobileRelayUrl() {
  try { return resolveRelayUrl(await asyncStorageRelayIo(AsyncStorage).load(), process.env.EXPO_PUBLIC_CIRCLE_RELAY_URL); }
  catch { return process.env.EXPO_PUBLIC_CIRCLE_RELAY_URL || null; }
}

/**
 * The relay to connect with at BOOT — the setting if there is one, else a connection point we already
 * hold (2026-07-30).
 *
 * Without this a device was only on a circle's relay *while joining it*: the join dials the endpoint the
 * invite names and does not persist it, so after a restart the device was on no relay, registered its
 * per-circle addresses nowhere, and could not be reached in that circle at all. The point was recorded the
 * whole time; nothing reconnected to it. `bootRelayUrl` holds the ordering (an explicit choice always
 * wins) — see its header for why a suggested point and a pod are both excluded.
 */
export async function resolveBootRelayUrl() {
  const stored = await resolveMobileRelayUrl();
  try {
    const io = asyncStorageConnectionPointsIo(AsyncStorage);
    const points = createConnectionPoints({ initial: await io.load(), save: () => {} });
    return bootRelayUrl({ stored, list: points.list() });
  } catch {
    return stored;      // no points store ⇒ exactly the previous behaviour
  }
}
import { discoverA2A } from '@onderling/core';

// `createRealHouseholdAgent` is loaded LAZILY (dynamic import below)
// so importing agentBundle.js doesn't transitively pull in
// `@onderling/oidc-session` and the rest of the realAgent chain.  This
// lets vitest exercise the stub-mode test seam (opts.skillStub) plus
// composeManifests / buildNavModels even when the real-boot chain
// isn't installed (e.g. basis-mobile's `npm install` doesn't
// declare @onderling/oidc-session yet, but the symlinked-vitest mode
// would).  Metro on Android still eagerly resolves the chain because
// Hermes loads the module top-to-bottom.
//
// VaultAsyncStorage from @onderling/react-native is pure JS, accepts an
// injected asyncStorage instance so vitest works without an RN runtime.
import { VaultAsyncStorage } from '@onderling/react-native/identity/VaultAsyncStorage';
import { RootKeyStoreVault } from '@onderling/vault';
import { makeSecureStoreRootKeyStore } from './secureStoreRootKeyStore.js';

async function loadCreateRealHouseholdAgent() {
  const mod = await import('../../../basis/src/core/agent/realAgent.js');
  return mod.createRealHouseholdAgent;
}

// MdnsTransport is dynamic-imported so vitest's node env (which can't
// resolve `react-native`) doesn't need a top-level mock.  On Hermes the
// native module guard inside MdnsTransport.isAvailable() short-circuits
// to false when MdnsModule isn't compiled in (e.g. iOS, Expo Go) — so
// failure is silent and the "Nearby" UI row simply doesn't render.
import { DISCOVERABILITY } from '@onderling/core';

async function loadMdnsTransport() {   // (batch 7) unused — kept one release for the stoop-mobile mirror; builder owns construction now
  try {
    const mod = await import('../../../../packages/react-native/src/transport/MdnsTransport.js');
    return mod.MdnsTransport;
  } catch {
    return null;
  }
}

/**
 * Boot the agent bundle.  See module-doc for the three boot modes.
 *
 * @param {object}  [opts]
 * @param {object}  [opts.householdManifest]   merge an extra manifest into the catalogue
 * @param {object}  [opts.chatVault]           secure-agent chat-side vault (e.g. VaultMemory in tests, VaultAsyncStorage on RN)
 * @param {object}  [opts.hostVault]           host-side vault (defaults inside factory to makeBrowserVault)
 * @param {object}  [opts.asyncStorage]        when provided AND chatVault/hostVault are NOT, synthesises two VaultAsyncStorage instances (cc-chat-id: + cc-host-id: prefixes). RN runtime path; vitest can pass a mock AsyncStorage to exercise it.
 * @param {function}[opts.provisionSettingsMedium] `(strategy) => medium|null` — the pod-backed self-sealed settings inner realAgent attaches to the parameter register on sign-in (RN parity with web circleApp)
 * @param {function}[opts.provisionHistoryMirror] `(strategy) => source|null` — the history mirror's sealed pod backend (realAgent gates on the history.mirror switch; RN parity with web circleApp)
 * @param {object}  [opts.secureAgentOpts]     forwarded to createRealHouseholdAgent → createSecureAgent
 * @param {function}[opts.publishEvent]        forwarded; defaults to no-op
 * @param {object}  [opts.nknLib]              optional runtime nkn-sdk module; if present, connectPeerTransport is wired
 * @param {function}[opts.onPeerMessage]       NKN inbound callback (only meaningful when nknLib provided)
 * @param {function}[opts.requestCatchUp] Bundle H: fired 1.5s after NKN connect; mirrors web's requestCatchUpFromKnownPeers
 * @param {function}[opts.buildPeerWiring] Bundle H: factory `({agent, callSkill}) => {onPeerMessage, requestCatchUp}`. Called after agent is created but before connect. Lets the caller build router/trigger that depend on the live agent without a chicken-and-egg with the returned bundle. Takes precedence over the explicit `opts.onPeerMessage` + `opts.requestCatchUp` when present.
 * @param {function}[opts.skillStub]           test-only — bypass the real factory entirely
 *
 * @returns {Promise<{
 *   catalogue: object,
 *   callSkill: (appOrigin: string, opId: string, args?: object) => Promise<object>,
 *   agent: object | null,
 *   transport: { kind: 'none' | 'nkn' | 'stub', connected?: boolean } ,
 *   attachPeerWiring: (wiring: { onPeerMessage?: function, requestCatchUp?: function }) => void,
 *   dispose: () => Promise<void>,
 * }>}
 */
export async function bootAgentBundle(opts = {}) {
  let catalogue             = composeManifests({ householdManifest: opts.householdManifest });
  // Extension mappings (feedback-extension mobile parity) — OPT-IN via opts.mappingsStore so node-vitest
  // boots (no store passed) skip the AsyncStorage path. Best-effort: verify each against the base catalogue
  // (sandbox-by-construction; unknown-op mappings refused), then re-merge the accepted ones. Never blocks boot.
  if (opts.mappingsStore) {
    try {
      const { sources } = await loadVerifyMappings({
        store: opts.mappingsStore, deviceId: opts.mappingsDeviceId || 'mobile', catalogue,
      });
      if (sources.length) {
        catalogue = composeManifests({ householdManifest: opts.householdManifest, extraSources: sources });
      }
    } catch { /* extensions never block boot */ }
  }
  // Same source-of-truth as the catalogue — used by renderReply opts so
  // list bubbles get per-row inline-keyboard buttons (see
  // docs/manifest-pipeline.md + test/chatRender.test.js).
  const manifestsByOrigin = buildManifestsByOrigin({ householdManifest: opts.householdManifest });

  // Mode 1 — test stub.  No real factory boot; callSkill delegates
  // to the injected stub.  Used by vitest tests that don't want to
  // pay the createRealHouseholdAgent cost (which provisions a vault,
  // signs WebID claims, etc.).
  if (typeof opts.skillStub === 'function') {
    const callSkill = async (appOrigin, opId, args) =>
      opts.skillStub(opId, args ?? {}, { appOrigin });
    return {
      catalogue,
      manifestsByOrigin,
      callSkill,
      agent:     null,
      transport: { kind: 'stub' },
      attachPeerWiring: () => {},   // no transport in stub mode
      dispose:   async () => {},
    };
  }

  // Mode 2 + 3 — real boot.  Factory throws on Hermes if no chatVault
  // is provided (it tries makeBrowserVault → localStorage).  Surface
  // the error in a useful shape rather than letting it crash the bundle.
  //
  // if the caller passed `opts.asyncStorage` but no explicit
  // vaults, synthesise VaultAsyncStorage instances under the same
  // prefix convention the web factory uses ('cc-chat-id:' /
  // 'cc-host-id:').  This is the canonical RN-runtime path; vitest
  // tests use it with a mock AsyncStorage.
  const chatVault = opts.chatVault
    ?? (opts.asyncStorage
      ? new VaultAsyncStorage({ prefix: 'cc-chat-id:', asyncStorage: opts.asyncStorage })
      : undefined);
  const hostVault = opts.hostVault
    ?? (opts.asyncStorage
      ? new VaultAsyncStorage({ prefix: 'cc-host-id:', asyncStorage: opts.asyncStorage })
      : undefined);
  // The OWNER ROOT — and it was missing (2026-07-30). Two vaults were synthesised here and this third one
  // was not, so `realAgent` fell back to its `makeBrowserVault('cc-owner-root:')`, which on React Native
  // finds no `localStorage` and quietly returns a **VaultMemory**. A new owner root was therefore minted on
  // every launch, and two things followed:
  //
  //   • every per-circle address is derived from that root, so they ALL changed on every app start. A
  //     member's address on the roster stopped matching the address their device registers, and nobody
  //     could reach them in a circle after a restart. Found running the first message round-trip on
  //     hardware — the peer sent to the recorded address and it answered from nowhere.
  //   • the 24-word recovery phrase shown during onboarding derives from the same root, so it was
  //     regenerated each launch. The screen says "without these words you can't get back to your things";
  //     they would not have got anyone back to anything.
  const ownerRootVault = opts.ownerRootVault
    ?? (opts.asyncStorage
      ? new VaultAsyncStorage({ prefix: 'cc-owner-root:', asyncStorage: opts.asyncStorage })
      : undefined);

  // Custody cutover: the root SEED lives behind the device keystore (expo-secure-store, passed in
  // from App bootstrap like asyncStorage is). The AsyncStorage vault above survives as the LEGACY
  // migration source (pre-cutover installs stored the cleartext phrase there) and as the fallback
  // door when no keystore module is provided (tests, Expo Go without the native module).
  const rootKeyStore = opts.rootKeyStore
    ?? (opts.secureStore ? makeSecureStoreRootKeyStore(opts.secureStore)
      : ownerRootVault ? new RootKeyStoreVault({ vault: ownerRootVault })
        : undefined);

  // when asyncStorage is provided, also seed the stoop
  // per-agent cache adapter so stoop's web-style boot survives app
  // reloads on Hermes.  createRealHouseholdAgent threads `opts.
  // stoopPersistDb` into createBrowserStoopAgent (which delegates
  // to apps/stoop/src/lib/persistPicker.js → AsyncStoragePersist).
  const stoopPersistDb = opts.stoopPersistDb
    ?? (opts.asyncStorage
      ? { dbName: 'cc-stoop-cache', asyncStorage: opts.asyncStorage }
      : undefined);

  // Parallel synthesis for tasks-v0 — without this, the tasks
  // CachingDataSource is in-memory only and every cold boot loses any
  // user-added tasks + re-runs the 4-seed dance (the data-loss bug
  // behind the `cc.firstBootSeeded.v1` flag in App.js).
  // createRealHouseholdAgent threads `opts.tasksPersistDb` into
  // createBrowserMultiCircleTasksAgent → buildBundle → tasks-v0's own
  // persistPicker (mirrors stoop's three-adapter shape).
  const tasksPersistDb = opts.tasksPersistDb
    ?? (opts.asyncStorage
      ? { dbName: 'cc-tasks-cache', asyncStorage: opts.asyncStorage }
      : undefined);

  // OBJ-2 S1e (mobile) — persist the household store across reloads, same shape
  // as tasks/stoop. createRealHouseholdAgent threads `householdPersistDb` into
  // new HouseholdStore({ dataSource }) → buildHouseholdDataSource → AsyncStoragePersist.
  const householdPersistDb = opts.householdPersistDb
    ?? (opts.asyncStorage
      ? { dbName: 'cc-household-cache', asyncStorage: opts.asyncStorage }
      : undefined);
  // #36 — persist the parameter register's settings (retention etc.) across app opens (AsyncStorage), parity
  // with web circleApp's `settingsPersistDb`.
  const settingsPersistDb = opts.settingsPersistDb
    ?? (opts.asyncStorage ? { dbName: 'cc-settings-cache', asyncStorage: opts.asyncStorage } : undefined);

  let agent;
  try {
    const createRealHouseholdAgent = await loadCreateRealHouseholdAgent();
    agent = await createRealHouseholdAgent({
      chatVault,
      hostVault,
      ownerRootVault,
      rootKeyStore,
      stoopPersistDb,
      tasksPersistDb,
      householdPersistDb,
      settingsPersistDb,
      // Held messages + the dead-address verdict survive a launch (AsyncStorage, like the settings cache).
      outboxPersistDb: opts.asyncStorage ? { dbName: 'cc-outbox-cache', asyncStorage: opts.asyncStorage } : undefined,
      stoopControlAgent: opts.stoopControlAgent,   // S4 — multi-member sealing router (redeem/leave)
      // Connectivity Phase 3 — LIVE shared-pod key-custody seams (member-side, keyed by circleId), RN
      // parity with web circleApp. A shared/hybrid circle WITH a pod + group key seals→writes the pod +
      // fans a ref (pod-signal), and catch-up range-queries→opens it; a no-pod circle keeps fan-out-full /
      // local-mirror reads. App.js passes circlePods' lazy wrappers; absent → the pre-Phase-3 behaviour.
      stoopCircleDataMove: opts.stoopCircleDataMove,
      stoopPodWrite:       opts.stoopPodWrite,
      // Cache-mode mirroring (RN parity with web circleApp): provision a pod-backed circle's store MEDIUM
      // (a cache-mode PseudoPod sealing→write-throughing to the pod). App.js passes circlePods'
      // `provisionCircleMedium`; absent → no cache media → shared local backing, unchanged.
      provisionCircleMedium: opts.provisionCircleMedium,
      // Settings pod-sync inner (RN parity): realAgent attaches this self-sealed pod medium to the parameter
      // register's settings store on sign-in. App.js passes circlePods' fetch/root; absent → local-only.
      provisionSettingsMedium: opts.provisionSettingsMedium,
      // The personal history mirror's pod backend (RN parity): realAgent gates on the history.mirror
      // switch (off by default) and seals with the same seal-to-self strategy. Absent → no mirror.
      provisionHistoryMirror: opts.provisionHistoryMirror,
      // #44 — the restore choices (web parity): the coarse mismatch dialog + the per-param
      // merge list ride the same two realAgent seams; the App shell paints them with Alerts.
      onSettingsKeyMismatch: opts.onSettingsKeyMismatch,
      onSettingsConflicts: opts.onSettingsConflicts,
      // The membership rider: the device log (the shells' EventLog) — membership statements ride its lane.
      deviceLog: opts.deviceLog,
      // The A2A surface (web parity): these manifests' ops become kernel skills a granted agent can
      // invoke, each gated by a CapabilityToken naming exactly that op. The list is the SHARED one the
      // connection menu paints from, so what this shell offers is what it exposes — and matches web.
      a2aManifests: connectionManifests({ householdManifest: opts.householdManifest }),
      secureAgentOpts:  opts.secureAgentOpts,
      // The per-user address-fallback setting, read LIVE (batch 4) — forwarded as-is (function or
      // bool); realAgent threads it into both halves of the choice (the fan's address pick and
      // reliableSend's `requireAliasCapable`). Absent → the pre-existing default (on), unchanged.
      allowAddressFallback: opts.allowAddressFallback,
      publishEvent:     opts.publishEvent,
      // recovery — resolve a circle's pod version store for the
      // listDataVersions/restoreDataVersion skills (RN twin of web's
      // circleVersioning; see src/core/circleVersioning.js).
      versionStoreFor:  getCircleVersionStore,
      // Perf — skip the demo seed on warm boot.  Without persistence
      // on the tasks-v0 itemStore, realAgent's listOpen probe always
      // returns empty and re-runs 4 addTask + setMyHandle +
      // setMyDisplayName round-trips (~2.5s of the cold-boot wall
      // clock).  Forward seedTasks / seedStoopProfile / seedStoopPosts
      // from the host so it can flip them based on its own first-boot
      // flag.  Default left undefined (truthy) so the first boot still
      // seeds.
      // Opt-in demo scaffolding (seeded demo members/tasks/posts). OFF by
      // default so a real circle shows only real members; forwarded here so
      // the demo deploy + fixtures can enable it via the bundle.
      seedDemoData:     opts.seedDemoData,
      seedTasks:        opts.seedTasks,
      seedStoopProfile: opts.seedStoopProfile,
      seedStoopPosts:   opts.seedStoopPosts,
      getActiveCircleId: getActiveCircle,   // per-circle store scoping — the active circle scopes chat ops
      // L3 — household routes through the uniform wired path (dissolved cores over the per-circle
      // CircleItemStore) by default; the legacy registry is retired. No flag: it's unconditional now.
    });
  } catch (err) {
    // Wrap with a localised-error-friendly shape so the RN UI can
    // surface it via `t('boot.boot_failed', { message: err.message })`.
    throw Object.assign(new Error(`agent-wiring-failed: ${err.message}`), {
      cause: err,
      code:  'AGENT_WIRING_FAILED',
    });
  }

  // SILENT out-of-circle delivery — the per-user "shared with me" inbox (received sealed copies).
  //   • STORE (TIERED): AsyncStorage-canonical + pod-mirror (`makeSharedWithMeStoreRN`, the SAME tiered
  //     wiring web uses in circleApp.js). The receive handler (ChatScreen buildPeerWiring, subtype
  //     `shared-copy`) persists inbound copies here; the launcher's SharedWithMeScreen lists + opens them.
  //     `opts.getSharedWithMePodWriter` is the writer thunk (App.js's `getCirclePodWriter`): null while
  //     unsigned → local-only; a live writer once the Solid session restores → copies SYNC across devices.
  //   • OPENER: built ONCE from the chat agent's identity (`agent.sa.agent.identity` — the same one the peer
  //     address, hence the recipient network key, derives from) via the shared `openerForIdentity` bridge.
  //     The network secret stays ENCAPSULATED in the identity; only the opener closure escapes. Null when no
  //     identity → the view degrades to a deny-safe no-op on tap.
  const sharedWithMeStore = makeSharedWithMeStoreRN(AsyncStorage, {
    getPodWriter: typeof opts.getSharedWithMePodWriter === 'function' ? opts.getSharedWithMePodWriter : undefined,
  });
  const sharedWithMeOpener = openerForIdentity(agent?.sa?.agent?.identity ?? null);

  // Cross-peer transport. Bundle G2 (2026-05-27): NKN is the
  // primary public layer.  Mobile loads nkn-sdk as a runtime peer-dep
  // (web uses `window.nkn` from CDN); we import it here + pass to
  // realAgent's connectPeerTransport which REQUIRES nknLib explicitly
  // (the substrate NknTransport could dynamic-import on its own, but
  // realAgent's gate throws first if nknLib is undefined).  Fire-and-
  // forget so boot stays fast — nkn-sdk's seed-node handshake can take
  // 5-90s.  Web does the same (main.js:1325 — connectPeerImpl().then).
  //
  // peer-router + catch-up trigger. `buildPeerWiring`
  // is called now (agent ready, callSkill present) so the caller can
  // produce both pieces without waiting for the bundle return.
  // Peer-wiring is held in a MUTABLE slot so the caller can attach it
  // AFTER boot (M1, 2026-05-29).  Lifting the bundle boot to App.js
  // means ChatScreen — which owns the thread state the router closes
  // over — can no longer pass `buildPeerWiring` at boot time; it
  // attaches via `bundle.attachPeerWiring(...)` once it has mounted.
  // The connectPeerTransport handshake takes seconds, so a same-tick
  // mount attach lands well before any inbound message or the 1.5s
  // catch-up fires.  `buildPeerWiring`/`opts.onPeerMessage` are still
  // honoured for the boot-time path (tests, single-screen callers).
  const peerWiringRef = { onPeerMessage: undefined, requestCatchUp: undefined };
  // Captured at connect so `reconnectPeer` (in-app relay setting change) can re-invoke connectPeerTransport
  // with the fresh relay URL + the same nkn/rtc libs — a LIVE reconnect, no app reload. Mirrors web.
  let _connNknLib = null; let _connRtcLib = null;
  // The relay this device is actually on. The connection-points store describes points; this is the
  // socket fact behind `setActive`, and the join path reads it to decide whether an invite's endpoint
  // still needs dialling (J-CP1).
  let _activeRelayUrl = null;
  if (typeof opts.buildPeerWiring === 'function') {
    try {
      const w = opts.buildPeerWiring({ agent, callSkill: agent.callSkill });
      peerWiringRef.onPeerMessage  = w?.onPeerMessage;
      peerWiringRef.requestCatchUp = w?.requestCatchUp;
    } catch (err) {
      console.warn('[cc/boot] buildPeerWiring threw', err?.message ?? err);
    }
  }
  peerWiringRef.onPeerMessage  ??= opts.onPeerMessage;
  peerWiringRef.requestCatchUp ??= opts.requestCatchUp;

  const attachPeerWiring = ({ onPeerMessage, requestCatchUp } = {}) => {
    if (typeof onPeerMessage === 'function')  peerWiringRef.onPeerMessage  = onPeerMessage;
    if (typeof requestCatchUp === 'function') peerWiringRef.requestCatchUp = requestCatchUp;
  };

  // 5.9c — best-effort local mDNS discovery for the "Nearby" row on the
  // circle launcher.  Mirrors stoop-mobile/agentBundle.js's wiring (look
  // for the `MdnsTransport.isAvailable()` block).  Fire-and-forget so
  // boot stays fast; if the native module is missing (vitest, iOS, Expo
  // Go) or the start times out (Wi-Fi off), `bundle.mdns` simply stays
  // unset and the UI row hides itself.
  let mdns = null;

  // The mesh SURFACE — built BEFORE the transport exists, deliberately, so the UI holds one stable object
  // from boot; the builder below fills it in when mDNS lands (or never, on iOS / Expo Go / Wi-Fi off), which
  // settles anything a screen asked meanwhile and seeds the peer list. One surface, the same one the
  // builder returns — not a second pair over a second thunk (that duplicate is how "unavailable" stuck).
  const meshSurface = createMeshSurface({
    onDegraded: (r) => console.warn(
      `[cc/boot] discoverability: asked for '${r.requested}', actually '${r.effective}'`,
    ),
  });
  const { discoverability, nearbyPeers } = meshSurface;
  // The Nearby room's wire binding (nearbyRoomBinding.js): outbound over the agent's peer send to the
  // room's current peers, inbound through the shell's peer router (`...nearbyRoom.handlers`). Lazy on the
  // agent, like everything else here built before the agent lands.
  const nearbyRoom = createNearbyRoomBinding({
    sendPeerMessage: (addr, payload) => agent.sendPeerMessage(addr, payload),
    listPeers: () => nearbyPeers.list(),
    subscribeToPeers: (fn) => nearbyPeers.subscribe(fn),   // a newcomer is told the room as it stands
    myAddress: () => agent?.sa?.agent?.identity?.pubKey ?? null,
    // Rung 4 — what "share how to reach me" shares: the relay this device rides, and the NKN address
    // only if the publication lock allows (the same lock the invite QR honours). All-or-nothing by
    // Frits' call; deciding WHAT "all" is happens here, not in the room code.
    myAddresses: async () => {
      const out = {};
      try { const url = await resolveMobileRelayUrl(); if (url) out.relay = { url }; } catch { /* no relay is honest */ }
      try {
        const allow = agent?.getParamValue?.(SHARE_NKN_ADDRESS_PARAM_KEY);
        const addr = agent?.peer?.address ?? null;
        if (allow === true && typeof addr === 'string' && addr) out.nkn = { address: addr };
      } catch { /* the lock stays closed on a broken read */ }
      return out;
    },
    // The face this device presents in the room: the SAME faces a circle offers — displayName,
    // handle, or nobody — chosen per device in "You here" (nearbyAllowsStore), a label only.
    myFace: async () => {
      try {
        const choice = readNearbyFace();
        if (choice === 'none') return null;
        const r = await agent.callSkill?.('stoop', 'getMyProfile', {});   // → { entry: MemberMap row }
        const e = r?.entry ?? {};
        const label = choice === 'handle' ? (e.handle ?? null) : (e.displayName ?? e.handle ?? null);
        return label ? { label: String(label) } : null;
      } catch { return null; }
    },
    onError: (err, phase) => console.warn(`[nearby] ${phase}:`, err?.message ?? err),
  });

  (async () => {
    try {
      // Batch 7 — the shared BUILDER, mDNS-only, replaces the hand-rolled block that duplicated its
      // hostname derivation, availability guard, 6000 ms time-box and discoverability wiring (the
      // SURFACE rule). Adoptable now that the builder's BleTransport import is lazy (+ the metro
      // bleAbsent shim). `permissions: { ble: false }` — mDNS needs no prompt, and the hand-rolled
      // block never showed one; letting the builder ask for BLE/location here would be a regression.
      // The bundle's own discoverability/nearbyPeers surfaces (built pre-transport, lazy thunks over
      // `mdns` above) stay THE surfaces — they pick this instance up on assignment.
      const { buildMeshTransports } = await import('../../../../packages/react-native/src/buildMeshTransports.js');
      // The full chat AgentIdentity (with pubKey/sign/encrypt) lives
      // inside sa.agent.identity — same one the peer address is derived
      // from, so peers see one consistent identifier.
      const chatIdentity = agent?.sa?.agent?.identity;
      if (!chatIdentity?.pubKey) return;
      const built = await buildMeshTransports({
        identity: chatIdentity,
        enable: { ble: false, relay: false },
        // Rest in BROWSE: see the room, announce nothing. The builder's default is PUBLISH and the native
        // start() announces, so without this the phone advertised `_onderling._tcp` with its pubKey at all
        // times — a presence beacon nobody asked for. Opening the Nearby screen raises to PUBLISH for as
        // long as it is open (nearbyDiscoverability.js); closing it drops back. The persisted radio
        // switch outranks all of it: off means OFF from the first boot moment, nothing browsed either.
        discoverability: readNearbyRadio() === 'off' ? DISCOVERABILITY.OFF : DISCOVERABILITY.BROWSE,
        hostnamePrefix: 'cc',
        permissions: { ble: false },
        surface: meshSurface,
      });
      if (!built?.mdns) return;   // no radio / Wi-Fi off / native module absent — Nearby row hides
      const inst = built.mdns;
      mdns = inst;
      // T5.2d — inject the built mDNS into the unified secure-mesh router so
      // peers found on the local network are actually ROUTABLE (mdns > relay >
      // nkn), not merely listed in the Nearby row. `addSecureTransport`
      // security-wraps it (same SecurityLayer as the chat agent) + registers it
      // on the router; connect:false because we already time-boxed the
      // pre-connect above. Best-effort: a failure leaves the Nearby UI working
      // and the agent routing over nkn/relay.
      try {
        await agent.addSecureTransport?.('mdns', inst, { connect: false });
        console.log('[cc/boot] mDNS injected into router — local-network routing live');
      } catch (err) {
        console.warn('[cc/boot] mDNS router-inject failed (Nearby still works):', err?.message ?? err);
      }
    } catch (err) {
      console.warn('[cc/boot] mDNS init failed (best-effort):', err?.message ?? err);
    }
  })();

  // G13 — register this device's per-circle addresses on the connected relay, SCOPED to the
  // relay-diversity rule (docs/decisions.md): a circle's address goes only to relays that circle rides.
  // Fire-and-forget BY DESIGN (mirrors web's registerCirclePresence): registering is harmless before the
  // `preferCircleAddress` flip, the port replays aliases on reconnect of the same socket, `reconnectPeer`'s
  // NEW socket re-runs this, and the relay holds+drains messages per registration — boot never waits on it.
  // Circle ids come from the launcher after its load (the connect-time call may run before circles are
  // known); idempotent, so calling twice is free. The points store is read here as a read-only view — the
  // owning, saving instance stays in the connection-points screen.
  let _circleIdsForRegistration = [];
  //
  // Called with NO argument, this now asks the substrate which circles this device is in rather than
  // reusing whatever list the launcher screen last pushed in. That default was the bug (2026-07-30): the
  // only caller feeding fresh ids was `CircleLauncherScreen`'s circles-load effect, so a circle joined
  // from anywhere else -- a tapped invite link opens the join wizard over whatever screen you were on --
  // was absent from the cached list, its per-circle address was never registered, and the new member was
  // unreachable until the app was relaunched and the launcher happened to load. Asking the substrate makes
  // a bare `registerCirclePresence()` correct from any caller, which is what the post-join seam needs.
  const liveCircleIds = async () => {
    try {
      const res = await agent.callSkill?.('stoop', 'listMyCircles', {});
      const ids = (Array.isArray(res?.circles) ? res.circles : [])
        .map((b) => (typeof b === 'string' ? b : b?.id))
        .filter(Boolean);
      // Union with the cached list: a circle the substrate has not caught up on yet must not be
      // DE-registered by a refresh, and registration is idempotent.
      return [...new Set([...ids, ..._circleIdsForRegistration])];
    } catch {
      return _circleIdsForRegistration;
    }
  };
  const registerCirclePresence = async (circleIds = null) => {   // primes security, then relay scoping
    const ids = Array.isArray(circleIds) ? circleIds : await liveCircleIds();
    _circleIdsForRegistration = ids;
    // Decisions 4 + 1 — the per-circle SIGNING identity AND the roster snapshot that authorizes senders,
    // for EVERY circle the substrate knows, before (and independently of) the relay scoping below.
    // One shared primer, called identically by web (`circleApp.js`); until 2026-08-02 the roster half was
    // fed only by screens, so a circle you had not OPENED accepted its traffic unchecked.
    try { await primeCircleSecurity({ agent, circleIds: ids }); }
    catch (err) { console.warn('[cc/boot] circle security priming failed:', err?.message ?? err); }
    try {
      // The relay this device is ACTUALLY on, not the one it was configured with (2026-07-30).
      //
      // These disagree in the case that matters most: joining a circle dials the endpoint the invite
      // names WITHOUT persisting it — deliberately, so joining does not silently rewrite a relay someone
      // chose. But registration read the stored preference, so a joiner ended up connected to the
      // circle's relay while registering its per-circle addresses against a different url — or none at
      // all. The relay then knew the device only by its pubKey, and every message addressed to its
      // per-circle address timed out. Found by walking the first message round-trip on hardware.
      const relayUrl = agent?.relay?.url ?? _activeRelayUrl ?? await resolveMobileRelayUrl();
      if (!relayUrl || !agent?.relay?.supportsAliases) return;
      const io = asyncStorageConnectionPointsIo(AsyncStorage);
      const points = createConnectionPoints({ initial: await io.load(), save: () => {} });
      const circlesForPoint = (url) => points.circlesFor(url);
      circlesForPoint.pointsFor = (cid) => points.pointsFor(cid);   // the reverse view the scoper duck-types
      await registerCircleAddresses({
        transport: agent.relay,   // the facade quacks like the port's alias half — never the transport itself
        relayUrl,
        circleIds: ids,
        circleAddressFor: (cid) => agent.circleAddressFor?.(cid) ?? null,
        circleAddressSignerFor: (cid) => agent.circleAddressSignerFor?.(cid) ?? null,
        circlesForPoint,
        // The relay this device connects to IS the deployment default — unmapped circles land here alone.
        defaultRelayUrl: relayUrl,
        onError: (err, cid) => console.warn(`[cc/boot] circle-address register failed (${cid}):`, err?.message ?? err),
      });
      // NOW announce — the aliases are bound, so the announcement is signed per-circle. Sending it any
      // earlier means the canonical key signs it and every recipient refuses it while the fan reports
      // success (measured 2026-08-02, three-party run).
      try { await announceCircleAddresses({ agent, circleIds: ids }); }
      catch (err) { console.warn('[cc/boot] circle-address announce failed:', err?.message ?? err); }
    } catch (err) { console.warn('[cc/boot] circle-address registration failed:', err?.message ?? err); }
  };

  let transport = { kind: 'none' };
  if (typeof agent.connectPeerTransport === 'function') {
    transport = { kind: 'nkn', connecting: true };
    (async () => {
      try {
        // Resolve nkn-sdk: caller-injected (tests) > runtime import.
        let nknLib = opts.nknLib;
        if (!nknLib) {
          // Perf #5 (2026-05-30): nkn-sdk tries to load a WebAssembly
          // module for hash/sig speedups; Hermes (RN's JS engine) has
          // no WebAssembly so nkn falls back to pure JS — works fine
          // but emits two scary-looking warnings on every boot.  Mute
          // just the WASM-prep + Aborted lines during the import +
          // initial connect, then restore the real warn.  Other warns
          // pass through untouched.
          const originalWarn = console.warn;
          const isWasmNoise = (msg) => typeof msg === 'string'
            && (msg.includes('asynchronously prepare wasm')
                || msg.startsWith('Aborted(ReferenceError: Property \'WebAssembly\''));
          console.warn = (...a) => { if (!isWasmNoise(a[0])) originalWarn(...a); };
          try {
            const mod = await import('nkn-sdk');
            nknLib = mod.default ?? mod;
          } catch (err) {
            console.warn = originalWarn;
            originalWarn('[cc/boot] nkn-sdk import failed:', err?.message ?? err);
            return;
          }
          // Restore the real warn after a short window so the connect's
          // own WASM-prep also gets filtered, then anything later (real
          // warnings) surfaces normally.
          setTimeout(() => { console.warn = originalWarn; }, 2000);
        }
        // T5.2d — best-effort WebRTC rendezvous. Needs a dev build with
        // react-native-webrtc; in Expo Go / a plain build the loader returns
        // null and rendezvous stays signalling-only (nkn/relay keep routing).
        // Loaded from the specific module (not the @onderling/react-native barrel)
        // so no unrelated native dep is pulled at boot.
        let rtcLib = null;
        try {
          const rtcMod = await import('../../../../packages/react-native/src/transport/rendezvousRtcLib.js');
          rtcLib = await rtcMod.loadRendezvousRtcLib?.();
        } catch { /* absent — non-fatal, rendezvous just stays off */ }
        // Stable wrapper reads the mutable slot at delivery time, so a
        // router attached after connect still receives messages.
        _connNknLib = nknLib; _connRtcLib = rtcLib;   // capture for reconnectPeer (live relay reconnect)
        _activeRelayUrl = await resolveBootRelayUrl();
        await agent.connectPeerTransport({
          nknLib,
          onPeerMessage: (addr, payload) => peerWiringRef.onPeerMessage?.(addr, payload),
          // T3a — relay alongside NKN (routed); the in-app setting wins over the env (no rebuild). unset → NKN-only.
          relayUrl: _activeRelayUrl,
          // T5.2d — direct WebRTC upgrade over the nkn/relay signalling path.
          rendezvous: true,
          rtcLib,
        });
        console.log('[cc/boot] peer transport connected, address:', agent.peer?.address);
        registerCirclePresence();   // G13 — fire-and-forget; never awaited (self-catching)
        // fire the catch-up trigger
        // 1.5s after connect so HI handshake settles first.  Mirrors
        // web/main.js:1338.  Read the slot at fire time — null/undefined
        // (test-mode / not-yet-attached) skips silently.
        setTimeout(() => {
          const requestCatchUp = peerWiringRef.requestCatchUp;
          if (typeof requestCatchUp !== 'function') return;
          try {
            const r = requestCatchUp();
            if (r && typeof r.catch === 'function') {
              r.catch((err) => console.warn('[cc/boot] catch-up failed', err?.message ?? err));
            }
          } catch (err) {
            console.warn('[cc/boot] catch-up threw', err?.message ?? err);
          }
        }, 1500);
      } catch (err) {
        // Connect failures are non-fatal — local-only flows stay live.
        // Log so /me can be debugged when it shows "not connected".
        console.warn('[cc/boot] NKN connect failed:', err?.message ?? err);
      }
    })();
  }

  // (feedback-extension) — contact/bot exposed skills + the DM channel, LIVE
  // (web≡mobile, same shared modules). basis's secure-agent keeps NO core
  // PeerGraph (agent.peers is undefined / agent.sa.agent.peers null), so contacts
  // are APP-OWNED: one PeerGraph the skill registry + the Contacten roster
  // read, populated as bots are discovered/added. The agent stays the transport
  // (sendPeerMessage → core RoutingStrategy: mdns > rendezvous > relay > nkn). The
  // registry synthesises a contact-thread catalogue + a router (sendA2ATask for
  // a2a bots); the channel carries the conversation over sa.peer. Exposed on
  // the bundle for the Contacten screens + Detox.
  // Persist the roster so v2 Contacten survives a reload (AsyncStorage on RN);
  // the AsyncStorageAdapter implements the PeerGraph storageBackend interface
  // (get/set/delete/list). Same pattern as stoop-mobile's agentBundle.
  const peerGraph = new PeerGraph({
    storageBackend: new AsyncStorageAdapter({ prefix: 'cc-peers:' }),
  });
  const sendContactTask = async (peerUrl, skillId, args) => {
    const task = sendA2ATask(agent, peerUrl, skillId, args);
    const { parts } = await task.done();
    return { parts };
  };
  const contactSkills = createContactSkillRegistry({ peerGraph, sendTask: sendContactTask });
  contactSkills.start().catch(() => { /* discovery is best-effort — never blocks boot */ });
  const contactChannel = createContactThreadChannel({
    sendToPeer: (addr, payload) =>
      (typeof agent.sendPeerMessage === 'function'
        ? agent.sendPeerMessage(addr, payload)
        : Promise.reject(new Error('agent.sendPeerMessage unavailable'))),
  });
  const coreAgent = agent.sa?.agent ?? null;   // discoverA2A's hello/native-upgrade target

  // Offline delivery M1 — the device's wake-nudge switch (OFF by default; a token reaches the
  // relay only after the person enables it in Settings). Built lazily so a boot without
  // AsyncStorage (tests) or without the relay facade simply has no switch. `restore()` is
  // fire-and-forget: a relay restart forgets sleeping devices, so a switched-on device
  // re-registers its token on every boot; registerPushToken itself awaits the relay connection.
  let wakeNudges = null;
  if (opts.asyncStorage && agent.relay) {
    try {
      const { createWakeNudges } = await import('@onderling/react-native/push');
      // The switch's persistence is the parameter register (device scope) since the params
      // consolidation — the orchestrator keeps its injected storage seam (a package cannot import
      // app composition), so the app injects a register-backed adapter: reads mirror the live
      // register value, writes go through the ONE kind-gated set-param.
      const registerStore = {
        getItem: async () => (agent.getParamValue?.('wake.nudges') === true ? 'on' : 'off'),
        setItem: async (_k, v) => { await agent.callSkill('params', 'set-param', { key: 'wake.nudges', value: v === 'on' }); },
      };
      wakeNudges = createWakeNudges({
        agent: coreAgent ?? agent,
        relay: agent.relay,
        asyncStorage: registerStore,
        projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
      });
      wakeNudges.restore()
        .then((r) => { if (r.restored) console.log('[cc/boot] wake-nudges: token re-registered on the relay'); })
        .catch(() => { /* fire-and-forget — the Settings row shows the live truth */ });
    } catch (err) {
      console.warn('[cc/boot] wake-nudges unavailable:', err?.message ?? err);
    }
  }

  // Calendar cross-peer fan-out (web parity) — a successful calendar dispatch
  // fans its invite/RSVP envelopes out over the peer transport. Gated on the
  // transport being connected; a no-op otherwise. The hook's snapshot lookups
  // use the raw agent.callSkill (no re-entrancy).
  const callSkill = withCalendarOutbound(agent.callSkill, {
    sendPeer: (addr, payload) =>
      (typeof agent.sendPeerMessage === 'function'
        ? agent.sendPeerMessage(addr, payload)
        : Promise.reject(new Error('agent.sendPeerMessage unavailable'))),
    // transport-NEUTRAL reachability (NKN OR relay) — not peer.status alone.
    isPeerConnected: () => agent.isPeerReachable?.() ?? (agent.peer?.status === 'connected'),
    publishEvent: opts.publishEvent,
  });

  // G11 — wire the no-pod key-event fan's transport (circlePods' sink reads these lazily; the sink only
  // fires on a membership change, e.g. a REMOVE → rotation, so wiring here at boot is always in time).
  // Injected as an opts hook so this module keeps zero RN/screen imports; App.js passes circlePods'
  // setCircleKeyEventWiring. Absent (tests / stub boots) ⇒ single-device behaviour, unchanged.
  opts.setKeyEventWiring?.({
    sendPeer: (addr, payload, sendOpts) => (typeof agent.sendPeerMessage === 'function'
      ? agent.sendPeerMessage(addr, payload, sendOpts)
      : Promise.resolve()),
    callSkill,
    // The KEY LANE's emit (web parity): the sink hands each key-event here to be signed, chained
    // and appended to the device log; the returned statement is what fans.
    keyEmit: (gid, event) => agent.keyEmit?.(gid, event) ?? null,
  });

  // OBJ-2 membership — ONE shared peer-redeem pending-map + sender. ChatScreen wires the response
  // handler against this map (and uses this sender for the classic join wizard); the v2 launcher uses
  // the same sender, so a v2 join correlates with the already-wired response handler. No double-wiring.
  const pendingPeerRedeems = new Map();
  const sendPeerRedeem = makeSendGroupRedeemRequest({
    sendPeer:        (addr, payload, opts) => agent.sendPeerMessage(addr, payload, opts),
    isPeerConnected: () => agent.isPeerReachable?.() ?? (agent.peer?.status === 'connected'),
    pendingMap:      pendingPeerRedeems,
    // Identity 5B/C — present this device's per-circle address on the peer redeem path (parity with web).
    circleAddressFor: (gid) => agent.circleAddressFor?.(gid) ?? null,
    // …and PROVE it: a fresh per-circle address is signed with its own key (source circle == the
    // circle being joined), so the admin records it instead of dropping it as unproven.
    signCircleAddress: (gid, addr) => agent.signCircleLink?.(gid, gid, addr) ?? null,
  });

  // personas#2 — post-join persona-property push: ONE shared pending-map + sender (parity with the
  // redeem pair). ChatScreen wires the update+ack handlers against this map; the About-me screen uses
  // this sender via shareDisclosureToCircle.
  const pendingPersonaProps = new Map();
  const sendPersonaUpdate = makeSendPersonaPropsUpdate({
    sendPeer:        (addr, payload, opts) => agent.sendPeerMessage(addr, payload, opts),
    isPeerConnected: () => agent.isPeerReachable?.() ?? (agent.peer?.status === 'connected'),
    pendingMap:      pendingPersonaProps,
    circleAddressFor: (gid) => agent.circleAddressFor?.(gid) ?? null,
  });
  // Diff-gate memo (profile-update propagation): what this device last shared with each
  // (persona, circle). In-memory for the session (parity with web's localStorage-backed memo);
  // the share screens pass it so an open-and-save-unchanged is a true no-op.
  const disclosureShareMemo = createDisclosureShareMemo();

  // In-app relay setting live-reconnect: re-invoke connectPeerTransport with the FRESH relay URL + the
  // params captured at boot. Returns { ok, effective } — the URL now in use. Mirrors web's applyRelayUrl.
  /**
   * Live relay reconnect. With no argument it re-reads the in-app setting (the "I changed my relay"
   * case). With an explicit `relayUrl` it dials THAT endpoint — which is how a join reaches a circle
   * whose admin lives on a relay this device is not on yet (J-CP1). One reconnect path either way:
   * a second way to open a socket is a second way to get the alias replay wrong.
   */
  const reconnectPeer = async ({ relayUrl: override = null } = {}) => {
    if (typeof agent?.connectPeerTransport !== 'function') return { ok: false, error: 'no transport' };
    const relayUrl = (typeof override === 'string' && override) ? override : await resolveMobileRelayUrl();
    try {
      await agent.connectPeerTransport({
        nknLib: _connNknLib ?? undefined,
        onPeerMessage: (addr, payload) => peerWiringRef.onPeerMessage?.(addr, payload),
        relayUrl,
        // An explicit URL means a caller is about to send over it (the join dial). Wait for the socket:
        // routing consults the real `canReach`, so a send issued before it opens quietly picks another
        // transport and waits out its timeout instead.
        awaitRelayReady: typeof override === 'string' && !!override,
        rendezvous: true,
        rtcLib: _connRtcLib ?? undefined,
      });
      _activeRelayUrl = relayUrl;
      registerCirclePresence();   // G13 — a NEW socket starts with no aliases; re-register (fire-and-forget)
      return { ok: true, effective: relayUrl };
    } catch (err) { return { ok: false, error: err?.message ?? String(err), effective: relayUrl }; }
  };

  // 5.9c — expose `mdns` as a live getter so the launcher reads the
  // current instance (initially null, populated when the async
  // connect() resolves a tick later).  Callers should not cache the
  // returned value across renders.
  return {
    catalogue,
    manifestsByOrigin,
    callSkill,
    agent,
    reconnectPeer,
    /** The relay this device is on right now (null = none). Read live; do not cache across renders. */
    activeRelayUrl: () => _activeRelayUrl,
    registerCirclePresence,   // G13 — callable with no args from anywhere; asks the substrate for the list
    /**
     * Post-join: make a circle reachable (G13). Register this device's per-circle address AND bind the
     * other members' circle addresses to their keys from the roster.
     *
     * Wired into the join wizard's `onJoined` seam. Both halves used to run only from
     * `CircleLauncherScreen`, so joining from anywhere else left the member on the roster at an address
     * their own device had never registered — unreachable until the app was relaunched.
     */
    onCircleJoined: ({ circleId } = {}) => makeCircleReachable({
      agent, circleId, registerCirclePresence,
    }),
    transport,
    pendingPeerRedeems,
    sendPeerRedeem,
    pendingPersonaProps,
    sendPersonaUpdate,
    disclosureShareMemo,
    contactSkills,
    peerGraph,
    contactChannel,
    coreAgent,
    discoverA2A,
    // SILENT out-of-circle delivery — the receive handler (ChatScreen) persists into this store; the launcher
    // lists + opens from it. `sharedWithMeOpener` is this device's network-derived sealing opener (or null).
    sharedWithMeStore,
    sharedWithMeOpener,
    wakeNudges,               // offline delivery M1 — the Settings toggle dispatches through this (null = no switch on this boot)
    get mdns() { return mdns; },
    // The surface. Prefer these over `mdns` in app code — see the import comment above.
    discoverability,
    nearbyPeers,
    nearbyRoom,
    attachPeerWiring,
    dispose: async () => {
      try { contactSkills.dispose(); } catch { /* defensive */ }
      try { await mdns?.disconnect?.(); } catch { /* defensive */ }
      try { await agent?.sa?.shutdown?.(); } catch { /* defensive */ }
    },
  };
}
