/**
 * Mobile host-op bridge for Bundle F.
 *
 * Web routes `appOrigin === 'basis'` ops to the canonical
 * `apps/basis/src/core/localBuiltins.js` (~30 handlers).
 * Mobile shipped with a hard short-circuit that returned
 * "not wired on mobile yet" for ALL such ops — so /me /help
 * /threads /embed-time and friends were dead.
 *
 * This module wires those handlers into mobile by:
 *   1. Wrapping the React `threadState` reducer in a
 *      `threadStore`-shaped adapter (matching the surface that
 *      localBuiltins' /threads + /newthread expect).
 *   2. Constructing dependency-injected `localBuiltins` with the
 *      adapter, the booted agent, the merged catalogue, and `t`.
 *   3. Returning the `{opId: handler}` dispatch table that
 *      ChatScreen consults BEFORE its "not wired" fallback.
 *
 * Handlers needing DOM-only deps (file pickers, side panels,
 * OIDC) gracefully degrade because their `if (!dep) return {
 * ok: false, error: t('xxx.no_*') }` guards fire — that's a
 * real error message instead of a silent dead-end. - plug
 * those gaps with RN-equivalent deps.
 *
 * The threadStore adapter mutates via the React state-setter,
 * but also writes through to `threadStateRef.current` so multiple
 * synchronous handler calls within a single dispatch see the
 * latest state (React's setter is async-scheduled; the ref is
 * the synchronous source of truth between renders).
 */
// Relative path (not the `@onderling-app/basis/core-localBuiltins`
// subpath export) — Metro on RN doesn't honour package.json "exports"
// subpaths the way Node does.  Same pattern agentBundle.js uses for
// realAgent.js.
import { createLocalBuiltins }   from '../../../basis/src/core/localBuiltins.js';
import AsyncStorage              from '@react-native-async-storage/async-storage';
import { resolveRelayUrl, asyncStorageRelayIo } from '../../../basis/src/v2/relayPref.js';

// Media mobile twin (2026-07) — the sealed-media upgrade gate (shared
// handler decides; we only compose) + the RN identity-shaped encoder.
import { hasMediaGateway }       from '../../../basis/src/core/handlers/mediaEmbed.js';
import { encodePickedImage }     from './mediaPicker.js';

import {
  createThread, setActiveThread, updateMessages,
} from './threadState.js';

// Bundle G1 — portable runners web wires from main.js:1390-1394.
// brief.js + find.js are pure logic (catalogue fan-out → callSkill);
// AppRegistry is a class with subscribe + syncWithCatalogue.  All three
// already lift cleanly — same unifier pattern as Bundle F.
import { runBrief, createBriefCache } from '../../../basis/src/brief.js';
import { runFind }                    from '../../../basis/src/find.js';
import { AppRegistry }                from '../../../basis/src/appRegistry.js';

// Bundle G3 — NKN-on-pod wrappers (lookupPeerAddrByWebid +
// publishPeerAddrToPod).  Same shape web wires from main.js:1421-1435
// but consuming the mobile OidcSessionRN's authenticated fetch.
import {
  buildLookupPeerAddrByWebid,
  buildPublishPeerAddrToPod,
}                                     from './podPeerAddr.js';

/**
 * Build the mobile threadStore adapter.  Returns an object exposing
 * the methods localBuiltins calls on `threadStore`:
 *   - listThreads()              → Array<{id, name, filter, ...}>
 *   - createThread({name, ...})  → {id, name, ...}
 *   - getThread(id)              → entry|null
 *   - activeId                   → string getter (NOT a function)
 *
 * Mobile's `threadState` entries lack web's `filter` /
 * `permissions` fields; we surface them as empty objects so the
 * shape-shape stays compatible.
 */
function buildThreadStoreAdapter({ threadStateRef, setThreadState }) {
  return {
    get activeId() { return threadStateRef.current.activeThreadId; },
    listThreads() {
      return [...threadStateRef.current.threads.values()].map((e) => ({
        id:           e.id,
        name:         e.name,
        filter:       {},
        permissions:  { allowCommands: true },
        messages:     e.messages,
      }));
    },
    getThread(id) {
      const e = threadStateRef.current.threads.get(id);
      if (!e) return null;
      return {
        id: e.id, name: e.name, filter: {}, permissions: { allowCommands: true },
        messages: e.messages,
      };
    },
    createThread({ name, filter }) {
      // 2026-05-27 — when localBuiltins.createDmThread asks for a
      // thread with `filter:{actors:[peerId], dm:true}`, translate
      // that to mobile's `peerAddr` field so the free-text-in-DM
      // route + the inbound peer-message router both pick it up.
      const peerAddr = (filter && filter.dm === true && Array.isArray(filter.actors) && filter.actors.length === 1)
        ? filter.actors[0]
        : null;
      const prev   = threadStateRef.current;
      const { state, newId } = createThread(prev, { name, peerAddr });
      threadStateRef.current = state;
      setThreadState(state);
      const e = state.threads.get(newId);
      return {
        id:           e.id,
        name:         e.name,
        filter:       filter ?? {},
        permissions:  { allowCommands: true },
        messages:     e.messages,
        peerAddr:     e.peerAddr,
      };
    },
  };
}

/**
 * Build the mobile host-op dispatch table.
 *
 * @param {object}   args
 * @param {React.MutableRefObject}      args.threadStateRef
 * @param {function}                    args.setThreadState
 * @param {object}                      args.agent       booted agent (from bundle)
 * @param {object}                      args.catalogue     merged catalogue (from bundle)
 * @param {function}                    args.callSkill   bundle.callSkill (for /embed which calls back into substrate skills)
 * @param {function}                    args.t           localiser
 * @param {object} [args.eventLog] EventLog instance
 * @param {function}                    [args.openLogsPanel] () => void — set ChatScreen state to show LogsPanel
 * @returns {Object<string, (args: object) => Promise<*>>}  handler table
 */
export function buildMobileLocalBuiltins({
  threadStateRef, setThreadState,
  agent, catalogue, callSkill, t,
  eventLog, openLogsPanel, openQrScanner,
  openFilePicker,
  // Media mobile twin (2026-07) — the sealed-media seams. All optional:
  // absent gateway ⇒ the shared embed-file builtin keeps its legacy inline
  // file-card path (honest degradation, identical to web — no sealer in
  // reach means NO unsealed upload; sealed-only stands).
  //   mediaGateway        { bucket, sealer, opener?, keyRef? } — blob-gateway's
  //                       injected contracts (tests: memory bucket + real
  //                       sealer pair; LIVE bucket infra is the recorded gap)
  //   openMediaFilePicker the RN image picker (mediaPicker.js — pickAndResize;
  //                       pre-resized + thumbnailed on the picker's side)
  //   encodeImage         override for the identity-shaped default below
  //   storeMediaItem      item-store seam (absent ⇒ item rides on the embed)
  mediaGateway, openMediaFilePicker, encodeImage, storeMediaItem,
  podAuth, onSignOut,
  // Bundle G3 — raw OidcSessionRN ref for podPeerAddr wrappers.
  // podAuth intentionally hides session.fetch (only exposes {webid}),
  // so the NKN-on-pod helpers take the underlying session directly
  // to access getAuthenticatedFetch().
  sessionRef,
}) {
  const threadStore = buildThreadStoreAdapter({ threadStateRef, setThreadState });

  // Bundle G1 — runner + registry singletons scoped to this
  // build of the handler table.  /brief reads the cache across
  // invocations; /apps subscribes the registry to catalogue changes
  // (mobile catalogue is built-once today, so syncWithCatalogue runs
  // immediately + the subscriber is informational).
  const _briefCache = createBriefCache();
  const _appRegistry = new AppRegistry();
  if (catalogue?.appOrigins) _appRegistry.syncWithCatalogue(catalogue.appOrigins);

  // setActive shim for /newthread / /dm.  Mobile's setActiveThread is
  // a pure reducer; we update the ref + schedule a re-render.
  const setActive = (threadId) => {
    const prev = threadStateRef.current;
    const next = setActiveThread(prev, threadId);
    if (next === prev) return;
    threadStateRef.current = next;
    setThreadState(next);
  };

  const localActor = agent?.identity?.host?.webid
    ?? agent?.identity?.chat?.pubKey
    ?? 'mobile-actor';

  const builtinDeps = {
    catalogue,
    t,
    threadStore,
    setActive,
    callSkill,
    localActor,
    agent,
    eventLog,
    openLogsPanel,
    openQrScanner,
    openFilePicker,
    // Media mobile twin (2026-07) — the sealed-media deps ride the same
    // injection route every other seam takes.  encodeImage defaults to the
    // identity-shaped adapter: the RN picker already resized + thumbnailed,
    // so "encoding" is just carrying {mime, dataB64, width, height,
    // thumbnail} through to mediaEmbed unchanged (no canvas on RN).
    mediaGateway,
    encodeImage: encodeImage ?? encodePickedImage,
    storeMediaItem,
    podAuth,
    onSignOut,
    // Bundle G1 — /brief, /find, /apps now wired same as web.
    // briefCache is per-bundle-build so the 60s cache survives across
    // multiple /brief invocations within one session.
    briefRunner: (opts) => runBrief({
      catalogue,
      callSkill,
      cache: _briefCache,
      bypassCache: opts?.bypassCache,
    }),
    findRunner:  (opts) => runFind({ catalogue, callSkill, query: opts?.query }),
    appRegistry: _appRegistry,
    // Bundle G2 — /peer-connect reconnects the NKN transport.
    // realAgent's connectPeerTransport REQUIRES nknLib explicitly
    // (web injects window.nkn; mobile dynamic-imports nkn-sdk).
    connectPeer: async () => {
      if (typeof agent?.connectPeerTransport !== 'function') {
        throw new Error('agent has no connectPeerTransport');
      }
      const mod = await import('nkn-sdk');
      const nknLib = mod.default ?? mod;
      // T5.2d — mirror the boot path: best-effort WebRTC rendezvous so a manual
      // /peer-connect reconnect also restores the direct-route upgrade.
      let rtcLib = null;
      try {
        const rtcMod = await import('../../../../packages/react-native/src/transport/rendezvousRtcLib.js');
        rtcLib = await rtcMod.loadRendezvousRtcLib?.();
      } catch { /* react-native-webrtc absent — non-fatal */ }
      await agent.connectPeerTransport({
        nknLib,
        // T3a — the in-app relay setting (Settings → Mij) wins over the env var (no rebuild); unset → NKN-only.
        relayUrl: resolveRelayUrl(await asyncStorageRelayIo(AsyncStorage).load(), process.env.EXPO_PUBLIC_CIRCLE_RELAY_URL),
        rendezvous: true,                                             // T5.2d
        rtcLib,
      });
      return { address: agent.peer?.address ?? '' };
    },
    // Bundle G3 — /lookup-peer <webid> + /publish-peer. Same
    // helpers web wires via main.js:1421-1435; mobile uses the
    // OidcSessionRN authenticated fetch instead of the @inrupt
    // browser fetch.  When sessionRef isn't supplied (older
    // ChatScreen call-sites), leave the injection undefined so the
    // built-in handlers report t('lookup.unavailable') / t('publishPeerAddrCmd.unavailable').
    ...(sessionRef ? {
      lookupPeerAddrByWebid: buildLookupPeerAddrByWebid({ sessionRef }),
      publishPeerAddrToPod:  buildPublishPeerAddrToPod({ sessionRef, agent }),
    } : {}),
    //   - externalFlow, simPeers                    → not applicable on mobile
  };

  const table = createLocalBuiltins(builtinDeps);

  // Media mobile twin (2026-07) — "pickAndResize as the file input"
  // (plans/NOTE-media-and-streaming.md).  When the composition wires BOTH
  // the sealed-media gateway and the RN image picker, /embed-file's pick
  // becomes the media input: a SECOND instance of the SAME shared handler,
  // differing only in the injected picker — composition routes, the shared
  // code stays the single source of logic.  /send-file (and every other
  // picker consumer, and gateway-less builds) keeps the document picker.
  if (hasMediaGateway(mediaGateway) && typeof openMediaFilePicker === 'function') {
    table['embed-file'] = createLocalBuiltins({
      ...builtinDeps,
      openFilePicker: openMediaFilePicker,
    })['embed-file'];
  }

  return table;
}
