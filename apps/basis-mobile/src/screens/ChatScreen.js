/**
 * Chat screen.
 *
 * step 1 — TextInput + message list wired through the canonical
 * basis web pipeline (parseInput → resolveDispatch → runDispatch
 * → renderReply).
 *
 * step 5 — multi-thread state via the small mobile-local
 * `threadState` reducer; ThreadDrawer lets the user switch + create
 * threads.  Per-thread messages, sourceDispatch, and pendingFollowUp
 * live inside the reducer so switching parks pending follow-ups
 * correctly.
 *
 * What this slice DOES not yet do (later sub-steps):
 *   - multi-field form rendering (step 6)
 *   - [Help with] DM spawn, [Start DM], [Download] specials (step 7)
 *   - free-text LLM routing (later — web only has slash today too)
 *
 * No hardcoded strings ([[no-hardcoded-strings]]) — every label
 * goes through `t()`.
 */
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  AppState, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';

import {
  parseInput, resolveDispatch, runDispatch, scopeReadyDispatch, getActiveCircle,
  renderReply, isQrUri,
  // E3 — record-panel auto-refresh after a mutation.
  itemRefFromReply, REFRESHABLE_VERBS,
  // E2 — bulk fan-out (`/done all`).
  executeBulkDispatch, lastListingItems,
} from '@onderling-app/basis';

import { createFeedbackMount } from '../../../basis/src/feedback/feedbackMount.js';
// presentLocalNotification is the shared local-notify helper (folded out of the
// app's old v2/nativePush.js dup → @onderling/react-native/push · PushAdapter.presentLocal).
import { presentLocalNotification } from '@onderling/react-native/push';
import { feedbackContactItem } from '../../../basis/src/feedback/feedbackSurface.js';
import { autoRefreshStalePanels } from '../core/panelAutoRefresh.js';
import { buildNavModels }  from '../core/navModel.js';
import { dlog }            from '../core/devLog.js';
import { t }               from '../core/localisation.js';
import {
  refreshList, snapshotSourceDispatch,
} from '../core/refreshList.js';
import {
  beginFollowUp, completeFollowUp,
  beginFormFollowUp, completeMultiFieldFollowUp,
} from '../core/followUp.js';
import {
  createInitialThreadState, listThreads, getActiveThread,
  setActiveThread, createThread, updateMessages,
  setSourceDispatch, setPendingFollowUp,
  ensureDmThread, updatePeerDisplay,
} from '../core/threadState.js';
import { makePeerRouter }      from '../../../basis/src/core/handlers/peerRouter.js';
import { makeReceiptReceiver } from '../../../basis/src/v2/deliverySettings.js';
import { pushContactReply }    from '../core/contactReplyInbox.js';
import { makeKringChatPeerHandler } from '../../../basis/src/v2/kringChatReceiver.js';
import { createChatMessageInbox } from '../../../basis/src/v2/chatMessageInbox.js';
import { makeKringRecipePeerHandler } from '../../../basis/src/v2/kringRecipeReceiver.js';
import { makeKringRulesPeerHandler }  from '../../../basis/src/v2/kringRulesReceiver.js';
import { makeKringPolicyPeerHandler } from '../../../basis/src/v2/kringPolicyReceiver.js';
import { makeKringGovernancePeerHandler, makeKringReportPeerHandler } from '../../../basis/src/v2/kringLogReceiver.js';
import { governanceEntryId } from '../../../basis/src/v2/governanceLog.js';
import { makeHandleChatMessage }
                               from '../../../basis/src/core/handlers/chatMessage.js';
import { makeHandleBuurtPeerIntro }
                               from '../../../basis/src/core/handlers/meshIntros.js';
// B2 — per-circle ADDRESS announcing (web parity): the receive half + the admin's post-join
// propagation. Same shared source both shells call; each only passes its own `agent`.
import { makeCircleAddressAnnouncePeerHandler, propagateCircleAddressesAfterJoin }
                               from '../../../basis/src/v2/circleAddressAnnounce.js';
// G11 — no-pod group-key rotation, RECEIVE side: record an inbound key-event into the local per-circle
// log (circlePods' store); a content read folds it into the key chain. Same shared handler as web.
import { makeHandleGroupKeyEvent }
                               from '../../../basis/src/core/handlers/groupKeyEvent.js';
import { recordCircleKeyEvent } from '../core/circlePods.js';
import {
  makeHandleCatchUpRequest, makeRequestCatchUpFromKnownPeers,
} from '../../../basis/src/core/handlers/catchUp.js';
// ε.4 — negotiated catch-up protocol substrate.
import { makeCatchUpProviderHandler } from '../../../basis/src/v2/catchUpProvider.js';
import { makeCatchUpReceiver }        from '../../../basis/src/v2/catchUpReceiver.js';
import { makeHandleCalendarRsvp }
                               from '../../../basis/src/core/handlers/calendarRsvp.js';
import { makeHandleCalendarCancel }
                               from '../../../basis/src/core/handlers/calendarCancel.js';
import { makeHandleBuurtPost } from '../../../basis/src/core/handlers/buurtPost.js';
import {
  makeHandleGroupRedeemRequest,
  makeHandleGroupRedeemResponse,
  makeSendGroupRedeemRequest,
} from '../../../basis/src/core/handlers/groupRedeem.js';
// personas#2 — post-join "share to this circle" peer handlers (admin records + acks; member resolves).
import {
  makeHandlePersonaPropsUpdate,
  makeHandlePersonaPropsAck,
} from '../../../basis/src/core/handlers/personaPropsUpdate.js';
// profile-update propagation — the roster "pull-me" signal (announce on a real roster write;
// receive → record the silent stream entry + re-read). Web parity (circleApp.js).
import {
  makeRosterUpdateAnnouncer,
  makeRosterUpdatedPeerHandler,
} from '../../../basis/src/v2/rosterUpdated.js';
import { makeHandleHelpWithAccepted, makeHandleHelpWithResponse }
                               from '../../../basis/src/core/handlers/helpWith.js';
import { makeHandleCalendarInvite }
                               from '../../../basis/src/core/handlers/calendarInvite.js';
import { makeHandleFileShare } from '../../../basis/src/core/handlers/fileShare.js';
// SILENT out-of-circle delivery — inbound `shared-copy` handler: lands a relayed sealed COPY into the per-user
// "shared with me" store (the launcher lists + opens it). Shared core (web≡mobile), same as circleApp.js.
import { makeHandleSharedCopy } from '../../../basis/src/core/handlers/sharedCopyReceive.js';
// Circle roster → household no-pod sync peers (+ per-circle address binding). The ONE shared
// implementation, called by web (circleApp) and the mobile launcher too.
import { feedHouseholdRoster } from '../../../basis/src/v2/householdRosterPairing.js';
import { computeEmbedButtons } from '../../../basis/src/core/embedButtons.js';
import { makeCalendarOutboundHook }
                               from '../../../basis/src/core/handlers/calendarOutbound.js';
import { interceptButtonTap }       from '../core/buttonSpecials.js';
import { buildMobileLocalBuiltins } from '../core/hostOps.js';
import { wizardModalFor }           from '../core/wizardRegistry.js';
import { EventLog }                 from '../../../basis/src/eventLog.js';
import LogsPanel                    from '../../../basis/src/rn/screens/LogsPanel.js';
import RecordDetailModal            from '../../../basis/src/rn/screens/RecordDetailModal.js';
import { recordCanExpand }          from '../core/recordExpand.js';
import { openFilePicker }           from '../core/filePicker.js';
// Media mobile twin (2026-07) — RN media input + media-card render model.
import { openMediaFilePicker }      from '../core/mediaPicker.js';
import { buildMediaCardModel }      from '../core/mediaCardModel.js';
import { saveBase64File }           from '../core/fileSave.js';
import { useBasisAuth }        from '../auth/basisAuthHook.js';
import { buildMobilePodAuth }       from '../core/podAuth.js';
import { OidcSessionRN }            from '@onderling/oidc-session-rn';
import * as SecureStore             from 'expo-secure-store';
import { ExpoSecureStore }          from '@onderling/react-native/ports';
import AsyncStorage                 from '@react-native-async-storage/async-storage';
import SlashFAB            from '../rn/SlashFAB.js';
import ThreadDrawer        from '../rn/ThreadDrawer.js';
import MultiFieldFormBubble from '../rn/MultiFieldFormBubble.js';

// Phase 1 QR (2026-05-27) — render real QR images for record-field
// values matching one of the registered URI schemes (onderling-contact://,
// onderling-invite://, basis://).  Substrate at
// @onderling/react-native/qr/view wraps react-native-qrcode-svg.
import { QrCodeView }     from '@onderling/react-native/qr/view';
import QrScannerModal     from '../rn/QrScannerModal.js';
import { classifyQrPayload } from '@onderling/react-native/qr';
import { getBasisClassifiers } from '../core/qrClassifiers.js';
// Extension install (feedback-extension mobile parity) — consent sheet + controller.
import ExtensionConsentSheet from './v2/ExtensionConsentSheet.js';
import { useExtensionInstall } from '../core/extensionInstallRN.js';
import { asyncStorageMappingsStore, MAPPINGS_DEVICE } from '../core/mappingsStoreRN.js';
// ε.6 — multi-offer chooser modal (opt-in via policy.catchUpChooserMode='prompt').
import CircleCatchUpChooserScreen from './v2/CircleCatchUpChooserScreen.js';
// ε.6 follow-up — read the same per-kring policy the launcher writes so
// the chooser mode is honoured on mobile (web reads localStorage
// synchronously; mobile uses a hot cache because AsyncStorage is async).
import { makeCirclePolicyStoreRN } from '../core/circleStoresRN.js';

// Synthetic message IDs.  Counter is module-level + monotonic for the
// life of this JS bundle, but threads persist across app launches via
// threadState.  On boot the counter restarts at 1 — so the new `m1`,
// `m2`… would collide with persisted bubbles using the same ids,
// triggering React's "two children with the same key" warning.  A
// per-launch random prefix guarantees cross-session uniqueness
// (2026-05-27 real-device finding).
const MSG_ID_PREFIX = Math.random().toString(36).slice(2, 8);
let nextMessageId = 1;
const mkId = () => `m${MSG_ID_PREFIX}${nextMessageId++}`;

// M6 — the feedback bot's LLM endpoint on mobile (Expo public env; the device can't run Ollama).
// Unset → the bot still enters mode + the deterministic intent fast-path works, but the LLM
// clean/review step needs a reachable route. Mirrors web's VITE_FEEDBACK_LLM_BASEURL.
const FEEDBACK_LLM_BASEURL = process.env.EXPO_PUBLIC_FEEDBACK_LLM_BASEURL || undefined;
const FEEDBACK_LLM_MODEL = process.env.EXPO_PUBLIC_FEEDBACK_LLM_MODEL || undefined;
// M6 — feedback real-pod ACTIVATION (parity with web's VITE_FEEDBACK_ACTIVATION_URL / _PROJECT_ID).
// Unset → `/feedback <code>` has no activation service, so the bare-demo mount path is used.
const FEEDBACK_ACTIVATION_URL = process.env.EXPO_PUBLIC_FEEDBACK_ACTIVATION_URL || null;
const FEEDBACK_PROJECT_ID = process.env.EXPO_PUBLIC_FEEDBACK_PROJECT_ID || 'basis';

// ε.1 — fallback inbox builder used only when App.js didn't pass one
// (e.g. older standalone test mounts).  Production wiring goes through
// the App-level singleton so dedup state is shared with the rehydrator.
function makeFallbackInbox(eventLog, callSkill) {
  return createChatMessageInbox({
    eventLog,
    ingest: async (payload, fromPeerAddr) => {
      if (typeof callSkill !== 'function') return { ok: false };
      try { return await callSkill('stoop', 'ingestKringMessage', { payload, fromPeerAddr }); }
      catch (err) {
        console.warn('[kring-chat] ingestKringMessage failed:', err?.message ?? err);
        return { error: String(err?.message ?? err) };
      }
    },
  });
}

export default function ChatScreen({
  bundle = null,
  bootError = null,
  // A circle was joined in THIS shell (the invite-link path) → the launcher's list is stale and must
  // reload. Declared here deliberately: the sibling bug fixed the same day was App.js passing
  // `onAcceptFallback` to a screen that never destructured it, which threw on render.
  onCirclesChanged = null,
  eventLog = null,
  // ε.1 — shared inbox singleton (msgId dedup + ingest mirror + eventLog append).
  // The receiver path here routes through it; rehydrator + future catch-up paths
  // share the same instance so dedup state is unified.  Pre-ε.1 prop name
  // `kringChatDedup` no longer exists — App.js owns the inbox now.
  kringChatInbox = null,
  // Delivery honesty — the shared per-message map (App.js owns it); inbound receipts advance it here.
  deliveryStateMap = null,
  // γ-next.recipe — pending-recipe cache + dedup, plumbed from App.js
  // so the launcher's editor sees the same store the receiver writes to.
  kringRecipePendingStore = null,
  kringRecipeDedup = null,
  // γ-next.rules — pending-rules cache + dedup, mirrors the recipe wire.
  // Launcher's rules editor reads from this store; receiver writes here.
  kringRulesPendingStore = null,
  kringRulesDedup = null,
  // γ-next.policy — pending-policy cache + dedup.  Launcher's settings
  // editor reads from this store; receiver writes here.  Completes the
  // γ-next trio (recipe / rules / policy).
  kringPolicyPendingStore = null,
  kringPolicyDedup = null,
  // 5.4c (2026-05-30) — App.js owns the OidcSessionRN so the v2 circle
  // launcher can build a podWriter from the SAME session.  If absent
  // (standalone mounts / older tests) we fall back to creating one
  // locally so existing wiring keeps working unchanged.
  sessionRef: sessionRefProp = null,
  // Fired after sign-in completes / sign-out clears, so App.js can
  // refresh the launcher's pod-writer ref.  No-op when omitted.
  onSessionChanged = null,
  // cluster J — lift podAuth up so the v2 launcher (which is the only visible UI; this ChatScreen is
  // mounted-but-hidden) can expose a pod sign-in entry. Pod sign-in otherwise has no v2 surface.
  onPodAuthReady = null,
  // Media mobile twin (2026-07) — the sealed-media seams `{ gateway, opener }`.
  // `gateway` ({bucket, sealer, keyRef?}) feeds hostOps → the shared embed-file
  // builtin's sealed upload path; `opener` unseals the media-card chip's inline
  // thumbnail.  App.js does NOT wire this yet — the LIVE blob-bucket + verifier
  // infra is the recorded gap (same as web).  Absent seams degrade honestly:
  // /embed-file keeps the legacy inline file-card (no sealer in reach ⇒ no
  // unsealed upload) and any received media-card renders the mime/dims
  // placeholder chip.
  media = null,
}) {
  // M1 (2026-05-29) — the agent bundle is booted ONCE in App.js (shared
  // with the circle launcher).  `bootState` is DERIVED from the props so
  // the rest of this screen — which reads `bootState.kind` /
  // `bootState.bundle` throughout — is unchanged.
  const bootState = useMemo(() => {
    if (bundle)    return { kind: 'ready', bundle };
    if (bootError) return { kind: 'error', message: bootError };
    return { kind: 'loading' };
  }, [bundle, bootError]);
  const navModels = useMemo(() => (bundle ? buildNavModels() : []), [bundle]);
  const [threadState,  setThreadState]  = useState(() => createInitialThreadState());
  const [input,        setInput]        = useState('');
  const [busy,         setBusy]         = useState(false);
  const [debugOpen,    setDebugOpen]    = useState(false);
  const [drawerOpen,   setDrawerOpen]   = useState(false);
  // active wizard launched by a row-button tap.
  // null when no wizard open; otherwise { opId, args }.  ChatScreen
  // looks up wizardModalFor(opId) to pick the component.
  const [pendingWizard, setPendingWizard] = useState(null);
  // eventLog instance (created once per session) and
  // visibility flag for the LogsPanel modal.  localBuiltins.logs
  // toggles `logsPanelOpen` via the `openLogsPanel` callback when
  // the user types a bare /logs.
  const eventLogRef = useRef(null);
  const feedbackMountRef = useRef(null);   // M6 — lazy feedback mount (created on first /feedback)
  if (!eventLogRef.current) {
    // M1 — App.js owns the EventLog (so boot-time agent events + this
    // screen's inbound peer events share one log).  Fall back to a fresh
    // one if rendered standalone (e.g. a future test harness).
    eventLogRef.current = eventLog ?? new EventLog({ initial: [], muted: [] });
  }
  const [logsPanelOpen, setLogsPanelOpen] = useState(false);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  // E5 — record/mini-page "⤢ Open in full": holds the reply shown in
  // the full-height detail modal, or null when closed.
  const [expandedRecord, setExpandedRecord] = useState(null);
  // ε.5 — "Catching up…" indicator + provider-side notification cards.
  // Status is fed by the negotiated catch-up receiver's emitStatus
  // hook; notifications come from the provider's emitNotification.
  const [catchUpStatus, setCatchUpStatus] = useState(null);
  const [catchUpNotifications, setCatchUpNotifications] = useState([]);
  const catchUpProviderRef = useRef(null);
  // ε.6 — multi-offer chooser modal state.  `pendingChoice` holds the
  // currently-visible chooser invocation; the resolver fn settles the
  // Promise the catch-up receiver is awaiting on.
  const [pendingCatchUpChoice, setPendingCatchUpChoice] = useState(null);
  const pendingCatchUpResolverRef = useRef(null);
  // ε.6 follow-up — per-kring policy hot cache.  AsyncStorage can't be
  // read synchronously, but ε.6's `getChooserMode` hook is sync (the
  // receiver state machine doesn't want async there).  We instantiate
  // the SAME policyStore the launcher uses (shared AsyncStorage prefix
  // `cc.circlePolicy.<id>`) and serve reads from an in-memory cache.
  // On a miss, fire the async load + cache; this turn returns 'auto'
  // (default); subsequent calls return the real value.  Also exposes
  // an async `getCirclePolicy(id)` for the catchUpProvider's
  // autoApprove path.
  const policyStoreRef    = useRef(null);
  if (!policyStoreRef.current) {
    policyStoreRef.current = makeCirclePolicyStoreRN(AsyncStorage);
  }
  const policyCacheRef    = useRef(new Map());
  const policyLoadingRef  = useRef(new Set());
  const ensurePolicyLoaded = useCallback((circleId) => {
    if (!circleId) return;
    if (policyCacheRef.current.has(circleId)) return;
    if (policyLoadingRef.current.has(circleId)) return;
    policyLoadingRef.current.add(circleId);
    Promise.resolve(policyStoreRef.current.get(circleId))
      .then((p) => { policyCacheRef.current.set(circleId, p ?? {}); })
      .catch(() => { policyCacheRef.current.set(circleId, {}); })
      .finally(() => { policyLoadingRef.current.delete(circleId); });
  }, []);
  const getChooserModeMobile = useCallback((circleId) => {
    ensurePolicyLoaded(circleId);
    const p = policyCacheRef.current.get(circleId);
    return p?.catchUpChooserMode === 'prompt' ? 'prompt' : 'auto';
  }, [ensurePolicyLoaded]);
  const getCirclePolicyMobile = useCallback(async (circleId) => {
    if (!circleId) return null;
    try {
      const p = await policyStoreRef.current.get(circleId);
      if (p) policyCacheRef.current.set(circleId, p);
      return p ?? null;
    } catch { return null; }
  }, []);
  // Solid OIDC. Hook drives the OAuth dance;
  // OidcSessionRN holds tokens in SecureStore (restored on mount).
  // `buildMobilePodAuth` adapts both into the podAuth shape that
  // localBuiltins (signin / signout / whoami) consumes.
  const authHook = useBasisAuth();
  // 5.4c — prefer the App-owned sessionRef so the v2 circle launcher
  // shares this OidcSessionRN.  Standalone mounts (older tests, future
  // harnesses) fall back to a screen-local ref.
  const localSessionRef = useRef(null);
  if (!sessionRefProp && !localSessionRef.current) {
    localSessionRef.current = new OidcSessionRN({ store: new ExpoSecureStore({ store: SecureStore }).asOidcStore(), appId: 'basis' });
  }
  const sessionRef = sessionRefProp ?? localSessionRef;
  useEffect(() => {
    // When App owns the ref it has already kicked off restore + the
    // circle podWriter refresh; skip the duplicate restore here.
    if (sessionRefProp) return;
    sessionRef.current?.restoreFromVault?.().catch(() => { /* fresh install */ });
  }, [sessionRefProp, sessionRef]);
  const podAuth = useMemo(() => {
    const base = buildMobilePodAuth({ hook: authHook, session: sessionRef.current });
    // 5.4c — fire onSessionChanged after operations that mutate the
    // session, so App.js can refresh the circle launcher's podWriter
    // ref without ChatScreen needing to know about it.
    if (!onSessionChanged) return base;
    return {
      ...base,
      async startSignIn(opts) {
        const r = await base.startSignIn(opts);
        try { await onSessionChanged(); } catch { /* best-effort */ }
        return r;
      },
      async signOut() {
        const r = await base.signOut();
        try { await onSessionChanged(); } catch { /* best-effort */ }
        return r;
      },
    };
  }, [authHook, onSessionChanged]);
  // cluster J — hand podAuth to App.js so the visible v2 launcher can drive pod sign-in. podAuth's identity
  // changes every render (its authHook dep is unstable), so expose a STABLE proxy that delegates to the
  // latest — passing podAuth directly would fire onPodAuthReady→setState every render (infinite loop).
  const podAuthRef = useRef(podAuth);
  podAuthRef.current = podAuth;
  const stablePodAuth = useMemo(() => ({
    startSignIn: (...a) => podAuthRef.current.startSignIn(...a),
    signOut: (...a) => podAuthRef.current.signOut(...a),
    getCurrentSession: (...a) => podAuthRef.current.getCurrentSession?.(...a),
    getRawSessionInfo: (...a) => podAuthRef.current.getRawSessionInfo?.(...a),
    resolveIssuer: (...a) => podAuthRef.current.resolveIssuer?.(...a),
  }), []);
  useEffect(() => { onPodAuthReady?.(stablePodAuth); }, [stablePodAuth, onPodAuthReady]);
  const scrollRef       = useRef(null);
  // threadStateRef stays in sync so fire-and-forget async handlers
  // (button taps, follow-up completions) read the latest state
  // without re-binding callbacks on every state change.
  const threadStateRef  = useRef(threadState);

  // joiner-side cross-instance redeem.
  // Shared by makeSendGroupRedeemRequest (writer; joinGroup wizard)
  // and makeHandleGroupRedeemResponse (reader; peer-router).  Lives
  // on a ref so it survives renders without leaking entries between
  // remounts.  Mirrors web's `pendingPeerRedeems` module-level Map.
  const pendingPeerRedeemsRef = useRef(new Map());
  useEffect(() => { threadStateRef.current = threadState; }, [threadState]);

  // An invite someone SENDS you, rather than one you scan.
  //
  // Found walking S4 (2026-07-30): four schemes are declared in `app.json`, the registry in
  // `qrSchemes.js` exists to hold that config honest, and `decodeInvite` parses the URL — but nothing in
  // this app ever *received* one. There was no `Linking` call anywhere in `basis-mobile`, so tapping an
  // invite link opened the app on whatever screen it was last on and dropped the invite on the floor. The
  // scanned and pasted paths worked, which is why it went unnoticed: the failure only appears on the route
  // most people would actually use, which is to send a friend a link.
  //
  // Deliberately a pass-through: the URL goes to the SAME classifier the scanner uses and then to the same
  // `onQrScanResult`, so a link and a scan of the same payload cannot diverge. A cold start arrives via
  // `getInitialURL`, a warm one via the 'url' event — both are needed, and only having the second is the
  // usual version of this bug.
  //
  // A cold start has to WAIT for the agent. The link arrives at mount, which is well before the bundle is
  // ready, and the join wizard's first act is to fetch the circle's rules over `callSkill` — so delivering
  // immediately produced "Could not load rules: callSkill is not a function". The scanner path can never hit
  // this (you cannot scan before the app is up), which is why the ordering was never exercised. So a URL
  // that arrives early is PARKED and delivered on the render where boot reports ready.
  // Declared HERE and not further down: the effect below lists it as a dependency, and a dep array is
  // evaluated during render — a `const` declared later would be a TDZ ReferenceError on first paint.
  const bootReady = bootState.kind === 'ready';
  const pendingLinkRef = useRef(null);
  // Readiness has to be readable from inside the link subscription, and the subscription is mounted ONCE
  // (`[]`) so it can never drop a link that arrives mid-render. That means it closes over the values from
  // mount — when boot is by definition not ready yet — so reading the render-scoped `bootReady` from in
  // there is permanently `false`. A ref is the live value; the flag above is only for the effect's dep.
  const bootReadyRef = useRef(false);
  bootReadyRef.current = bootReady;
  useEffect(() => {
    let cancelled = false;
    const receive = (url) => {
      if (cancelled || !url) return;
      pendingLinkRef.current = String(url).trim();
      drainPendingLink();
    };
    Linking.getInitialURL().then(receive).catch(() => { /* no launch URL is the normal case */ });
    const sub = Linking.addEventListener('url', ({ url }) => receive(url));
    return () => { cancelled = true; sub?.remove?.(); };
    // `onQrScanResult`/`drainPendingLink` are stable function declarations in this component body;
    // re-subscribing on every render would drop links that arrive mid-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Second half of the same mechanism: whenever boot becomes ready, hand over anything parked.
  useEffect(() => {
    if (bootReady) drainPendingLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootReady]);

  const activeThread     = getActiveThread(threadState);
  const activeMessages   = activeThread?.messages ?? [];
  const activeThreadId   = threadState.activeThreadId;
  const pendingFollowUp  = activeThread?.pendingFollowUp ?? null;

  // mobile host-op handlers (lifted from web
  // localBuiltins).  Built once after boot completes; the adapter
  // inside reads threadStateRef live, so handlers see fresh state.
  const localBuiltins = useMemo(() => {
    if (bootState.kind !== 'ready') return null;
    return buildMobileLocalBuiltins({
      threadStateRef, setThreadState,
      agent:         bootState.bundle.agent,
      catalog:       bootState.bundle.catalog,
      callSkill:     bootState.bundle.callSkill,
      t,
      eventLog:       eventLogRef.current,
      openLogsPanel:  () => setLogsPanelOpen(true),
      openQrScanner:  () => setQrScannerOpen(true),
      openFilePicker,
      // Media mobile twin (2026-07) — gateway seams + the RN image picker.
      // Only engages when App.js supplies `media.gateway` (live infra = the
      // recorded gap); hostOps defaults encodeImage to the identity adapter.
      mediaGateway:        media?.gateway,
      openMediaFilePicker,
      podAuth,
      onSignOut: async () => {
        await sessionRef.current?.clear?.();
        try { await onSessionChanged?.(); } catch { /* best-effort */ }
      },
      // Bundle G3 — raw OidcSessionRN ref for /lookup-peer +
      // /publish-peer (which need session.getAuthenticatedFetch).
      sessionRef,
    });
  }, [bootState, podAuth, media]);

  // Extension install (feedback-extension) — the consent sheet + its controller. Uses the shared
  // buildConsentModel/installMapping (sandbox gate + store write). Trigger via globalThis.onderlingInstallExtension
  // (set by the hook). V0: the mapping persists to AsyncStorage and surfaces as a slash-command on the next boot.
  const extStore = useMemo(() => asyncStorageMappingsStore(AsyncStorage), []);
  const extCatalog = bootState.kind === 'ready' ? bootState.bundle.catalog : { opsById: new Map() };
  const { consentResult, confirm: confirmExtInstall, decline: declineExtInstall } = useExtensionInstall({
    store: extStore, deviceId: MAPPINGS_DEVICE, catalog: extCatalog, onInstalled: () => {},
  });

  // M1 (2026-05-29) — the agent bundle is booted ONCE in App.js and
  // shared with the circle launcher (so mobile circle screens can
  // load/create without a second agent / NKN identity).  This screen
  // attaches its peer-wiring AFTER mount via `bundle.attachPeerWiring`.
  // The wiring closes over THIS screen's thread state, which App.js
  // can't see — so it can't be passed at boot time.  The NKN handshake
  // takes seconds; attaching at mount lands well before any inbound
  // peer message or the 1.5s catch-up trigger.
  //
  // inbound peer-router (port of web/main.js:346) +
  // catch-up trigger (port of main.js:1338), built over the live agent
  // + callSkill.
  const buildPeerWiring = useCallback(({ agent, callSkill, contactChannel, pendingPeerRedeems, pendingPersonaProps, sharedWithMeStore }) => {
    const sendPeer = (addr, payload) => agent.sendPeerMessage(addr, payload);
    const getMyPubKey = () =>
      agent?.identity?.chat?.pubKey ?? agent?.identity?.host?.webid ?? null;

    // Reducer-style state updates from inbound envelopes.
    // ensureDmThread mutates threadStateRef synchronously so multiple
    // inbound calls in the same tick see each other.
    const handleDmThreadOpen = (peerAddr) => {
      const prev = threadStateRef.current;
      const { state, threadId } = ensureDmThread(prev, { peerAddr });
      if (state !== prev) {
        threadStateRef.current = state;
        setThreadState(state);
      }
      return { id: threadId };
    };
    const appendBubble = (threadId, rendered) => {
      setThreadState((prev) => updateMessages(prev, threadId, (msgs) => [
        ...msgs,
        { id: mkId(), role: 'bot', pending: false, rendered },
      ]));
    };
    const renamePeer = (peerAddr, displayName) => {
      setThreadState((prev) => {
        const next = updatePeerDisplay(prev, { peerAddr, displayName });
        threadStateRef.current = next;
        return next;
      });
    };

    // Mobile publishEvent — fans into the eventLog so /logs picks up
    // inbound notifications (parity with web's publishEventRef →
    // event-router).
    const publishEvent = (e) => {
      if (!e || typeof e !== 'object') return;
      const evt = {
        ...e,
        id: e.id ?? `peer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        ts: e.ts ?? Date.now(),
      };
      try { eventLogRef.current?.append?.(evt); } catch { /* defensive */ }
    };

    // Delivery honesty (receiver half) — who is ALLOWED to tell us a message arrived. Built here rather
    // than at the handler so the roster cache lives as long as the peer wiring does. The shell injects
    // only its two adapters (the log it already owns, the roster skill); the rule is shared with web.
    const applyIncomingReceipt = deliveryStateMap
      ? makeReceiptReceiver({
        deliveryMap: deliveryStateMap,
        eventLog:    eventLogRef.current,
        listCircleMembers: async (circleId) => {
          const r = await callSkill('stoop', 'listGroupMembers', { groupId: circleId });
          return Array.isArray(r?.members) ? r.members : [];
        },
      })
      : null;

    // profile-update propagation — on a REAL roster write (admin recording a member's disclosure
    // change) drop the SILENT `roster-updated` entry on the shared eventLog + fan the refs out.
    // No values on the wire, no chat bubble, no wake. Parity with web's `announceRosterUpdate`.
    const rosterUpdateAnnouncer = makeRosterUpdateAnnouncer({
      rawCallSkill: callSkill,
      eventLog:     eventLogRef.current,
    });

    // main-thread bubble landing.
    // Mirrors web's `store.getThread('main').addShellMessage`.
    const addMainBubble = (bubble) => appendBubble('main', bubble);

    // ε.4 — negotiated catch-up coordinator + provider handler.
    // Built ONLY when we have a shared inbox; the legacy peer-poll
    // path still works without it (and stays the fallback below).
    const inboxForNegotiated = kringChatInbox ?? null;
    const catchUpReceiver = inboxForNegotiated
      ? makeCatchUpReceiver({
          sendToPeer: sendPeer,
          inbox:      inboxForNegotiated,
          emitStatus: (s) => {
            setCatchUpStatus(s);
            // Hide the pill 1.5s after a terminal phase.
            if (s.phase === 'done' || s.phase === 'no-offers' || s.phase === 'timed-out') {
              setTimeout(() => setCatchUpStatus((cur) => (cur === s ? null : cur)), 1500);
            }
          },
          // ε.6 — opt-in multi-offer chooser.  Reads the per-kring
          // policy via the hot cache (see policyCacheRef above).  First
          // call for a kring returns 'auto' while the async fetch lands
          // in cache; subsequent calls return the real value.  Default
          // for unknown kringen / missing field = 'auto' (parity with ε.4).
          getChooserMode: getChooserModeMobile,
          chooseOffer: (offers, { circleId }) => new Promise((resolve) => {
            pendingCatchUpResolverRef.current = (decision) => {
              try { resolve(decision); }
              finally {
                pendingCatchUpResolverRef.current = null;
                setPendingCatchUpChoice(null);
              }
            };
            setPendingCatchUpChoice({ offers, circleId });
          }),
          logger: console,
        })
      : null;
    const catchUpProvider = makeCatchUpProviderHandler({
      callSkill,
      sendToPeer: sendPeer,
      // Reads the same per-kring policy the launcher writes
      // (`cc.circlePolicy.<id>`).  catchUpProvider awaits this, so a
      // genuine async read is fine here — the provider state machine
      // doesn't block boot.  Returns null on miss / error → defaults
      // to the auto-approve V1 path.
      getCirclePolicy:  getCirclePolicyMobile,
      isKnownContact:   () => true,
      emitNotification: (n) => {
        setCatchUpNotifications((prev) => [...prev, n]);
      },
      logger: console,
    });
    catchUpProviderRef.current = catchUpProvider;

    const handlers = {
      // Substrate-only handlers — no UI bubble; just persist local
      // state + publish a notification for /logs.
      'buurt-peer-intro':      makeHandleBuurtPeerIntro({ callSkill }),
      // B2 — inbound per-circle ADDRESS announcements (web parity). Every announcement carries its
      // own proof, so the sender is not trusted; recording refreshes the sealing binding AND the
      // authorize snapshot together, or the member would be reachable and then refused.
      'circle-address-announce': makeCircleAddressAnnouncePeerHandler({ agent }),
      // G11 — a group-key rotation fanned by another member lands in the local key-event log (web parity).
      'group-key-event':       makeHandleGroupKeyEvent({ recordKeyEvent: recordCircleKeyEvent }),
      // Legacy peer-poll path kept as fallback for callers / tests
      // that still drive it.  The new ε.4 'catch-up-request' subtype
      // is registered alongside via catchUpProvider.handler.
      'catch-up-request':      catchUpProvider.handler,
      'catch-up-accept':       catchUpProvider.onAccept,
      ...(catchUpReceiver ? {
        'catch-up-offer': catchUpReceiver.onPeerMessage,
        'catch-up-chunk': catchUpReceiver.onPeerMessage,
        'catch-up-end':   catchUpReceiver.onPeerMessage,
      } : {}),
      // a contact-bot's reply in its Contacten DM thread → the shared inbox
      // the open ContactThreadScreen subscribes to (cross-screen, like the kring
      // chat wire).  Guarded: the channel is absent in stub-mode boots.
      // S1 #3 — also an inbound PEER DM (contact-msg): a person's message lands in
      // the same inbox (the thread screen routes it by sender address).
      ...(contactChannel ? {
        [contactChannel.subtypes.in]:  contactChannel.replyHandler((reply) => pushContactReply(reply)),
        [contactChannel.subtypes.out]: contactChannel.messageHandler((msg) => pushContactReply(msg)),
      } : {}),
      // NOTE: the legacy buurt-post peer-poll path
      // (`makeHandleCatchUpRequest`) handled the same `catch-up-request`
      // subtype with a different payload shape (`{sinceMs}` instead of
      // `{requestId, sinceTs, fromPeerAddr}`).  ε.4's `isValidRequest`
      // SILENTLY drops the old shape, so legacy peers don't crash us —
      // they just don't get a reply.  The factory is still imported in
      // case a follow-up slice needs to opt back in per-kring.
      'calendar-rsvp':         makeHandleCalendarRsvp({ callSkill, publishEvent }),
      'calendar-cancel':       makeHandleCalendarCancel({ callSkill, publishEvent }),
      'buurt-post':            makeHandleBuurtPost({ callSkill, publishEvent }),
      'group-redeem-request':  makeHandleGroupRedeemRequest({
        callSkill, sendPeer, publishEvent,
        // …and return OUR per-circle address for the circle being joined, proven the same way the joiner
        // proves theirs, so per-circle addressing works in both directions from the join on (web parity).
        circleAddressFor: (gid) => agent.circleAddressFor?.(gid) ?? null,
        signCircleAddress: (gid, addr) => agent.signCircleLink?.(gid, gid, addr) ?? null,
        // B2 — hand the circle the newcomer's proven per-circle address, and the newcomer the
        // circle's (web parity: the identical shared function, only the agent differs).
        propagateCircleAddresses: ({ circleId, newMemberWebid }) =>
          propagateCircleAddressesAfterJoin({ agent, circleId, newMemberWebid }),
      }),
      // joiner-side response. Pairs with
      // `pendingPeerRedeemsRef` populated by the joinGroup wizard's
      // sendPeerRedeem call.  Mirror of web's handleGroupRedeemResponse
      // at main.js:743.
      'group-redeem-response': makeHandleGroupRedeemResponse({
        // OBJ-2 — the BUNDLE's shared map (so a v2-launcher join correlates here too); ref is the fallback.
        pendingMap: pendingPeerRedeems ?? pendingPeerRedeemsRef.current,
      }),
      // personas#2 — post-join persona-property push: admin records onto the roster + acks; the member
      // resolves its pending push on the ack (bundle's shared map, parity with the redeem pair).
      'persona-props-update':  makeHandlePersonaPropsUpdate({ callSkill, sendPeer, announceRosterUpdate: rosterUpdateAnnouncer }),
      'persona-props-ack':     makeHandlePersonaPropsAck({ pendingMap: pendingPersonaProps }),
      // profile-update propagation — record the roster owner's silent "pull-me" onto the shared
      // eventLog (never a bubble, never a wake); the launcher's roster view re-reads on it.
      'roster-updated':        makeRosterUpdatedPeerHandler({ eventLog: eventLogRef.current }),
      'help-with-accepted':    makeHandleHelpWithAccepted({
        ensureDmThread:    handleDmThreadOpen,
        appendBubble,
        updatePeerDisplay: renamePeer,
        t,
      }),
      // inbound 'help-with-response' produces
      // a structured responder-card bubble (Accept / Decline / Counter).
      'help-with-response':    makeHandleHelpWithResponse({
        ensureDmThread:        handleDmThreadOpen,
        appendResponderCard:   (threadId, data) => {
          setThreadState((prev) => updateMessages(prev, threadId, (msgs) => [
            ...msgs,
            { id: mkId(), role: 'bot', pending: false, rendered: {
              kind:           'responder-card',
              messageId:      null,
              threadId:       null,
              lifecycleState: 'live',
              itemId:         data.itemId,
              fromAddr:       data.fromAddr,
              postText:       data.postText,
              body:           data.body,
              senderDisplay:  data.senderDisplay,
            }},
          ]));
        },
        updatePeerDisplay:     renamePeer,
      }),
      // embed-card bubbles (time-card +
      // file-card).  Calendar invites land as time-card with RSVP
      // buttons; file-shares as file-card with [Download] + [Save].
      'calendar-invite':       makeHandleCalendarInvite({
        callSkill, addMainBubble, publishEvent,
      }),
      'file-share':            makeHandleFileShare({
        addMainBubble, publishEvent,
      }),
      // SILENT out-of-circle delivery — a peer pushed a sealed COPY straight to us; persist it into the
      // per-user "shared with me" store (the launcher's Mij inbox lists + opens it with this device's own
      // network-derived sealing key). web≡mobile: SAME handler + store web registers in circleApp.js. Guarded
      // — with no store on the bundle (older boot) the subtype simply isn't routed.
      ...(sharedWithMeStore
        ? { 'shared-copy': makeHandleSharedCopy({ store: sharedWithMeStore, publishEvent }) }
        : {}),
      // ε.1 — kring chat-message: routes through the shared inbox
      // (App.js owns the singleton).  The inbox handles envelope
      // validation, msgId dedup, ingest mirror into stoop's itemStore
      // (mute/eviction filtered), and the eventLog append that drives
      // the GESPREK tab bubbles.  Same dedup state as the boot
      // rehydrator so a chat already in itemStore can't double-render.
      // If no inbox was wired (older standalone tests) we fall back to
      // a private one so existing wiring keeps working.
      'kring-chat-message':    makeKringChatPeerHandler({
        inbox: kringChatInbox ?? makeFallbackInbox(eventLogRef.current, callSkill),
      }),
      // Delivery honesty — the peer's app stored our message. The shared receiver validates (rebuilt,
      // `from` off the wire), resolves the message's circle off the log, and only lets someone the
      // circle's ROSTER knows advance it; the map's monotonic rule then orders it. Absent map ⇒ the
      // handler is a no-op, as before. Fire-and-forget: reading the roster is a skill call and the peer
      // router does not await its handlers, so a slow read delays the bubble, never the receive loop.
      'delivery-receipt': (from, payload) => { applyIncomingReceipt?.(payload, from); },
      // γ-next.recipe — kring scherm recipe broadcast.  Caches the
      // inbound recipe per-kring; the editor pulls on next open and
      // passes via γ.3's `incomingRecipe` opt.  No bubble UI.
      ...(kringRecipePendingStore ? {
        'kring-recipe-broadcast': makeKringRecipePeerHandler({
          pendingStore: kringRecipePendingStore,
          dedup:        kringRecipeDedup,
        }),
      } : {}),
      // γ-next.rules — kring rules document broadcast.  Caches the
      // inbound rules doc per-kring; the rules editor pulls on next
      // open and passes via γ.4's `incomingRules` opt.  No bubble UI.
      ...(kringRulesPendingStore ? {
        'kring-rules-broadcast': makeKringRulesPeerHandler({
          pendingStore: kringRulesPendingStore,
          dedup:        kringRulesDedup,
        }),
      } : {}),
      // γ-next.policy — kring circlePolicy broadcast.  Caches the
      // inbound policy doc per-kring; the settings editor pulls on
      // next open and passes via γ.4's `incomingPolicy` opt.  No
      // bubble UI.  Completes the γ-next trio (recipe / rules / policy).
      ...(kringPolicyPendingStore ? {
        'kring-policy-broadcast': makeKringPolicyPeerHandler({
          pendingStore: kringPolicyPendingStore,
          dedup:        kringPolicyDedup,
        }),
      } : {}),
      // Wave C tail A — ingest fanned governance/report events into the one log so a
      // vote/report raised on another device replicates here (deduped by the stable id).
      // notify: an in-app nudge when a decision OPENS (governanceWakeHint gates to propose).
      'kring-governance-broadcast': makeKringGovernancePeerHandler({
        eventLog: eventLogRef.current,
        notify: (circleId, event) => {
          try {
            eventLogRef.current?.append({
              id: `gov-notif-${governanceEntryId(event)}`, ts: Date.now(), app: 'basis', type: 'notification', circleId,
              payload: { message: t('circle.governance.notify_vote_opened', { action: t(`circle.governance.action.${event.action}`) }) },
            });
          } catch { /* best-effort */ }
        },
      }),
      'kring-report-broadcast':     makeKringReportPeerHandler({ eventLog: eventLogRef.current }),
    };
    const defaultHandler = makeHandleChatMessage({
      ensureDmThread:    handleDmThreadOpen,
      appendBubble,
      updatePeerDisplay: renamePeer,
      t,
    });
    // ε.3 (2026-06-01) — `makeRequestCatchUpFromKnownPeers` now routes
    // each kring through `scheduleCatchUp(policy.pod)`.  We pass the
    // App-owned `kringChatInbox` so the pod range-query path can route
    // results through the SAME inbox the receiver / rehydrator use
    // (shared LRU + ingest mirror = no double bubbles, even if a
    // catch-up batch overlaps a live NKN delivery).  `getCirclePolicy`
    // isn't threaded here yet — ChatScreen lives next to the launcher's
    // policyStore but doesn't read from it directly today — so all
    // kringen default to `{pod: 'personal'}` ⇒ 'peer' strategy until
    // the launcher's policy lookup is forwarded down (follow-up slice).
    // For pod:'shared' kringen the dispatcher would return 'deferred'
    // without that wiring, so the legacy peer path stays unchanged.
    const inboxForCatchUp = kringChatInbox ?? null;
    // ε.4 — the negotiated peer handler.  When the inbox is wired (=
    // launcher path) we route personal/none kringen through the new
    // coordinator + roster-driven knownPeers; otherwise the legacy
    // peer-poll path stays as fallback.
    const peerCatchUpNegotiated = catchUpReceiver
      ? async ({ circleId, sinceTs }) => {
          let roster = [];
          try {
            const r = await callSkill('stoop', 'listGroupRoster', { groupId: circleId });
            roster = Array.isArray(r?.members) ? r.members : [];
          } catch { /* empty */ }
          const knownPeers = roster.map((m) => m?.addr).filter(Boolean);
          // Feed the household no-pod sync roster with this circle's members, through the SHARED helper
          // both other call sites already use (web's `feedHouseholdRosterForCircle`, the mobile
          // launcher's circles-load). This was an inline copy, and it had drifted twice over: it called
          // `addCirclePeer(addr)` with ONE argument where the signature is
          // `addCirclePeer(circleId, addr)` — so peers read from THIS circle's roster were paired into
          // whatever circle happened to be active — and it skipped the resync + per-circle key binding
          // the shared helper also does. Logic that already exists in shared code is called, not
          // re-written (invariant 1).
          // Fire-and-forget, like the launcher's call: pairing must not delay the catch-up it precedes.
          feedHouseholdRoster({ agent, circleId }).catch(() => { /* best-effort */ });
          return catchUpReceiver.requestCatchUp({
            circleId,
            sinceTs:    Number.isFinite(sinceTs) ? sinceTs : 0,
            knownPeers,
            fromPeerAddr: '',
          });
        }
      : null;
    return {
      onPeerMessage:  makePeerRouter({ handlers, defaultHandler }),
      requestCatchUp: makeRequestCatchUpFromKnownPeers({
        callSkill, sendPeer,
        inbox: inboxForCatchUp,
        peerCatchUpNegotiated,
      }),
    };
  }, []);

  // Attach the peer-wiring once the App-booted bundle is ready.
  useEffect(() => {
    if (bootState.kind !== 'ready') return;
    const { agent, callSkill } = bootState.bundle;
    dlog.boot('attaching peer wiring', {
      transport:  bootState.bundle.transport,
      appOrigins: [...bootState.bundle.catalog.appOrigins],
      opCount:    bootState.bundle.catalog.opsById?.size ?? 0,
    });
    bootState.bundle.attachPeerWiring?.(buildPeerWiring({ agent, callSkill, contactChannel: bootState.bundle.contactChannel, pendingPeerRedeems: bootState.bundle.pendingPeerRedeems, pendingPersonaProps: bootState.bundle.pendingPersonaProps, sharedWithMeStore: bootState.bundle.sharedWithMeStore }));
  }, [bootState, buildPeerWiring]);

  // Auto-scroll on every new message in the active thread.
  useEffect(() => {
    if (activeMessages.length === 0) return;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd?.({ animated: true }));
  }, [activeMessages]);

  // Switching threads should reset the scroll to the bottom of the
  // newly-active thread.
  useEffect(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd?.({ animated: false }));
  }, [activeThreadId]);

  // Verify-summary push nudge (parity with web main.js) — on app FOREGROUND, self-poll the /control/
  // container via the feedback mount and fire a LOCAL notification (expo) for any unverified round.
  // No-op until the feedback mount + its verify pods exist (mirrors web pre-activation). AsyncStorage-deduped.
  useEffect(() => {
    const checkNudge = async () => {
      const mount = feedbackMountRef.current;
      if (!mount || activeThreadId == null) return;
      try {
        const raw = await AsyncStorage.getItem('fp.nudged');
        const seen = new Set(raw ? JSON.parse(raw) : []);
        const nudged = await mount.nudge(activeThreadId, {
          alreadyNudged: (r) => seen.has(r),
          notify: ({ round, message }) => presentLocalNotification({
            title: t('feedback.nudge_title'), body: message || t('feedback.nudge_body'), data: { round },
          }),
        });
        if (nudged?.length) { nudged.forEach((r) => seen.add(r)); await AsyncStorage.setItem('fp.nudged', JSON.stringify([...seen])); }
      } catch { /* best-effort; a nudge must never break the screen */ }
    };
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') checkNudge(); });
    checkNudge();
    return () => sub.remove();
  }, [activeThreadId]);

  /**
   * Run a dispatch through the pipeline + append a user/bot bubble pair
   * to the THREAD ACTIVE AT CALL TIME.  Re-renders patch the bot bubble
   * via updateMessages so the pending→resolved transition stays on the
   * thread where the dispatch originated, even if the user switches
   * threads mid-flight.
   *
   * @param {object} args
   * @param {object} args.dispatch    — already-resolved dispatch shape
   * @param {string} args.userText    — text for the user-bubble
   * @param {string} [args.threadId]  — explicit target thread (defaults to active at call time)
   */
  const dispatchAndAppend = useCallback(async ({
    dispatch, userText, sourceDispatch, threadId,
  }) => {
    if (bootState.kind !== 'ready') return;
    const targetThreadId = threadId ?? threadStateRef.current.activeThreadId;
    const userMsgId      = mkId();
    const botMsgId       = mkId();
    setThreadState((prev) => updateMessages(prev, targetThreadId, (msgs) => [
      ...msgs,
      { id: userMsgId, role: 'user', text: userText },
      { id: botMsgId,  role: 'bot',  pending: true },
    ]));
    setBusy(true);

    try {
      dlog.dispatch('resolved', {
        kind:      dispatch.kind,
        opId:      dispatch.opId,
        appOrigin: dispatch.appOrigin,
        args:      dispatch.args,
      });
      let rendered;
      let replyForRefresh = null;   // E3 — captured reply → itemRef for panel refresh
      if (dispatch.kind === 'ready') {
        // F1 (5.3) — bind item-creating dispatches to the open circle
        // so a task / post created while a circle is active lands in
        // that circle.  No-op unless a circle is active + verb is
        // add/post + no explicit scope was supplied.
        const scopedDispatch = scopeReadyDispatch(dispatch, getActiveCircle());
        // calendar outbound hook fires after a
        // successful calendar dispatch + fans out invite / RSVP
        // envelopes over NKN.  Same factory web uses.  Wrap
        // bundle.callSkill once + reuse in both branches below.
        const agentRef = bootState.bundle.agent;
        const calendarHook = makeCalendarOutboundHook({
          callSkill:       bootState.bundle.callSkill,
          sendPeer:        (addr, payload) => agentRef.sendPeerMessage(addr, payload),
          isPeerConnected: () => agentRef?.peer?.status === 'connected',
          publishEvent:    (e) => {
            if (!e || typeof e !== 'object') return;
            const evt = {
              ...e,
              id: e.id ?? `cal-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              ts: e.ts ?? Date.now(),
            };
            try { eventLogRef.current?.append?.(evt); } catch { /* defensive */ }
          },
        });
        const wrappedBundleCallSkill = async (origin, opId, args) => {
          const r = await bootState.bundle.callSkill(origin, opId, args);
          try { await calendarHook(origin, opId, args ?? {}, r); }
          catch (err) { dlog.warn('calendar-outbound hook failed', err?.message ?? err); }
          return r;
        };

        // basis host ops first try the mobile
        // localBuiltins port (lifted from web).  If no handler yet,
        // fall back to the explicit "not wired" bubble so the user
        // sees something actionable instead of a red error.
        if (dispatch.appOrigin === 'basis') {
          const handler = localBuiltins?.[dispatch.opId];
          if (!handler) {
            rendered = {
              kind: 'text',
              messageId: botMsgId,
              threadId: null,
              lifecycleState: 'closed',
              text: t('chat.basis_op_pending', { opId: dispatch.opId }),
            };
          } else {
            // Route through runDispatch so renderReply gets the
            // canonical reply shape (payload + shape + threadId).
            // route non-basis ops through
            // wrappedBundleCallSkill so the calendar outbound hook
            // fires for /addappt + /accept etc when they appear via
            // localBuiltins-routed dispatches.
            const wrappedCallSkill = async (origin, opId, args) => {
              if (origin === 'basis') return handler(args ?? {});
              return wrappedBundleCallSkill(origin, opId, args);
            };
            const reply = await runDispatch(scopedDispatch, wrappedCallSkill);
            replyForRefresh = reply;
            rendered = renderReply(reply, {
              t,
              appOrigin:         dispatch.appOrigin,
              manifestsByOrigin: bootState.bundle.manifestsByOrigin,
            });
          }
        } else {
          // wrappedBundleCallSkill fires the calendar outbound
          // hook after substrate writes succeed.
          const reply = await runDispatch(scopedDispatch, wrappedBundleCallSkill);
          replyForRefresh = reply;
          // M6 — surface the feedback assistant as a distinct 'agent' contact atop /contacts (mirrors web).
          const forRender = (dispatch.opId === 'listContacts' && !reply.error && Array.isArray(reply.items))
            ? { ...reply, items: [feedbackContactItem({
                label:     t('feedback.contactLabel', { defaultValue: 'Feedback assistant' }),
                openLabel: t('feedback.openChat',     { defaultValue: 'Open chat' }),
              }), ...reply.items] }
            : reply;
          rendered = renderReply(forRender, {
            t,
            appOrigin:         dispatch.appOrigin,
            manifestsByOrigin: bootState.bundle.manifestsByOrigin,
          });
        }
      } else if (dispatch.kind === 'bulk') {
        // E2 — `/done all`: resolve candidate ids from the freshest
        // list in this thread (prefer the same app), fan-out via
        // executeBulkDispatch, render the summary.  Mobile has no
        // filter-router, so cross-thread propagation is the action
        // fan-out itself (mirrors web's runBulkOp) rather than an
        // EventRouter broadcast.
        const targetMsgs = listThreads(threadStateRef.current)
          .find((th) => th.id === targetThreadId)?.messages ?? [];
        const itemIds = lastListingItems(targetMsgs, { appOrigin: dispatch.appOrigin });
        if (itemIds.length === 0) {
          rendered = {
            kind: 'text', messageId: botMsgId, threadId: null,
            lifecycleState: 'closed', text: t('reply.bulk_no_list'),
          };
        } else {
          const { message } = await executeBulkDispatch({
            bulk:      dispatch,
            itemIds,
            callSkill: bootState.bundle.callSkill,
            opLabel:   dispatch.opId,
          });
          rendered = {
            kind: 'text', messageId: botMsgId, threadId: null,
            lifecycleState: 'closed', text: message,
          };
        }
      } else if (dispatch.kind === 'unknown') {
        rendered = {
          kind: 'error',
          messageId: botMsgId,
          threadId: null,
          lifecycleState: 'closed',
          error: { code: 'unknown-input', message: t('chat.unknown_input') },
          text: t('chat.unknown_input'),
        };
      } else {
        rendered = {
          kind: 'error',
          messageId: botMsgId,
          threadId: null,
          lifecycleState: 'closed',
          error: { code: dispatch.code ?? 'dispatch-error', message: dispatch.message ?? '' },
          text: dispatch.message ?? t('chat.dispatch_error'),
        };
      }

      dlog.render('rendered', {
        kind:        rendered.kind,
        itemCount:   rendered.items?.length ?? 0,
        buttonCount: (rendered.items ?? [])
          .reduce((n, it) => n + (it.buttons?.length ?? 0), 0),
      });

      // E3 — store the source on every refreshable-shape reply (lists +
      // record / mini-page / embed panels) so it can be re-fetched.  The
      // verb gate at refresh time still protects against re-running a
      // mutation-sourced panel.
      const REFRESHABLE_SHAPES = new Set(['list', 'record', 'mini-page', 'embed-card']);
      const trackedSource = (REFRESHABLE_SHAPES.has(rendered.kind) && sourceDispatch)
        ? sourceDispatch
        : null;
      setThreadState((prev) => {
        let next = updateMessages(prev, targetThreadId, (msgs) => msgs.map((m) =>
          m.id === botMsgId
            ? { ...m, pending: false, rendered, sourceDispatch: trackedSource }
            : m,
        ));
        // Mirror the source on the THREAD only for lists (unchanged) so
        // the existing row-tap refresh path keeps its single source.
        if (trackedSource && rendered.kind === 'list') {
          next = setSourceDispatch(next, targetThreadId, trackedSource);
        }
        return next;
      });

      // E3 — when this dispatch was a MUTATION that changed an item,
      // auto-refresh any open record/mini-page/embed panel in OTHER
      // threads showing that item (mirrors web's onPanelStale path,
      // which excludes the dispatching thread).  Fire-and-forget.
      const verb = bootState.bundle.catalog?.opsById?.get(dispatch.opId)?.op?.verb;
      if (dispatch.kind === 'ready' && verb && !REFRESHABLE_VERBS.has(verb)) {
        const itemRef = itemRefFromReply(replyForRefresh, dispatch.appOrigin);
        if (itemRef) {
          autoRefreshStalePanels({
            itemRef,
            threads:           listThreads(threadStateRef.current),
            excludeThreadId:   targetThreadId,
            catalog:           bootState.bundle.catalog,
            manifestsByOrigin: bootState.bundle.manifestsByOrigin,
            callSkill:         bootState.bundle.callSkill,
            t,
            applyRefresh: (tid, mid, fresh) => setThreadState((prev) =>
              updateMessages(prev, tid, (msgs) => msgs.map((m) =>
                (m.id === mid ? { ...m, rendered: fresh } : m)))),
          }).catch((err) => dlog.warn('panel auto-refresh failed', err?.message ?? err));
        }
      }
    } catch (err) {
      dlog.warn('dispatch threw', err?.message ?? err);
      setThreadState((prev) => updateMessages(prev, targetThreadId, (msgs) => msgs.map((m) =>
        m.id === botMsgId
          ? {
              ...m,
              pending: false,
              rendered: {
                kind: 'error',
                messageId: botMsgId,
                threadId: null,
                lifecycleState: 'closed',
                error: { code: 'thrown', message: err?.message ?? String(err) },
                text: err?.message ?? String(err),
              },
            }
          : m,
      )));
    } finally {
      setBusy(false);
    }
  }, [bootState]);

  /** Bottom TextInput + SlashFAB path — parse free text then dispatch.
   *  When the active thread has a pending follow-up (step 4), the
   *  user's text completes it instead of parsing as a new command. */
  const submitInput = useCallback(async (rawInput) => {
    if (bootState.kind !== 'ready') return;
    const text = String(rawInput ?? '').trim();
    if (!text) return;

    const currentState     = threadStateRef.current;
    const currentThreadId  = currentState.activeThreadId;
    const currentThread    = currentState.threads.get(currentThreadId);
    const followUp         = currentThread?.pendingFollowUp ?? null;

    // 2026-05-27 — when the active thread is a DM (peerAddr set) and
    // the input isn't a slash command, route it as a chat-message
    // envelope over NKN.  Web does this in
    // `apps/basis/web/main.js`; mobile was missing
    // the path, which made [Start DM] + typing look broken.
    if (currentThread?.peerAddr && !text.startsWith('/')) {
      const peerAddr = currentThread.peerAddr;
      const userMsgId = mkId();
      setThreadState((prev) => updateMessages(prev, currentThreadId, (msgs) => [
        ...msgs,
        { id: userMsgId, role: 'user', text },
      ]));
      try {
        // 2026-05-27 — envelope shape must match what the receiver
        // chatMessage handler expects: `payload.body` (not `text`),
        // plus the top-level `type:'p2p-chat'` discriminator the web
        // peer-router uses (apps/basis/web/main.js:2398).
        await bootState.bundle.agent.sendPeerMessage(peerAddr, {
          type:    'p2p-chat',
          subtype: 'chat-message',
          body:    text,
          sentAt:  Date.now(),
        });
      } catch (err) {
        setThreadState((prev) => updateMessages(prev, currentThreadId, (msgs) => [
          ...msgs,
          { id: mkId(), role: 'bot', pending: false, rendered: {
            kind: 'text',
            messageId: null,
            threadId: null,
            lifecycleState: 'closed',
            text: t('chat.dm_send_failed', { error: err?.message ?? String(err) }),
          }},
        ]));
      }
      return;
    }

    // M6 — feedback bot (parity with web main.js). `/feedback` enters mode; free text while a
    // thread is active routes to the co-hosted bot; the mount echoes the user + renders the bot's
    // reply through the SAME setThreadState/updateMessages path the DM branch above uses.
    const fbAppendUser = (tid, x) => setThreadState((prev) => updateMessages(prev, tid, (msgs) => [
      ...msgs, { id: mkId(), role: 'user', text: x },
    ]));
    const fbAppendBot = (tid, x) => setThreadState((prev) => updateMessages(prev, tid, (msgs) => [
      ...msgs, { id: mkId(), role: 'bot', pending: false, rendered: {
        kind: 'text', messageId: null, threadId: tid, lifecycleState: 'closed', text: x,
      } },
    ]));
    // Real-pod ACTIVATION branch (`/feedback <code>`, parity with web main.js): own-pod-first verify
    // pods from the RN pod session. A bare `/feedback` (no code) falls through to the demo mount below.
    const fbCode = String(text).trim().match(/^\/feedback\s+(\S+)$/);
    if (fbCode && FEEDBACK_ACTIVATION_URL) {
      try {
        const { activateMobileFeedback } = await import('../v2/feedbackActivation.js');
        const pods = await activateMobileFeedback({ session: sessionRef.current, activationUrl: FEEDBACK_ACTIVATION_URL, projectId: FEEDBACK_PROJECT_ID, code: fbCode[1] });
        feedbackMountRef.current = createFeedbackMount({
          llmBaseURL: FEEDBACK_LLM_BASEURL,
        llmModel: FEEDBACK_LLM_MODEL, pod: pods.ownPod, centralPod: pods.centralPod, controlStore: pods.controlStore,
          appendUserBubble: fbAppendUser, appendBotBubble: fbAppendBot,
        });
        fbAppendUser(currentThreadId, String(text).trim());
        await feedbackMountRef.current.open(currentThreadId);
      } catch (e) {
        fbAppendBot(currentThreadId, e?.message === 'not-logged-in'
          ? t('feedback.login_first', { defaultValue: 'Log eerst in op je pod om mee te doen.' })
          : t('feedback.activation_failed', { error: e?.message ?? String(e), defaultValue: 'Activatie mislukt.' }));
      }
      return;
    }
    if (!feedbackMountRef.current) {
      feedbackMountRef.current = createFeedbackMount({
        llmBaseURL: FEEDBACK_LLM_BASEURL,
        llmModel: FEEDBACK_LLM_MODEL,
        appendUserBubble: fbAppendUser,
        appendBotBubble: fbAppendBot,
      });
    }
    if (await feedbackMountRef.current.tryHandle(text, currentThreadId)) return;

    // Multi-field follow-ups complete through the inline form bubble's
    // Submit button, NOT the text input.  If the user typed into the
    // input while a multi pending lives on the thread, treat it as a
    // fresh slash command and DON'T touch the pending state.
    if (followUp && followUp.kind === 'single') {
      dlog.dispatch('followup completing', {
        opId:     followUp.opId,
        param:    followUp.missingParam,
        threadId: currentThreadId,
      });
      const completed = completeFollowUp({ pending: followUp, text });
      const originId  = followUp.originMessageId;
      setThreadState((prev) => setPendingFollowUp(prev, currentThreadId, null));
      await dispatchAndAppend({
        dispatch: completed,
        userText: text,
        threadId: currentThreadId,
      });
      if (originId) {
        const refreshState  = threadStateRef.current;
        const refreshThread = refreshState.threads.get(currentThreadId);
        const origin = refreshThread?.messages.find((m) => m.id === originId);
        if (origin?.sourceDispatch) {
          const refreshed = await refreshList({
            sourceDispatch:    origin.sourceDispatch,
            catalog:           bootState.bundle.catalog,
            manifestsByOrigin: bootState.bundle.manifestsByOrigin,
            callSkill:         bootState.bundle.callSkill,
            t,
          });
          if (refreshed) {
            setThreadState((prev) => updateMessages(prev, currentThreadId, (msgs) =>
              msgs.map((m) => m.id === originId ? { ...m, rendered: refreshed } : m),
            ));
          }
        }
      }
      return;
    }

    const catalog  = bootState.bundle.catalog;
    const parsed   = parseInput(text, catalog);
    const dispatch = resolveDispatch(parsed, catalog);

    // slashes for wizard ops launch the modal directly
    // (mirrors web's pageSurfaceOpen path).  Without this the wizard
    // opIds would hit localBuiltins' "no handler" fallback.
    //
    // also fire on `needsForm`: some wizard ops
    // (/embed-time has title+when required) trip needsForm when the
    // slash has no flags.  The wizard collects + validates fields
    // itself, so launching it with whatever prefilledArgs we have is
    // the right move.
    if (wizardModalFor(dispatch.opId)
        && (dispatch.kind === 'ready' || dispatch.kind === 'needsForm')) {
      const prefill = dispatch.args ?? dispatch.prefilledArgs ?? {};
      setPendingWizard({ opId: dispatch.opId, args: prefill });
      return;
    }

    await dispatchAndAppend({
      dispatch,
      userText:       text,
      sourceDispatch: dispatch.kind === 'ready' ? snapshotSourceDispatch(dispatch) : null,
      threadId:       currentThreadId,
    });
  }, [bootState, dispatchAndAppend]);

  /** Row-button-tap path (steps 2 6 7). */
  const handleButtonTap = useCallback(async ({ opId, itemId, buttonLabel, originMessageId, embed, peerAddr }) => {
    if (bootState.kind !== 'ready') return;
    const currentState    = threadStateRef.current;
    const currentThreadId = currentState.activeThreadId;
    dlog.button('tap', { opId, itemId, buttonLabel, originMessageId, threadId: currentThreadId });

    // step 7 — special-case interception (respondToItem → spawn
    // a Help thread + park a follow-up; startDm → spawn a DM thread;
    // downloadFile → save-file if list-row carries inline bytes, else
    // friendly "not wired" bubble).  Mirrors web's onButtonTap short-
    // circuits in apps/basis/web/main.js. -followup-1
    // forwards item.embed so saveBase64File can run on phone.
    // M6 — the feedback 'agent' contact's action: enter feedback mode (not a peer DM).
    if (opId === 'openFeedback') {
      if (!feedbackMountRef.current) {
        feedbackMountRef.current = createFeedbackMount({
          llmBaseURL: FEEDBACK_LLM_BASEURL,
        llmModel: FEEDBACK_LLM_MODEL,
          appendUserBubble: (tid, x) => setThreadState((prev) => updateMessages(prev, tid, (msgs) => [...msgs, { id: mkId(), role: 'user', text: x }])),
          appendBotBubble:  (tid, x) => setThreadState((prev) => updateMessages(prev, tid, (msgs) => [...msgs, { id: mkId(), role: 'bot', pending: false, rendered: { kind: 'text', messageId: null, threadId: tid, lifecycleState: 'closed', text: x } }])),
        });
      }
      await feedbackMountRef.current.open(currentThreadId);
      return;
    }

    const intercept = interceptButtonTap({ opId, itemId, buttonLabel, t, embed, peerAddr });
    if (intercept.handled) {
      applyButtonSpecial(intercept, { originMessageId, sourceThreadId: currentThreadId });
      return;
    }

    // wizard launch for ops with a registered RN
    // modal (e.g. conflictDisputeWizard).  Mirrors web's
    // WIZARD_RENDERERS map in apps/basis/web/main.js
    // pageSurfaceOpen.  Pass `id` so wizard state machines that
    // read args.id (e.g. conflictDisputeState.initialState) get
    // the post id from the row tap.
    if (wizardModalFor(opId)) {
      setPendingWizard({ opId, args: { id: itemId } });
      return;
    }

    const catalog = bootState.bundle.catalog;
    const entry = catalog.opsById?.get(opId);
    if (!entry) {
      await dispatchAndAppend({
        dispatch: {
          kind: 'error',
          code: 'unknown-op',
          message: t('chat.dispatch_error'),
        },
        userText: buttonLabel,
        threadId: currentThreadId,
      });
      return;
    }
    const firstReq = (entry.op?.params ?? []).find(
      // 2026-05-27 — bind row's itemId to a `webid`-kind param too,
      // not just string/enum.  Without this, [Remove] on a contact
      // row hits the followup prompt asking the user to type their
      // own webid (which they don't know) — silently no-op.
      (p) => p?.required && (p.kind === 'string' || p.kind === 'enum' || p.kind === 'webid'),
    );
    const args = firstReq ? { [firstReq.name]: itemId } : { id: itemId };
    const parse = {
      kind: 'slash', opId, args, threadId: null,
      command: '(button)', body: itemId,
    };
    const dispatch = resolveDispatch(parse, catalog);

    if (dispatch.kind === 'needsForm') {
      // Try single-field first; fall back to multi-field form bubble
      // (step 6) when 2+ params are missing.
      const single = beginFollowUp({ dispatch, originMessageId, t });
      if (single) {
        const userMsgId = mkId();
        const botMsgId  = mkId();
        setThreadState((prev) => {
          let next = updateMessages(prev, currentThreadId, (msgs) => [
            ...msgs,
            { id: userMsgId, role: 'user', text: t('chat.button_tap', { label: buttonLabel, item: itemId }) },
            { id: botMsgId,  role: 'bot',  pending: false, rendered: {
              kind: 'text',
              messageId: botMsgId,
              threadId: null,
              lifecycleState: 'live',
              text: single.promptText,
            }},
          ]);
          next = setPendingFollowUp(next, currentThreadId, single);
          return next;
        });
        return;
      }
      const multi = beginFormFollowUp({ dispatch, originMessageId, t });
      if (multi) {
        const userMsgId = mkId();
        const formMsgId = mkId();
        setThreadState((prev) => {
          let next = updateMessages(prev, currentThreadId, (msgs) => [
            ...msgs,
            { id: userMsgId, role: 'user', text: t('chat.button_tap', { label: buttonLabel, item: itemId }) },
            // The form bubble is a synthetic message with a marker
            // `formPending` field; MessageBubble below renders it via
            // MultiFieldFormBubble.
            { id: formMsgId, role: 'bot', pending: false, formPending: multi },
          ]);
          next = setPendingFollowUp(next, currentThreadId, multi);
          return next;
        });
        return;
      }
    }

    await dispatchAndAppend({
      dispatch,
      userText: t('chat.button_tap', { label: buttonLabel, item: itemId }),
      threadId: currentThreadId,
    });

    // step 3 — refresh the originating list bubble in place.
    if (originMessageId) {
      const refreshState  = threadStateRef.current;
      const refreshThread = refreshState.threads.get(currentThreadId);
      const origin = refreshThread?.messages.find((m) => m.id === originMessageId);
      const sourceDispatch = origin?.sourceDispatch;
      if (sourceDispatch) {
        const refreshed = await refreshList({
          sourceDispatch,
          catalog,
          manifestsByOrigin: bootState.bundle.manifestsByOrigin,
          callSkill:         bootState.bundle.callSkill,
          t,
        });
        if (refreshed) {
          setThreadState((prev) => updateMessages(prev, currentThreadId, (msgs) =>
            msgs.map((m) => m.id === originMessageId ? { ...m, rendered: refreshed } : m),
          ));
        }
      }
    }
  }, [bootState, dispatchAndAppend]);

  const onSendPress = useCallback(async () => {
    const text = input;
    setInput('');
    await submitInput(text);
  }, [input, submitInput]);

  /**
   * Apply a button-special intercept (step 7).  Three action shapes:
   *   spawn-thread-with-followup — new thread, switch, park follow-up
   *   spawn-thread               — new thread + switch, no dispatch
   *   inline-text                — append bot bubble in current thread
   */
  const applyButtonSpecial = useCallback((intercept, { originMessageId, sourceThreadId }) => {
    if (!intercept?.handled) return;
    const userBubbleText = intercept.userBubble ?? '';
    if (intercept.kind === 'spawn-thread-with-followup') {
      setThreadState((prev) => {
        const { state: afterCreate, newId } = createThread(prev, { name: intercept.threadName });
        const userMsgId = mkId();
        const botMsgId  = mkId();
        const followUp = {
          ...intercept.followUp,
          originMessageId: originMessageId ?? null,
        };
        let next = updateMessages(afterCreate, newId, () => [
          { id: userMsgId, role: 'user', text: userBubbleText },
          { id: botMsgId,  role: 'bot', pending: false, rendered: {
            kind: 'text',
            messageId: botMsgId,
            threadId: null,
            lifecycleState: 'live',
            text: followUp.promptText,
          }},
        ]);
        next = setPendingFollowUp(next, newId, followUp);
        return next;
      });
      return;
    }
    if (intercept.kind === 'spawn-thread') {
      // 2026-05-27 — when the intercept carries a peerAddr (e.g.
      // [Start DM] on a contact row), route via ensureDmThread so
      // (a) the thread tags peerAddr — required for free-text →
      // chat-message routing + inbound peer-message landing, and
      // (b) re-tapping [DM] on the same peer reuses the existing
      // thread instead of spawning duplicates.
      if (typeof intercept.peerAddr === 'string' && intercept.peerAddr !== '') {
        setThreadState((prev) => {
          const { state: afterEnsure, threadId } = ensureDmThread(prev, {
            peerAddr: intercept.peerAddr,
            nameFallback: intercept.threadName,
          });
          const withActive = setActiveThread(afterEnsure, threadId);
          return updateMessages(withActive, threadId, (msgs) => [
            ...msgs,
            { id: mkId(), role: 'user', text: userBubbleText },
          ]);
        });
        return;
      }
      setThreadState((prev) => {
        const { state: afterCreate, newId } = createThread(prev, { name: intercept.threadName });
        const userMsgId = mkId();
        return updateMessages(afterCreate, newId, () => [
          { id: userMsgId, role: 'user', text: userBubbleText },
        ]);
      });
      return;
    }
    if (intercept.kind === 'inline-text') {
      setThreadState((prev) => updateMessages(prev, sourceThreadId, (msgs) => [
        ...msgs,
        { id: mkId(), role: 'user', text: userBubbleText },
        { id: mkId(), role: 'bot', pending: false, rendered: {
          kind: 'text',
          messageId: null,
          threadId: null,
          lifecycleState: 'closed',
          text: intercept.text,
        }},
      ]));
    }
    // followup-1: [Download] with an inline snapshot.
    // Drop the user bubble + a pending bot bubble immediately,
    // then replace the bot bubble's text once saveBase64File
    // resolves.  Pending state avoids the user staring at a
    // blank thread while expo-file-system writes the blob.
    if (intercept.kind === 'save-file') {
      const userMsgId = mkId();
      const botMsgId  = mkId();
      setThreadState((prev) => updateMessages(prev, sourceThreadId, (msgs) => [
        ...msgs,
        { id: userMsgId, role: 'user', text: userBubbleText },
        { id: botMsgId,  role: 'bot', pending: true, rendered: {
          kind: 'text',
          messageId: botMsgId,
          threadId: null,
          lifecycleState: 'live',
          text: t('chat.download_saving', { name: intercept.name }),
        }},
      ]));
      (async () => {
        const res = await saveBase64File({
          dataB64: intercept.dataB64,
          name:    intercept.name,
        });
        const finalText = res.ok
          ? t('chat.download_saved', { name: res.name, uri: res.uri })
          : t('chat.download_save_failed', { error: res.error });
        setThreadState((prev) => updateMessages(prev, sourceThreadId, (msgs) =>
          msgs.map((m) => m.id === botMsgId
            ? { ...m, pending: false, rendered: { ...m.rendered, text: finalText, lifecycleState: 'closed' } }
            : m,
          ),
        ));
      })();
    }
    // responder-card Accept / Decline /
    // Counter taps.  Accept fires acceptResponder + sends help-with-
    // accepted; Decline sends help-with-declined; Counter inline-
    // prompts the user.  All three drop the user bubble first, then
    // run the side-effect async, then drop a result bubble.
    if (intercept.kind === 'accept-responder') {
      const userMsgId = mkId();
      const botMsgId  = mkId();
      setThreadState((prev) => updateMessages(prev, sourceThreadId, (msgs) => [
        ...msgs,
        { id: userMsgId, role: 'user', text: userBubbleText },
        { id: botMsgId,  role: 'bot', pending: true, rendered: {
          kind: 'text',
          messageId: botMsgId,
          threadId: null,
          lifecycleState: 'live',
          text: t('responder.accepting'),
        }},
      ]));
      (async () => {
        let finalText;
        try {
          const result = await bootState.bundle.callSkill('stoop', 'acceptResponder', {
            requestId:      intercept.requestId,
            responderWebid: intercept.responderAddr,
          });
          if (result?.error) throw new Error(result.error);
          finalText = t('responder.accepted');
          // Fire help-with-accepted envelope.  Fail soft — the local
          // accept succeeded regardless.
          if (intercept.responderAddr) {
            try {
              await bootState.bundle.agent.sendPeerMessage(intercept.responderAddr, {
                type: 'p2p-chat', subtype: 'help-with-accepted',
                itemId: intercept.requestId,
                sentAt: Date.now(),
              });
            } catch { /* swallow — user sees the local success */ }
          }
        } catch (err) {
          finalText = t('responder.accept_failed', { error: err?.message ?? String(err) });
        }
        setThreadState((prev) => updateMessages(prev, sourceThreadId, (msgs) =>
          msgs.map((m) => m.id === botMsgId
            ? { ...m, pending: false, rendered: { ...m.rendered, text: finalText, lifecycleState: 'closed' } }
            : m,
          ),
        ));
      })();
    }
    if (intercept.kind === 'decline-responder') {
      setThreadState((prev) => updateMessages(prev, sourceThreadId, (msgs) => [
        ...msgs,
        { id: mkId(), role: 'user', text: userBubbleText },
        { id: mkId(), role: 'bot', pending: false, rendered: {
          kind: 'text',
          messageId: null,
          threadId: null,
          lifecycleState: 'closed',
          text: t('responder.declined'),
        }},
      ]));
      // Fire help-with-declined fire-and-forget.
      if (intercept.responderAddr && bootState.kind === 'ready') {
        bootState.bundle.agent.sendPeerMessage(intercept.responderAddr, {
          type: 'p2p-chat', subtype: 'help-with-declined',
          itemId: intercept.requestId,
          sentAt: Date.now(),
        }).catch(() => { /* swallow */ });
      }
    }
    if (intercept.kind === 'counter-responder') {
      setThreadState((prev) => updateMessages(prev, sourceThreadId, (msgs) => [
        ...msgs,
        { id: mkId(), role: 'user', text: userBubbleText },
        { id: mkId(), role: 'bot', pending: false, rendered: {
          kind: 'text',
          messageId: null,
          threadId: null,
          lifecycleState: 'closed',
          text: intercept.text,
        }},
      ]));
    }
  }, [t, bootState]);

  /**
   * Multi-field form Submit handler (step 6). Completes the
   * pending dispatch + replaces the form bubble with the user's filled
   * values shown as a user bubble, then runs the dispatch through the
   * normal pipeline.
   */
  const onFormSubmit = useCallback(async ({ pending, values, formMsgId, threadId }) => {
    const completed = completeMultiFieldFollowUp({ pending, values });
    // Render the submitted values as a user bubble in place of the
    // form (keeps the timeline coherent — user sees what they sent).
    const summary = pending.fields
      .map((f) => `${f.label}: ${values[f.name]}`)
      .join(' · ');
    setThreadState((prev) => {
      let next = updateMessages(prev, threadId, (msgs) => msgs.map((m) =>
        m.id === formMsgId
          ? { id: m.id, role: 'user', text: summary }
          : m,
      ));
      next = setPendingFollowUp(next, threadId, null);
      return next;
    });
    await dispatchAndAppend({
      dispatch: completed,
      userText: summary,
      threadId,
    });
    if (pending.originMessageId) {
      const refreshThread = threadStateRef.current.threads.get(threadId);
      const origin = refreshThread?.messages.find((m) => m.id === pending.originMessageId);
      if (origin?.sourceDispatch) {
        const refreshed = await refreshList({
          sourceDispatch:    origin.sourceDispatch,
          catalog:           bootState.bundle.catalog,
          manifestsByOrigin: bootState.bundle.manifestsByOrigin,
          callSkill:         bootState.bundle.callSkill,
          t,
        });
        if (refreshed) {
          setThreadState((prev) => updateMessages(prev, threadId, (msgs) =>
            msgs.map((m) => m.id === pending.originMessageId ? { ...m, rendered: refreshed } : m),
          ));
        }
      }
    }
  }, [bootState, dispatchAndAppend]);

  /** Drawer callbacks (step 5). */
  const onSwitchThread = useCallback((id) => {
    setThreadState((prev) => setActiveThread(prev, id));
    setDrawerOpen(false);
  }, []);
  const onCreateThreadFromDrawer = useCallback((name) => {
    setThreadState((prev) => createThread(prev, { name }).state);
    setDrawerOpen(false);
  }, []);

  const threads = useMemo(() => listThreads(threadState), [threadState]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID="chat-screen"
    >
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            onPress={() => setDrawerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t('threads.drawer_open_a11y')}
            testID="chat-drawer-open"
            style={styles.drawerBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.drawerBtnText}>☰</Text>
          </TouchableOpacity>
          <View style={styles.headerTitleBlock}>
            <Text style={styles.title}>{t('app.name')}</Text>
            <Text style={styles.activeThreadName} testID="chat-active-thread-name">
              {activeThread?.name ?? ''}
            </Text>
          </View>
        </View>
        <Text style={styles.tagline}>{t('app.tagline')}</Text>
        {bootState.kind === 'loading' && (
          <Text style={styles.status}>{t('boot.loading')}</Text>
        )}
        {bootState.kind === 'error' && (
          <Text style={styles.error}>
            {t('boot.boot_failed', { message: bootState.message })}
          </Text>
        )}
        {bootState.kind === 'ready' && (
          <TouchableOpacity
            onPress={() => setDebugOpen((v) => !v)}
            accessibilityRole="button"
            testID="chat-debug-toggle"
          >
            <Text style={styles.status} testID="chat-header-status">
              {t('boot.agents_ready')} — {navModels.length} apps
              {debugOpen ? ' ▼' : ' ▶'}
            </Text>
          </TouchableOpacity>
        )}
        {bootState.kind === 'ready' && debugOpen && (
          <View testID="chat-debug-list">
            {navModels.map(({ appOrigin, nav }) => (
              <View
                key={appOrigin}
                style={styles.appBlock}
                testID={`chat-app-row-${appOrigin}`}
              >
                <Text style={styles.appName}>{appOrigin}</Text>
                <Text style={styles.appMeta}>
                  {(nav.sections ?? []).length} sections,{' '}
                  {(nav.globals ?? []).length} globals
                </Text>
              </View>
            ))}
          </View>
        )}
        {/* ε.5 — "Catching up…" pill.  Visible while a negotiated
            catch-up is in flight; hides 1.5s after a terminal phase. */}
        {catchUpStatus && (
          <View testID="catch-up-indicator" style={styles.catchUpPill}>
            <Text style={styles.catchUpPillText}>
              {catchUpStatus.phase === 'streaming' && Number.isFinite(catchUpStatus.total) && catchUpStatus.total > 0
                ? t('circle.chat.catch_up.streaming_progress', {
                    count: catchUpStatus.count ?? 0,
                    total: catchUpStatus.total,
                  })
                : catchUpStatus.phase === 'done'
                  ? t('circle.chat.catch_up.done')
                  : catchUpStatus.phase === 'no-offers'
                    ? t('circle.chat.catch_up.no_offers')
                    : t('circle.chat.catch_up.requesting')}
            </Text>
          </View>
        )}
        {/* ε.5 — provider-side notification cards.  One per pending
            inbound catch-up-request from a non-known contact when
            policy.catchUpAutoApprove=false.  V1: minimal banner with
            mode-pick buttons; deeper UI in a follow-up slice. */}
        {catchUpNotifications.length > 0 && (
          <View testID="catch-up-notifications">
            {catchUpNotifications.map((n) => (
              <View key={n.requestId} style={styles.catchUpCard}>
                <Text style={styles.catchUpCardTitle}>
                  {t('circle.chat.catch_up.provider_request_title', {
                    name: (n.fromPeerAddr || '').slice(0, 12),
                    kring: n.groupId,
                  })}
                </Text>
                <Text style={styles.catchUpCardSize}>
                  {t('circle.chat.catch_up.provider_request_size', {
                    count: n.count,
                    kb: Math.max(1, Math.round((n.sizeBytes ?? 0) / 1024)),
                  })}
                </Text>
                <View style={styles.catchUpCardBtnRow}>
                  {[
                    { label: t('circle.chat.catch_up.provider_send_all'),     mode: 'all' },
                    { label: t('circle.chat.catch_up.provider_send_last_50'), mode: 'last-50' },
                    { label: t('circle.chat.catch_up.provider_send_last_7d'), mode: 'last-7-days' },
                    { label: t('circle.chat.catch_up.provider_decline'),     mode: null },
                  ].map((opt) => (
                    <TouchableOpacity
                      key={opt.label}
                      style={styles.catchUpCardBtn}
                      onPress={() => {
                        try {
                          catchUpProviderRef.current?.resolveCatchUpRequest?.({
                            requestId: n.requestId, mode: opt.mode,
                          }).catch(() => {});
                        } finally {
                          setCatchUpNotifications((prev) =>
                            prev.filter((x) => x.requestId !== n.requestId));
                        }
                      }}
                    >
                      <Text style={styles.catchUpCardBtnText}>{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
      >
        {activeMessages.length === 0 ? (
          <Text style={styles.emptyState}>{t('chat.no_messages_yet')}</Text>
        ) : (
          activeMessages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              onButtonTap={handleButtonTap}
              onFollowUpTap={(slash) => submitInput(slash)}
              onQuickReplyTap={(slash) => submitInput(slash)}
              onExpandRecord={(r) => setExpandedRecord(r)}
              manifestsByOrigin={bootState.kind === 'ready' ? bootState.bundle.manifestsByOrigin : undefined}
              media={media}
              onFormSubmit={(values) => onFormSubmit({
                pending:   msg.formPending,
                values,
                formMsgId: msg.id,
                threadId:  activeThreadId,
              })}
            />
          ))
        )}
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={pendingFollowUp?.promptText ?? t('chat.placeholder')}
          editable={bootState.kind === 'ready' && !busy}
          onSubmitEditing={onSendPress}
          returnKeyType="send"
          blurOnSubmit={false}
          testID="chat-input"
        />
        <TouchableOpacity
          onPress={onSendPress}
          disabled={bootState.kind !== 'ready' || busy || !input.trim()}
          style={[
            styles.sendBtn,
            (bootState.kind !== 'ready' || busy || !input.trim()) && styles.sendBtnDisabled,
          ]}
          accessibilityRole="button"
          testID="chat-send"
        >
          <Text style={styles.sendBtnText}>{t('chat.send')}</Text>
        </TouchableOpacity>
      </View>

      {bootState.kind === 'ready' && (
        <SlashFAB
          catalog={bootState.bundle.catalog}
          onDispatch={submitInput}
        />
      )}

      <ThreadDrawer
        threads={threads}
        activeThreadId={activeThreadId}
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSwitchThread={onSwitchThread}
        onCreateThread={onCreateThreadFromDrawer}
      />

      {/* wizard modal launched by a row-button tap.
          The component is resolved from wizardRegistry by opId; the
          state machine + submitDispute live in the portable
          src/core/wizards/*State.js (shared with web). */}
      {pendingWizard ? (() => {
        const WizardComponent = wizardModalFor(pendingWizard.opId);
        if (!WizardComponent) return null;
        return (
          <WizardComponent
            visible={true}
            args={pendingWizard.args}
            callSkill={bootState.kind === 'ready' ? bootState.bundle.callSkill : undefined}
            t={t}
            // joinGroupWizard's cross-instance
            // fallback (membershipCode-with-adminPeerAddr).  Constructed
            // inline so it closes over the live agent + pendingMap.
            // OBJ-2 — the BUNDLE's shared sender (same pending-map the response handler resolves against,
            // and the same one the v2 launcher uses), so classic + v2 joins both correlate.
            sendPeerRedeem={bootState.kind === 'ready' ? bootState.bundle.sendPeerRedeem : undefined}
            // J-CP1 — be on the circle's endpoint BEFORE the redeem (same seams the v2 launcher passes).
            // This host is where a TAPPED INVITE LINK lands, and it is precisely the host that has NOT been
            // told which relay the invite names: without these two the redeem goes out over whatever
            // transport this device happens to have, waits out a handshake timeout, and the join fails or
            // crawls. Only consumed by JoinGroupWizardModal; other wizards ignore them.
            dialEndpoint={(url) => bootState.kind === 'ready'
              ? bootState.bundle.reconnectPeer?.({ relayUrl: url })
              : undefined}
            activeEndpointUrl={() => bootState.kind === 'ready'
              ? (bootState.bundle.activeRelayUrl?.() ?? null)
              : null}
            // Post-join reachability (G13). Only consumed by JoinGroupWizardModal; other wizards ignore it.
            //
            // This host is where a TAPPED INVITE LINK lands, and it passed neither of the two things a join
            // has to do to make the new member reachable — register this device's per-circle address for the
            // circle, and bind the other members' addresses to their keys. Both used to hang off the
            // launcher screen, so joining from here left the member on the roster at an address their own
            // device had never registered: unreachable until the app was relaunched (found 2026-07-30).
            onJoined={bootState.kind === 'ready'
              ? async (a) => {
                try { await bootState.bundle.onCircleJoined(a); } finally {
                  // …and tell the launcher its list is stale. Separate from reachability on purpose: a
                  // circle you cannot see is a different failure from one nobody can reach you in, and
                  // fixing only the second still leaves you unable to open what you just joined.
                  onCirclesChanged?.();
                }
              }
              : undefined}
            // /create-group success-screen embeds the admin's NKN
            // address into the invite URL so the joiner can peer-
            // redeem when their substrate has no local copy of the
            // code (cross-device flow).
            getMyPeerAddr={() => bootState.kind === 'ready'
              ? (bootState.bundle.agent?.peer?.address ?? null)
              : null}
            // N1+E8 — persist the create wizard's chosen policy (incl. the
            // buurt chat-off default) onto the new circle, reusing the same
            // AsyncStorage policy store the launcher reads.  Only consumed
            // by CreateGroupWizardModal; other wizards ignore it.
            persistPolicy={(groupId, patch) => policyStoreRef.current?.update(groupId, patch)}
            // Bundle I (2026-05-27) — settings modal pod + relay
            // sections.  Only consumed by SettingsWizardModal; other
            // wizards ignore the unknown props.
            podAuth={podAuth}
            agent={bootState.kind === 'ready' ? bootState.bundle.agent : undefined}
            onSignOut={async () => {
              try { await sessionRef.current?.clear?.(); } catch { /* best-effort */ }
              try { await onSessionChanged?.(); } catch { /* best-effort */ }
            }}
            onClose={() => setPendingWizard(null)}
            onDispatched={(reply) => {
              // Land a confirmation bubble in the originating thread,
              // mirroring web's pageSurfaceOpen.onDispatched.
              //
              // 2026-05-27 (Bundle I).  Wizards may emit a
              // `kind:'record'` reply with `payload:{...}` so we can
              // render the success-screen with QR + fields (the path
              // /create-group now uses to surface its invite URL).
              // Fall back to plain text for legacy wizards.
              const followUps = Array.isArray(reply?.followUps) ? reply.followUps : undefined;
              if (reply?.kind === 'record' && reply.payload && typeof reply.payload === 'object') {
                const fields = Object.entries(reply.payload)
                  .filter(([k]) => !k.startsWith('_'))
                  .map(([name, value]) => ({
                    name, value,
                    kind: (typeof value === 'string' && isQrUri(value)) ? 'qr' : 'string',
                  }));
                setThreadState((prev) => updateMessages(prev, activeThreadId, (msgs) => [
                  ...msgs,
                  { id: mkId(), role: 'bot', pending: false, rendered: {
                    kind: 'record',
                    messageId: null,
                    threadId: null,
                    lifecycleState: 'closed',
                    title:  reply.title ?? reply.message ?? '',
                    fields,
                    followUps,
                  }},
                ]));
                return;
              }
              const text = reply?.message ?? '';
              if (text) {
                setThreadState((prev) => updateMessages(prev, activeThreadId, (msgs) => [
                  ...msgs,
                  { id: mkId(), role: 'bot', pending: false, rendered: {
                    kind: 'text',
                    messageId: null,
                    threadId: null,
                    lifecycleState: 'closed',
                    text,
                    followUps,
                  }},
                ]));
              }
            }}
          />
        );
      })() : null}

      {/* logs side-panel. EventLog is created at
          mount and accumulates `publishEvent` deliveries from the
          booted agent. */}
      <LogsPanel
        visible={logsPanelOpen}
        eventLog={eventLogRef.current}
        onClose={() => setLogsPanelOpen(false)}
        t={t}
      />

      {/* E5 — record/mini-page "⤢ Open in full" detail modal. */}
      <RecordDetailModal
        visible={!!expandedRecord}
        record={expandedRecord}
        onClose={() => setExpandedRecord(null)}
        t={t}
      />

      {/* QR scanner (2026-05-27).  /scan-qr opens this; the modal
          classifies the scanned text and routes by kind:
          - 'contact' → callSkill('stoop','addContactFromQr',{payload})
          - 'invite'  → setPendingWizard({opId:'joinGroup', args:{invite:payload}}) */}
      <QrScannerModal
        visible={qrScannerOpen}
        onClose={() => setQrScannerOpen(false)}
        onResult={(res) => onQrScanResult(res)}
        t={t}
      />

      {/* Extension install consent sheet (feedback-extension mobile parity). */}
      <ExtensionConsentSheet result={consentResult} onAdd={confirmExtInstall} onDecline={declineExtInstall} />

      {/* ε.6 — multi-offer catch-up chooser.  Only mounted while a
          chooseOffer() invocation is in flight; the resolver is
          stashed in pendingCatchUpResolverRef and settles the Promise
          the receiver is awaiting. */}
      {pendingCatchUpChoice ? (
        <CircleCatchUpChooserScreen
          visible
          offers={pendingCatchUpChoice.offers}
          circleId={pendingCatchUpChoice.circleId}
          circleName={pendingCatchUpChoice.circleId}
          onResolve={(decision) => {
            const r = pendingCatchUpResolverRef.current;
            if (typeof r === 'function') r(decision ?? { decline: true });
            else setPendingCatchUpChoice(null);
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );

  /**
   * Deliver a parked deep link, but only once the agent can serve the wizard behind it.
   *
   * Holding rather than dropping matters: the invite link is how most people arrive, and it is a cold start
   * by definition — the app was not running when they tapped it.
   */
  function drainPendingLink() {
    if (!bootReadyRef.current) return;
    const url = pendingLinkRef.current;
    if (!url) return;
    pendingLinkRef.current = null;
    onQrScanResult(classifyQrPayload(url, getBasisClassifiers()));
  }

  async function onQrScanResult(res) {
    setQrScannerOpen(false);
    if (!res || res.kind === 'unknown') {
      appendBotText(t('chat.scan_unknown'));
      return;
    }
    const payload = res.payload;
    if (res.kind === 'contact') {
      // Call the stoop substrate skill that decodes the URL + adds the
      // contact in one round-trip.  Then synthesise a confirmation bubble.
      try {
        const reply = bootState.kind === 'ready'
          ? await bootState.bundle.callSkill('stoop', 'addContactFromQr', { payload })
          : null;
        if (reply?.error) appendBotText(t('chat.scan_failed', { error: reply.error }));
        else              appendBotText(t('chat.scan_contact_added'));
      } catch (err) {
        appendBotText(t('chat.scan_failed', { error: err?.message ?? String(err) }));
      }
      return;
    }
    if (res.kind === 'invite') {
      appendBotText(t('chat.scan_invite_open'));
      // opId MUST match the WIZARD_REGISTRY key ('joinGroupWizard',
      // not 'joinGroup') — wizardModalFor() looks it up by exact key,
      // and a mismatch silently renders nothing (the bug: /scan-qr of
      // a onderling-invite:// did nothing because 'joinGroup' wasn't a
      // registered wizard).
      setPendingWizard({ opId: 'joinGroupWizard', args: { invite: payload } });
      return;
    }
    appendBotText(t('chat.scan_unknown'));
  }

  function appendBotText(text) {
    setThreadState((prev) => updateMessages(prev, activeThreadId, (msgs) => [
      ...msgs,
      { id: mkId(), role: 'bot', pending: false, rendered: {
        kind: 'text',
        messageId: null,
        threadId: null,
        lifecycleState: 'closed',
        text,
      }},
    ]));
  }
}

/* ── message bubble ─────────────────────────────────────────────── */

// E1 — notification severity → left-accent colour.
const NOTIFICATION_ACCENTS = { info: '#4a78b0', success: '#3f8f5b', warning: '#b08a2e', error: '#b04a4a' };

// E1 — human-readable byte size (B / KB / MB / GB).
function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

function MessageBubble({ msg, onButtonTap, onFollowUpTap, onQuickReplyTap, onFormSubmit, onExpandRecord, manifestsByOrigin, media }) {
  if (msg.role === 'user') {
    return (
      <View style={[styles.bubble, styles.bubbleUser]} testID={`bubble-user-${msg.id}`}>
        <Text style={[styles.bubbleText, styles.bubbleUserText]}>{msg.text}</Text>
      </View>
    );
  }

  // step 6 — inline multi-field form bubble.
  if (msg.formPending) {
    return (
      <MultiFieldFormBubble
        pending={msg.formPending}
        onSubmit={onFormSubmit}
      />
    );
  }

  if (msg.pending) {
    return (
      <View style={[styles.bubble, styles.bubbleBot]}>
        <Text style={[styles.bubbleText, styles.bubblePending]}>
          {t('chat.thinking')}
        </Text>
      </View>
    );
  }

  const r = msg.rendered ?? {};
  if (r.kind === 'error') {
    return (
      <View style={[styles.bubble, styles.bubbleError]}>
        <Text style={styles.bubbleErrorText}>
          {r.text ?? r.error?.message ?? t('chat.dispatch_error')}
        </Text>
      </View>
    );
  }
  if (r.kind === 'list') {
    const items   = r.items ?? [];
    const enabled = r.lifecycleState !== 'disabled' && typeof onButtonTap === 'function';
    return (
      <View
        style={[styles.bubble, styles.bubbleBot, styles.bubbleList]}
        testID={`bubble-bot-list-${msg.id}`}
      >
        {items.length === 0 ? (
          <Text style={styles.bubbleText}>{t('chat.list_empty')}</Text>
        ) : (
          items.map((item) => (
            <ListItemRow
              key={item.id}
              item={item}
              enabled={enabled}
              onButtonTap={onButtonTap}
              originMessageId={msg.id}
            />
          ))
        )}
      </View>
    );
  }
  // embed-card render branch. Surfaces
  // time-card (calendar-invite) + file-card (file-share / folio
  // /embed-file) bubbles with manifest-driven action buttons
  // (Accept / Decline / Tentative on time-card; Download / Save to
  // my pod on file-card).  Buttons compute via portable
  // `computeEmbedButtons`; tap path matches list items so the
  // existing `interceptButtonTap` save-file shortcut fires
  // on [Download].
  if (r.kind === 'embed-card') {
    // Media mobile twin (2026-07) — the media-card variant mirrors web's
    // domAdapter dispatch (variant = embed.kind): the sealed-media chip
    // renders its own bubble; every other variant keeps EmbedCardBubble.
    if (r.embed?.kind === 'media-card') {
      return (
        <MediaCardBubble
          msg={msg}
          rendered={r}
          onButtonTap={onButtonTap}
          manifestsByOrigin={manifestsByOrigin}
          mediaOpener={media?.opener}
        />
      );
    }
    return (
      <EmbedCardBubble
        msg={msg}
        rendered={r}
        onButtonTap={onButtonTap}
        manifestsByOrigin={manifestsByOrigin}
      />
    );
  }
  // C2 follow-up (2026-05-27) — record render branch.  Was falling
  // through to empty text bubble for skills returning `reply:'record'`
  // (e.g. /share-my-contact, /pod-status, /folio-status).  Renders
  // title + each `{name, value}` field.  For QR-payload values
  // (onderling-contact://, onderling-invite://) the value is rendered as a
  // real scannable QR via @onderling/react-native/qr/view + the raw URL
  // as selectable text underneath (Phase 1 of mobile QR slice).
  if (r.kind === 'record') {
    const fields = Array.isArray(r.fields) ? r.fields : [];
    const recFollowUps = Array.isArray(r.followUps) ? r.followUps : null;
    return (
      <View style={[styles.bubble, styles.bubbleBot, styles.bubbleList]} testID={`bubble-bot-record-${msg.id}`}>
        {/* E5 — header row: title + "⤢ Open in full" detail affordance. */}
        {(r.title || recordCanExpand(r)) && (
          <View style={styles.recordHeaderRow}>
            {r.title ? <Text style={[styles.briefSectionLabel, styles.recordHeaderTitle]}>{r.title}</Text> : <View style={{ flex: 1 }} />}
            {recordCanExpand(r) && typeof onExpandRecord === 'function' && (
              <Pressable
                onPress={() => onExpandRecord(r)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('chat.nav.openInFull')}
                testID={`record-expand-${msg.id}`}
              >
                <Text style={styles.recordExpandIcon}>⤢</Text>
              </Pressable>
            )}
          </View>
        )}
        {fields.length === 0 ? (
          <Text style={[styles.bubbleText, styles.bubblePending]}>{t('chat.record_empty')}</Text>
        ) : (
          fields.map((f, i) => {
            const valueIsQr = typeof f.value === 'string' && isQrUri(f.value);
            return (
              <View key={`${f.name}-${i}`} style={styles.recordFieldRow}>
                <Text style={styles.recordField} selectable={true}>
                  <Text style={styles.recordFieldName}>{f.name}: </Text>
                  <Text>{typeof f.value === 'string' ? f.value : JSON.stringify(f.value)}</Text>
                </Text>
                {valueIsQr && (
                  <View style={styles.recordQrFrame}>
                    <QrCodeView value={f.value} size={200} />
                  </View>
                )}
              </View>
            );
          })
        )}
        {recFollowUps && recFollowUps.length > 0 && (
          <View style={styles.followUpRow}>
            {recFollowUps.map((slash, i) => (
              <Pressable key={`${slash}-${i}`} style={styles.followUpChip} onPress={() => onFollowUpTap?.(slash)}>
                <Text style={styles.followUpChipText}>{slash}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    );
  }
  // A3 follow-up (2026-05-27) — /brief render branch.  Was falling
  // through to empty text bubble; now renders sections (or the
  // emptyMessage when every app had nothing to brief).
  if (r.kind === 'brief') {
    const sections = Array.isArray(r.sections) ? r.sections : [];
    if (sections.length === 0) {
      return (
        <View style={[styles.bubble, styles.bubbleBot]}>
          <Text style={[styles.bubbleText, styles.bubblePending]}>
            {r.emptyMessage ?? t('chat.brief_empty')}
          </Text>
        </View>
      );
    }
    return (
      <View style={[styles.bubble, styles.bubbleBot, styles.bubbleList]} testID={`bubble-bot-brief-${msg.id}`}>
        {sections.map((s, i) => (
          <View key={`${s.appOrigin ?? 'sec'}-${i}`} style={{ marginBottom: i < sections.length - 1 ? 8 : 0 }}>
            <Text style={styles.briefSectionLabel}>{s.label ?? s.appOrigin}</Text>
            {typeof s.payload?.message === 'string' && (
              <Text style={styles.bubbleText}>{s.payload.message}</Text>
            )}
            {Array.isArray(s.payload?.items) && s.payload.items.slice(0, 5).map((it) => (
              <Text key={String(it.id)} style={styles.listRowLabel}>· {it.label ?? it.id}</Text>
            ))}
          </View>
        ))}
      </View>
    );
  }
  // E1 (§B#5) — notification bubble.  Title (optional) + body, with a
  // left accent bar colour-keyed by severity level.
  if (r.kind === 'notification') {
    const accent = NOTIFICATION_ACCENTS[r.level] ?? NOTIFICATION_ACCENTS.info;
    return (
      <View
        style={[styles.bubble, styles.bubbleBot, styles.bubbleNotification, { borderLeftColor: accent }]}
        testID={`bubble-bot-notification-${msg.id}`}
      >
        {r.title ? <Text style={styles.notificationTitle}>{r.title}</Text> : null}
        <Text style={styles.bubbleText}>{r.text ?? ''}</Text>
      </View>
    );
  }
  // E1 (§B#5) — file card: name + meta line (type · size) + optional desc.
  if (r.kind === 'file') {
    const metaBits = [];
    if (r.mime) metaBits.push(r.mime);
    if (typeof r.size === 'number') metaBits.push(formatFileSize(r.size));
    return (
      <View style={[styles.bubble, styles.bubbleBot, styles.bubbleFile]} testID={`bubble-bot-file-${msg.id}`}>
        <Text style={styles.fileName}>{r.name || t('chat.file.unnamed')}</Text>
        {metaBits.length > 0 ? <Text style={styles.fileMeta}>{metaBits.join(' · ')}</Text> : null}
        {r.description ? <Text style={styles.bubbleText}>{r.description}</Text> : null}
      </View>
    );
  }
  // responder-card from inbound
  // help-with-response.  Three buttons: Accept (substrate call +
  // help-with-accepted envelope), Decline (help-with-declined),
  // Counter (inline prompt).  Tap routes via onButtonTap →
  // buttonSpecials → applyButtonSpecial.
  if (r.kind === 'responder-card') {
    return (
      <ResponderCardBubble
        msg={msg}
        rendered={r}
        onButtonTap={onButtonTap}
      />
    );
  }
  // (feedback-extension) — curation before/after bubble. Mirrors the
  // web `kind:'curation'` render from the SAME shared view model (renderer
  // emits { changed, sides:{before,after}, changedPaths }).  Presentational
  // only: a changed/unchanged tag, the two versions stacked (objects are
  // JSON-stringified, strings shown as-is), and the changed paths as a
  // caption.  testIDs let Detox target the bubble + each side.
  if (r.kind === 'curation') {
    const sides = r.sides ?? {};
    const stringify = (v) =>
      typeof v === 'string' ? v
      : v == null ? ''
      : JSON.stringify(v, null, 2);
    const paths = Array.isArray(r.changedPaths) ? r.changedPaths : [];
    return (
      <View
        style={[styles.bubble, styles.bubbleBot, styles.bubbleList, styles.bubbleCuration]}
        testID="curation-bubble"
      >
        <View style={[styles.curationTag, r.changed ? styles.curationTagChanged : styles.curationTagUnchanged]}>
          <Text style={[styles.curationTagText, r.changed ? styles.curationTagTextChanged : styles.curationTagTextUnchanged]}>
            {r.changed ? t('circle.curation.changed') : t('circle.curation.unchanged')}
          </Text>
        </View>
        <View style={styles.curationSide}>
          <Text style={styles.briefSectionLabel}>{t('circle.curation.before')}</Text>
          <Text style={styles.curationSideText} selectable={true} testID="curation-before">
            {stringify(sides.before)}
          </Text>
        </View>
        <View style={[styles.curationSide, styles.curationSideAfter]}>
          <Text style={styles.briefSectionLabel}>{t('circle.curation.after')}</Text>
          <Text style={styles.curationSideText} selectable={true} testID="curation-after">
            {stringify(sides.after)}
          </Text>
        </View>
        {paths.length > 0 && (
          <Text style={styles.curationPaths}>{paths.join(', ')}</Text>
        )}
      </View>
    );
  }
  const followUps   = Array.isArray(r.followUps) ? r.followUps : null;
  // α.5a (audit #3) — inline-keuze quick-reply pills under the bubble
  // text.  Each pill carries a full `{label, slash}`; tap dispatches
  // the slash through `submitInput`, the same path the TextInput's
  // Enter uses.  Suppressed when the bubble is `disabled` so a stale
  // bot reply can't re-fire mutations.
  const quickReplies = Array.isArray(r.quickReplies) ? r.quickReplies : null;
  const pillsEnabled = r.lifecycleState !== 'disabled';
  return (
    <View style={[styles.bubble, styles.bubbleBot]}>
      <Text style={styles.bubbleText}>{r.text ?? ''}</Text>
      {quickReplies && quickReplies.length > 0 && pillsEnabled && (
        <View style={styles.quickReplyRow} testID={`bubble-bot-quick-replies-${msg.id}`}>
          {quickReplies.map((qr, i) => (
            <Pressable
              key={`${qr.slash}-${i}`}
              style={styles.quickReplyChip}
              onPress={() => onQuickReplyTap?.(qr.slash)}
              accessibilityRole="button"
              accessibilityLabel={qr.label}
              testID={`bubble-bot-quick-reply-${msg.id}-${i}`}
            >
              <Text style={styles.quickReplyChipText}>{qr.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {followUps && followUps.length > 0 && (
        <View style={styles.followUpRow}>
          {followUps.map((slash, i) => (
            <Pressable
              key={`${slash}-${i}`}
              style={styles.followUpChip}
              onPress={() => onFollowUpTap?.(slash)}
            >
              <Text style={styles.followUpChipText}>{slash}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function ResponderCardBubble({ msg, rendered, onButtonTap }) {
  const enabled = rendered.lifecycleState !== 'disabled' && typeof onButtonTap === 'function';
  const itemId = rendered.itemId;
  const fromAddr = rendered.fromAddr;
  const tap = (opId, label) => onButtonTap?.({
    opId, itemId,
    buttonLabel: label,
    originMessageId: msg.id,
    extra: { fromAddr },
  });
  return (
    <View
      style={[styles.bubble, styles.bubbleBot, styles.bubbleResponderCard]}
      testID={`bubble-bot-responder-${msg.id}`}
    >
      <Text style={styles.responderHeader}>
        {t('responder.header_offer_of_help')}
      </Text>
      {rendered.postText ? (
        <Text style={styles.responderContext}>{rendered.postText}</Text>
      ) : null}
      <Text style={styles.responderBody}>{rendered.body}</Text>
      <View style={styles.responderButtons}>
        <TouchableOpacity
          onPress={() => tap('acceptResponder', t('responder.btn_accept'))}
          disabled={!enabled}
          style={[styles.responderBtn, styles.responderBtnPrimary, !enabled && styles.embedBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel={t('responder.btn_accept')}
          testID={`responder-btn-accept-${itemId}`}
        >
          <Text style={styles.embedBtnText}>{t('responder.btn_accept')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => tap('declineResponder', t('responder.btn_decline'))}
          disabled={!enabled}
          style={[styles.responderBtn, !enabled && styles.embedBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel={t('responder.btn_decline')}
          testID={`responder-btn-decline-${itemId}`}
        >
          <Text style={styles.embedBtnText}>{t('responder.btn_decline')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => tap('counterResponder', t('responder.btn_counter'))}
          disabled={!enabled}
          style={[styles.responderBtn, !enabled && styles.embedBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel={t('responder.btn_counter')}
          testID={`responder-btn-counter-${itemId}`}
        >
          <Text style={styles.embedBtnText}>{t('responder.btn_counter')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function EmbedCardBubble({ msg, rendered, onButtonTap, manifestsByOrigin }) {
  const embed = rendered.embed ?? {};
  const snap  = embed.snapshot ?? {};
  const enabled = rendered.lifecycleState !== 'disabled' && typeof onButtonTap === 'function';
  const buttons = computeEmbedButtons({ manifestsByOrigin, embed });

  const isFile = embed.kind === 'file-card';
  const isTime = embed.kind === 'time-card';

  const titleText = isFile
    ? (snap.name ?? snap.id ?? t('chat.embed_unnamed_file'))
    : isTime
      ? (snap.title ?? snap.id ?? t('chat.embed_untitled_event'))
      : (snap.id ?? embed.kind ?? 'embed');

  const detailLines = [];
  if (isFile) {
    if (typeof snap.mime  === 'string') detailLines.push(snap.mime);
    if (typeof snap.bytes === 'number') detailLines.push(formatBytes(snap.bytes));
    if (typeof snap.path  === 'string') detailLines.push(snap.path);
  } else if (isTime) {
    if (typeof snap.startAt === 'string') detailLines.push(snap.startAt);
    if (typeof snap.location === 'string') detailLines.push(snap.location);
  }

  return (
    <View
      style={[styles.bubble, styles.bubbleBot, styles.bubbleEmbedCard]}
      testID={`bubble-bot-embed-${msg.id}`}
    >
      <Text style={styles.embedTitle}>
        {isFile ? '📄 ' : isTime ? '📅 ' : ''}{titleText}
      </Text>
      {detailLines.length > 0 && (
        <Text style={styles.embedDetails}>{detailLines.join(' · ')}</Text>
      )}
      <EmbedActionButtons
        msg={msg}
        embed={embed}
        buttons={buttons}
        enabled={enabled}
        onButtonTap={onButtonTap}
      />
    </View>
  );
}

/** Manifest-driven embed action buttons — shared by EmbedCardBubble and
 *  MediaCardBubble (media) so the tap contract stays defined once. */
function EmbedActionButtons({ msg, embed, buttons, enabled, onButtonTap }) {
  if (!buttons || buttons.length === 0) return null;
  return (
    <View style={styles.embedButtons}>
      {buttons.map((btn) => (
        <TouchableOpacity
          key={btn.callbackData}
          onPress={() => onButtonTap?.({
            opId:    btn.opId,
            itemId:  btn.itemId,
            buttonLabel: btn.label,
            originMessageId: msg.id,
            embed,
          })}
          disabled={!enabled}
          style={[styles.embedBtn, !enabled && styles.embedBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel={btn.label}
          testID={`embed-btn-${btn.opId}-${btn.itemId}`}
        >
          <Text style={styles.embedBtnText}>{btn.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/**
 * Media mobile twin (2026-07) — the sealed-media chip, mirroring web's
 * renderMediaCard: sealed inline thumbnail (openThumbnail — no gate, no
 * fetch) when the composition supplies the opener; mime/dims placeholder
 * otherwise; enc hints WIN over the item's top-level hints (decided).
 * All of that logic lives in the pure model (src/core/mediaCardModel.js) —
 * this component only projects it.
 */
function MediaCardBubble({ msg, rendered, onButtonTap, manifestsByOrigin, mediaOpener }) {
  const embed = rendered.embed ?? {};
  const m = buildMediaCardModel(embed, { opener: mediaOpener });
  const enabled = rendered.lifecycleState !== 'disabled' && typeof onButtonTap === 'function';
  const buttons = computeEmbedButtons({ manifestsByOrigin, embed });
  return (
    <View
      style={[styles.bubble, styles.bubbleBot, styles.bubbleEmbedCard]}
      testID={`bubble-bot-media-${msg.id}`}
    >
      {m.thumbUri ? (
        <Image
          source={{ uri: m.thumbUri }}
          style={[styles.mediaThumb, m.thumbBox]}
          resizeMode="cover"
          accessibilityLabel={m.alt}
          testID={`media-thumb-${msg.id}`}
        />
      ) : (
        <View style={styles.mediaPlaceholder} testID={`media-placeholder-${msg.id}`}>
          <Text style={styles.mediaIcon}>🖼</Text>
          <Text style={styles.embedDetails}>{m.details}</Text>
        </View>
      )}
      {m.caption != null && (
        <Text style={styles.mediaCaption}>{m.caption}</Text>
      )}
      <EmbedActionButtons
        msg={msg}
        embed={embed}
        buttons={buttons}
        enabled={enabled}
        onButtonTap={onButtonTap}
      />
    </View>
  );
}

function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '?';
  if (n < 1024)         return `${n} B`;
  if (n < 1024 * 1024)  return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function ListItemRow({ item, enabled, onButtonTap, originMessageId }) {
  const buttons = Array.isArray(item.buttons) ? item.buttons : [];
  return (
    <View style={styles.listRow} testID={`list-row-${item.id}`}>
      <Text style={styles.listRowLabel}>{item.label ?? item.id}</Text>
      {typeof item.staleHint === 'string' && item.staleHint !== '' && (
        <Text style={styles.listRowStale}>{item.staleHint}</Text>
      )}
      {buttons.length > 0 && (
        <View style={styles.listRowButtons}>
          {buttons.map((btn, i) => {
            const [opId, ...rest] = String(btn.callbackData ?? '').split(':');
            const itemId = rest.join(':');
            const onPress = () => onButtonTap?.({
              opId, itemId,
              buttonLabel: btn.label,
              originMessageId,
              // followup-1: pass the per-row embed so the
              // [Download] short-circuit can reach an inline file
              // snapshot.  Undefined when the source item didn't
              // carry one — buttonSpecials handles that path.
              embed: item.embed,
              // 2026-05-27 — pass the contact's peer address so the
              // [DM] button-special can target it directly rather
              // than try to NKN-send to the stableId/webid.
              peerAddr: item.peerAddr,
            });
            return (
              <TouchableOpacity
                key={`${btn.callbackData}-${i}`}
                onPress={onPress}
                disabled={!enabled}
                style={[
                  styles.listRowBtn,
                  !enabled && styles.listRowBtnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel={btn.label}
                testID={`list-row-btn-${opId}-${itemId}`}
              >
                <Text
                  style={[
                    styles.listRowBtnText,
                    !enabled && styles.listRowBtnTextDisabled,
                  ]}
                >
                  {btn.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#fff' },
  header:     { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  drawerBtn:  { paddingVertical: 4, paddingHorizontal: 4 },
  drawerBtnText: { fontSize: 22, color: '#333' },
  headerTitleBlock: { flex: 1 },
  title:      { fontSize: 22, fontWeight: '700' },
  activeThreadName: { fontSize: 12, color: '#666', marginTop: 1 },
  tagline:    { fontSize: 13, color: '#666', marginTop: 2 },
  status:     { fontSize: 13, marginTop: 8 },
  error:      { fontSize: 13, marginTop: 8, color: '#b00' },
  appBlock:   { marginTop: 8, padding: 8, backgroundColor: '#f7f7f7', borderRadius: 6 },
  appName:    { fontSize: 14, fontWeight: '600' },
  appMeta:    { fontSize: 11, color: '#666', marginTop: 2 },

  // ε.5 — catch-up indicator + provider notification card.
  catchUpPill: {
    alignSelf: 'flex-start', marginTop: 6,
    backgroundColor: '#222', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  catchUpPillText: { color: '#fff', fontSize: 12 },
  catchUpCard: {
    marginTop: 8, padding: 10, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#ccc', borderRadius: 8,
  },
  catchUpCardTitle: { fontSize: 13, fontWeight: '600' },
  catchUpCardSize:  { fontSize: 12, color: '#555', marginTop: 2, marginBottom: 6 },
  catchUpCardBtnRow:{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catchUpCardBtn: {
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: '#f4f4f4', borderWidth: 1, borderColor: '#888', borderRadius: 6,
  },
  catchUpCardBtnText: { fontSize: 12 },

  messageList:        { flex: 1 },
  messageListContent: { padding: 12, gap: 8 },
  emptyState:         { textAlign: 'center', color: '#888', marginTop: 24, fontSize: 13 },

  bubble:           { maxWidth: '85%', padding: 10, borderRadius: 12, marginBottom: 4 },
  bubbleUser:       { backgroundColor: '#1e88e5', alignSelf: 'flex-end' },
  bubbleBot:        { backgroundColor: '#f0f0f0', alignSelf: 'flex-start' },
  bubbleError:      { backgroundColor: '#fde8e8', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#f5b5b5' },
  bubbleText:       { fontSize: 14, color: '#222' },
  bubblePending:    { fontStyle: 'italic', color: '#666' },
  bubbleErrorText:  { fontSize: 14, color: '#b00' },
  bubbleList:       { paddingVertical: 6 },
  // E1 — notification + file bubbles.
  bubbleNotification: { borderLeftWidth: 4, paddingLeft: 10 },
  notificationTitle:  { fontSize: 14, fontWeight: '700', color: '#333', marginBottom: 2 },
  bubbleFile:         { borderWidth: 1, borderColor: '#d9d9d9' },
  fileName:           { fontSize: 14, fontWeight: '600', color: '#333' },
  fileMeta:           { fontSize: 12, color: '#777', marginTop: 2 },

  listRow:         { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  listRowLabel:    { fontSize: 14, color: '#222' },
  listRowStale:    { fontSize: 11, color: '#888', marginTop: 2 },
  listRowButtons:  { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, gap: 6 },
  listRowBtn:      { backgroundColor: '#1e88e5', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14 },
  listRowBtnDisabled: { backgroundColor: '#ccc' },
  listRowBtnText:  { color: '#fff', fontSize: 12, fontWeight: '600' },
  listRowBtnTextDisabled: { color: '#666' },

  // embed-card (time-card + file-card).
  bubbleEmbedCard: { paddingVertical: 8, paddingHorizontal: 10, borderLeftWidth: 3, borderLeftColor: '#1e88e5' },
  embedTitle:      { fontSize: 15, fontWeight: '600', color: '#222' },
  embedDetails:    { fontSize: 12, color: '#666', marginTop: 2 },
  // Media mobile twin (2026-07) — the media-card chip.
  mediaThumb:       { borderRadius: 6, backgroundColor: '#eee' },
  mediaPlaceholder: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  mediaIcon:        { fontSize: 22, marginRight: 8 },
  mediaCaption:     { fontSize: 13, color: '#444', marginTop: 4 },
  embedButtons:    { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 6 },
  embedBtn:        { backgroundColor: '#1e88e5', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  embedBtnDisabled:{ backgroundColor: '#ccc' },
  embedBtnText:    { color: '#fff', fontSize: 12, fontWeight: '600' },

  // responder-card.
  bubbleResponderCard:  { paddingVertical: 8, paddingHorizontal: 10, borderLeftWidth: 3, borderLeftColor: '#f57c00' },
  responderHeader:      { fontSize: 14, fontWeight: '600', color: '#222' },
  responderContext:     { fontSize: 12, color: '#666', marginTop: 4, fontStyle: 'italic' },
  responderBody:        { fontSize: 14, color: '#222', marginTop: 6, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#ddd' },
  responderButtons:     { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 6 },
  responderBtn:         { backgroundColor: '#888', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  responderBtnPrimary:  { backgroundColor: '#1e88e5' },

  // A3 follow-up (2026-05-27) — brief render branch.
  briefSectionLabel:    { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 2 },

  // C2 follow-up (2026-05-27) — record render branch.
  recordFieldRow:       { marginTop: 4 },
  recordField:          { fontSize: 13, color: '#222', marginTop: 2 },
  recordFieldName:      { fontWeight: '600', color: '#555' },
  recordQrFrame:        { alignItems: 'center', marginTop: 8 },
  recordHeaderRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recordHeaderTitle:    { flex: 1, marginBottom: 0 },
  recordExpandIcon:     { fontSize: 16, color: '#1e88e5', paddingHorizontal: 4 },

  // (feedback-extension) — curation before/after bubble. Tag row +
  // two stacked side panels (the after panel left-accented to read as the
  // resolved version) + a muted changed-paths caption.  Monospace side
  // text so JSON-stringified objects stay legible.
  bubbleCuration:       { paddingHorizontal: 10 },
  curationTag:          { alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10, marginBottom: 6 },
  curationTagChanged:   { backgroundColor: '#fdeede' },
  curationTagUnchanged: { backgroundColor: '#eef0f2' },
  curationTagText:      { fontSize: 11, fontWeight: '700' },
  curationTagTextChanged:   { color: '#a86322' },
  curationTagTextUnchanged: { color: '#6a7177' },
  curationSide:         { marginBottom: 8 },
  curationSideAfter:    { borderLeftWidth: 3, borderLeftColor: '#3f8f5b', paddingLeft: 8 },
  curationSideText:     { fontSize: 13, color: '#222', marginTop: 2, fontFamily: 'monospace' },
  curationPaths:        { fontSize: 11, color: '#888', marginTop: 2, fontStyle: 'italic' },

  // C1 follow-up (2026-05-27) — followUp chip row under text bubbles.
  followUpRow:          { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, gap: 6 },
  followUpChip:         { paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#e8f0fe', borderRadius: 12, borderWidth: 1, borderColor: '#c7dafc' },
  followUpChipText:     { fontSize: 12, color: '#1a4fa0', fontFamily: 'monospace' },

  // α.5a (audit #3) — inline-keuze quick-reply pill row under text
  // bubbles.  Mirrors followUp chip metrics (same radius/padding) so
  // the visual grammar stays consistent; distinct backgroundColor +
  // testID prefix keeps the two surfaces independently targetable.
  quickReplyRow:        { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, gap: 6 },
  quickReplyChip:       { paddingVertical: 4, paddingHorizontal: 10, backgroundColor: '#eef7ee', borderRadius: 12, borderWidth: 1, borderColor: '#c5e3c5' },
  quickReplyChipText:   { fontSize: 12, color: '#2a6a2a' },

  inputBar:        { flexDirection: 'row', padding: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ddd', gap: 8, alignItems: 'center' },
  input:           { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14 },
  sendBtn:         { backgroundColor: '#1e88e5', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  sendBtnDisabled: { backgroundColor: '#bbb' },
  sendBtnText:     { color: '#fff', fontWeight: '600' },
});

styles.bubbleUserText = { ...styles.bubbleText, color: '#fff' };
