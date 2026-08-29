/**
 * App.js — basis-mobile root.
 *
 * M1 (2026-05-29) — the agent bundle is booted ONCE here and shared
 * with BOTH the chat screen and the circle launcher, so the circle
 * screens can load/create over the same agent (one NKN identity, one
 * stoop cache).  ChatScreen attaches its peer-wiring after mount via
 * `bundle.attachPeerWiring` — the inbound router closes over ChatScreen's
 * thread state, which App can't see, so it can't be passed at boot time.
 *
 * Per the polyfill discipline in index.js, all global setup must happen
 * there — App.js stays safe to import from a test context where
 * polyfills aren't loaded (the portable core in src/core/ has no RN
 * imports).
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, Pressable, Text, StyleSheet, BackHandler } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { asyncStorageMappingsStore, MAPPINGS_DEVICE } from './src/core/mappingsStoreRN.js';
import * as SecureStore from 'expo-secure-store';

import { theme } from './src/screens/v2/theme.js';
import { ThemeProvider } from './src/screens/v2/themeContext.js';

import ChatScreen from './src/screens/ChatScreen.js';
import CircleLauncherScreen from './src/screens/v2/CircleLauncherScreen.js';
import RestoreFlowModal from './src/screens/v2/RestoreFlowModal.js';
// Delivery honesty (2026-07-28) — the ONE per-message delivery map, lifted here so ChatScreen's
// peer-router (inbound receipts) and CircleLauncherScreen's bubbles (rendering) share an instance.
// Two maps would mean receipts advancing a state no bubble reads.
import { createDeliveryStateMap } from '@onderling/kring-host/deliveryState';
import { makeGiveUpConsumers } from '../basis/src/v2/deliveryGiveUp.js';
import {
  makeReceiptSender, asyncStorageDeliveryIo, createDeliverySettingsStore,
  setDeliverySettingsChangedHook,
  createFallbackOffer, setAddressFallbackReportHook,
  // #36 — the retention choice comes from the parameter register, applied to the shared EventLog at boot.
  retentionFromDays,
} from '@onderling-app/basis';
import FirstRunWelcomeScreen from './src/screens/FirstRunWelcomeScreen.js';
import MnemonicEntryScreen from './src/screens/MnemonicEntryScreen.js';
import MnemonicCreateScreen from './src/screens/MnemonicCreateScreen.js';
import { initLocalisation, subscribeLang, t } from './src/core/localisation.js';
import { bootAgentBundle } from './src/core/agentBundle.js';
import { attachSurfacePrefAgent } from './src/core/surfacePrefStore.js';
import { attachThemeAgent } from './src/screens/v2/themeContext.js';
import { asyncStorageRelayIo, resolveRelayUrl } from '../basis/src/v2/relayPref.js';
import {
  shouldShowFirstRunWelcome, markWelcomeDismissed,
} from './src/core/firstRun.js';
import { restoreFromMnemonic } from './src/core/restoreFromMnemonic.js';
// first-run CREATE-side mnemonic display.
import {
  shouldShowCreateMnemonic, markMnemonicAck,
} from './src/core/mnemonicCreate.js';
import { dlog } from './src/core/devLog.js';
import { EventLog } from '../basis/src/eventLog.js';
import { migrateCircleChatHistory, CHAT_MIGRATION_MARKER_KEY } from '../basis/src/v2/circleChatRehydrate.js';
import { createSettingsPodMedium } from '../basis/src/v2/settingsPodMedium.js';
import { createHistoryPodMedium } from '../basis/src/v2/historyMirror.js';
import { wireEventLogPersistence, asyncStorageSnapshotIo } from '../basis/src/v2/eventLogPersistence.js';
import { createChatMessageInbox } from '../basis/src/v2/chatMessageInbox.js';
import { createSelfAuthorCheck } from '../basis/src/v2/chatSelfAuthor.js';
import { OidcSessionRN } from '@onderling/oidc-session-rn';
import { buildCirclePodWriter } from './src/core/circleStoresRN.js';
// γ-next.recipe — per-circle pending-recipe cache (AsyncStorage-backed).
// One store per app; shared between ChatScreen (receiver) and
// CircleLauncherScreen (editor pull + send-side clear).
import { makeCircleRecipePendingStoreRN } from './src/core/circleRecipePendingStorageRN.js';
import { initCirclePods, circleControlAgentRouter, setCirclePodSession, setCircleKeyEventWiring, provisionCircleMedium, circleSendDataMove, circlePodWrite, circleResolveRef, getCirclePodFetch, getActiveRealPodRouting } from './src/core/circlePods.js';
import { discoverPodRoot } from '../basis/src/web/podStorage.js';
// γ-next.rules — per-circle pending-rules cache (AsyncStorage-backed).
// Mirrors the recipe wire: ChatScreen writes via the receiver,
// CircleLauncherScreen reads on rules-screen open + clears after the
// γ.4 resolver applies / discards.
import { makeCircleRulesPendingStoreRN } from './src/core/circleRulesPendingStorageRN.js';
// γ-next.policy — per-circle pending-policy cache (AsyncStorage-backed).
// Mirrors the rules wire: ChatScreen writes via the receiver,
// CircleLauncherScreen's settings editor reads on open + clears after
// the γ.4 resolver applies / discards.
import { makeCirclePolicyPendingStoreRN } from './src/core/circlePolicyPendingStorageRN.js';
import { makeCircleMembraneOpts, makeCircleGroupsIndex } from '../basis/src/v2/circleMembrane.js';
import { makeMemberOverrideStoreRN } from './src/core/circleStoresRN.js';

export default function App() {
  const [localeReady, setLocaleReady] = useState(false);
  const [, setLangVersion] = useState(0);   // bumped on app-language change → re-render the tree with new t()
  useEffect(() => subscribeLang(() => setLangVersion((v) => v + 1)), []);
  // cluster J — podAuth is built in the (hidden) ChatScreen; lift it here so the visible v2 launcher can
  // drive pod sign-in (the launcher had no sign-in entry, stranding the OidcSessionRN flow).
  const [podAuth, setPodAuth] = useState(null);
  // 5.9b — first-run welcome gate.  States:
  //  - 'checking'  — haven't probed AsyncStorage yet (render nothing; boot
  //                  useEffect waits too).
  //  - 'show'      — no identity + no dismissal marker (render welcome).
  //  - 'restore'   — user picked "I have a recovery phrase" (5.9b-followup);
  //                  render MnemonicEntryScreen.  On success we seed the
  //                  chat vault BEFORE flipping to 'dismissed', so the boot
  //                  useEffect finds the seeded keypair instead of generating
  //                  a fresh one.
  //  - 'dismissed' — proceed with the normal boot path.
  const [firstRun, setFirstRun] = useState('checking');
  // Bulletin design (2026-07): system fonts only — the Source Serif
  // useFonts load is gone with the linen theme.
  // there is no separate classic chat shell as a
  // routable screen.  ChatScreen stays mounted invisibly so its peer-
  // wiring keeps routing inbound DMs / mesh events; the launcher is the
  // ONLY visible top-level surface.  Chat now lives inside the circle
  // view as the CONVERSATION tab (will fill the surface; until then
  // there's a hole where chat used to be reachable as a standalone).
  const [bundle, setBundle] = useState(null);
  // The restore-settings flow's pending flag — raised by the boot hooks, consumed by the modal
  // once the bundle is live (React state ordering makes the gate race-free by construction).
  const [restoreFlowPending, setRestoreFlowPending] = useState(false);
  const [bootError, setBootError] = useState(null);
  // CREATE-side mnemonic display. States:
  //  - 'pending'   — not probed yet (or skipped while bundle still booting).
  //  - 'show'      — ack marker missing → render MnemonicCreateScreen with
  //                  the agent's BIP39 phrase.
  //  - 'dismissed' — user acknowledged (or restore-path already ack'd a
  //                  different identity) → normal app render proceeds.
  const [mnemonicState, setMnemonicState] = useState('pending');
  const [mnemonic, setMnemonic] = useState('');

  // Shared EventLog: boot-time agent events + ChatScreen's inbound peer
  // events land in one log so /logs shows everything.
  const eventLogRef = useRef(null);
  if (!eventLogRef.current) {
    eventLogRef.current = new EventLog({ initial: [], muted: [] });
    // #36 — the chat-retention window now lives in the parameter register; it is applied to the eventLog once
    // the agent bundle is ready (see below, at `bundleRef.current = b`), parity with web circleApp.
  }
  // ε.1 — single normalization gate for circle-chat inserts.  The
  // inbox owns msgId dedup + envelope validation + ingest mirror +
  // eventLog append.  Both the boot rehydrator (below) AND
  // ChatScreen's NKN peer-router route through this one instance, so
  // a chat that's already in stoop's itemStore can't double-append
  // mid-boot.  Built once per launch alongside `eventLogRef`.
  //
  // The `ingest` closure reads `bundleRef` lazily so we can construct
  // the inbox before the bundle boots — ChatScreen / launcher both
  // read `inbox` via props from boot, no second pass needed.
  const bundleRef = useRef(null);
  const deliveryStateMapRef = useRef(null);
  // The mute membrane's circle↔person index — one per agent lifetime; the roster feed fills it
  // (householdRosterPairing reads `agent._circleGroupsIndex`), the receive path consumes it.
  const circleGroupsIndexRef = useRef(makeCircleGroupsIndex());
  if (!deliveryStateMapRef.current) deliveryStateMapRef.current = createDeliveryStateMap();
  const deliverySettingsStoreRef = useRef(null);
  // The agent reads `allowFallback` LIVE through this cache (batch 4): a sync read, because the send
  // path cannot await AsyncStorage per message. Primed from the store at mount; kept fresh by the
  // shared change hook — the My-data screen owns its OWN store instance over the same key, so
  // without the hook a flipped toggle would not reach the send path until reboot.
  const deliverySettingsCacheRef = useRef({ sendReceipts: true, allowFallback: false });
  if (!deliverySettingsStoreRef.current) {
    deliverySettingsStoreRef.current = createDeliverySettingsStore(asyncStorageDeliveryIo(AsyncStorage));
    // Whichever door flipped it (the offer's button, the My-data toggle): the cache follows, and a fallback
    // that just came ON re-drives what was held under the old terms (parity with web circleApp).
    setDeliverySettingsChangedHook((s) => {
      const cameOn = s.allowFallback && !deliverySettingsCacheRef.current.allowFallback;
      deliverySettingsCacheRef.current = s;
      if (cameOn) Promise.resolve(bundleRef.current?.agent?.retryHeldUnderCurrentTerms?.()).catch(() => { /* holds stay held */ });
    });
    deliverySettingsStoreRef.current.get()
      .then((s) => { deliverySettingsCacheRef.current = s; })
      .catch(() => { /* keep defaults */ });
  }
  // The fallback OFFER (2026-07-28), mobile half. The offer logic is app-level (its evidence and cooldown
  // must survive circle switches); the MOUTH is whichever circle chat is open, registered below. When the
  // offer fires with no circle open it is BUFFERED, not dropped — the moment a chat mounts, it speaks and
  // arms the cooldown. Same dormancy as web: nothing fires until `preferCircleAddress` is enabled.
  const circleBotSinkRef = useRef(null);
  const pendingFallbackOfferRef = useRef(null);
  const fallbackOfferRef = useRef(null);
  if (!fallbackOfferRef.current) {
    fallbackOfferRef.current = createFallbackOffer({
      onOffer: (payload) => {
        const sink = circleBotSinkRef.current;
        if (sink) { sink(payload); fallbackOfferRef.current.decline(); }
        else pendingFallbackOfferRef.current = payload;
      },
    });
    setAddressFallbackReportHook((info) => fallbackOfferRef.current.report(info));
  }
  // One-tap accept: same store the My-data toggle reads, offer evidence cleared, confirmation spoken
  // through the current mouth. Threaded to CircleDetail's button router (App owns store + offer).
  const acceptFallbackOffer = useCallback(async () => {
    try { await deliverySettingsStoreRef.current.set({ allowFallback: true }); }
    catch { return; }   // confirm only on success
    fallbackOfferRef.current?.accept();
    circleBotSinkRef.current?.({ messageKey: 'circle.nearbyScreen.delivery_fallback_on' });
  }, []);

  // "The circle list is stale" — a counter, owned here because BOTH screens stay mounted.
  //
  // The launcher loads its circles on mount and after its OWN create/join wizards. A join that happens
  // anywhere else — a tapped invite link opens the wizard in the chat shell — never told it, and since App
  // renders both screens simultaneously (one hidden behind a View) switching tabs does not remount it
  // either. So you joined a circle and it was simply not in "Your circles" until the app was relaunched
  // (found 2026-07-30, right after the first message round-trip landed). Bumping this is the notification.
  const [circlesRevision, setCirclesRevision] = useState(0);
  const onCirclesChanged = useCallback(() => setCirclesRevision((n) => n + 1), []);

  const registerCircleBotSink = useCallback((fn) => {
    circleBotSinkRef.current = typeof fn === 'function' ? fn : null;
    // A buffered offer speaks as soon as a mouth exists — and only then arms the cooldown, so an offer
    // that never got shown does not silently burn its one chance.
    if (circleBotSinkRef.current && pendingFallbackOfferRef.current) {
      circleBotSinkRef.current(pendingFallbackOfferRef.current);
      pendingFallbackOfferRef.current = null;
      fallbackOfferRef.current.decline();
    }
  }, []);

  const circleChatInboxRef = useRef(null);
  // Delivery honesty — ONE receipt sender, shared by the legacy-envelope inbox and the signed-statement
  // receive path in ChatScreen (web's `onCircleStored` parity: one set of side effects, not two).
  const chatReceiptSenderRef = useRef(null);
  if (!chatReceiptSenderRef.current) {
    chatReceiptSenderRef.current = makeReceiptSender({
      getSettings: () => deliverySettingsStoreRef.current.get(),
      sendTo: (to, payload) => (typeof bundleRef.current?.sendPeer === 'function'
        ? bundleRef.current.sendPeer(to, payload)
        : Promise.reject(new Error('no peer send yet'))),
    });
  }
  if (!circleChatInboxRef.current) {
    circleChatInboxRef.current = createChatMessageInbox({
      eventLog: eventLogRef.current,
      ingest: async (payload, fromPeerAddr) => {
        const callSkill = bundleRef.current?.callSkill;
        if (typeof callSkill !== 'function') return { ok: false };
        try {
          return await callSkill('stoop', 'ingestCircleMessage', { payload, fromPeerAddr });
        } catch (err) {
          console.warn('[circle-chat] ingestCircleMessage failed:', err?.message ?? err);
          return { error: String(err?.message ?? err) };
        }
      },
      logger: console,
      // Delivery honesty — a LIVE insert answers the sender with a receipt, through the ONE shared
      // sender above (policy entirely inside `makeReceiptSender`: only source 'receiver' · setting read
      // per message · fail-closed on a broken read; reads `bundleRef` lazily — the bundle boots later).
      onStored: (info) => chatReceiptSenderRef.current(info),
      // Connectivity Phase 3 (receiver side) — resolve a pod-signal REF envelope (a pod-row pointer, no
      // body) into the full chat message by reading + unsealing the circle's shared pod. Absent a pod /
      // group key → the inbox skips the ref (deferred), never crashes the receive loop. Web parity
      // (circleApp inbox `resolveRef: circleResolveRef`); the lazy wrapper settles custody at call time.
      resolveRef: circleResolveRef,
      // "Did I write this?" — so a message of mine read back out of storage (the boot rehydrate two
      // blocks down, catch-up, pod replay) comes back as MINE ('me', what the bubbles compare against)
      // instead of as a stranger's. Web parity, same shared check; per-circle by construction, and never
      // consulted on the live receive path (chatSelfAuthor.js). Reads `bundleRef` lazily like `ingest`.
      isSelfAuthored: createSelfAuthorCheck({
        whoAmI: () => (typeof bundleRef.current?.callSkill === 'function'
          ? bundleRef.current.callSkill('stoop', 'whoAmI', {})
          : Promise.resolve(null)),
        circleAddressFor: (cid) => bundleRef.current?.agent?.circleAddressFor?.(cid) ?? null,
      }),
      localActor: 'me',
    });
  }
  // γ-next.recipe — shared circle-recipe-broadcast pending store.
  // ChatScreen's peer-router writes via the receiver handler;
  // CircleLauncherScreen's editor reads on mount + clears after the
  // γ.3 resolver applies/discards.
  const circleRecipePendingStoreRef = useRef(null);
  if (!circleRecipePendingStoreRef.current) {
    circleRecipePendingStoreRef.current = makeCircleRecipePendingStoreRN(AsyncStorage);
  }
  // S4 — wire the durable AsyncStorage vault for per-circle pod producers (sealing
  // identities + group keys); enables content sealing on a p2/p3 circle (web parity).
  initCirclePods(AsyncStorage);
  // γ-next.recipe — shared LRU dedup for the recipe-broadcast handler.
  const circleRecipeDedupRef = useRef(null);
  if (!circleRecipeDedupRef.current) {
    circleRecipeDedupRef.current = new Set();
  }
  // γ-next.rules — shared circle-rules-broadcast pending store.
  // ChatScreen's peer-router writes via the receiver handler;
  // CircleLauncherScreen's rules editor reads on mount + clears after
  // the γ.4 resolver applies/discards.
  const circleRulesPendingStoreRef = useRef(null);
  if (!circleRulesPendingStoreRef.current) {
    circleRulesPendingStoreRef.current = makeCircleRulesPendingStoreRN(AsyncStorage);
  }
  // γ-next.rules — shared LRU dedup for the rules-broadcast handler.
  const circleRulesDedupRef = useRef(null);
  if (!circleRulesDedupRef.current) {
    circleRulesDedupRef.current = new Set();
  }
  // γ-next.policy — shared circle-policy-broadcast pending store.
  // ChatScreen's peer-router writes via the receiver handler;
  // CircleLauncherScreen's settings editor reads on mount + clears after
  // the γ.4 resolver applies/discards.  Completes the γ-next trio
  // (recipe / rules / policy).
  const circlePolicyPendingStoreRef = useRef(null);
  if (!circlePolicyPendingStoreRef.current) {
    circlePolicyPendingStoreRef.current = makeCirclePolicyPendingStoreRN(AsyncStorage);
  }
  // γ-next.policy — shared LRU dedup for the policy-broadcast handler.
  const circlePolicyDedupRef = useRef(null);
  if (!circlePolicyDedupRef.current) {
    circlePolicyDedupRef.current = new Set();
  }

  // 5.4c (2026-05-30) — single OidcSessionRN, lifted from ChatScreen so
  // BOTH the chat shell AND the circle launcher see the same restored
  // session.  ChatScreen still drives sign-in / sign-out through the
  // `useBasisAuth` hook (and now reads this ref via props); the launcher
  // builds its own `getPodWriter` thunk from THIS ref
  // (`sessionToPodWriterRN(sessionRef.current)`), so it is live on every
  // call.  Until a session restores the thunk returns null and circle
  // policy IO stays local-only — see tieredPolicyIo + makeCirclePolicyStoreRN.
  //
  // `getCirclePodWriter` below is a DIFFERENT reader of the same idea
  // (`circlePodWriterRef.current`) and belongs to the bundle
  // (`getSharedWithMePodWriter`). It used to be handed to the launcher too, as
  // a `getPodWriter` prop the launcher never destructured or read — dead, and
  // the comment here claimed otherwise. Removed 2026-07-30, found by the
  // prop-destructuring fitness guard while fixing the `onAcceptFallback`
  // render crash of the same shape.
  const sessionRef = useRef(null);
  if (!sessionRef.current) {
    sessionRef.current = new OidcSessionRN({ store: SecureStore, appId: 'basis' });
  }
  // S4 — share the session with circlePods so a signed-in user's sealed circles route to
  // their REAL pod (via the session's authenticated fetch).
  setCirclePodSession(sessionRef);
  // 5.4c — pod writer slot the launcher's getPodWriter thunk reads on
  // every load/save.  `null` while no session is restored → tieredPolicyIo
  // falls through to the local AsyncStorage side.  Refreshed on mount and
  // every time the SecureStore restore completes.
  const circlePodWriterRef = useRef(null);
  // S4 — when signed in, route stoop's items to the user's REAL pod (web parity with
  // circleApp). Same attachPod seam; the RN authenticated fetch is the OidcSessionRN bearer.
  // Best-effort; fires on session restore + once the bundle is up (whichever lands later).
  const maybeAttachStoopPod = useCallback(async () => {
    const session = sessionRef.current;
    const agent = bundleRef.current?.agent;
    if (!agent?.attachStoopPod || !session?.isAuthenticated?.() || !session.webid) return;
    const sessionShim = { fetch: session.getAuthenticatedFetch(), webid: session.webid };
    const podRoot = await discoverPodRoot(sessionShim).catch(() => null);
    if (podRoot) agent.attachStoopPod({ podRoot, webid: session.webid, fetch: sessionShim.fetch }).catch(() => {});
  }, []);
  const refreshCirclePodWriter = useCallback(async () => {
    const w = await buildCirclePodWriter(sessionRef.current).catch(() => null);
    circlePodWriterRef.current = w;
    if (w) dlog.boot('circle pod writer ready @', w.podRoot);
    maybeAttachStoopPod();   // restore completed → attach stoop's item store too
  }, [maybeAttachStoopPod]);
  const getCirclePodWriter = useCallback(() => circlePodWriterRef.current, []);

  useEffect(() => {
    // Follow the device locale (English default, Dutch when the device is nl) so the app UI matches the
    // feedback bot's language — Hermes has Intl, so no expo-localization dependency.
    let lng = 'en';
    try { if (String(Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase().startsWith('nl')) lng = 'nl'; } catch { /* default en */ }
    initLocalisation({ lng }).then(() => setLocaleReady(true));
  }, []);

  // the chat shell is no longer a separate routable screen, so
  // the App-level back handler has nothing to pop.  The launcher's own
  // back handler (CircleLauncherScreen) handles popping sub-views.

  // 5.9b — first-run probe.  Reads AsyncStorage to decide whether to
  // show the welcome screen before booting the bundle.  Errors fall
  // open as "show welcome" — better to greet an extra time than to
  // silently skip on a real first run.
  useEffect(() => {
    shouldShowFirstRunWelcome(AsyncStorage)
      .then((show) => setFirstRun(show ? 'show' : 'dismissed'))
      .catch(() => setFirstRun('show'));
  }, []);

  const dismissFirstRun = useCallback(() => {
    markWelcomeDismissed(AsyncStorage).catch(() => { /* non-fatal */ });
    setFirstRun('dismissed');
  }, []);

  // 5.9b-followup — user tapped "I have a recovery phrase" on the welcome
  // screen.  Route to MnemonicEntryScreen; boot stays paused until either
  // restore succeeds (→ 'dismissed', seeded vault) or the user cancels
  // back to 'show'.
  const startRestore = useCallback(() => setFirstRun('restore'), []);
  const cancelRestore = useCallback(() => setFirstRun('show'), []);

  // 5.9b-followup — invoked from MnemonicEntryScreen with the raw text.
  // Validate + seed the chat vault, then flip to 'dismissed' so boot
  // proceeds against the existing keypair.  Returns the helper's result
  // so the screen can surface error codes inline.
  const submitMnemonic = useCallback(async (phrase) => {
    const result = await restoreFromMnemonic({
      mnemonic:     phrase,
      asyncStorage: AsyncStorage,
      secureStore:  SecureStore,   // the root seed's key door — must match the boot's
    });
    if (result.ok) {
      // Mark welcome dismissed too — otherwise next launch would re-show
      // it before the new identity is detected (probe order in firstRun.js).
      try { await markWelcomeDismissed(AsyncStorage); } catch { /* non-fatal */ }
      setFirstRun('dismissed');
    }
    return result;
  }, []);

  // 5.4c — fire-and-forget SecureStore restore.  Mirrors web's
  // circleApp.js handleRedirect flow: when the session resolves with a
  // real WebID, build the writer; otherwise stay local-only.  Non-blocking
  // so the launcher renders immediately with local IO; the NEXT save
  // automatically picks up the writer once the ref is populated (no
  // re-render needed — the thunk reads `.current` live).
  useEffect(() => {
    sessionRef.current?.restoreFromVault?.()
      .then(() => refreshCirclePodWriter())
      .catch(() => { /* fresh install — circlePodWriterRef stays null */ });
  }, [refreshCirclePodWriter]);

  useEffect(() => {
    // 5.9b — wait until the user has cleared the welcome (or there's no
    // welcome to clear) before booting.  Boot generates an identity in
    // the vault, which would race a future restore-from-mnemonic path.
    if (firstRun !== 'dismissed') return;
    let cancelled = false;
    (async () => {
      try {
        dlog.boot('booting agent bundle (App)');
        // Perf — first-boot seed flag.  tasks-v0's CachingDataSource
        // is not persistent on mobile, so the listOpen probe inside
        // realAgent always sees an empty circle and re-seeds 4 addTasks
        // (+ setMyHandle + setMyDisplayName for stoop profile).  Cost:
        // ~2.5s of the cold-boot wall clock on every launch.  This
        // flag flips after the first successful boot so subsequent
        // boots skip the seed regardless of circle persistence.  When
        // tasks-v0 gains AsyncStorage persistence the flag becomes
        // redundant (the probe will return non-empty); leaving the
        // flag in place is harmless.
        // THE DEVICE LOG IS DURABLE (the content re-root's first slice): hydrate + wire the debounced
        // save before the bundle boots (whose entries would otherwise race an unhydrated log). Best-effort.
        try {
          const { hydrated } = await wireEventLogPersistence({
            eventLog: eventLogRef.current, io: asyncStorageSnapshotIo(AsyncStorage),
          });
          // `dlog` is a channel object, not a function — calling it here threw, and so did the catch
          // below, which turned one log line into "boot failed (App)" from the first launch that had
          // anything to hydrate. Found on a device 2026-08-29; guarded by
          // test/devLogIsNeverCalledAsAFunction.test.js.
          if (hydrated) dlog.boot(`[device-log] hydrated ${hydrated} persisted entries`);
        } catch (err) { dlog.warn(`[device-log] persistence wiring failed: ${err?.message ?? err}`); }
        const SEED_FLAG = 'cc.firstBootSeeded.v1';
        const alreadySeeded = await AsyncStorage.getItem(SEED_FLAG).catch(() => null) === '1';
        let eventSeq = 0;
        const b = await bootAgentBundle({
          // A message the hold queue GIVES UP ON must stop claiming "maybe received" (review, 2026-07-30).
          // `createSecureAgent` reports every drop; without a consumer the bubble kept the optimistic
          // state for a message that is gone — the one place the UI could say something untrue. App owns
          // the delivery map and hands the SAME instance to both shells, so writing here is web≡mobile by
          // construction. `failed` is an existing terminal state the bubble already renders with a retry.
          // The two give-up reports, from the ONE shared rule (web's circleApp.js calls the same).
          // This was an inline copy here and absent on web, which is how web ended up unable to say that
          // a message had been given up on.
          // ADMISSION + delivery, one opts object — EXTEND, never replace (web ≡ mobile; the same
          // membrane fragment both shells spread; the toggles wrote overrides for months while nothing
          // on the receive path read them).
          secureAgentOpts: {
            ...makeGiveUpConsumers({ deliveryMap: deliveryStateMapRef.current }),
            ...makeCircleMembraneOpts({
              overrideStore: makeMemberOverrideStoreRN(AsyncStorage),
              groupsIndex: circleGroupsIndexRef.current,
            }),
          },
          // The per-user address-fallback setting, read LIVE (batch 4, web≡mobile) — a sync read off
          // the hook-fed cache, because the send path cannot await AsyncStorage per message.
          allowAddressFallback: () => deliverySettingsCacheRef.current.allowFallback === true,
          // Persist the agent identity (chat + host vaults + stoop
          // cache) to AsyncStorage so the NKN address — derived from the
          // identity keypair — stays stable across reboots (otherwise a
          // peer's cached peerAddr from a /share-my-contact QR breaks).
          asyncStorage: AsyncStorage,
          // The owner-root seed's key door — the OS keystore (Android Keystore / iOS Keychain
          // via expo-secure-store). The phrase itself is never persisted.
          secureStore: SecureStore,
          // The restore-settings FLOW (web parity): the boot hooks only raise a flag — they fire
          // DURING boot, before the bundle exists, and the flow's first act is a waist call. The
          // modal (gated on the bundle state below) starts the declared flow, whose probe
          // re-branches; the old per-hook Alert chains are retired with the #44 dialogs.
          onSettingsKeyMismatch: () => setRestoreFlowPending(true),
          onSettingsConflicts: () => setRestoreFlowPending(true),
          // SILENT out-of-circle delivery — the writer thunk for the bundle's TIERED "shared with me" store
          // (received sealed copies mirror to the user's pod once signed in; local-only while null). Same
          // thunk the launcher's other tiered stores read (getCirclePodWriter → circlePodWriterRef.current).
          getSharedWithMePodWriter: getCirclePodWriter,
          // S4 — multi-member sealing: route stoop redeem/leave to the circle's producer.
          stoopControlAgent: circleControlAgentRouter,
          // Cache-mode mirroring (RN parity): a pod-backed circle's store rides a cache-mode PseudoPod.
          provisionCircleMedium,
          // Settings pod-sync (RN parity with web circleApp): seal the parameter register's agent/circle params
          // to <pod>/basis/settings/… under the owner-derived key, so they open on the user's other devices.
          // Same shared factory + attachInner path realAgent already runs; mobile only supplies the pod
          // fetch + root, exactly like provisionCircleMedium above. Null fetch/root → factory returns null → local.
          // The membership rider: hand the device log so membership statements ride its lane.
          deviceLog: eventLogRef.current ?? undefined,
          provisionSettingsMedium: async (strategy) => createSettingsPodMedium({
            fetch:   getCirclePodFetch(),
            podRoot: getActiveRealPodRouting()?.podRoot ?? null,
            strategy,
          }),
          // The personal history mirror's pod backend (parity with web circleApp): same pod, same
          // seal-to-self strategy; realAgent gates on the history.mirror switch (off by default).
          provisionHistoryMirror: async (strategy) => createHistoryPodMedium({
            fetch:   getCirclePodFetch(),
            podRoot: getActiveRealPodRouting()?.podRoot ?? null,
            strategy,
          }),
          // Connectivity Phase 3 — LIVE shared-pod key-custody seams (member-side), RN parity with web
          // circleApp. A shared/hybrid circle WITH a pod + group key seals→writes the pod + fans a ref
          // (pod-signal); catch-up range-queries→opens it. A no-pod circle keeps fan-out-full unchanged.
          stoopCircleDataMove: circleSendDataMove,
          stoopPodWrite:       circlePodWrite,
          // G11 — the no-pod key-event fan's transport (a REMOVE → rotation fans the new key to the
          // remaining members). The bundle injects its peer sender + skill dispatch at boot.
          setKeyEventWiring: setCircleKeyEventWiring,
          // Extension mappings (feedback-extension) — load installed extensions from AsyncStorage at boot,
          // verify them against the base catalogue, and merge the accepted ones into the dispatch catalogue.
          mappingsStore:    asyncStorageMappingsStore(AsyncStorage),
          mappingsDeviceId: MAPPINGS_DEVICE,
          // Skip the demo seed on warm boot.  Saves ~2.5s of boot time.
          seedTasks:        !alreadySeeded,
          seedStoopProfile: !alreadySeeded,
          seedStoopPosts:   !alreadySeeded,
          publishEvent: (e) => {
            if (!e || typeof e !== 'object') return;
            const evt = {
              ...e,
              id: e.id ?? `mob-${Date.now()}-${(eventSeq += 1).toString(36)}`,
              ts: e.ts ?? Date.now(),
            };
            try { eventLogRef.current?.append?.(evt); } catch { /* defensive */ }
          },
        });
        if (cancelled) { b.dispose?.(); return; }
        dlog.boot('bundle ready (App)', {
          transport:  b.transport,
          appOrigins: [...b.catalogue.appOrigins],
          opCount:    b.catalogue.opsById?.size ?? 0,
        });
        // ε.1 — expose the bundle to the inbox's lazy-bound ingest
        // closure built above.  Must happen BEFORE the rehydrator
        // fires (next block) so the first ingest call sees callSkill.
        bundleRef.current = b;
        // Register-backed surface preference (the device-params consolidation): bind the booted
        // agent into the module store, which hydrates the cached value from the register.
        attachSurfacePrefAgent(b.agent);
        // Same for the theme (the register is the authority; the AsyncStorage key stays the
        // pre-boot paint cache — the attach reconciles cache←register through the provider).
        attachThemeAgent(b.agent);
        // Relay-URL reconcile (register = authority; the bare key is the pre-boot connect cache):
        // adopt a differing register value into the cache and reconnect live.
        (async () => {
          try {
            const reg = b.agent?.getParamValue?.('relay.url');
            const io = asyncStorageRelayIo(AsyncStorage);
            const cached = resolveRelayUrl(await io.load(), '') || '';
            if (typeof reg === 'string' && reg && reg !== cached) {
              await io.save(reg);
              await b.reconnectPeer?.();
            }
          } catch { /* the cache stands — the next explicit set converges both */ }
        })();
        // #36 — apply the persisted chat-retention (from the parameter register, hydrated at agent boot) to the
        // shared eventLog, parity with web circleApp. Reads via callSkill('params',…) (the bundle exposes it).
        b.callSkill?.('params', 'get-param', { key: 'retention.chatDays' })
          .then((r) => eventLogRef.current?.setRetention?.(retentionFromDays(r?.value)))
          .catch(() => { /* defaults stand */ });
        // web ≡ mobile: same attach as circleApp.js — the roster feed fills the membrane's index.
        if (b?.agent) b.agent._circleGroupsIndex = circleGroupsIndexRef.current;
        setBundle(b);
        maybeAttachStoopPod();   // S4 — bundle up → attach stoop's item store if already signed in
        // Mark the first-boot seed as done so the next launch skips it.
        // Fire-and-forget; failures are non-fatal (next launch re-seeds,
        // which is harmless because realAgent's listOpen probe is the
        // outer guard).
        if (!alreadySeeded) {
          AsyncStorage.setItem(SEED_FLAG, '1').catch(() => { /* non-fatal */ });
        }
        // THE ONE-TIME HISTORY MIGRATION (store copy → persisted device log, web parity): the log is
        // the record now, so the store-era history lands on it ONCE through the shared inbox and the
        // AsyncStorage latch skips every later boot. The per-boot rehydrate is retired — this was its
        // final job; a failed pass leaves the latch unset and retries next boot.
        if (typeof b?.callSkill === 'function' && eventLogRef.current) {
          migrateCircleChatHistory({
            callSkill: b.callSkill,
            inbox:     circleChatInboxRef.current,
            marker: {
              get: () => AsyncStorage.getItem(CHAT_MIGRATION_MARKER_KEY),
              set: (v) => AsyncStorage.setItem(CHAT_MIGRATION_MARKER_KEY, v),
            },
          }).catch(() => { /* logged inside */ });
        }
        // probe whether we should display the CREATE-side
        // mnemonic.  Skipped silently when the identity / mnemonic isn't
        // available (e.g. restore-from-mnemonic path already acknowledged
        // a different identity).  Any failure inside the probe falls
        // through to 'dismissed' so the app boot never blocks.
        try {
          const show = await shouldShowCreateMnemonic(AsyncStorage);
          if (!show) { setMnemonicState('dismissed'); return; }
          // The OWNER ROOT's phrase — the one secret everything derives from — via the same skill the
          // in-app "show my recovery phrase" screen uses.
          //
          // 2026-08-02: this used to read `b.agent.sa.agent.identity.getMnemonic()`, which is the CHAT
          // identity. Its seed is `root.deriveAgentSeed('default')` — a CHILD of the root — so
          // `getMnemonic()` re-encoded the child and the app showed 24 words that were NOT the recovery
          // phrase. Writing them down and typing them back installed them as a brand-new root: a
          // different person, at addresses nobody had ever seen.
          // Same defensive read as CircleMyDataScreen, the consumer that already had this right — whose
          // own comment records that it too once read the wrong seed ("was stoop getMnemonicOnce").
          let phrase = null;
          try {
            const res = await b.callSkill?.('household', 'revealOwnerPhrase', {});
            if (res && !res.error) {
              const w = res.mnemonic ?? res.phrase ?? res.words ?? '';
              phrase = Array.isArray(w) ? w.join(' ') : String(w || '');
            }
          } catch { phrase = null; }
          if (typeof phrase === 'string' && phrase.trim()) {
            if (!cancelled) {
              setMnemonic(phrase);
              setMnemonicState('show');
            }
          } else {
            setMnemonicState('dismissed');
          }
        } catch (probeErr) {
          dlog.warn('mnemonic probe failed (App)', probeErr?.message ?? probeErr);
          setMnemonicState('dismissed');
        }
      } catch (err) {
        dlog.warn('boot failed (App)', err?.message ?? err);
        if (!cancelled) setBootError(err?.message ?? String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [firstRun]);

  if (!localeReady) return null;
  if (firstRun === 'checking') return null;   // probe still in-flight
  if (firstRun === 'show') {
    return (
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <FirstRunWelcomeScreen onStart={dismissFirstRun} onRestore={startRestore} />
      </SafeAreaProvider>
    );
  }
  if (firstRun === 'restore') {
    return (
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <MnemonicEntryScreen onSubmit={submitMnemonic} onCancel={cancelRestore} />
      </SafeAreaProvider>
    );
  }

  // show the CREATE-side mnemonic screen once after the
  // identity has been seeded.  Renders ABOVE the normal app overlay so
  // the user has to acknowledge (or pick "Later") before reaching the
  // launcher.  The screen never reappears once "Written down" or
  // "Photo taken" is tapped.
  if (mnemonicState === 'show') {
    const dismissMnemonic = async (kind) => {
      try { await markMnemonicAck(AsyncStorage, kind); } catch { /* non-fatal */ }
      setMnemonicState('dismissed');
    };
    return (
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <MnemonicCreateScreen
          mnemonic={mnemonic}
          onWritten={() => dismissMnemonic('written')}
          onPhoto={() => dismissMnemonic('photo')}
          onLater={() => dismissMnemonic('later')}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {/* Reactive display theme (systeem / licht / donker). The provider reads the
          stored preference, resolves 'system' against the live OS scheme, and
          re-renders on change — the My-data toggle recolours render-time readers live. */}
      <ThemeProvider>
      <View style={styles.root}>
        {/* ChatScreen stays mounted (peer-wiring keeps routing
            inbound DMs / mesh) but is visually hidden behind the launcher
            overlay.  No "← chat" route reveals it; chat now lives inside
            the circle view as the CONVERSATION tab.
            The styles.hiddenChat below uses absolute positioning so the
            ChatScreen is mounted + peer-wired but never visible. */}
        <View style={styles.hiddenChat} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ChatScreen
            // A join completed in THIS shell (the invite-link path) must reach the launcher's list.
            onCirclesChanged={onCirclesChanged}
            bundle={bundle}
            bootError={bootError}
            eventLog={eventLogRef.current}
            circleChatInbox={circleChatInboxRef.current}
            chatStoredReceipt={(info) => chatReceiptSenderRef.current(info)}
            deliveryStateMap={deliveryStateMapRef.current}
            circleRecipePendingStore={circleRecipePendingStoreRef.current}
            circleRecipeDedup={circleRecipeDedupRef.current}
            circleRulesPendingStore={circleRulesPendingStoreRef.current}
            circleRulesDedup={circleRulesDedupRef.current}
            circlePolicyPendingStore={circlePolicyPendingStoreRef.current}
            circlePolicyDedup={circlePolicyDedupRef.current}
            sessionRef={sessionRef}
            onSessionChanged={refreshCirclePodWriter}
            onPodAuthReady={setPodAuth}
          />
        </View>
        <CircleLauncherScreen
          bundle={bundle}
          deliveryStateMap={deliveryStateMapRef.current}
          registerCircleBotSink={registerCircleBotSink}
          onAcceptFallback={acceptFallbackOffer}
          // Bumped when a circle is joined/created from another surface → the launcher reloads its list.
          circlesRevision={circlesRevision}
          sessionRef={sessionRef}
          podAuth={podAuth}
          eventLog={eventLogRef.current}
          circleRecipePendingStore={circleRecipePendingStoreRef.current}
          circleRulesPendingStore={circleRulesPendingStoreRef.current}
          circlePolicyPendingStore={circlePolicyPendingStoreRef.current}
          /* no onBack (no chat shell to fall back to) +
             no onChatRoute (the circle view IS the chat, no route). */
        />
        <RestoreFlowModal
          visible={restoreFlowPending && !!bundle}
          callSkill={bundle?.callSkill}
          onClose={() => setRestoreFlowPending(false)}
          onPhrase={startRestore}
        />
      </View>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // ChatScreen is kept mounted for its peer-wiring side-effect
  // but parked off-screen so it never paints over the launcher.  An
  // alternative is `display: 'none'` but RN can lose layout in that
  // path on some platforms; absolute-zero-size + pointerEvents=none is
  // the proven invisible-but-mounted recipe.
  hiddenChat: {
    position: 'absolute',
    top: 0, left: 0,
    width: 0, height: 0,
    overflow: 'hidden',
  },
});
