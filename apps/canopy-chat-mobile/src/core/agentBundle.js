/**
 * canopy-chat-mobile — in-process agent bundle.
 *
 * Composition shell: the same `createRealHouseholdAgent` factory
 * that powers web canopy-chat (lifted to portable code in #225.1)
 * gets booted here with RN-friendly opts.  Cross-peer mesh wires
 * the RN NknTransport (#223) when a runtime nkn-sdk module is
 * available.
 *
 * Portable: zero RN, zero DOM at import time.  The actual factory
 * boot may need browser-globals (createRealHouseholdAgent uses
 * `typeof globalThis.localStorage` guards), so on RN the caller
 * passes `opts.chatVault` + `opts.hostVault` to bypass the
 * localStorage default.  See #222.5 (AsyncStorage adapter follow-
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
// Shared extension-mapping loader (feedback-extension P2) — web≡mobile core.
import { loadVerifyMappings } from '../../../canopy-chat/src/v2/mappingsLoader.js';

// `createRealHouseholdAgent` is loaded LAZILY (dynamic import below)
// so importing agentBundle.js doesn't transitively pull in
// `@canopy/oidc-session` and the rest of the realAgent chain.  This
// lets vitest exercise the stub-mode test seam (opts.skillStub) plus
// composeManifests / buildNavModels even when the real-boot chain
// isn't installed (e.g. canopy-chat-mobile's `npm install` doesn't
// declare @canopy/oidc-session yet, but the symlinked-vitest mode
// would).  Metro on Android still eagerly resolves the chain because
// Hermes loads the module top-to-bottom.
//
// VaultAsyncStorage from @canopy/react-native is pure JS, accepts an
// injected asyncStorage instance so vitest works without an RN runtime.
import { VaultAsyncStorage } from '../../../../packages/react-native/src/identity/VaultAsyncStorage.js';

async function loadCreateRealHouseholdAgent() {
  const mod = await import('../../../canopy-chat/src/core/agent/realAgent.js');
  return mod.createRealHouseholdAgent;
}

// MdnsTransport is dynamic-imported so vitest's node env (which can't
// resolve `react-native`) doesn't need a top-level mock.  On Hermes the
// native module guard inside MdnsTransport.isAvailable() short-circuits
// to false when MdnsModule isn't compiled in (e.g. iOS, Expo Go) — so
// failure is silent and the "Nearby" UI row simply doesn't render.
async function loadMdnsTransport() {
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
 * @param {object}  [opts.householdManifest]   merge an extra manifest into the catalog
 * @param {object}  [opts.chatVault]           secure-agent chat-side vault (e.g. VaultMemory in tests, VaultAsyncStorage on RN)
 * @param {object}  [opts.hostVault]           host-side vault (defaults inside factory to makeBrowserVault)
 * @param {object}  [opts.asyncStorage]        when provided AND chatVault/hostVault are NOT, synthesises two VaultAsyncStorage instances (cc-chat-id: + cc-host-id: prefixes). RN runtime path; vitest can pass a mock AsyncStorage to exercise it.
 * @param {object}  [opts.secureAgentOpts]     forwarded to createRealHouseholdAgent → createSecureAgent
 * @param {function}[opts.publishEvent]        forwarded; defaults to no-op
 * @param {object}  [opts.nknLib]              optional runtime nkn-sdk module; if present, connectPeerTransport is wired
 * @param {function}[opts.onPeerMessage]       NKN inbound callback (only meaningful when nknLib provided)
 * @param {function}[opts.requestCatchUp]      Bundle H (#268): fired 1.5s after NKN connect; mirrors web's requestCatchUpFromKnownPeers
 * @param {function}[opts.buildPeerWiring]     Bundle H (#268): factory `({agent, callSkill}) => {onPeerMessage, requestCatchUp}`. Called after agent is created but before connect. Lets the caller build router/trigger that depend on the live agent without a chicken-and-egg with the returned bundle. Takes precedence over the explicit `opts.onPeerMessage` + `opts.requestCatchUp` when present.
 * @param {function}[opts.skillStub]           test-only — bypass the real factory entirely
 *
 * @returns {Promise<{
 *   catalog: object,
 *   callSkill: (appOrigin: string, opId: string, args?: object) => Promise<object>,
 *   agent: object | null,
 *   transport: { kind: 'none' | 'nkn' | 'stub', connected?: boolean } ,
 *   attachPeerWiring: (wiring: { onPeerMessage?: function, requestCatchUp?: function }) => void,
 *   dispose: () => Promise<void>,
 * }>}
 */
export async function bootAgentBundle(opts = {}) {
  let catalog             = composeManifests({ householdManifest: opts.householdManifest });
  // Extension mappings (feedback-extension P2 mobile parity) — OPT-IN via opts.mappingsStore so node-vitest
  // boots (no store passed) skip the AsyncStorage path. Best-effort: verify each against the base catalog
  // (sandbox-by-construction; unknown-op mappings refused), then re-merge the accepted ones. Never blocks boot.
  if (opts.mappingsStore) {
    try {
      const { sources } = await loadVerifyMappings({
        store: opts.mappingsStore, deviceId: opts.mappingsDeviceId || 'mobile', catalog,
      });
      if (sources.length) {
        catalog = composeManifests({ householdManifest: opts.householdManifest, extraSources: sources });
      }
    } catch { /* extensions never block boot */ }
  }
  // Same source-of-truth as the catalog — used by renderReply opts so
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
      catalog,
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
  // #222.5: if the caller passed `opts.asyncStorage` but no explicit
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

  // #222.6: when asyncStorage is provided, also seed the stoop
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
  // createBrowserMultiCrewTasksAgent → buildBundle → tasks-v0's own
  // persistPicker (mirrors stoop's three-adapter shape).
  const tasksPersistDb = opts.tasksPersistDb
    ?? (opts.asyncStorage
      ? { dbName: 'cc-tasks-cache', asyncStorage: opts.asyncStorage }
      : undefined);

  let agent;
  try {
    const createRealHouseholdAgent = await loadCreateRealHouseholdAgent();
    agent = await createRealHouseholdAgent({
      chatVault,
      hostVault,
      stoopPersistDb,
      tasksPersistDb,
      secureAgentOpts:  opts.secureAgentOpts,
      publishEvent:     opts.publishEvent,
      // Perf — skip the demo seed on warm boot.  Without persistence
      // on the tasks-v0 itemStore, realAgent's listOpen probe always
      // returns empty and re-runs 4 addTask + setMyHandle +
      // setMyDisplayName round-trips (~2.5s of the cold-boot wall
      // clock).  Forward seedTasks / seedStoopProfile / seedStoopPosts
      // from the host so it can flip them based on its own first-boot
      // flag.  Default left undefined (truthy) so the first boot still
      // seeds.
      seedTasks:        opts.seedTasks,
      seedStoopProfile: opts.seedStoopProfile,
      seedStoopPosts:   opts.seedStoopPosts,
    });
  } catch (err) {
    // Wrap with a localised-error-friendly shape so the RN UI can
    // surface it via `t('boot.boot_failed', { message: err.message })`.
    throw Object.assign(new Error(`agent-wiring-failed: ${err.message}`), {
      cause: err,
      code:  'AGENT_WIRING_FAILED',
    });
  }

  // Cross-peer transport.  Bundle G2 (#264, 2026-05-27): NKN is the
  // primary public layer.  Mobile loads nkn-sdk as a runtime peer-dep
  // (web uses `window.nkn` from CDN); we import it here + pass to
  // realAgent's connectPeerTransport which REQUIRES nknLib explicitly
  // (the substrate NknTransport could dynamic-import on its own, but
  // realAgent's gate throws first if nknLib is undefined).  Fire-and-
  // forget so boot stays fast — nkn-sdk's seed-node handshake can take
  // 5-90s.  Web does the same (main.js:1325 — connectPeerImpl().then).
  //
  // Bundle H (#268): peer-router + catch-up trigger.  `buildPeerWiring`
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
  (async () => {
    try {
      const MdnsTransport = await loadMdnsTransport();
      if (!MdnsTransport || !MdnsTransport.isAvailable?.()) return;
      // The full chat AgentIdentity (with pubKey/sign/encrypt) lives
      // inside sa.agent.identity — same one the NKN address is derived
      // from, so peers see one consistent identifier.
      const chatIdentity = agent?.sa?.agent?.identity;
      if (!chatIdentity?.pubKey) return;
      const inst = new MdnsTransport({
        identity: chatIdentity,
        hostname: `cc-${chatIdentity.pubKey.slice(0, 8)}`,
      });
      // Time-box the native start (Wi-Fi off otherwise hangs forever).
      await Promise.race([
        inst.connect(),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('mdns pre-connect timeout')),
          6000,
        )),
      ]);
      mdns = inst;
    } catch (err) {
      console.warn('[cc/boot] mDNS init failed (best-effort):', err?.message ?? err);
    }
  })();

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
        // Stable wrapper reads the mutable slot at delivery time, so a
        // router attached after connect still receives messages.
        await agent.connectPeerTransport({
          nknLib,
          onPeerMessage: (addr, payload) => peerWiringRef.onPeerMessage?.(addr, payload),
        });
        console.log('[cc/boot] NKN connected, address:', agent.peer?.address);
        // Bundle H (#268, 2026-05-27) — fire the catch-up trigger
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

  // 5.9c — expose `mdns` as a live getter so the launcher reads the
  // current instance (initially null, populated when the async
  // connect() resolves a tick later).  Callers should not cache the
  // returned value across renders.
  return {
    catalog,
    manifestsByOrigin,
    callSkill: agent.callSkill,
    agent,
    transport,
    get mdns() { return mdns; },
    attachPeerWiring,
    dispose: async () => {
      try { await mdns?.disconnect?.(); } catch { /* defensive */ }
      try { await agent?.sa?.shutdown?.(); } catch { /* defensive */ }
    },
  };
}
