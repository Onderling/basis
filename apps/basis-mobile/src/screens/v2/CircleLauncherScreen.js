/**
 * basis-mobile v2 — circle launcher + detail screen (boards 1B / F1).
 *
 * Mobile counterpart of web's circleLauncher + circleDetail + circleApp,
 * over the same shared model ('@onderling-app/basis'). The launcher is
 * the app's default screen; the classic ChatScreen stays reachable via
 * "← chat". Opening a circle sets the active circle (F1) and shows an
 * inline scoped detail; "+ new circle" creates one via the existing
 * createGroupV2 path and refreshes.
 *
 * Data: with a `bundle` (callSkill) real circles + items + create work via
 * the shared helpers; otherwise the empty states show + create is a no-op.
 * Flagged for device verification.
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, BackHandler, Modal, Alert, findNodeHandle } from 'react-native';
import { useTheme } from './themeContext.js';
// The status bar overlaps a full-screen View on Android/iOS. Every screen in this file draws its own
// header bar at the very top of `styles.page`, so the inset belongs to that style — see `makeStyles`.
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
// Network-change sources for the Nearby re-announce. AppState is always available; netinfo is an OPTIONAL
// peer, so it is loaded defensively — a shell without it keeps foreground-return detection and simply loses
// the in-foreground Wi-Fi-switch case.
import { subscribeToNetworkChange as subscribeAppState, combineSources } from '@onderling/react-native';
import {
  loadCircles, circleSourcesFromAgent, makeResolvingCallSkill,
  loadCircleItems, quickCreateCircle, setActiveCircle, normalizeCircleMembers,
  circleFilesFromListFiles,
  // 1:1-bot chat gate — the assistant-header strip shows ONLY in a genuine 1:1-with-a-bot chat.
  oneToOneBotLabel,
  // per-kring feature-flag consumption.
  isFeatureEnabled,
  // §4 — admin's policy.view → default Chat/Scherm landing surface.
  defaultViewModeFromPolicy,
  // per-circle activity preview + unread badge.
  buildTilePreviews, bumpSeenAt,
  // claim-router hook (mirror claimed tasks to my own circle).
  makeAfterClaimHook,
  // Nearby model + label helpers (the action map + banner rule are SHARED with web — invariant 3).
  buildNearbyModel, NEARBY_ACTION_LABELS, NEARBY_ASK_LABELS, NEARBY_INVITE_LABELS,
  nearbyVisibilityKey, createNearbyScreen, POINT_SOURCE_LABELS,
  createConnectionPoints, adoptExistingRelay, asyncStorageConnectionPointsIo, recordJoinedCirclePoints,
  // "My things" private notes-list.
  myThingsFromListFiles,
  // kring-scoped event stream + per-row action chips.
  chatRows, actionsForStreamRow, resolveConversationKinds,
  // recognising an inbound CHAT entry for THIS circle — the same kind + the same circle-id read the
  // conversation projection itself uses, so the refresh cannot key off something the filter ignores.
  CHAT_KIND, eventCircleId,
  // P1.7 — the viewer's conversation filter (kinds × people/agents), shared model, device-local store.
  applyChatFilter, chatFilterChips, normalizeChatFilter, asyncStorageChatFilterIo,
  // "Never share my global address" — the publication lock (web parity).
  shareableAddress, asyncStorageAddressSharingIo,
  deliveryPresentation,
  // Taken (tasks) tab — task-store item → stream-row projection (shared web≡mobile).
  buildTaskRows,
  // per-kring bottom tabs from policy.features (v2 §1).
  buildKringTabs, DEFAULT_KRING_TAB,
  // D1 (§5A) — quickActions row: feature↔tab mapping + frequency counter.
  featureTabId, featureForTabId, createActionFrequencyStore,
  // α.1a/b — scherm recipe model + per-block materializer.
  getActiveRecipe, materializeRecipe, materializeBlock,
  // α.1d.3 — recipe-editor mutation helpers.
  addRecipe, renameRecipe, removeRecipe, setActiveRecipe,
  addBlock, removeBlock, moveBlock, updateBlock, updateRecipe,
  // α.2 — user-owned cross-kring screens + α.3 picker.
  createUserScreenStore, addScreen as addUserScreen,
  renameScreen as renameUserScreen, removeScreen as removeUserScreen,
  setActiveScreen, updateScreen, materializeScreen,
  // δ.2 — per-message delivery state for optimistic kring chat sends.
  createDeliveryStateMap,
  // Phase 2 — shared kring chat send primitives (optimistic event + best-effort fan-out).
  kringChatMessageEvent, broadcastKringFanOut,
  // Phase 3 — the shared circle label→candidate lookup (base items + app-qualified live fetch).
  makeCircleLookup,
  // Composer parity — the classic shell's slash-command suggest, shared so mobile renders the same set.
  suggestCommands,
  // Conversational follow-up for needsForm (shared) — ask for a missing field, next message answers.
  // beginFormFollowUp/completeMultiFieldFollowUp drive the 2+-field inline form (parity with web).
  beginFollowUp, completeFollowUp, beginFormFollowUp, completeMultiFieldFollowUp,
  // Shared one-line bot reply (verb-aware Added:/Completed:) + Part D catalog scoping (drops /me etc.).
  kringReplyText, scopeCatalogToApps,
  // B (circle bot) — dispatch primitives to run an interpreted command in the kring.
  parseInput, resolveDispatch, runDispatch, scopeReadyDispatch, executeBulkDispatch,
  // profile-update propagation — the silent "pull-me" entry kind (the roster PULL trigger).
  ROSTER_UPDATED_KIND,
} from '@onderling-app/basis';
// B (circle bot) — v2 free-text→LLM→command surface (shared with web). Deep-imported like the other
// v2 modules (kringChatReceiver etc.) since they're not on the basis barrel.
// S6.A — manifest-driven inline buttons on bot replies (the resurrected inline menu), shared with web.
import { embedButtonsForReply, embedsFromReply } from '../../../../basis/src/v2/replyEmbeds.js';
import { embedChipsOf, embedTypeLabelKey, shortRef, screenForEmbedType } from '../../../../basis/src/v2/embedChips.js';
import { buildManifestsByOrigin } from '../../core/composeManifests.js';
// D / Surface 2 — the detail ACTION BAR roster, projected from manifest.actions
// via the shared selector (web≡mobile; NOT a hand-written ⋯-menu list).
import { circleActionsMobile } from '../../../../basis/src/v2/actionProjection.js';
// B4 — leaving a circle prunes it on THIS device (address bindings + the authorize snapshot), and
// de-registers its per-circle address on the transport. Both shared with web; the transport handle
// is the only per-shell part, passed in as `unregister`.
import { leaveCircleLocally } from '../../../../basis/src/v2/circleMembershipHygiene.js';
import { unregisterCircleAddresses } from '../../../../basis/src/v2/circleAddressRegistration.js';
import { basisManifest } from '../../../../basis/src/index.js';
// S6.B/C — open-screen surface + per-circle gate (shared with web).
import { isAppSurfaceEnabled } from '../../../../basis/src/v2/appFeature.js';
// the capability gate + the affordance matrix (web≡mobile, shared core).
import { effectiveCapabilities, checkCapability } from '../../../../basis/src/v2/capabilityGate.js';
import { buildCapabilityMatrix } from '@onderling/app-manifest';
// S6.C — per-user surface preference (inline / screen / minimal), shared selector + the mobile store.
import { selectSurfaceButtons } from '../../../../basis/src/v2/surfacePref.js';
// "only you" vs "whole kring" — message scope (data property; the badge renders it).
import { scopeForReply } from '../../../../basis/src/v2/messageScope.js';
import { buildFindExtras } from '@onderling/kring-host/findExtras';
// S6.D — is the conversational "chat" projection LLM-enriched here? (user LLM + circle permits)
import { resolveChatAi } from '../../../../basis/src/v2/chatAi.js';
import { surfacePrefStore } from '../../core/surfacePrefStore.js';
import MultiFieldFormBubble from '../../rn/MultiFieldFormBubble.js';   // 2+-field inline form (parity with web)
import { createCircleDispatch, addressesBot, stripBotTag } from '../../../../basis/src/v2/circleDispatch.js';
import { revealedMemberLabel } from '../../../../basis/src/v2/circleViewAs.js';
import { resolveCircleLlm } from '../../../../basis/src/v2/llmPicker.js';
// Phase 4 §9/§10 — the settings-surface transport state (relayPref) + the shared composer built-in classifier (G17).
import { resolveRelayUrl, asyncStorageRelayIo } from '../../../../basis/src/v2/relayPref.js';
import { parseCircleBuiltin } from '../../../../basis/src/v2/circleComposerBuiltins.js';
// The SHARED security-status report — the SAME handler web reaches (circleApp.js). Mobile's circle composer
// classified `/security-status` (it's in CIRCLE_BUILTIN_COMMANDS) but had no branch, so it fell through to the
// bot/feedback path — a web≡mobile drift (#18). This restores parity.
import { securityStatus } from '../../../../basis/src/core/localBuiltins.js';
// Task #13 — the onboarding + standing help-bot flow, all logic shared with web (circleApp.js). The mobile
// shell wires the SAME thin seams: provision the help circle, drive onboarding as the bot's chat, and run
// the standing Q&A router with the honest (#37) route-conditional wording.
import {
  HELP_CIRCLE_ID, helpCircleSpec, helpCircleRoster, onderlingBotMember, provisionHelpCircle,
} from '../../../../basis/src/v2/helpCircle.js';
import { createOnboardingFlags, asyncStorageOnboardingIo } from '../../../../basis/src/v2/onboardingFlags.js';
import { buildOnboardingTemplate } from '../../../../basis/src/v2/onboardingTemplate.js';
import { startGuidedSetup } from '../../../../basis/src/v2/guidedSetup.js';
import { onboardingTurn, answerOnboarding, parseOnboardingAction } from '../../../../basis/src/v2/onboardingChat.js';
import { botIsAddressed } from '../../../../basis/src/v2/botAddress.js';
import {
  routeHelpMessage, helpTopicChips, resolveHelpTopic, parseHelpAction, helpConsentAction, helpLlmLabelKeys,
} from '../../../../basis/src/v2/helpChat.js';
// #38 — the DEDICATED help-answer LLM path (shared with web): a freeform layer-2 ask is ANSWERED, grounded
// in the kaartjes, instead of routed through the tool-selection prompt (→ null → fallback).
import { answerHelpViaLlm } from '../../../../basis/src/v2/help/helpLlm.js';
import { helpDeck } from '../../../../basis/src/v2/help/kaartjes.js';
// OBJ-2 membership — reuse the classic RN join wizard + the camera scanner + the shared invite glue.
import JoinGroupWizardModal from '../../../../basis/src/rn/wizards/joinGroupWizardModal.js';
import CreateGroupWizardModal from '../../../../basis/src/rn/wizards/createGroupWizardModal.js';
import QrScannerModal from '../../rn/QrScannerModal.js';
import { QrCodeView } from '@onderling/react-native/qr/view';
import { buildCircleInviteUri } from '../../../../basis/src/v2/circleInvite.js';
import { feedHouseholdRoster } from '../../../../basis/src/v2/householdRosterPairing.js';
// Conversation memory — recent kring turns woven into the bot's interpret context.
import { recentKringTurns } from '../../../../basis/src/v2/kringMemory.js';
import { createTokenGate } from '../../../../basis/src/v2/tokenGate.js';
import { makeCircleRetriever } from '../../../../basis/src/v2/circleRetriever.js';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createAsBackend } from '@onderling/react-native/pseudo-pod-adapter';
import { buildCircleEmbedProviders } from '../../../../basis/src/v2/circleEmbedProviders.js';
import { resolveCircleEmbedder } from '../../../../basis/src/v2/embedPicker.js';
import { circleGateRules } from '../../../../basis/src/v2/circleGate.js';
import { interpretToCommand } from '../../../../basis/src/v2/interpretCommand.js';
import { scopeStoopCallSkill } from '../../../../basis/src/v2/circleStoopScope.js';
// Sealed media (2026-07-11): the per-circle media composition is SHARED src/ (platform-neutral,
// no DOM). Mobile reuses it verbatim — same seal path as web's stoop noticeboard — so a prikbord
// image seals per-circle instead of being refused. Do NOT reimplement sealing in the shell.
import { createCircleMediaComposition, makeDevMediaBucket } from '../../../../basis/src/v2/circleMediaGateway.js';
import { buildSelfMediaComposition, makeResealMediaForCircle } from '../../../../basis/src/v2/profileMediaReseal.js';
import { openMediaFilePicker, encodePickedImage } from '../../core/mediaPicker.js';
import { resolveSealedThumbUri } from '../../core/mijHost.js';
import { getCircleSealStrategy, seedCircleRosterFor, getCirclePodFetch, getCircleActorWebId, setCircleContactsSource } from '../../core/circlePods.js';
// M6 — the feedback bot rides the SHARED mount (web uses the same one). tryHandle routes /feedback +
// /feedback-stop + free text while active, before the circle bot; bubbles render via appendKringMessage.
import { createFeedbackMount } from '../../../../basis/src/feedback/feedbackMount.js';
// Rich kring feedback (parity with web's invite-circle): the co-hosted bot's review renders as editable
// CARDS + its long bubbles chunk, instead of flattened text. Shared surface + shared RN card component.
import { createFeedbackSurface, signerForIdentity, chunkBubble } from '../../../../basis/src/feedback/feedbackSurface.js';
import { makeNoLoginFeedbackPods } from '../../../../basis/src/feedback/noLoginPods.js';
import { FeedbackReviewCards } from '../../rn/FeedbackBubbles.js';
import CircleMandatePicker from './CircleMandatePicker.js';
import { buildCircleLlmProviders } from '../../../../basis/src/v2/circleLlmProviders.js';
import { createClarifyingDispatch } from '../../../../basis/src/v2/clarifyingDispatch.js';
// the shared confirm gate at the dispatch waist (mobile presenter: Alert.alert, destructive style).
import { runConfirmGate, alertConfirmPresenter } from '../../core/confirmDispatch.js';
import { createUserLlmDefaultStore, asyncStorageUserLlmIo } from '../../../../basis/src/v2/userLlmDefault.js';
import { buildUserLlmRuntime, validateUserLlmConfig } from '../../../../basis/src/v2/userLlmRuntime.js';
import { formatNearbyLabel } from '../../core/nearbyLabel.js';
import { t, lang } from '../../core/localisation.js';
import {
  makeCirclePolicyStoreRN, makeMemberOverrideStoreRN, makeAvailabilityStoreRN,
  // Objective D — session → podWriter so the availability pref publishes.
  sessionToPodWriterRN,
  // persisted multi-admin proposals.
  // α.1e — scherm recipe book persistence.
  makeKringRecipeStoreRN,
  // α.3 — per-user screens persistence.
  makeUserScreenStoreRN,
  // β.5 — per-user pin-to-top persistence.
  makeCirclePinStoreRN,
  // γ.2 — per-circle rules persistence + version capture (was inline
  // AsyncStorage at the rules entry points up to β).
  makeCircleRulesStoreRN,
} from '../../core/circleStoresRN.js';
// δ.1 — per-screen materialized-blocks cache (cache-first render).
import { makeScreenBlocksCacheRN } from '../../core/screenBlocksCacheStorageRN.js';
import CircleSettingsScreen from './CircleSettingsScreen.js';
import CircleOverrideScreen from './CircleOverrideScreen.js';
// the mobile list-screen surface (web≡mobile).
import CircleListScreen from './CircleListScreen.js';
// D-mig-mobile-1b — list-screen config is now SOURCED from the projected manifest
// section (shared `sectionForScreen`), mirroring web 1b. The old hardcoded
// list-screen literal is retired: each screenId resolves to `{section, appOrigin}`
// over the composed manifests, and the section's dataSource/labelField/categoryField/
// searchFields drive the fetch + render — no per-shell duplication (invariant #1/#3).
import { sectionForScreen } from '../../../../basis/src/v2/pageProjection.js';
// generic screen drill-down (row → detail with selection context),
// the mobile twin of web's openCircleScreenPanel wiring.  The drill/selection/
// fetch logic is SHARED (src/v2/screenDrilldown.js) — the portable core module
// only binds renderMobile + the {circleId, ...selection} host-context shape.
import {
  screenPanelContext, drilldownForScreen, selectionContextFor,
  fetchScreenItems, itemsFromReply, recordFromReply,
} from '../../core/screenPanelDrilldown.js';
import CircleRecordScreen from './CircleRecordScreen.js';
import CircleAvailabilityScreen from './CircleAvailabilityScreen.js';
import CircleViewAsScreen from './CircleViewAsScreen.js';
import CircleMemberCardScreen from './CircleMemberCardScreen.js';   // §2 — member-persona card + self-view
import CircleAdvisorScreen from './CircleAdvisorScreen.js';
import CircleHopScreen from './CircleHopScreen.js';
import CircleOfferingEditorScreen from './CircleOfferingEditorScreen.js';
import CircleFolioScreen from './CircleFolioScreen.js';
import CircleRulesScreen from './CircleRulesScreen.js';
import CircleRulesConsentScreen from './CircleRulesConsentScreen.js';
import CircleTabBar from './CircleTabBar.js';
import CircleScreenView from './CircleScreenView.js';
import CircleRecipeEditorScreen from './CircleRecipeEditorScreen.js';
import CircleScreensPickerScreen from './CircleScreensPickerScreen.js';
import ContactsScreen from './ContactsScreen.js';
import ContactThreadScreen from './ContactThreadScreen.js';
import FeedbackThreadScreen from './FeedbackThreadScreen.js';
import { createFeedbackBotStore } from '../../../../basis/src/v2/feedbackBots.js';
// objective L · Phase 2 — the Contacten roster feeds CircleShareScreen's out-of-circle recipient picker.
import { listContacts, mergeContacts, stoopContactToRow } from '../../../../basis/src/v2/contactsSource.js';
import CircleNoticeboard from './CircleNoticeboard.js';
import CircleListsScreen from './CircleListsScreen.js';   // composable lists (web≡mobile)
import CircleShareScreen from './CircleShareScreen.js';   // objective L — cross-circle share UI (web≡mobile)
import CircleProfileScreen from './CircleProfileScreen.js';
import CircleAdminPanelScreen from './CircleAdminPanelScreen.js';
import CircleMyDataScreen from './CircleMyDataScreen.js';
import { resolveMobileRelayUrl } from '../../core/agentBundle.js';
// invite parity (J-NP3 + the invite-carries-endpoint decision) — the same policy/storage reads web's
// showCircleInvite does, so a mobile-built invite carries the SAME disclosure + endpoint fields.
import { loadCircleStoragePod } from '../../../../basis/src/v2/circleStoragePolicy.js';
import CircleMijScreen from './CircleMijScreen.js';   // mij#personas — the "Mij → persona's" surface (replaces the single-persona About-me content, web parity with openAboutMePanel)
import CircleGovernanceScreen from './CircleGovernanceScreen.js';   // Wave C §5 — governance surface (web≡mobile)
import { bindCircleGovernance, openPolicyProposals } from '../../../../basis/src/v2/governanceAppWiring.js';   // §8 reports + settings-consensus governance
import { governanceEntryId } from '../../../../basis/src/v2/governanceLog.js';
import { reportEntryId } from '../../../../basis/src/v2/reportModel.js';
import SharedWithMeScreen from './SharedWithMeScreen.js';   // SILENT out-of-circle delivery — personal "shared with me" inbox (web≡mobile)

// B (circle bot) — host LLM route for NL→command in the kring. Mirrors web's VITE_CIRCLE_LLM_BASEURL
// + the feedback mobile EXPO_PUBLIC_FEEDBACK_LLM_BASEURL pattern. Unset → no provider → the LLM branch
// stays inert (slash commands + plain kring chat still work).
const CIRCLE_LLM_BASEURL = process.env.EXPO_PUBLIC_CIRCLE_LLM_BASEURL || null;
const CIRCLE_LLM_MODEL   = process.env.EXPO_PUBLIC_CIRCLE_LLM_MODEL || undefined;
// Per-call LLM timeout (web parity: VITE_CIRCLE_LLM_TIMEOUT_MS). The provider's 12s default is fine for a
// fast enclave but aborts a CPU-only local model (qwen2.5:7b warms up + answers in 60–120s) → the bot
// silently drops to "basic mode". Default generous (120s); override via env.
const CIRCLE_LLM_TIMEOUT_MS = Number(process.env.EXPO_PUBLIC_CIRCLE_LLM_TIMEOUT_MS ?? 120000) || 120000;
// F-retrieve tier-2 embeddings (web parity) — base defaults to the LLM base (the
// enclave serves /v1/chat/completions + /v1/embeddings), so semantic RAG rides the
// same trust boundary; null base → semantic inert (tier-1 lexical).
const CIRCLE_EMBED_BASEURL = process.env.EXPO_PUBLIC_CIRCLE_EMBED_BASEURL || CIRCLE_LLM_BASEURL;
const CIRCLE_EMBED_MODEL   = process.env.EXPO_PUBLIC_CIRCLE_EMBED_MODEL || undefined;
const CIRCLE_BOT_NAME    = process.env.EXPO_PUBLIC_CIRCLE_BOT_NAME || 'assistant';
// M6 — feedback bot's LLM route (cleans/anonymizes participant input). Unset → in-memory demo mode.
const FEEDBACK_LLM_BASEURL = process.env.EXPO_PUBLIC_FEEDBACK_LLM_BASEURL || undefined;
// The companion collector for the no-login kring feedback session (raw stays local; the round-approved,
// device-signed summary is released here). Unset → own-pod-only (no central route / verify rounds).
const FEEDBACK_COLLECTOR_URL = process.env.EXPO_PUBLIC_FEEDBACK_COLLECTOR_URL || undefined;
// Languages the kring feedback bot offers (only those with a full locale + pipeline string file). Labels/prompts
// come from the locale files read IN each target language (see emitFeedbackLangOptions) — no hardcoded strings.
const FEEDBACK_LANGS = String(process.env.EXPO_PUBLIC_FEEDBACK_LANGS || 'nl,en').split(',').map((s) => s.trim()).filter(Boolean);
// Default circle posture (off|local|cloud|user); 'user' = each member's personal default decides.
const CIRCLE_LLM_POLICY  = process.env.EXPO_PUBLIC_CIRCLE_LLM_POLICY || 'user';
// Scope the LLM's tool list to these app origins (comma-list, e.g. "household,tasks"). Unset → the bot
// offers ALL circle apps' ops (~105 tools) — a big, slow prompt. Narrowing to the relevant apps cuts the
// tool count dramatically (household alone ≈ 16), so the per-turn prompt is far smaller + faster.
const CIRCLE_LLM_APPS = (process.env.EXPO_PUBLIC_CIRCLE_LLM_APPS || '').split(',').map((s) => s.trim()).filter(Boolean);

// F-retrieve persistence (web parity): one app-level StorageBackend for the
// circle-bot RAG vector index, scoped per-circle inside the retriever to
// private/state/search-index/circle-rag/<circleId>/ (never sharing/ — invariant
// #7). Same @onderling/pseudo-pod substrate the circle pods run on (see
// src/core/circlePods.js). Objective L (2026-07-08): AsyncStorage-PERSISTENT on
// device (createAsBackend over the RN AsyncStorage) so embedded vectors survive a
// restart instead of re-embedding — mirrors web's IndexedDB wiring; falls back to
// in-memory when AsyncStorage is unusable (tests use a Map-backed stub, so this
// path is exercised there). The remaining path — a real signed-in Solid pod —
// stays the live-pod tail.
const circleSearchVectorStore = (AsyncStorage && typeof AsyncStorage.getItem === 'function')
  ? createAsBackend({ AsyncStorage, scope: 'cc-circle-rag' })
  : createMemoryBackend();

// Sealed media (2026-07-11) — mirror web circleApp.js: ONE DEV bucket per app session
// (in-memory; the real S3/R2 swap point is recorded in circleMediaGateway.js), and the
// per-circle sealed-media composition cached so the session ACL's grants persist across
// re-opens. A p0/p1 circle (no seal strategy) composes to `null` → sealed-only: the wrapper
// refuses attachments and the 📎 affordance stays hidden (NO unsealed fallback). This is the
// SHARED composition both platforms use — reused, not reimplemented in the shell.
const circleMediaBucket = makeDevMediaBucket();
const circleMediaCompositions = new Map();   // circleId → Promise<composition|null>
function getCircleMediaComposition(circleId, policy) {
  if (!circleId) return Promise.resolve(null);
  if (!circleMediaCompositions.has(circleId)) {
    circleMediaCompositions.set(circleId, createCircleMediaComposition({
      circleId,
      getSealStrategy: () => getCircleSealStrategy(circleId, policy),
      localActor: getCircleActorWebId() || 'me',
      bucket: circleMediaBucket,
    }).catch(() => null));
  }
  return circleMediaCompositions.get(circleId);
}

// D1 (§5A) — per-circle action-frequency counter behind the quickActions
// row.  Module singleton (shared across kring opens), hydrated once from
// AsyncStorage and persisting its snapshot on every bump.  In-memory reads
// work before hydration completes (just yield the default feature order).
const ACTION_FREQ_KEY = 'cc.actionFrequency';
const actionFrequency = createActionFrequencyStore({}, {
  onChange: (snap) => { AsyncStorage.setItem(ACTION_FREQ_KEY, JSON.stringify(snap)).catch(() => {}); },
});
AsyncStorage.getItem(ACTION_FREQ_KEY).then((raw) => {
  if (!raw) return;
  try {
    const snap = JSON.parse(raw);
    for (const [cid, counts] of Object.entries(snap ?? {})) {
      for (const [k, v] of Object.entries(counts ?? {})) {
        if (typeof v === 'number' && v > 0) actionFrequency.bump(cid, k, v);
      }
    }
  } catch { /* corrupt snapshot — ignore */ }
}).catch(() => {});

// D1 (§5A) — in-memory fallback recipe (just the Veel-gebruikt row) for a
// kring with no authored scherm.  Never persisted.
const DEFAULT_SCHERM_RECIPE = Object.freeze({
  // #16 — quick-actions + the noticeboard (buurt prikbord via stoop listOpen), so a
  // scherm-landing circle surfaces the open posts even with the chat tab hidden.
  id: '__default__', name: '', blocks: [
    { id: 'qa-default', type: 'quickActions', config: { limit: 4 } },
    { id: 'nb-default', type: 'noticeboard',  config: { limit: 8 } },
  ],
});

// Wrap a top-level surface (Kringen / Stroom / Mij) with the bottom tab bar.
function WithTabBar({ active, onSelect, children }) {
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>{children}</View>
      <CircleTabBar active={active} onSelect={onSelect} />
    </View>
  );
}

export default function CircleLauncherScreen({
  bundle,
  // Delivery honesty — the shared per-message map (App.js owns it; ChatScreen's router feeds it).
  deliveryStateMap = null,
  // The fallback offer's MOUTH (App.js owns the offer): the open kring chat registers its bot bubble
  // while mounted, so an app-level offer can speak in the conversation the person is looking at.
  registerKringBotSink = null,
  // …and its ACCEPT (App.js `acceptFallbackOffer`: sets the setting, clears the offer, speaks the confirm).
  //
  // This line was missing, and it broke EVERY circle-open (found 2026-07-30). App.js passed the prop, the
  // detail component declared it, and the render at ~1733 forwarded a bare `onAcceptFallback` that existed
  // in no scope — so opening any circle threw `Property 'onAcceptFallback' doesn't exist`, React aborted the
  // render, and the launcher stayed on the list. It read as a dead tap: no navigation and nothing in the log,
  // because the press handler ran fine and the RENDER it caused is what failed. The redbox was there the
  // whole time, minimised.
  onAcceptFallback = null,
  // Bumped by App.js when a circle is joined/created from another surface. The launcher loads its list on
  // mount and after its OWN wizards; both screens stay mounted, so nothing else told it.
  circlesRevision = 0,
  // cluster J — the OidcSessionRN ref (App.js:187), needed to activate the feedback verify pods.
  sessionRef = null,
  // cluster J — podAuth (lifted from the hidden ChatScreen) so the "Me" screen can drive pod sign-in.
  podAuth = null,
  eventLog,
  kringRecipePendingStore = null,
  // γ-next.rules — per-kring pending-rules cache (AsyncStorage-backed,
  // owned by App.js).  Receiver writes; rules editor reads on mount +
  // clears after the γ.4 resolver applies / discards.
  kringRulesPendingStore = null,
  // γ-next.policy — per-kring pending-policy cache (AsyncStorage-backed,
  // owned by App.js).  Receiver writes; settings editor reads on mount +
  // clears after the γ.4 resolver applies / discards.  Completes the
  // γ-next trio (recipe / rules / policy).
  kringPolicyPendingStore = null,
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();   // clear the status bar so the header bar is fully tappable
  const styles = useMemo(() => makeStyles(theme, insets), [theme, insets]);
  const [circles, setCircles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  // M3 — sub-view within the launcher: 'list' | 'availability' | 'detail'
  // | 'settings' | 'override'.  `selected` carries the active circle for
  // detail/settings/override.
  // boot lands on the Schermen tab (primary). Was 'list' (= Kringen).
  const [view, setView] = useState('screens');
  // The member's saved assistant endpoint config (settings → My data). Persisted to AsyncStorage;
  // CircleDetail re-reads it on mount, so a save applies the next time a circle opens.
  const [userLlmCfg, setUserLlmCfg] = useState({});
  useEffect(() => {
    let alive = true;
    createUserLlmDefaultStore(asyncStorageUserLlmIo(AsyncStorage)).get().then((v) => { if (alive) setUserLlmCfg(v); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const onSaveUserLlm = useCallback(async (cfg) => {
    const err = validateUserLlmConfig(cfg);
    if (err) return err;                       // confidential-route guard → inline message
    const saved = await createUserLlmDefaultStore(asyncStorageUserLlmIo(AsyncStorage)).set(cfg).catch(() => cfg);
    setUserLlmCfg(saved);
    return null;
  }, []);
  // Phase 4 §9 — device transport state for the circle settings fold (relay availability greys the
  // private-DM toggle per the §7 route × capability matrix). Loaded from AsyncStorage (relay URL +
  // transport-mode); the settings controls apply changes live via onCircleControl. When it can't be
  // read the fold defaults ENABLED + logs a seam (never a faked disable).
  const [circleTransport, setCircleTransport] = useState(null);
  const loadCircleTransport = useCallback(async () => {
    try {
      const relayUrl = resolveRelayUrl(await asyncStorageRelayIo(AsyncStorage).load(), process.env.EXPO_PUBLIC_CIRCLE_RELAY_URL) || '';
      let mode = null;
      try { const m = await AsyncStorage.getItem('cc-transport-mode'); if (m === 'nkn' || m === 'relay' || m === 'both') mode = m; } catch { /* best-effort */ }
      setCircleTransport({ mode, relayUrl, relayConnected: !!relayUrl });
    } catch { setCircleTransport(null); }
  }, []);
  useEffect(() => { loadCircleTransport(); }, [loadCircleTransport]);
  // Device-scoped settings controls (transport-mode · relay endpoint) dispatch as built-ins here —
  // the SAME handlers the /set-relay + /transport-mode composer built-ins use (invariants #1/#2).
  const onCircleControl = useCallback(async (opId, args) => {
    if (opId === 'set-relay') {
      // Mirror web's applyRelayUrl (circleApp.js): persist → read the STORED value BACK (so the
      // confirmation reflects what was saved, never the raw input) → live-reconnect → return
      // {ok, effective, error} so the caller reports the truth. Failures are SURFACED, not
      // swallowed — a swallowed `.set` TypeError is exactly what hid the never-persisted bug
      // (commit 7de8b661). asyncStorageRelayIo is the raw IO { load, save } (NOT { get, set }).
      const io = asyncStorageRelayIo(AsyncStorage);
      let saveError = null;
      try { await io.save(args?.clear ? '' : String(args?.url ?? '')); }
      catch (err) { saveError = err?.message ?? String(err); }
      let effective = '';
      try { effective = resolveRelayUrl(await io.load(), process.env.EXPO_PUBLIC_CIRCLE_RELAY_URL) || ''; }
      catch { /* read-back best-effort */ }
      let reconnect = { ok: true };
      if (!saveError) {
        try { reconnect = (await bundle?.reconnectPeer?.()) ?? { ok: true }; }
        catch (err) { reconnect = { ok: false, error: err?.message ?? String(err) }; }
      }
      loadCircleTransport();
      return { ok: !saveError && reconnect?.ok !== false, effective, error: saveError ?? reconnect?.error ?? null };
    }
    if (opId === 'transport-mode' && ['nkn', 'relay', 'both'].includes(String(args?.mode))) {
      try { await AsyncStorage.setItem('cc-transport-mode', args.mode); } catch { /* best-effort */ }
      try { bundle?.agent?.setTransportMode?.(args.mode); } catch { /* best-effort */ }
    }
    if (opId === 'security-status') {
      // The SHARED security-status report (web≡mobile — circleApp.js): what the circle boundary is ENFORCING.
      // `bundle.agent` is the household agent (web's `circleHouseholdAgent`); the message rides back to the
      // composer as a bot bubble. Routed HERE because `bundle` is the launcher's prop, not CircleDetail's (#18).
      try {
        const r = await securityStatus({}, { agent: bundle?.agent, t });
        return { ok: true, message: r?.message ?? String(r ?? '') };
      } catch (err) {
        return { ok: false, message: String(err?.message ?? err) };
      }
    }
    loadCircleTransport();
    return null;
  }, [bundle, loadCircleTransport]);
  // the contact (bot/peer) whose DM thread is open under the Contacten tab.
  const [contactThread, setContactThread] = useState(null);
  // cluster J — persisted registry of added feedback bots (AsyncStorage), shared with the Contacten roster
  // + the dedicated feedback thread. Created once.
  const feedbackStoreRef = useRef(null);
  if (!feedbackStoreRef.current) feedbackStoreRef.current = createFeedbackBotStore(AsyncStorage);
  const feedbackStore = feedbackStoreRef.current;
  const [viewAsPolicy, setViewAsPolicy] = useState('pairwise');
  const [viewAsMembers, setViewAsMembers] = useState([]);
  const [folioFiles, setFolioFiles] = useState([]);
  // the acting member's capability matrix for the folio file
  // browser. Gates the file-OPEN row action (get × file) the SAME way the list
  // surface gates its row buttons. Empty until built ⇒ 'show' ⇒ unchanged.
  const [folioCapMatrix, setFolioCapMatrix] = useState([]);
  const [skillDraft, setSkillDraft] = useState(null);
  const [rulesDoc, setRulesDoc] = useState(null);
  const [rulesPreview, setRulesPreview] = useState(null);
  // γ-next.rules — pending incoming rules doc (from peer broadcast).
  // Loaded when the rules screen opens; cleared after the γ.4 resolver
  // applies or discards.
  const [incomingRules, setIncomingRules] = useState(null);
  // γ-next.policy — pending incoming policy doc (from peer broadcast).
  // Loaded when the settings screen opens; cleared after the γ.4
  // resolver applies or discards.
  const [incomingPolicy, setIncomingPolicy] = useState(null);
  // α.1d.3 — recipe editor state (lives in the parent so book + mode
  // survive the BOOK ↔ RECIPE round-trip).  Callbacks land below
  // after recipeStore is declared.
  const [recipeBook, setRecipeBook] = useState({ recipes: [], activeId: null });
  const [recipeEditorMode, setRecipeEditorMode] = useState('book');
  const [recipeEditingId, setRecipeEditingId] = useState(null);
  // γ-next.recipe — pending incoming recipe (from peer broadcast).
  // Loaded when the recipe screen opens; cleared after γ.3 resolver
  // applies or discards.
  const [incomingRecipe, setIncomingRecipe] = useState(null);
  // α.3 — Screens-tab state.  Two sub-modes: 'picker' (CRUD list) +
  // 'view' (render the materialized active screen).  Book + blocks
  // live here so they survive sub-mode switches without refetching.
  const [screensBook, setScreensBook] = useState({ screens: [], activeId: null });
  const [screensSubMode, setScreensSubMode] = useState('picker');
  const [viewingScreenId, setViewingScreenId] = useState(null);
  const [screenViewBlocks, setScreenViewBlocks] = useState(null);
  // δ.1 — true while a fresh materialize runs after a cache-hit render.
  // Drives the subtle refresh pip in CircleScreenView.
  const [screenViewRefreshing, setScreenViewRefreshing] = useState(false);
  const [items, setItems] = useState([]);
  const [creating, setCreating] = useState(false);
  // OBJ-2 — join a circle: scan an invite QR → run the shared join wizard. Invite modal: show this
  // circle's membership QR. Both reuse the classic membership core; nothing new below the surface.
  const [joinScanOpen, setJoinScanOpen] = useState(false);
  const [joinArgs, setJoinArgs] = useState(null);     // {invite} → JoinGroupWizardModal runs
  const [inviteFor, setInviteFor] = useState(null);   // {circleId, uri, error} → invite-QR modal
  // selected circle's policy (loaded when `selected` changes); used
  // to gate detail action buttons on the Functies axis.
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  const [chatAi, setChatAi] = useState({ enriched: false, reason: 'no-provider' });   // S6.D — chat LLM enrichment for My-data
  // kring tile activity preview ({subtitle, ts, unread} per circle)
  // + seenAt persistence (the per-circle "last-open" marker that drives the
  // unread badge).  Loaded on mount; bumped on openCircle.
  const [seenAt,   setSeenAt]   = useState({});
  const [previews, setPreviews] = useState({});
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem('cc.circleSeenAt');
        if (alive && raw) setSeenAt(JSON.parse(raw) || {});
      } catch { /* fresh */ }
    })();
    return () => { alive = false; };
  }, []);
  // Recompute the previews map whenever events / circles / seenAt change.
  useEffect(() => {
    const events = eventLog?.query ? eventLog.query({ excludeMuted: true }) : [];
    setPreviews(buildTilePreviews({ events, circles, seenAt }));
  }, [eventLog, circles, seenAt]);
  // per-circle voorstellen badge. Populated lazily after
  // circles load; refresh after a settings save (CircleSettingsScreen
  // calls back through onPoll once it persists a new proposal).
  const [proposalCounts, setProposalCounts] = useState({});
  // Mijn dingen state lives here so the screen can render
  // synchronously when entered; `myThingsFiles` is loaded via listFiles.
  const [myThingsFiles, setMyThingsFiles] = useState([]);
  // raw Folio list result for share-toggle re-projection.
  const [rawFolioFiles, setRawFolioFiles] = useState(null);

  // refresh the selected circle's policy whenever `selected` changes,
  // so CircleDetail can gate its feature-bound buttons (houseRules,
  // memberDirectory).  Falls back to null on read failure → the helper
  // applies feature defaults.
  // Read the active circle's policy from the store into `selectedPolicy` (the prop CircleDetail's
  // gate + tabs + catalog react to). Extracted so an in-place settings save can re-run it — otherwise
  // CircleDetail keeps the policy it loaded on open and a newly-(dis)abled app stays (un)gated until
  // the circle is fully re-opened (device-verify #80, 2026-07-02).
  const reloadSelectedPolicy = useCallback(async () => {
    if (!selected?.id) { setSelectedPolicy(null); return; }
    let p = null;
    try { p = await policyStore.get(selected.id); } catch { /* defaults */ }
    setSelectedPolicy(p);
  }, [selected, policyStore]);
  useEffect(() => {
    if (!selected?.id) { setSelectedPolicy(null); return; }
    let alive = true;
    (async () => {
      let p = null;
      try { p = await policyStore.get(selected.id); } catch { /* defaults */ }
      if (alive) setSelectedPolicy(p);
    })();
    return () => { alive = false; };
  }, [selected, policyStore]);

  // S6.D — is the conversational "chat" projection LLM-enriched in the active circle?
  // (the circle's policy.llmTool + the member's loaded LLM + a configured provider).
  useEffect(() => {
    let alive = true;
    (async () => {
      let userLlm = { mode: CIRCLE_LLM_BASEURL ? 'local' : 'off' };
      try { const v = await createUserLlmDefaultStore(asyncStorageUserLlmIo(AsyncStorage)).get(); if (v) userLlm = v; } catch { /* default */ }
      const r = resolveChatAi({
        circleLlmTool: selectedPolicy?.llmTool ?? CIRCLE_LLM_POLICY,
        userLlmMode: userLlm?.mode,
        hasProvider: !!CIRCLE_LLM_BASEURL,
      });
      if (alive) setChatAi(r);
    })();
    return () => { alive = false; };
  }, [selectedPolicy]);

  // 5.9c — passive "Nearby N device(s)" signal from MdnsTransport.  When the
  // bundle exposes mdns we mirror its connectionCount into state, subscribed
  // to peer-discovered + peer-disconnected so the row updates as peers come
  // and go.  When bundle.mdns is null (vitest, iOS, Expo Go, Wi-Fi off) the
  // row hides via the `bundle?.mdns` gate at render time.
  const [nearbyCount, setNearbyCount] = useState(0);
  useEffect(() => {
    const mdns = bundle?.mdns;
    if (!mdns) return;
    const sync = () => {
      const n = mdns.connectionCount;
      setNearbyCount(typeof n === 'number' ? n : 0);
    };
    sync();
    mdns.on?.('peer-discovered',   sync);
    mdns.on?.('peer-disconnected', sync);
    return () => {
      mdns.off?.('peer-discovered',   sync);
      mdns.off?.('peer-disconnected', sync);
    };
  }, [bundle]);

  // M3 — AsyncStorage-backed circle stores (keys match web's localStorage
  // convention).  Created once; the sub-screens load/save through them.
  const policyStore       = useMemo(() => makeCirclePolicyStoreRN(AsyncStorage), []);
  // The OWNER-sealed source media composition (SHARED seal path — web ≡ mobile): the
  // picture is sealed to my OWN key, so it is circle-independent (the general/truth
  // layer). Memoised once per identity; both the picture SET/preview and the disclosure
  // re-sealer draw from it. Reuses this shell's dev media bucket.
  const getSelfMediaComposition = useMemo(() => {
    const identity = bundle?.coreAgent?.identity ?? null;
    let selfCompPromise;
    return () => {
      if (!selfCompPromise) {
        selfCompPromise = buildSelfMediaComposition({
          identity, bucket: circleMediaBucket, localActor: getCircleActorWebId() || 'me',
        }).catch(() => null);
      }
      return selfCompPromise;
    };
  }, [bundle?.coreAgent?.identity]);
  // Profile-picture disclosure re-sealer: turns the owner-sealed source picture into a
  // per-circle copy on share (Frits: option (a)). Injected into shareDisclosureToCircle.
  const resealMediaForCircle = useMemo(() => makeResealMediaForCircle({
    getSelfComposition:   getSelfMediaComposition,
    getCircleComposition: getCircleMediaComposition,
    getPolicy:            (circleId) => policyStore.get(circleId),
  }), [getSelfMediaComposition, policyStore]);
  // The picture SET/preview seam handed to CircleMijScreen (thin RN row → host helpers).
  // `pick()` opens the picker + seals to the self gateway; `resolve()` renders the sealed
  // thumb as a data: URI. Both no-op safely when the self composition is unavailable.
  const profilePicture = useMemo(() => ({
    getGateway: async () => (await getSelfMediaComposition())?.mediaGateway ?? null,
    getOpener:  async () => (await getSelfMediaComposition())?.mediaGateway?.opener ?? null,
    openFilePicker: openMediaFilePicker,
    encodeImage:    encodePickedImage,
    localActor: getCircleActorWebId() || 'me',
  }), [getSelfMediaComposition]);
  // §8 unification — the ONE report write path (member · post · message) → the governance
  // report host, so every report propagates + shows in the governance Reports section (folds
  // the older reportPost). Best-effort; scoped to the active circle.
  const fileCircleReportMobile = useCallback(async (targetType, targetRef, targetLabel = null, reason = '') => {
    const circleId = selected?.id; if (!circleId || !targetRef) return;
    try {
      const broadcast = (channel, cid, event, opts) => {
        const op = channel === 'report' ? 'broadcastKringReport' : 'broadcastKringGovernance';
        const msgId = channel === 'report' ? reportEntryId(event) : (event?.body?.hash ? `gov:${event.body.hash}` : governanceEntryId(event));
        // `opts.to` narrows the fan to the circle's admins on the report channel (story 3.6) — web parity.
        const to = Array.isArray(opts?.to) ? opts.to : undefined;
        bundle?.callSkill?.('stoop', op, { groupId: cid, event, msgId, ts: Date.now(), ...(to ? { to } : {}) })?.catch?.(() => {});
      };
      const gov = bindCircleGovernance({
        eventLog, callSkill: bundle?.callSkill, getPolicy: (cid) => policyStore.get(cid),
        myRef: getCircleActorWebId() || '', genId: () => `rep-${Math.random().toString(36).slice(2, 10)}`, broadcast,
        circleIdentityFor: bundle?.agent?.circleIdentityFor ?? null,
      });
      await gov.reports.file({ circleId, targetType, targetRef, targetLabel, reason });
    } catch { /* best-effort */ }
  }, [selected, bundle, eventLog, policyStore]);
  const overrideStore     = useMemo(() => makeMemberOverrideStoreRN(AsyncStorage), []);
  // Objective D — mirror the pref to the user's pod so other agents read it.
  // getPodWriter is a thunk: null while unsigned (→ local-only), a live
  // writer once the Solid session (sessionRef) is authenticated.
  const availabilityStore = useMemo(() => makeAvailabilityStoreRN(AsyncStorage, {
    getPodWriter: () => sessionToPodWriterRN(sessionRef?.current ?? null),
  }), []);
  // SILENT out-of-circle delivery — the per-user "shared with me" inbox. The store is instantiated ON THE
  // BUNDLE (agentBundle.js) so the ChatScreen receive handler + this launcher share ONE instance; here we just
  // LOAD its list when the Mij sub-view opens (web≡mobile: mirrors web's `showSharedWithMe` reading the store).
  const sharedWithMeStore = bundle?.sharedWithMeStore ?? null;
  const [sharedWithMeList, setSharedWithMeList] = useState([]);
  useEffect(() => {
    if (view !== 'sharedWithMe' || !sharedWithMeStore) return;
    let alive = true;
    (async () => {
      let list = [];
      try { list = await sharedWithMeStore.list(); } catch { list = []; }
      if (alive) setSharedWithMeList(list);
    })();
    return () => { alive = false; };
  }, [view, sharedWithMeStore]);
  // build the folio capability matrix from the selected circle's
  // policy + this member's opt-outs (same inputs the list surface uses). Feeds
  // CircleFolioScreen so its file-OPEN row action greys/hides per the gate.
  useEffect(() => {
    if (!selected?.id) { setFolioCapMatrix([]); return; }
    let alive = true;
    (async () => {
      let matrix = [];
      try {
        const sources = [...new Set(Object.values(buildManifestsByOrigin()))].map((manifest) => ({ manifest }));
        const ovr = await overrideStore.get(selected.id);
        matrix = buildCapabilityMatrix(sources, {
          enabledApps: Array.isArray(selectedPolicy?.apps) && selectedPolicy.apps.length ? selectedPolicy.apps : null,
          template: selectedPolicy?.capabilities || {}, optOuts: ovr?.capabilityOptOuts || [],
        });
      } catch { /* best-effort — empty ⇒ show */ }
      if (alive) setFolioCapMatrix(matrix);
    })();
    return () => { alive = false; };
  }, [selected, selectedPolicy, overrideStore]);
  // multi-admin proposal store. Settings consults this to persist
  // pending consensus proposals + commit on unanimous approval.
  // Settings consensus rides GOVERNANCE (changePolicy on the log) — the AsyncStorage proposal
  // side-store is retired. One handle serves the badge count, the settings propose, and (via the
  // wired setPolicy enactor) apply-on-approval; proposals cross devices because the events fan.
  const govPolicy = useMemo(() => {
    if (!bundle?.callSkill || !eventLog) return null;
    const broadcast = (channel, cid, event, opts) => {
      const op = channel === 'report' ? 'broadcastKringReport' : 'broadcastKringGovernance';
      const msgId = event?.body?.hash ? `gov:${event.body.hash}` : governanceEntryId(event);
      const to = Array.isArray(opts?.to) ? opts.to : undefined;
      bundle.callSkill('stoop', op, { groupId: cid, event, msgId, ts: Date.now(), ...(to ? { to } : {}) })?.catch?.(() => {});
    };
    return bindCircleGovernance({
      eventLog, callSkill: bundle.callSkill, getPolicy: (cid) => policyStore.get(cid),
      myRef: getCircleActorWebId() || '', genId: () => `gov-${Math.random().toString(36).slice(2, 10)}`, broadcast,
      circleIdentityFor: bundle?.agent?.circleIdentityFor ?? null,
      setPolicy: (cid, patch) => policyStore.update(cid, patch),
    });
  }, [bundle, eventLog, policyStore]);
  // α.1e — per-kring scherm recipe book (multi-recipe; one marked active).
  const recipeStore       = useMemo(() => makeKringRecipeStoreRN(AsyncStorage), []);
  // α.3 — per-user screens store.  One book per user.
  const userScreenStore   = useMemo(() => makeUserScreenStoreRN(AsyncStorage), []);
  // δ.1 — per-screen materialized-blocks cache (cache-first render +
  // background refresh).  Instantiated inline rather than threaded
  // through App.js as a ref because this cache is purely a UI optimisation
  // owned by the Schermen tab; no peer-receiver writes to it from outside.
  const screenBlocksCache = useMemo(() => makeScreenBlocksCacheRN(AsyncStorage), []);
  // β.5 — per-user "pin to top" store + cached maps.  Pin = float a tile
  // to the top of its kind section; mute = per-kring `chatOff` override
  // already exposed via the override store (no new substrate).  Menu =
  // `menuCircle` is the circle whose context menu is open (null when
  // closed).
  const pinStore          = useMemo(() => makeCirclePinStoreRN(AsyncStorage), []);
  // γ.2 — per-circle rules store (replaces inline AsyncStorage in the
  // rules screen handlers).  Snapshots every save into a versions slot.
  const rulesStore        = useMemo(() => makeCircleRulesStoreRN(AsyncStorage), []);
  const [pinnedMap, setPinnedMap] = useState({});
  const [mutedMap,  setMutedMap]  = useState({});
  const [menuCircle, setMenuCircle] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try { const m = await pinStore.get(); if (alive) setPinnedMap(m); }
      catch { /* keep {} */ }
    })();
    return () => { alive = false; };
  }, [pinStore]);
  // Refresh the muted-map whenever the circle list changes; reads
  // each circle's override and surfaces chatOff===true as "muted".
  const refreshMutedMap = useCallback(async () => {
    const next = {};
    for (const c of circles) {
      try {
        const o = await overrideStore.get(c.id);
        if (o?.chatOff) next[c.id] = true;
      } catch { /* skip */ }
    }
    setMutedMap(next);
  }, [circles, overrideStore]);
  useEffect(() => { refreshMutedMap(); }, [refreshMutedMap]);
  // α.1d.3 — recipe-editor helpers (defined here so recipeStore is in scope).
  const refreshRecipeBook = useCallback(async (cid) => {
    if (!cid) return;
    try { setRecipeBook(await recipeStore.get(cid)); }
    catch { setRecipeBook({ recipes: [], activeId: null }); }
  }, [recipeStore]);
  const applyRecipeMutation = useCallback(async (cid, mutator) => {
    if (!cid) return;
    let nextBook = null;
    try {
      nextBook = await recipeStore.update(cid, mutator);
      setRecipeBook(nextBook);
    } catch (err) { console.warn('[recipe] mutation failed:', err?.message ?? err); }
    // γ-next.recipe — fan the just-updated active recipe out to peers.
    // Fire-and-forget; per-peer errors land in result.errors which we
    // log.  No-op when callSkill / no agent / no active recipe.
    if (!nextBook || typeof bundle?.callSkill !== 'function') return;
    const active = nextBook.recipes?.find?.((r) => r.id === nextBook.activeId);
    if (!active) return;
    const msgId = `kring-recipe-${cid}-${Date.now()}`;
    const ts    = Date.now();
    bundle.callSkill('stoop', 'broadcastKringRecipe', {
      groupId: cid, recipe: active, msgId, ts,
    }).then((r) => {
      if (r?.error) console.warn('[kring-recipe] fan-out skipped:', r.error);
    }).catch((err) => {
      console.warn('[kring-recipe] fan-out failed:', err?.message ?? err);
    });
  }, [recipeStore, bundle]);

  // γ-next.recipe — pull cached pending recipe whenever the recipe
  // editor view opens for a selected circle.  γ.3's resolver runs
  // automatically from inside the editor when incomingRecipe is
  // non-null + diverges from local.
  useEffect(() => {
    if (view !== 'recipes' || !selected?.id || !kringRecipePendingStore) {
      setIncomingRecipe(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const cached = await kringRecipePendingStore.get(selected.id);
        if (alive) setIncomingRecipe(cached ?? null);
      } catch { if (alive) setIncomingRecipe(null); }
    })();
    return () => { alive = false; };
  }, [view, selected, kringRecipePendingStore]);

  // γ-next.recipe — clear the cached pending recipe after the γ.3
  // resolver applies or discards.  Both paths route through here so
  // a fresh broadcast can land in the slot again.
  const clearIncomingRecipe = useCallback(async () => {
    setIncomingRecipe(null);
    if (selected?.id && kringRecipePendingStore) {
      try { await kringRecipePendingStore.clear(selected.id); } catch { /* ignore */ }
    }
  }, [selected, kringRecipePendingStore]);

  // γ-next.rules — pull cached pending rules doc whenever the rules
  // screen opens for a selected circle.  γ.4's resolver runs
  // automatically from inside the screen when incomingRules is
  // non-null + diverges from local.
  useEffect(() => {
    if (view !== 'rules' || !selected?.id || !kringRulesPendingStore) {
      setIncomingRules(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const cached = await kringRulesPendingStore.get(selected.id);
        if (alive) setIncomingRules(cached ?? null);
      } catch { if (alive) setIncomingRules(null); }
    })();
    return () => { alive = false; };
  }, [view, selected, kringRulesPendingStore]);

  // γ-next.rules — clear the cached pending rules after the γ.4
  // resolver applies or discards.  Both paths route through here so
  // a fresh broadcast can land in the slot again.
  const clearIncomingRules = useCallback(async () => {
    setIncomingRules(null);
    if (selected?.id && kringRulesPendingStore) {
      try { await kringRulesPendingStore.clear(selected.id); } catch { /* ignore */ }
    }
  }, [selected, kringRulesPendingStore]);

  // γ-next.policy — pull cached pending policy doc whenever the settings
  // screen opens for a selected circle.  γ.4's resolver runs
  // automatically from inside the screen when incomingPolicy is
  // non-null + diverges from local.
  useEffect(() => {
    if (view !== 'settings' || !selected?.id || !kringPolicyPendingStore) {
      setIncomingPolicy(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const cached = await kringPolicyPendingStore.get(selected.id);
        if (alive) setIncomingPolicy(cached ?? null);
      } catch { if (alive) setIncomingPolicy(null); }
    })();
    return () => { alive = false; };
  }, [view, selected, kringPolicyPendingStore]);

  // γ-next.policy — clear the cached pending policy after the γ.4
  // resolver applies or discards.  Both paths route through here so
  // a fresh broadcast can land in the slot again.
  const clearIncomingPolicy = useCallback(async () => {
    setIncomingPolicy(null);
    if (selected?.id && kringPolicyPendingStore) {
      try { await kringPolicyPendingStore.clear(selected.id); } catch { /* ignore */ }
    }
  }, [selected, kringPolicyPendingStore]);

  // α.3 — Screens helpers.
  const refreshScreensBook = useCallback(async () => {
    let book;
    try { book = await userScreenStore.get(); }
    catch { book = { screens: [], activeId: null }; }
    // First-run seed: three default screens (Stream, My things,
    // My calendar) so the Schermen tab is immediately useful.  Once
    // any screen exists we never re-seed.
    if (book.screens.length === 0) {
      book = await userScreenStore.update((cur) => {
        let next = addUserScreen(cur, t('circle.screens.seed_name'));
        let id   = next.screens[next.screens.length - 1].id;
        next = updateScreen(next, id, (s) => addBlock(s, 'noticeboard'));
        next = addUserScreen(next, t('circle.screens.seed_my_things'));
        id   = next.screens[next.screens.length - 1].id;
        next = updateScreen(next, id, (s) => addBlock(s, 'tasks'));
        next = addUserScreen(next, t('circle.screens.seed_my_calendar'));
        id   = next.screens[next.screens.length - 1].id;
        next = updateScreen(next, id, (s) => addBlock(s, 'agenda'));
        return next;
      });
    }
    setScreensBook(book);
  }, [userScreenStore]);
  const applyScreenMutation = useCallback(async (mutator) => {
    try { setScreensBook(await userScreenStore.update(mutator)); }
    catch (err) { console.warn('[screens] mutation failed:', err?.message ?? err); }
  }, [userScreenStore]);
  // Refresh + materialize whenever we land on the screens view.
  useEffect(() => {
    if (view !== 'screens') return;
    refreshScreensBook();
  }, [view, refreshScreensBook]);
  useEffect(() => {
    if (view !== 'screens' || screensSubMode !== 'view' || !viewingScreenId) {
      setScreenViewBlocks(null);
      setScreenViewRefreshing(false);
      return;
    }
    const screen = screensBook.screens.find((s) => s.id === viewingScreenId);
    if (!screen) { setScreenViewBlocks([]); setScreenViewRefreshing(false); return; }
    // δ.1 — cache-first render: paint the last materialized payload
    // immediately so the press feels instant, then materialize fresh
    // in the background.  On a cache miss we keep the existing null →
    // Loading… → fresh flow.  `alive` doubles as the race-token: if
    // the user navigates away while materialize is in flight, drop
    // the result.
    let alive = true;
    (async () => {
      // Cache-first read.  Any failure → fall through to the cold path.
      let cached = null;
      try { cached = await screenBlocksCache.get(viewingScreenId); }
      catch { /* ignore */ }
      if (!alive) return;
      if (Array.isArray(cached)) {
        setScreenViewBlocks(cached);
        setScreenViewRefreshing(true);
      } else {
        setScreenViewBlocks(null);
        setScreenViewRefreshing(false);
      }
      try {
        const blocks = await materializeScreen({
          screen,
          hostOps: { callSkill, eventLog, circles, fetchImpl: getCirclePodFetch() || undefined },
        });
        if (!alive) return;
        setScreenViewBlocks(blocks);
        setScreenViewRefreshing(false);
        // Best-effort: write the fresh blocks back so the next open is
        // also instant.  Quota / serialisation failures are silent.
        screenBlocksCache.set(viewingScreenId, blocks).catch(() => { /* ignore */ });
      } catch (err) {
        console.warn('[screens] materialize failed:', err?.message ?? err);
        if (!alive) return;
        // Keep the cached payload visible on materialize failure rather
        // than blanking the screen; just stop the pip.  If there was no
        // cache to begin with, fall back to the empty array.
        setScreenViewRefreshing(false);
        if (!Array.isArray(cached)) setScreenViewBlocks([]);
      }
    })();
    return () => { alive = false; };
  }, [view, screensSubMode, viewingScreenId, screensBook, callSkill, eventLog, circles, screenBlocksCache]);

  const callSkill = useMemo(
    // Pass a catalog getter so the resolver skips origins that don't declare the op
    // (no probe-storm). Lazy → read at dispatch time. The launcher-level resolver uses
    // the RAW merged catalog (`bundle.catalog`); per-circle app scoping happens in
    // CircleDetail. (`catalog` is CircleDetail-local — not in scope here.)
    () => (bundle?.callSkill ? makeResolvingCallSkill(bundle.callSkill, undefined, () => bundle?.catalog) : null),
    [bundle],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sources = callSkill
        ? circleSourcesFromAgent({ callSkill, helpCircleName: () => helpCircleSpec(t).name })
        : {};
      const _l = await loadCircles(sources);
      setCircles(_l);
      // G13 — feed the bundle's per-circle relay registration fresh ids (fire-and-forget, self-catching).
      bundle?.registerCirclePresence?.(_l.map((c) => c?.id).filter(Boolean));
      return _l.length;
    } catch {
      setCircles([]);
      return 0;
    } finally {
      setLoading(false);
    }
  }, [callSkill, bundle]);

  // Task #13 — the two first-run flags (help-circle provisioned · onboarding done), over AsyncStorage IO.
  // The SAME shared store the web shell uses; passed down to CircleDetail so onboarding persists identically.
  const onboardingFlags = useMemo(() => createOnboardingFlags(asyncStorageOnboardingIo(AsyncStorage)), []);
  // Live circle ids for the provisioner's existence check without re-arming the boot effect.
  const circlesRef = useRef(circles);
  circlesRef.current = circles;
  // Provision the default HELP circle (you + the Onderling-bot) ONCE, through the real mobile create path
  // (quickCreateCircle), mirroring web's maybeProvisionHelpCircle. Idempotent + first-run-guarded via the
  // shared provisionHelpCircle orchestrator; best-effort — a failure leaves the marker unset so it retries
  // next boot. Runs after the first circle load so the existence check sees the persisted circles.
  const provisionedRef = useRef(false);
  useEffect(() => {
    if (provisionedRef.current || loading || typeof bundle?.callSkill !== 'function') return;
    provisionedRef.current = true;
    (async () => {
      try {
        const spec = helpCircleSpec(t);
        const r = await provisionHelpCircle({
          isProvisioned: () => onboardingFlags.isHelpCircleProvisioned(),
          listCircleIds: () => (circlesRef.current || []).map((c) => c.id),
          // Real create path (raw callSkill → createGroupV2), the SAME the launcher's "+ new circle" uses.
          createHelpCircle: (s) => quickCreateCircle({ callSkill: bundle.callSkill, name: s.name, id: s.id }),
          // The help circle's roster is a product constant surfaced at render time (helpCircleRoster), so
          // there's no separate member-add op here — parity with the shared provisioner (web≡mobile).
          addBotMember: () => {},
          markProvisioned: () => onboardingFlags.markHelpCircleProvisioned(),
          spec,
          // The circle's name (spec.name) is now its own title ('Uitleg'/'Help'); the bot keeps its own
          // name ('Onderling', circle.onboarding.help_name) so the roster/1:1-header still reads 'Onderling'.
          bot: onderlingBotMember(t('circle.onboarding.help_name')),
        });
        if (r.provisioned) load();
      } catch (err) {
        console.warn('[launcher] help-circle provisioning failed', err?.message ?? err);
        provisionedRef.current = false;   // let the next boot retry
      }
    })();
  }, [loading, bundle, load, onboardingFlags]);

  // objective L · Phase 2 — the unified Contacten roster (PeerGraph bots/peers + stoop ContactBook people),
  // via the SAME shared helpers ContactsScreen uses. Fed to CircleShareScreen for the out-of-circle recipient
  // picker. Loaded lazily when the share view opens (below); best-effort, never blocks the launcher.
  const [shareContacts, setShareContacts] = useState([]);
  const loadShareContacts = useCallback(async () => {
    try {
      const [peerRows, stoopRes] = await Promise.all([
        listContacts(bundle?.peerGraph ?? null).catch(() => []),
        (typeof bundle?.callSkill === 'function' ? bundle.callSkill('stoop', 'listContacts', {}) : Promise.resolve(null)).catch(() => null),
      ]);
      const stoopRows = (Array.isArray(stoopRes?.contacts) ? stoopRes.contacts : []).map(stoopContactToRow).filter(Boolean);
      const merged = mergeContacts(peerRows, stoopRows);
      setShareContacts(merged);
      // Story 1.2 — hand the roster to the pod layer so a canonical REVOKE can re-derive an out-of-circle
      // grantee's sealing key and evict exactly that grantee (instead of rotating away from all of them).
      setCircleContactsSource(() => merged);
    } catch { setShareContacts([]); }
  }, [bundle]);

  // The stoop store hydrates from AsyncStorage a beat AFTER the agent bundle is
  // ready, so the first load can race ahead of it and return 0 circles (the
  // persisted ones look "lost" until the next manual reload). Retry a few times
  // while empty so saved circles surface on their own. Bounded so a genuinely
  // empty account doesn't spin; any real load (≥1 circle) stops it immediately.
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const tick = async () => {
      const n = await load();
      if (!cancelled && n === 0 && callSkill && (tries += 1) < 5) {
        setTimeout(() => { if (!cancelled) tick(); }, 1200);
      }
    };
    tick();
    return () => { cancelled = true; };
    // `circlesRevision` re-runs this when a circle arrives from elsewhere — the retry-while-empty loop is
    // exactly the right shape for it, since a just-joined circle may take a beat to reach the store.
  }, [load, callSkill, circlesRevision]);

  // refresh per-circle pending proposal counts whenever the
  // circle list changes.  countPending is async per circle; we tolerate
  // partial failures (a single bad circle just shows no badge).
  const refreshProposals = useCallback(async () => {
    const next = {};
    for (const c of circles) {
      try {
        const n = govPolicy ? (await openPolicyProposals(govPolicy, c.id)).proposals.length : 0;
        if (n > 0) next[c.id] = n;
      } catch { /* skip this circle */ }
    }
    setProposalCounts(next);
  }, [circles, govPolicy]);
  useEffect(() => { refreshProposals(); }, [refreshProposals]);

  // wire the claim-router hook once the bundle is ready.
  // On claimTask, the host hook reads the per-circle override; when
  // `flowThrough.tasksToPersonal` is true the claimed task is mirrored
  // into the user's primary circle ('cc-default') tagged `via:<circleId>`
  // so the "ON YOUR LIST" section below can surface it.  Web wires the
  // same hook from circleApp.js — keep this parallel.
  useEffect(() => {
    if (typeof bundle?.agent?.setAfterClaimHook !== 'function') return;
    bundle.agent.setAfterClaimHook(makeAfterClaimHook({
      getOverride:       (id) => overrideStore.get(id),
      resolveCircleName: async (id) => circles.find((c) => c.id === id)?.name ?? null,
      addToPersonalCircle: async ({ text, originCircleId, originCircleName, originTaskId, tag }) => {
        if (typeof bundle.callSkill !== 'function') return null;
        try {
          return await bundle.callSkill('tasks', 'addTask', {
            text,
            circleId:           'cc-default',
            originCircleId,
            originCircleName,
            originTaskId,
            tags:             [tag],
          });
        } catch { return null; }
      },
    }));
    // Cleanup: clear the hook on unmount so a hot-reload doesn't
    // leave a stale closure pointing at the previous circles array.
    return () => {
      try { bundle.agent.setAfterClaimHook(null); } catch { /* tolerate */ }
    };
  }, [bundle, overrideStore, circles]);

  // "ON YOUR LIST" tasks scoped to the selected circle.
  // Read from tasks-v0 `getMyTasks` and filter to the rows tagged with
  // `via:<circleId>` (set by the claim-router); falls back to empty on
  // any read failure.  Refreshed when `selected` changes.
  const [myListTasks, setMyListTasks] = useState([]);
  useEffect(() => {
    if (!selected?.id || !callSkill) { setMyListTasks([]); return; }
    let alive = true;
    (async () => {
      try {
        const res = await callSkill('getMyTasks', {});
        const items = Array.isArray(res?.items) ? res.items
          : Array.isArray(res?.tasks) ? res.tasks
          : Array.isArray(res) ? res : [];
        const wanted = `via:${selected.id}`;
        const filtered = items.filter((t) => Array.isArray(t?.tags) && t.tags.includes(wanted));
        if (alive) setMyListTasks(filtered);
      } catch {
        if (alive) setMyListTasks([]);
      }
    })();
    return () => { alive = false; };
  }, [selected, callSkill]);

  const openCircle = useCallback(async (c) => {
    setActiveCircle(c.id);
    // bump the seenAt marker so the unread badge clears on the
    // next launcher render; persist to AsyncStorage for next boot.
    setSeenAt((prev) => {
      const next = bumpSeenAt(prev, c.id);
      AsyncStorage.setItem('cc.circleSeenAt', JSON.stringify(next)).catch(() => {});
      return next;
    });
    // no chat-route fallback anymore. Every tap-on-kring
    // opens the kring view (which will host the GESPREK tab in).
    setSelected(c);
    setView('detail');
    setItems([]);
    // OBJ-2 — pair this circle's members as no-pod household-sync peers (web parity). Both devices do
    // this on open → they become mutual sync peers, so writes fan out. Best-effort; never blocks open.
    feedHouseholdRoster({ agent: bundle?.agent, circleId: c.id }).catch(() => {});
    if (!callSkill) return;
    try {
      const got = await loadCircleItems({ callSkill, circleId: c.id });
      setSelected((cur) => { if (cur && cur.id === c.id) setItems(got); return cur; });
    } catch { /* keep empty */ }
  }, [callSkill, bundle]);

  const closeCircle = () => { setActiveCircle(null); setSelected(null); setItems([]); setView('list'); };

  /**
   * Open the pairwise channel an answer created — rung 3 of the escalation ladder.
   *
   * A TRANSIENT thread, deliberately not written to contacts. Rung 3 is "we are talking now"; rung 4 is
   * "I can reach you from home", and that is a deliberate exchange of the transport→address map the user
   * has not made. Persisting a café encounter into the contact list climbs a rung nobody chose.
   */
  const openNearbyThread = useCallback((thread) => {
    if (!thread?.peerAddress) return;
    setContactThread({
      contactId: thread.peerAddress,
      name: thread.label,
      peerAddr: thread.peerAddress,
      transient: true,
    });
    setView('contacten');
  }, []);

  // Nearby row actions (Nearby step E, host wiring).
  //
  // Only the two the app can actually carry out are offered — `supportedActions` in `NearbyScreenHost`
  // withholds `request-join`, which needs the ask/invite exchange (steps F + H). This handler is therefore
  // allowed to assume it can service what it receives; an id it does not know is logged rather than
  // silently swallowed, so a new shared action shows up as a gap instead of a dead button.
  const handleNearbyAction = useCallback(async (action, row) => {
    const peerId = row?.id ?? null;
    if (!peerId) return;

    if (action === 'open-shared-circle') {
      // The row says "member" because the ROSTER said so. Find a circle we actually share, and open it —
      // never invent one from the fact that we can see each other.
      const shared = circlesRef.current.find((c) =>
        Array.isArray(c?.members) && c.members.some((m) => (m?.pubKey ?? m?.id ?? m) === peerId));
      if (shared) { await openCircle(shared); return; }
      // The roster said member and no circle matched: a stale row, not a reason to open something else.
      console.warn('[nearby] open-shared-circle: no shared circle found for', peerId.slice(0, 12));
      return;
    }

    if (action === 'invite-to-circle') {
      // Invites are per-circle, so this needs a circle chosen first. Sending the user to the list to pick
      // one is honest; guessing which circle they meant is not.
      setView('list');
      return;
    }

    console.warn('[nearby] unhandled action:', action);
  }, [openCircle]);


  // β.5 — context-menu handlers (long-press a tile to open).  Pin / Mute
  // are local toggles; Settings reuses the existing per-circle Settings
  // sub-screen; Leave fires /leave-group (via stoop.leaveGroup) after a
  // native Alert confirmation.
  const onPinCircle = useCallback(async (cid) => {
    try { setPinnedMap(await pinStore.toggle(cid)); }
    catch { /* tolerate */ }
  }, [pinStore]);

  const onMuteCircle = useCallback(async (cid) => {
    try {
      const cur = await overrideStore.get(cid);
      await overrideStore.update(cid, { chatOff: !cur.chatOff });
    } catch { /* tolerate */ }
    refreshMutedMap();
  }, [overrideStore, refreshMutedMap]);

  const onLeaveCircle = useCallback((cid, circle) => {
    const name = circle?.name ?? cid;
    Alert.alert(
      t('circle.tile.menu.leave'),
      t('circle.tile.menu.leave_confirm', { name }),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: t('circle.tile.menu.leave'),
          style: 'destructive',
          onPress: async () => {
            // B4 — the SAME shared leave web uses: the substrate leave, then unbind every member's
            // per-circle address and drop this circle's authorize snapshot. Mobile also had no
            // address de-registration at all, which web has had since J-R4.
            if (typeof bundle?.callSkill === 'function') {
              try {
                await leaveCircleLocally({
                  agent: bundle.agent, callSkill: bundle.callSkill,
                  circleId: cid,
                  unregister: () => unregisterCircleAddresses({
                    transport: bundle.agent?.relay, circleIds: [cid],
                    circleAddressFor: (id) => bundle.agent?.circleAddressFor?.(id) ?? null,
                  }),
                });
              } catch (err) {
                console.warn('[circleLauncher] leaveGroup failed:', err?.message ?? err);
              }
            }
            // Reload circles + drop any pin entry.
            try {
              const cur = await pinStore.get();
              if (cur[cid]) setPinnedMap(await pinStore.toggle(cid));
            } catch { /* tolerate */ }
            load();
          },
        },
      ],
    );
  }, [bundle, pinStore, load]);

  // β.5 — long-press on a tile opens the modal menu.
  const openTileMenu = useCallback((circle) => {
    setMenuCircle(circle);
  }, []);
  const closeTileMenu = useCallback(() => setMenuCircle(null), []);

  // Android back-gesture / hardware back button — pop the current sub-view
  // instead of exiting the app.  Mirrors each screen's existing onBack
  // semantics (the in-screen back button still works the same way).
  // Returning `true` consumes the event; `false` lets the system handle
  // it (exits the app — only when we're at the launcher root + nothing
  // inline to cancel).
  useEffect(() => {
    const handler = () => {
      // β.5 — tile context menu open → close it.  Highest priority since
      // any subsequent state-based pop would feel wrong while the modal
      // is on top.
      if (menuCircle) { setMenuCircle(null); return true; }
      // Inline cancel: creating-circle input row.
      if (creating) { setCreating(false); return true; }   // back closes the create wizard
      // α.3 — viewing a screen (Schermen tab "view" sub-mode) → back to
      // the picker (the screens-tab equivalent of returning from a
      // sub-view to the list).
      if (view === 'screens' && screensSubMode === 'view') {
        setScreensSubMode('picker'); setViewingScreenId(null); return true;
      }
      // Sub-views under a selected circle → back to detail.
      if (selected && (
        view === 'settings' || view === 'override' || view === 'viewas'
        || view === 'advisor' || view === 'skills' || view === 'folio'
        || view === 'rules' || view === 'lists'
      )) { setView('detail'); return true; }
      // Rules consent preview → back to rules editor.
      if (selected && view === 'rulesconsent') { setView('rules'); return true; }
      // Hop screen lives under the Mij tab.
      if (view === 'hop') { setView('availability'); return true; }
      // S2/S5 — Mij sub-views.
      if (view === 'mydata') { setView('profile'); return true; }
      // S3 — admin panel is a sub-view of the circle detail.
      if (selected && view === 'admin') { setView('detail'); return true; }
      if (selected && view === 'governance') { setView('detail'); return true; }
      // Top-level tab screens → back to launcher list.
      if (view === 'availability' || view === 'profile'
          || view === 'nearby' || view === 'mythings') {
        setView('list'); return true;
      }
      // Circle detail → close the circle (back to launcher list).
      if (selected) { closeCircle(); return true; }
      // no onBack fallback (no chat shell to fall back to);
      // at the launcher root, let the system handle (exit).
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [view, selected, creating, menuCircle, screensSubMode]);

  // Bottom tab bar (Screens / Kringen / Mij).  α.3 — Schermen is the
  // new primary; Stroom is retired (now lives as the seeded "Stream"
  // screen on the Screens tab).
  const onTab = (id) => {
    if (id === 'screens') setView('screens');
    else if (id === 'kringen') { setActiveCircle(null); setSelected(null); setView('list'); }
    else if (id === 'contacten') { setContactThread(null); setView('contacten'); }
    else if (id === 'mij') setView('profile');   // S2 — Mij is now the profile
  };

  // OBJ-2 — scanned a circle invite QR → hand it to the shared join wizard.
  const onJoinScan = useCallback((res) => {
    setJoinScanOpen(false);
    if (res && res.kind === 'invite' && res.payload) setJoinArgs({ invite: res.payload });
  }, []);
  // OBJ-2 — show THIS circle's membership QR (admin-gated by the substrate). Carries the same fields a
  // web-built invite does (invariant 2): the freedom template (join-time consent), the pod disclosure +
  // its url (J-NP3, rule 1), the admin's NKN address (B2) and the RELAY endpoint (the invite-carries-
  // endpoint decision — a pasted invite has no deep-link context to learn the relay from). Every read is
  // best-effort: a failure omits the field, never blocks the invite. (`offeringsMatching` stays a listed
  // web-only exception — the board-8 admin draft lives in web localStorage.)
  // The publication lock, read at invite-build time so a flip takes effect without a remount.
  const addressSharingIo = useMemo(() => asyncStorageAddressSharingIo(AsyncStorage), []);
  const [shareNknAddress, setShareNknAddress] = useState(true);
  useEffect(() => { addressSharingIo.load().then(setShareNknAddress).catch(() => {}); }, [addressSharingIo]);

  const openCircleInvite = useCallback(async (circleId) => {
    let r;
    try {
      let pol = {};
      try { pol = (await policyStore.get(circleId)) ?? {}; } catch { pol = {}; }
      let storage = null;
      try { storage = await loadCircleStoragePod({ callSkill: bundle?.callSkill, circleId }); } catch { storage = null; }
      const podBacked = storage?.pod === 'shared' || storage?.pod === 'hybrid';
      // The relay THIS circle rides per the points mapping, else the device's live relay (web parity).
      let relayUrl = null;
      try {
        const io = asyncStorageConnectionPointsIo(AsyncStorage);
        const store = createConnectionPoints({ initial: await io.load(), save: () => {} });
        relayUrl = store.pointsFor(circleId).find((p) => (p?.kind ?? 'relay') === 'relay')?.url ?? null;
      } catch { relayUrl = null; }
      if (!relayUrl) { try { relayUrl = await resolveMobileRelayUrl(); } catch { relayUrl = null; } }
      r = await buildCircleInviteUri({
        callSkill: bundle?.callSkill, circleId,
        adminPeerAddr: bundle?.agent?.householdSelfAddr ?? null,
        // Gated by the publication lock (J-CS8): with sharing off the invite carries no NKN address.
        // A lock that held only on web would invite trust on the wrong device.
        adminNknAddr:  shareableAddress(bundle?.agent?.peer?.address ?? null, shareNknAddress),
        capabilities: pol.capabilities, apps: pol.apps,
        podBacked, podUrl: podBacked ? (storage?.groupPodUri ?? null) : null,
        relayUrl,
      });
    } catch { r = { error: 'failed' }; }
    setInviteFor({ circleId, ...(r || {}) });
  }, [bundle, policyStore, shareNknAddress]);

  if (view === 'screens') {
    // α.3 — Screens primary tab.  Two sub-modes: 'picker' (CRUD list)
    // and 'view' (render the active screen's materialized blocks).
    if (screensSubMode === 'view') {
      const screen = screensBook.screens.find((s) => s.id === viewingScreenId);
      return (
        <WithTabBar active="screens" onSelect={onTab}>
          <View style={{ flex: 1, padding: 16, backgroundColor: theme.color.paper }}>
            <Pressable
              onPress={() => { setScreensSubMode('picker'); setViewingScreenId(null); }}
              accessibilityRole="button"
              testID="screens-view-back"
            >
              <Text style={{ color: theme.color.inkSoft, fontSize: 13, marginBottom: 8 }}>
                ← {t('circle.screens.picker_title')}
              </Text>
            </Pressable>
            <Text style={{ fontFamily: theme.font.serif, fontSize: 22, fontWeight: '600', color: theme.color.ink, marginBottom: 12 }}>
              {screen?.name || t('circle.screens.untitled')}
            </Text>
            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              <CircleScreenView blocks={screenViewBlocks} refreshing={screenViewRefreshing} />
            </ScrollView>
          </View>
        </WithTabBar>
      );
    }
    return (
      <WithTabBar active="screens" onSelect={onTab}>
        <CircleScreensPickerScreen
          book={screensBook}
          onOpenScreen={(sid) => { setViewingScreenId(sid); setScreensSubMode('view'); }}
          onAddScreen={(name) => applyScreenMutation((cur) => {
            const next = addUserScreen(cur, name);
            const newId = next.screens[next.screens.length - 1].id;
            return updateScreen(next, newId, (s) => addBlock(s, 'noticeboard'));
          })}
          onRenameScreen={(sid, name) => applyScreenMutation((cur) => renameUserScreen(cur, sid, name))}
          onRemoveScreen={(sid) => applyScreenMutation((cur) => removeUserScreen(cur, sid))}
          onSetActive={(sid) => applyScreenMutation((cur) => setActiveScreen(cur, sid))}
        />
      </WithTabBar>
    );
  }
  // S2 — Mij = your profile (identity + skills + location); availability is a sub-view.
  if (view === 'profile') {
    return (
      <WithTabBar active="mij" onSelect={onTab}>
        <CircleProfileScreen callSkill={bundle?.callSkill} onAvailability={() => setView('availability')} onMyData={() => setView('mydata')} onSharedWithMe={() => setView('sharedWithMe')} />
      </WithTabBar>
    );
  }
  // SILENT out-of-circle delivery — the personal, cross-circle "shared with me" inbox
  // (sealed copies peers pushed to this device). Sub-view of Mij; back returns to profile.
  // web ≡ mobile: renders the SAME SharedWithMeScreen over the SAME shared selector web uses.
  // `received` is loaded from the bundle's per-user shared-with-me store (the effect above);
  // `opener` is this device's own network-derived sealing opener (bundle.sharedWithMeOpener,
  // built from the encapsulated identity secret). A null opener makes a row tap a deny-safe no-op.
  if (view === 'sharedWithMe') {
    return (
      <WithTabBar active="mij" onSelect={onTab}>
        <SharedWithMeScreen
          received={sharedWithMeList}
          opener={bundle?.sharedWithMeOpener ?? null}
          onBack={() => setView('profile')}
        />
      </WithTabBar>
    );
  }
  // S5 — "My data": data-location + privacy + usage (read-only); sub-view of Mij.
  if (view === 'mydata') {
    return (
      <WithTabBar active="mij" onSelect={onTab}>
        <CircleMyDataScreen callSkill={bundle?.callSkill} podAuth={podAuth} eventLog={eventLog} onBack={() => setView('profile')} chatAi={chatAi} userLlm={userLlmCfg} onSaveUserLlm={onSaveUserLlm} validateUserLlm={validateUserLlmConfig} onReconnectPeer={bundle?.reconnectPeer} onOpenConnectionPoints={() => setView('points')} />
      </WithTabBar>
    );
  }
  if (view === 'availability') {
    return (
      <WithTabBar active="mij" onSelect={onTab}>
        <CircleAvailabilityScreen
          store={availabilityStore}
          onHop={() => setView('hop')}
        />
      </WithTabBar>
    );
  }
  // Contacten: the bot/peer roster + a 1:1 DM thread (mobile parity with web).
  if (view === 'contacten') {
    if (contactThread) {
      // cluster J — a feedback bot is a co-hosted agent, not a PeerGraph peer: open the dedicated feedback
      // thread (activates the verify pods) instead of the peer-DM thread.
      if (contactThread.isFeedback) {
        return (
          <WithTabBar active="contacten" onSelect={onTab}>
            <FeedbackThreadScreen
              session={sessionRef?.current ?? null}
              bot={contactThread.bot}
              store={feedbackStore}
              onBack={() => setContactThread(null)}
              identity={bundle?.coreAgent?.identity ?? null}
              // Anonymous bug-report send: the SAME peer/relay transport the bundle uses everywhere else.
              sendPeer={(a, p) => bundle?.agent?.sendPeerMessage?.(a, p)}
              // "Secure your access" reveal/restore reaches the household recovery-phrase skills via callSkill.
              callSkill={(o, op, a) => bundle?.callSkill?.(o, op, a)}
            />
          </WithTabBar>
        );
      }
      return (
        <WithTabBar active="contacten" onSelect={onTab}>
          <ContactThreadScreen
            bundle={bundle}
            contact={contactThread}
            onBack={() => setContactThread(null)}
          />
        </WithTabBar>
      );
    }
    return (
      <WithTabBar active="contacten" onSelect={onTab}>
        <ContactsScreen bundle={bundle} feedbackStore={feedbackStore} onOpen={(contact) => setContactThread(contact)} />
      </WithTabBar>
    );
  }
  // (Batch 5) the `stream` view is GONE — the cross-circle Stream VIEW retired (its tab left the bar
  // long ago; nothing could `setView('stream')` since). The LOG is untouched; every remaining surface
  // projects it via `circleRows`/`chatRows`. Web's `showStream` retired in the same batch (web≡mobile).
  // S3 — group admin panel (member roster + remove + announcements + moderation).
  if (selected && view === 'admin') {
    return (
      <CircleAdminPanelScreen
        callSkill={bundle?.callSkill}
        agent={bundle?.agent}
        groupId={selected.id}
        onBack={() => setView('detail')}
      />
    );
  }
  if (selected && view === 'governance') {   // Wave C §5 — governance surface (web≡mobile)
    return (
      <CircleGovernanceScreen
        callSkill={bundle?.callSkill}
        circleIdentityFor={bundle?.agent?.circleIdentityFor ?? null}
        eventLog={eventLog}
        getPolicy={(cid) => policyStore.get(cid)}
        updatePolicy={(cid, next) => policyStore.update(cid, next)}
        circleId={selected.id}
        onBack={() => setView('detail')}
      />
    );
  }
  if (selected && view === 'lists') {   // the composable lists/container UI (web≡mobile)
    return <CircleListsScreen circleId={selected.id} onBack={() => setView('detail')} />;
  }
  if (selected && view === 'share') {   // objective L — the cross-circle share UI (web≡mobile)
    // Thread the signed-in member's WebID as the acting identity (initiator gate `by` + read subject
    // `recipient`), mirroring web's circleOwnerWebId. Null when signed out ⇒ the wrappers keep deny-by-default.
    const actorWebId = getCircleActorWebId();
    return (
      <CircleShareScreen
        circleId={selected.id} policy={selectedPolicy}
        by={actorWebId} recipient={actorWebId}
        circles={circles} contacts={shareContacts}
        onBack={() => setView('detail')}
      />
    );
  }
  if (selected && view === 'settings') {
    // γ-next.policy — broadcast cache → editor → γ.4 resolver.  The
    // resolver is opt-in; when `incomingPolicy` is null the editor
    // renders untouched.  Applied / discarded both clear the cache.
    //
    // Send-side: the settings editor owns the `store.update` call (so
    // proposal + commit paths route through one place); we wrap the
    // store here so a fresh update fans the post-save policy out to
    // peers via stoop's `broadcastKringPolicy`.  Fire-and-forget;
    // per-peer errors land in result.errors which we log.  No-op when
    // callSkill / no agent.
    const broadcastingStore = {
      ...policyStore,
      update: async (cid, next) => {
        const r = await policyStore.update(cid, next);
        if (next && typeof next === 'object' && typeof bundle?.callSkill === 'function') {
          const msgId = `kring-policy-${cid}-${Date.now()}`;
          const ts    = Date.now();
          bundle.callSkill('stoop', 'broadcastKringPolicy', {
            groupId: cid, policy: next, msgId, ts,
          }).then((res) => {
            if (res?.error) console.warn('[kring-policy] fan-out skipped:', res.error);
          }).catch((err) => {
            console.warn('[kring-policy] fan-out failed:', err?.message ?? err);
          });
        }
        return r;
      },
    };
    return (
      <CircleSettingsScreen
        store={broadcastingStore}
        onProposePolicy={async (cid, patch) => {
          if (!govPolicy) return;
          await govPolicy.propose({
            circleId: cid, action: 'changePolicy', subject: patch,
            actor: { ref: getCircleActorWebId() || '', role: 'admin' },
          });
        }}
        circleId={selected.id}
        callSkill={bundle?.callSkill}
        // B · consent-card — inject the member-override store (records declined optional caps as
        // capabilityOptOuts) + the pod session's authed fetch, exactly as web circleApp.js does.
        overrideStore={overrideStore}
        podFetch={getCirclePodFetch() || undefined}
        incomingPolicy={incomingPolicy}
        onIncomingApplied={clearIncomingPolicy}
        onIncomingDiscarded={clearIncomingPolicy}
        // OBJ-2 — paired devices (no-pod sync). The agent exposes the household roster surface.
        householdSelfAddr={bundle?.agent?.householdSelfAddr ?? null}
        householdPeers={bundle?.agent?.listHouseholdPeers?.(selected.id) ?? []}
        onAddHouseholdPeer={(addr) => (bundle?.agent?.pairWithPeer ?? bundle?.agent?.addCirclePeer)?.(selected.id, addr)}
        onRemoveHouseholdPeer={(addr) => bundle?.agent?.removeHouseholdPeer?.(selected.id, addr)}
        // Phase 4 §9 — the device transport state the enabledWhen fold reads + the built-in dispatcher
        // for device-scoped controls (transport-mode · relay endpoint). web parity with circleApp.js.
        transport={circleTransport}
        onControl={onCircleControl}
        // #80 — re-read the just-saved policy so CircleDetail's gate/tabs/catalog update live
        // (the settings onSave awaits store.update before calling onBack, so this sees the new value).
        onBack={() => { refreshProposals(); reloadSelectedPolicy(); setView('detail'); }}
      />
    );
  }
  if (selected && view === 'override') {
    return <CircleOverrideScreen store={overrideStore} policyStore={policyStore} circleId={selected.id} onBack={() => setView('detail')} />;
  }
  if (selected && view === 'viewas') {
    // F-5.1 — real member directory loaded in onViewAs via listGroupMembers.
    return <CircleViewAsScreen members={viewAsMembers} policy={viewAsPolicy} onBack={() => setView('detail')} />;
  }
  if (view === 'hop') {
    // Hopping lives under the Mij tab (personal settings).
    return <CircleHopScreen callSkill={callSkill} onBack={() => setView('availability')} />;
  }
  if (view === 'points') {
    // Connection points (Nearby step I). The store is hydrated + migrated by the host component below.
    return <ConnectionPointsHost onBack={() => setView('mydata')} />;
  }
  if (view === 'nearby') {
    // Nearby screen. Driven by `createNearbyScreen` (shared with web), fed from the SURFACE — the
    // discoverability control + merged peer source on the bundle — never from `bundle.mdns` directly.
    // On a device with no discovering transport the surface is honest about it rather than silent:
    // the banner says "unavailable" instead of the screen looking like an empty room.
    return (
      <NearbyScreenHost
        bundle={bundle}
        onBack={() => setView('list')}
        onAction={handleNearbyAction}
        onOpenThread={openNearbyThread}
        onJoinInvite={(uri) => setJoinArgs({ invite: uri })}
      />
    );
  }
  if (view === 'mythings') {
    // Mijn dingen (private kring as notes-list).
    return (
      <MyThingsScreen files={myThingsFiles} onBack={() => setView('list')} />
    );
  }
  if (selected && view === 'advisor') {
    return <CircleAdvisorScreen eventLog={eventLog} circleId={selected.id} onBack={() => setView('detail')} />;
  }
  if (selected && view === 'skills') {
    return (
      <CircleOfferingEditorScreen
        skill={skillDraft}
        onSave={async (s) => {
          try { await AsyncStorage.setItem(`cc.circleSkill.${selected.id}`, JSON.stringify(s)); } catch { /* ignore */ }
          setSkillDraft(s);
          setView('detail');
        }}
        onBack={() => setView('detail')}
      />
    );
  }
  if (selected && view === 'folio') {
    // F-5.2 — real files loaded in onFiles via listFiles, scoped to the circle.
    return (
      <CircleFolioScreen
        files={folioFiles}
        rawFiles={rawFolioFiles}
        circleId={selected.id}
        myCircles={circles}
        capabilityMatrix={folioCapMatrix}
        appOrigin="folio"
        onBack={() => setView('detail')}
      />
    );
  }
  if (selected && view === 'rules') {
    // γ-next.rules — broadcast cache → editor → γ.4 resolver.  The
    // resolver is opt-in; when `incomingRules` is null the screen
    // renders untouched.  Applied / discarded both clear the cache.
    return (
      <CircleRulesScreen
        doc={rulesDoc}
        incomingRules={incomingRules}
        rulesStore={rulesStore}
        circleId={selected.id}
        onIncomingApplied={clearIncomingRules}
        onIncomingDiscarded={clearIncomingRules}
        onBack={() => setView('detail')}
        onPreview={(working) => { setRulesPreview(working); setView('rulesconsent'); }}
        onSave={async (doc) => {
          // γ.2 — saves go through rulesStore so the versions adapter
          // snapshots the doc into cc.versions.rules.<id> before the
          // canonical write lands.
          try { await rulesStore.set(selected.id, doc); } catch { /* ignore */ }
          setRulesDoc(doc);
          // γ-next.rules — fan the just-saved rules doc out to peers.
          // Fire-and-forget; per-peer errors land in result.errors which
          // we log.  No-op when callSkill / no agent / no doc.
          if (doc && typeof bundle?.callSkill === 'function') {
            const msgId = `kring-rules-${selected.id}-${Date.now()}`;
            const ts    = Date.now();
            bundle.callSkill('stoop', 'broadcastKringRules', {
              groupId: selected.id, rulesDoc: doc, msgId, ts,
            }).then((r) => {
              if (r?.error) console.warn('[kring-rules] fan-out skipped:', r.error);
            }).catch((err) => {
              console.warn('[kring-rules] fan-out failed:', err?.message ?? err);
            });
          }
          setView('detail');
        }}
      />
    );
  }
  if (selected && view === 'rulesconsent') {
    // Preview from the editor: Agree/Decline just return (real join-flow consent is the follow-on).
    return (
      <CircleRulesConsentScreen
        doc={rulesPreview}
        onBack={() => setView('rules')}
        onAgree={() => setView('rules')}
        onDecline={() => setView('rules')}
      />
    );
  }
  if (selected && view === 'recipes') {
    // α.1d.3 — recipe editor (book ↔ recipe modes; persistence flows
    // through recipeStore via applyRecipeMutation).
    return (
      <CircleRecipeEditorScreen
        book={recipeBook}
        mode={recipeEditorMode}
        editingRecipeId={recipeEditingId}
        // γ-next.recipe — broadcast cache → editor → γ.3 resolver.
        incomingRecipe={incomingRecipe}
        recipeStore={recipeStore}
        circleId={selected.id}
        onIncomingApplied={clearIncomingRecipe}
        onIncomingDiscarded={clearIncomingRecipe}
        onBack={() => setView('detail')}
        onOpenRecipe={(rid) => { setRecipeEditingId(rid); setRecipeEditorMode('recipe'); }}
        onBackToBook={() => { setRecipeEditorMode('book'); setRecipeEditingId(null); }}
        onAddRecipe={(name) => applyRecipeMutation(selected.id, (cur) => addRecipe(cur, name))}
        onRenameRecipe={(rid, name) => applyRecipeMutation(selected.id, (cur) => renameRecipe(cur, rid, name))}
        onRemoveRecipe={(rid) => applyRecipeMutation(selected.id, (cur) => removeRecipe(cur, rid))}
        onSetActive={(rid) => applyRecipeMutation(selected.id, (cur) => setActiveRecipe(cur, rid))}
        onAddBlock={(rid, type) => applyRecipeMutation(selected.id, (cur) => updateRecipe(cur, rid, (r) => addBlock(r, type)))}
        onRemoveBlock={(rid, bid) => applyRecipeMutation(selected.id, (cur) => updateRecipe(cur, rid, (r) => removeBlock(r, bid)))}
        onMoveBlock={(rid, bid, idx) => applyRecipeMutation(selected.id, (cur) => updateRecipe(cur, rid, (r) => moveBlock(r, bid, idx)))}
        onUpdateBlock={(rid, bid, patch) => applyRecipeMutation(selected.id, (cur) => updateRecipe(cur, rid, (r) => updateBlock(r, bid, patch)))}
      />
    );
  }
  if (selected) {
    return (
      <CircleDetail
        circle={selected}
        deliveryStateMap={deliveryStateMap}
        registerKringBotSink={registerKringBotSink}
        onAcceptFallback={onAcceptFallback}
        items={items}
        callSkill={callSkill}
        rawCallSkill={bundle?.callSkill}
        catalog={bundle?.catalog}
        policy={selectedPolicy}
        peerGraph={bundle?.peerGraph ?? null}
        myListTasks={myListTasks}
        eventLog={eventLog}
        circles={circles}
        recipeStore={recipeStore}
        onStoopEvent={bundle?.onStoopEvent}
        sendPersonaUpdate={bundle?.sendPersonaUpdate}
        disclosureShareMemo={bundle?.disclosureShareMemo}
        resealMediaForCircle={resealMediaForCircle}
        profilePicture={profilePicture}
        coreIdentity={bundle?.coreAgent?.identity ?? null}
        onCircleControl={onCircleControl}
        circleTransport={circleTransport}
        /* Task #13 — first-run flags (shared with the launcher's provisioner) + the onboarding
           "Ja, help me" handoff → the mobile create flow (close the help circle, open "+ new circle"). */
        onboardingFlags={onboardingFlags}
        onCreateCircle={() => { closeCircle(); setCreating(true); }}
        onBack={closeCircle}
        onInvite={() => openCircleInvite(selected.id)}
        onSettings={() => setView('settings')}
        onAdmin={() => setView('admin')}
        onGovernance={() => setView('governance')}
        onReportMember={(m) => { const ref = m?.webid || m?.id; if (ref) fileCircleReportMobile('member', ref, m?.handle || m?.realName || ref); }}
        onReportPost={(post) => { if (post?.id) fileCircleReportMobile('post', post.id, (post.text || '').slice(0, 48)); }}
        onReportMessage={(row) => { if (row?.id) fileCircleReportMobile('message', row.id, (row?.event?.payload?.text || '').slice(0, 48)); }}
        onMine={() => setView('override')}
        onViewAs={async () => {
          const p = await policyStore.get(selected.id);
          setViewAsPolicy(p?.revealPolicy ?? 'pairwise');
          let mem = [];
          if (callSkill) {
            try { mem = normalizeCircleMembers(await callSkill('listGroupMembers', { groupId: selected.id })); } catch { /* keep empty */ }
          }
          setViewAsMembers(mem);
          setView('viewas');
        }}
        onAdvisor={() => setView('advisor')}
        onSkills={async () => {
          let raw = null;
          try { const s = await AsyncStorage.getItem(`cc.circleSkill.${selected.id}`); if (s) raw = JSON.parse(s); } catch { /* fresh */ }
          setSkillDraft(raw);
          setView('skills');
        }}
        onFiles={async () => {
          let fs = [];
          let raw = null;
          if (callSkill) {
            try {
              raw = await callSkill('listFiles', {});
              fs = circleFilesFromListFiles(raw, selected.id);
            } catch { /* keep empty */ }
          }
          setFolioFiles(fs);
          // keep the raw list so the share-toggle pills can
          // re-project without a refetch.  Unwrap to a plain array if the
          // result is wrapped (`{items}` / `{files}`).
          const rawArr = !raw ? null
            : Array.isArray(raw.items) ? raw.items
            : Array.isArray(raw.files) ? raw.files
            : Array.isArray(raw) ? raw : null;
          setRawFolioFiles(rawArr);
          setView('folio');
        }}
        onRules={async () => {
          // γ.2 — load via rulesStore (same on-disk key as before:
          // `cc.circleRules.<id>`).
          let doc = null;
          try { doc = await rulesStore.get(selected.id); } catch { /* fresh */ }
          setRulesDoc(doc);
          setView('rules');
        }}
        onRecipes={async () => {
          await refreshRecipeBook(selected.id);
          setRecipeEditorMode('book');
          setRecipeEditingId(null);
          setView('recipes');
        }}
        onLists={() => setView('lists')}
        onShare={() => { loadShareContacts(); setView('share'); }}
      />
    );
  }

  return (
    <WithTabBar active="kringen" onSelect={onTab}>
      <View style={styles.page} testID="circle-launcher">
        {/* no "← chat" button (no chat shell to navigate to). */}
        <Text style={styles.title}>{t('circle.title')}</Text>

        {/* A RELOAD MUST NOT REMOVE WHAT IS ALREADY ON SCREEN — this is the two-taps-to-open bug.
            `load()` sets `loading` for the whole round-trip, and this branch used to swap the entire list
            for the loading line. React Native ends an in-flight press when the row it started on
            unmounts, so any tap that straddled a reload was simply dropped and the user tapped again.
            And reloads are common exactly where the miss was seen: joining from an invite link bumps
            `circlesRevision`, and the boot retry re-runs `load()` up to five times.
            So the placeholder is for an EMPTY list only — a refresh now repaints in place. */}
        {loading && circles.length === 0 ? (
          <Text style={styles.muted}>{t('circle.loading')}</Text>
        ) : (
          <ScrollView
            contentContainerStyle={styles.list}
            // …and the sibling class of first-tap loss: with this unset a ScrollView spends the first tap
            // dismissing the keyboard instead of hitting the row under it. Same value the other circle
            // list already uses (`CircleListScreen.js`).
            keyboardShouldPersistTaps="handled"
          >
            {bundle?.mdns ? (
              <View style={styles.nearbyRow} testID="circle-nearby">
                <Text style={styles.nearbyText}>
                  {formatNearbyLabel(nearbyCount, t)}
                </Text>
              </View>
            ) : null}

            {/* β.1 — Nearby + Mijn dingen launcher shortcuts removed.
                Nearby lives under the Mij tab; My-things is a seeded screen
                under the Schermen tab. */}
            {circles.length === 0 ? (
              <Text style={styles.muted}>{t('circle.empty')}</Text>
            ) : (
              renderLauncherGroups(circles, {
                previews, proposalCounts, openCircle,
                // β.5 — pin partition + long-press menu wiring.
                pinnedMap, mutedMap, onOpenMenu: openTileMenu,
              }, styles)
            )}

            {/* The inline name row is gone — "+ new circle" now opens the 5-step wizard (mounted below),
                so the button stays visible while the wizard is up. */}
            {(
              <Pressable
                style={styles.newBtn}
                accessibilityRole="button"
                onPress={() => setCreating(true)}
              >
                <Text style={styles.newText}>{t('circle.new')}</Text>
              </Pressable>
            )}
            {!creating ? (
              <Pressable style={styles.joinBtn} accessibilityRole="button" onPress={() => setJoinScanOpen(true)}>
                <Text style={styles.joinText}>{t('circle.join.button')}</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        )}
        {/* OBJ-2 — scan an invite QR, then run the shared join wizard (no-pod redeem via the bundle's sender). */}
        <QrScannerModal visible={joinScanOpen} onClose={() => setJoinScanOpen(false)} onResult={onJoinScan} t={t} />
        {/* Mount only once we have the invite — the wizard decodes it in its useState initializer (runs
            once on mount), so an always-mounted modal would cache a "no invite" error. */}
        {joinArgs ? (
          <JoinGroupWizardModal
            visible
            args={joinArgs}
            callSkill={bundle?.callSkill}
            sendPeerRedeem={bundle?.sendPeerRedeem}
            t={t}
            // The join sheet is the first surface a new person meets; it was hardcoded light and arrived
            // as a white sheet in a dark app (S3, 2026-07-30). The theme lives here, in the shell.
            theme={theme}
            circles={circles}
            circleAddressFor={(cid) => bundle?.agent?.circleAddressFor?.(cid) ?? null}
            signCircleLink={(cid, gid, addr) => bundle?.agent?.signCircleLink?.(cid, gid, addr) ?? null}
            // J-CP1 — be on the circle's endpoint BEFORE the redeem. The invite names it; without this
            // the redeem goes out over whatever transport this device happens to have, and a relay-only
            // admin never hears it.
            dialEndpoint={(url) => bundle?.reconnectPeer?.({ relayUrl: url })}
            activeEndpointUrl={() => bundle?.activeRelayUrl?.() ?? null}
            // Post-join reachability (G13) — the same seam the chat-shell host passes, so a join is
            // equally complete from either surface. This screen already bound the roster keys in
            // `onDispatched`; what it never did was RE-REGISTER this device's per-circle address, so the
            // circle just joined was missing from the relay until the next circles load.
            onJoined={bundle?.onCircleJoined}
            onClose={() => setJoinArgs(null)}
            onDispatched={(r) => {
              setJoinArgs(null);
              const gid = r?.groupId ?? r?.joinedGroupId ?? null;
              if (gid) feedHouseholdRoster({ agent: bundle?.agent, circleId: gid }).catch(() => {});
              // Rule 1 (web parity) — record the joined circle's pod/relay connection point(s) from what
              // the invite carried (the modal passes the decoded invite back). Best-effort by design:
              // the list is a convenience, a failure never breaks the join.
              if (gid && r?.invite) {
                (async () => {
                  try {
                    const io = asyncStorageConnectionPointsIo(AsyncStorage);
                    const store = createConnectionPoints({ initial: await io.load(), save: (v) => { io.save(v); } });
                    recordJoinedCirclePoints({ store, invite: r.invite, circleId: gid });
                    bundle?.registerCirclePresence?.();   // G13 — a new relay point changes the scoping
                  } catch { /* best-effort */ }
                })();
              }
              load();
            }}
          />
        ) : null}
        {/* Starting a circle opens the RICH 5-step wizard (identity · governance · rules · offerings · tech
            → review) — web parity (2026-07-26). It used to render a bare inline name row, so the wizard we
            built was reachable only through the onboarding handoff and every governance/rules/offerings
            choice silently defaulted. `quickCreateCircle` stays the PROGRAMMATIC create (help circle). */}
        {creating ? (
          <CreateGroupWizardModal
            visible
            callSkill={bundle?.callSkill}
            t={t}
            getMyPeerAddr={() => bundle?.agent?.peer?.address ?? null}
            persistPolicy={(groupId, patch) => policyStore.update?.(groupId, patch)}
            onClose={() => setCreating(false)}
            onDispatched={(r) => {
              setCreating(false);
              const gid = r?.groupId ?? null;
              if (gid) feedHouseholdRoster({ agent: bundle?.agent, circleId: gid }).catch(() => {});
              load();
            }}
          />
        ) : null}
        {/* OBJ-2 — invite QR for a circle (admin shows it; another device scans). */}
        <Modal visible={!!inviteFor} transparent animationType="fade" onRequestClose={() => setInviteFor(null)}>
          <Pressable style={styles.inviteBackdrop} onPress={() => setInviteFor(null)}>
            <Pressable style={styles.inviteCard} onPress={() => {}}>
              <Text style={styles.inviteTitle}>{t('circle.invite.title')}</Text>
              {inviteFor?.uri ? (
                <>
                  <QrCodeView value={inviteFor.uri} size={200} />
                  <Text style={styles.inviteHint}>{t('circle.invite.hint')}</Text>
                  {/* B5 — web ≡ mobile: the same "n of m places used" line, from the same key. */}
                  {typeof inviteFor.maxRedemptions === 'number' && typeof inviteFor.redemptionsUsed === 'number' ? (
                    <Text style={styles.inviteHint}>
                      {t('circle.invite.uses_left', { used: inviteFor.redemptionsUsed, max: inviteFor.maxRedemptions })}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.inviteHint}>{inviteFor?.error === 'admin-only' ? t('circle.invite.admin_only') : t('circle.invite.no_code')}</Text>
              )}
            </Pressable>
          </Pressable>
        </Modal>
        {/* β.5 — per-tile context menu, rendered as a transparent modal
            so a tap outside the sheet dismisses it.  The four actions
            mirror web: pin (toggle), mute (toggle), settings, leave. */}
        <Modal
          transparent
          visible={!!menuCircle}
          animationType="fade"
          onRequestClose={closeTileMenu}
        >
          <Pressable
            style={styles.tileMenuBackdrop}
            onPress={closeTileMenu}
            testID="circle-launcher-tile-menu-backdrop"
          >
            <View style={styles.tileMenuSheet} testID="circle-launcher-tile-menu">
              {(() => {
                if (!menuCircle) return null;
                const cid = menuCircle.id;
                const isPinned = !!pinnedMap[cid];
                const isMuted  = !!mutedMap[cid];
                const items = [
                  {
                    key: 'invite',
                    label: t('circle.invite.menu'),
                    onPress: () => { closeTileMenu(); openCircleInvite(cid); },
                  },
                  {
                    key: 'pin',
                    label: t(isPinned ? 'circle.tile.menu.unpin' : 'circle.tile.menu.pin'),
                    onPress: () => { closeTileMenu(); onPinCircle(cid); },
                  },
                  {
                    key: 'mute',
                    label: t(isMuted ? 'circle.tile.menu.unmute' : 'circle.tile.menu.mute'),
                    onPress: () => { closeTileMenu(); onMuteCircle(cid); },
                  },
                  {
                    key: 'settings',
                    label: t('circle.tile.menu.settings'),
                    onPress: () => {
                      closeTileMenu();
                      setSelected(menuCircle);
                      setView('settings');
                    },
                  },
                  {
                    key: 'leave',
                    label: t('circle.tile.menu.leave'),
                    onPress: () => {
                      closeTileMenu();
                      onLeaveCircle(cid, menuCircle);
                    },
                  },
                ];
                return items.map((it) => (
                  <Pressable
                    key={it.key}
                    style={styles.tileMenuItem}
                    onPress={it.onPress}
                    accessibilityRole="button"
                    testID={`circle-launcher-tile-menu-${it.key}`}
                  >
                    <Text style={styles.tileMenuItemText}>{it.label}</Text>
                  </Pressable>
                ));
              })()}
            </View>
          </Pressable>
        </Modal>
      </View>
    </WithTabBar>
  );
}

// β.3 — fixed display order for kring-kind section headers; anything not in
// this list is bucketed under 'other' (last).  Mirrors web circleLauncher.js
// and the values produced by the create wizard + circleModel.normalizeCircle.
const KIND_ORDER = ['household', 'buurt', 'vriendenkring'];

/**
 * β.1+β.2+β.3+β.5 — render the kringen list:
 *   - β.2 sort by recent activity (preview.ts desc; stable name tiebreak)
 *   - β.5 partition into pinned + unpinned within each section (pins
 *     float to the top of their kind section without escaping it)
 *   - β.3 group by `kind` with section headers (KIND_ORDER then 'other');
 *     when all kringen share one kind, headers are skipped (flat list).
 */
function renderLauncherGroups(circles, {
  previews, proposalCounts, openCircle,
  pinnedMap = {}, mutedMap = {}, onOpenMenu,
}, styles) {
  const sorted = [...circles].sort((a, b) => {
    const ta = previews?.[a.id]?.ts ?? 0;
    const tb = previews?.[b.id]?.ts ?? 0;
    if (tb !== ta) return tb - ta;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  // β.5 — partition by pin BEFORE grouping so pinned tiles float to the
  // top of their kind section without escaping it.
  const pinned = sorted.filter((c) => pinnedMap[c.id]);
  const unpinned = sorted.filter((c) => !pinnedMap[c.id]);
  const ordered = [...pinned, ...unpinned];

  const groups = new Map();
  for (const c of ordered) {
    const k = KIND_ORDER.includes(c.kind) ? c.kind : 'other';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const orderedKinds = [...KIND_ORDER, 'other'].filter((k) => groups.has(k));
  const showHeaders = orderedKinds.length > 1;
  if (!showHeaders) {
    return ordered.map((c) => (
      <LauncherTile
        key={c.id}
        circle={c}
        preview={previews?.[c.id]}
        pending={Number(proposalCounts?.[c.id]) || 0}
        isPinned={!!pinnedMap[c.id]}
        isMuted={!!mutedMap[c.id]}
        onOpen={openCircle}
        onLongPress={onOpenMenu}
      />
    ));
  }
  return orderedKinds.map((kind) => (
    <View key={`section-${kind}`} style={styles.section} testID={`circle-launcher-section-${kind}`}>
      <Text style={styles.sectionTitle}>{t(`circle.kind.${kind}`)}</Text>
      {groups.get(kind).map((c) => (
        <LauncherTile
          key={c.id}
          circle={c}
          preview={previews?.[c.id]}
          pending={Number(proposalCounts?.[c.id]) || 0}
          isPinned={!!pinnedMap[c.id]}
          isMuted={!!mutedMap[c.id]}
          onOpen={openCircle}
          onLongPress={onOpenMenu}
        />
      ))}
    </View>
  ));
}

/** Single kring tile (extracted in β.3 so grouped + flat paths share it). */
function LauncherTile({ circle: c, preview, pending, isPinned = false, isMuted = false, onOpen, onLongPress }) {
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const subtitle = (preview && preview.subtitle)
    ? preview.subtitle
    : (c.memberCount != null ? t('circle.members', { count: c.memberCount }) : null);
  const unread = preview?.unread ?? 0;
  return (
    <Pressable
      style={[styles.tile, isPinned && styles.tilePinned]}
      accessibilityRole="button"
      onPress={() => onOpen(c)}
      onLongPress={typeof onLongPress === 'function' ? () => onLongPress(c) : undefined}
      testID={`circle-tile-${c.id}`}
    >
      <View style={styles.tileBody}>
        <Text style={styles.tileName}>{c.name}</Text>
        {subtitle ? (
          <Text style={styles.tileMeta} numberOfLines={1}>{subtitle}</Text>
        ) : null}
      </View>
      {unread > 0 ? (
        <View
          style={styles.tileUnread}
          accessibilityLabel={t('circle.tile_unread', { count: unread })}
        >
          <Text style={styles.tileUnreadText}>{unread}</Text>
        </View>
      ) : null}
      {pending > 0 ? (
        <View
          style={styles.tileProposals}
          accessibilityLabel={t('circle.tile_proposals', { count: pending })}
          testID={`circle-tile-proposals-${c.id}`}
        >
          <Text style={styles.tileProposalsText}>{pending}</Text>
        </View>
      ) : null}
      {isPinned ? (
        <Text
          style={styles.tilePinIndicator}
          accessibilityElementsHidden
          testID={`circle-tile-pin-${c.id}`}
        >
          {'\u{1F4CC}'}
        </Text>
      ) : null}
      {/* Defensively reference `isMuted` so the tile component reads the
          prop (consumers visualize muted state via the menu's Unmute
          label; a tile-level dim is a follow-up polish). */}
      {isMuted ? null : null}
    </Pressable>
  );
}

// kring content view. Replaces the action-grid
// scaffolding as the per-circle landing surface.  Admin actions
// (Settings, Mine, ViewAs, …) collapse into a `⋯` overflow menu in the
// header, gated on the Functies axis (same gates the old grid used).
// B (circle bot) — the one-line kring-bubble reply text is now the SHARED `kringReplyText` (verb-aware
// Added:/Completed: phrasing); web + mobile use it so add/complete no longer read identically.

function CircleDetail({
  circle, items, callSkill, rawCallSkill, catalog: rawCatalog, policy, myListTasks = [],
  deliveryStateMap = null,
  registerKringBotSink = null,
  onAcceptFallback = null,
  // `isAgentActor` needs the peer graph to tell an agent actor from a person. It used to read
  // `bundle?.peerGraph`, and `bundle` is the LAUNCHER's prop — not one of ours. Optional chaining does not
  // save an UNDECLARED name, so that was a third render crash stacked behind `onAcceptFallback` and
  // `selectedPolicy` (found 2026-07-30 by the scope fitness guard, after the first two were fixed by hand).
  // Passed narrowly rather than handing this component the whole bundle: it needs one lookup, and the file's
  // style is to thread the specific store.
  peerGraph = null,
  eventLog,
  circles = [],
  recipeStore = null, onStoopEvent, sendPersonaUpdate, disclosureShareMemo = null, resealMediaForCircle = null, profilePicture = null, coreIdentity = null,
  onCircleControl = null, circleTransport = null,
  // Task #13 — onboarding first-run flags (shared store) + the create-flow handoff.
  onboardingFlags = null, onCreateCircle = null,
  onBack, onSettings, onMine, onViewAs, onAdvisor, onSkills, onFiles, onRules, onRecipes, onAdmin, onLists, onShare, onInvite, onGovernance, onReportMember, onReportPost, onReportMessage,
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();   // clear the status bar so the header bar is fully tappable
  const styles = useMemo(() => makeStyles(theme, insets), [theme, insets]);
  // Part D — scope the bot/suggest catalog to the circle's apps: drops basis's infra ops (/me etc.)
  // that the circle bot can't run (they threw `circle.bot.failed`) and keeps them out of the suggest list.
  const catalog = useMemo(
    () => (rawCatalog ? scopeCatalogToApps(rawCatalog, policy?.apps) : rawCatalog),
    [rawCatalog, policy],
  );
  // S6.A — {appOrigin → manifest} for computing inline buttons on bot replies.
  const manifestsByOrigin = useMemo(() => buildManifestsByOrigin(), []);
  // the manifest sources the capability gate reads (deduped; web≡mobile with circleApp.baseSources).
  const capabilitySources = useMemo(
    () => [...new Set(Object.values(manifestsByOrigin))].map((manifest) => ({ manifest })),
    [manifestsByOrigin],
  );
  // the member-override store (per-circle opt-outs) that the capability matrix reads.
  // CircleDetail is a separate component from the outer CircleLauncherScreen, so it needs its own
  // handle; the store is a stateless AsyncStorage wrapper, so a second instance is free.
  const overrideStore = useMemo(() => makeMemberOverrideStoreRN(AsyncStorage), []);
  // Per-circle stoop restructure (parity with web circleApp.js `stoopCall`): the
  // prikbord + scherm noticeboard block call the raw 3-arg `callSkill('stoop', …)`
  // directly, bypassing scopeReadyDispatch — so scope them to THIS circle here.
  // Writes get the circle id as the stoop scope key; list reads are filtered to the
  // circle. One shared agent, per-circle scope key (NOT N agents). NB: the 3-arg raw
  // dispatch is the `rawCallSkill` PROP (the parent's `bundle.callSkill`) — `bundle`
  // is not in scope in this component.
  // Sealed media (2026-07-11): thread THIS circle's media gateway into the wrapper (4th arg,
  // web parity with circleApp.js `getStoopMedia`) so a prikbord image attachment seals + rides
  // the SAME `{type:'media'}` blob pointer basis's own circle chat images use — one
  // circle's gateway per wrapper ⇒ per-circle by construction (no cross-seal). A p0/p1 circle
  // resolves no composition → the wrapper refuses attachments (sealed-only) and the 📎 hides.
  const getStoopMedia = useCallback(async () => {
    const comp = await getCircleMediaComposition(circle?.id, policy);
    return (comp && comp.mediaGateway)
      ? { mediaGateway: comp.mediaGateway, localActor: getCircleActorWebId() || 'me', t }
      : null;
  }, [circle?.id, policy]);
  const stoopCall = useMemo(
    () => scopeStoopCallSkill(
      rawCallSkill, circle?.id, () => getCircleSealStrategy(circle?.id, policy), getStoopMedia,
    ),
    [rawCallSkill, circle?.id, policy, getStoopMedia],
  );
  // Resolve this circle's sealed-media composition for the noticeboard: gate the 📎 affordance
  // (null for p0/p1 → hidden, web parity `kringMedia ? ... : null`) + open sealed full images on
  // tap. Async: the seal strategy rides the pod producer; null until it resolves and FOREVER for
  // p0/p1 (sealed-only, no unsealed upload fallback).
  const [circleMedia, setCircleMedia] = useState(null);
  useEffect(() => {
    let alive = true;
    setCircleMedia(null);
    getCircleMediaComposition(circle?.id, policy).then((m) => { if (alive) setCircleMedia(m || null); });
    return () => { alive = false; };
  }, [circle?.id, policy]);
  // S4 — seed a sealed circle's group-key roster with members who joined before the producer
  // was live (web parity with showKring). Best-effort; no-op for unsealed circles.
  useEffect(() => {
    if (circle?.id && typeof rawCallSkill === 'function') {
      seedCircleRosterFor({ circleId: circle.id, policy, callSkill: rawCallSkill }).catch(() => {});
    }
  }, [circle?.id, rawCallSkill, policy]);
  // Functies-axis gating for the overflow menu items now rides the
  // projection: the shared `circleActionsMobile` selector evaluates each
  // action's `requires` gate against `policy` (see the ⋯-menu render below).

  // kring stream rows scoped to this circle (chat-style).
  // EventLog has no subscribe seam yet; bumping `streamTick` after
  // local appends forces the memo to re-pull.
  const [streamTick, setStreamTick] = useState(0);
  // C15 — a CHAT projection: the log's silent system lane (the `roster-updated` pull-me and
  // friends) never surfaces here; the cross-circle Stream tab is the firehose. Web parity.
  // The conversation shows what THIS circle chose — its admin setting, else its template's, else the
  // permissive default (`conversationKinds.js`, web≡mobile). A filter, never a data change: turning a kind
  // back on brings its history with it.
  // Decision 3 (2026-07-29) — read both fields from the POLICY, which is where a create now writes them.
  // They were only ever read off the circle record, where nothing put them, so every circle resolved to
  // the permissive default no matter which template made it (S3/J-CW3). The circle record is still
  // consulted as a fallback, for a circle whose kind arrived by some other route.
  // `policy` — CircleDetail's own prop name for it. This block was written against `selectedPolicy`, which
  // is the LAUNCHER's state variable (it is what gets passed down as `policy`), so inside this component the
  // name resolved to nothing and opening a circle threw `Property 'selectedPolicy' doesn't exist`. It never
  // showed up because the render already died one prop earlier on `onAcceptFallback`; two crashes stacked in
  // the same render, both from a name that reads perfectly plausibly in the file it sits in.
  const allowedKinds = useMemo(() => resolveConversationKinds({
    circleSetting: policy?.conversationKinds ?? circle?.conversationKinds ?? null,
    templateKind:  policy?.kind ?? circle?.kind ?? null,
  }), [policy?.kind, policy?.conversationKinds, circle?.kind, circle?.conversationKinds]);
  // P1.7 — the reader's own narrowing on top of the circle's setting (web parity). Device-local per
  // circle; an actor we cannot resolve counts as a person, so nobody vanishes from a conversation.
  const chatFilterIo = useMemo(() => asyncStorageChatFilterIo(AsyncStorage), []);
  const [chatFilter, setChatFilter] = useState(null);
  useEffect(() => {
    let alive = true;
    const cid = circle?.id ?? null;
    if (!cid) { setChatFilter(null); return undefined; }
    chatFilterIo.load(cid).then((v) => { if (alive) setChatFilter(v); }).catch(() => {});
    return () => { alive = false; };
  }, [circle?.id, chatFilterIo]);
  const viewerFilter = useMemo(
    () => normalizeChatFilter(chatFilter, allowedKinds),
    [chatFilter, allowedKinds],
  );
  const isAgentActor = useCallback((actor) => {
    if (actor == null) return false;
    const list = peerGraph?.list ? peerGraph.list() : [];
    return (list ?? []).some((p) => (p?.pubKey === actor || p?.url === actor)
      && (p?.type === 'a2a' || p?.type === 'hybrid' || (Array.isArray(p?.skills) && p.skills.length > 0)));
  }, [peerGraph]);
  // Declared HERE (not with the entrust/LEDEN blocks below) because the rows memo reads them: the
  // viewer signals gate the owner-only entrust action AND the reveal-gated sender labels, and the
  // roster is what the labels resolve against. The circle roster via listGroupMembers (web≡mobile);
  // null = not loaded yet, [] = loaded empty. Loads at circle OPEN (batch 4): the chat tab needs it
  // for sender labels the moment it paints, not first when LEDEN is opened.
  const [mandateViewer, setMandateViewer] = useState({ viewerWebid: null, isAdmin: false });
  const [tabMembers, setTabMembers] = useState(null);
  const rows = useMemo(() => applyChatFilter({
    rows: chatRows({
      events:    eventLog?.query ? eventLog.query({ excludeMuted: true }) : [],
      circles,
      circleId:  circle?.id ?? null,
      kinds:     allowedKinds,
      // Sender labels through the reveal ladder (batch 4, web≡mobile): the projector stamps
      // `senderLabel`/`senderLabelKey`, the view only paints. `tabMembers` is null until the
      // circle-open roster load resolves — rows stay unstamped for that window, never a wire name.
      members:   tabMembers,
      viewerId:  mandateViewer.viewerWebid ?? null,
      policy:    policy?.revealPolicy ?? 'pairwise',
    }),
    filter: viewerFilter,
    allowedKinds,
    isAgentActor,
  }), [eventLog, circles, circle?.id, allowedKinds, viewerFilter, isAgentActor, streamTick,
    tabMembers, mandateViewer, policy]);
  const onChatFilter = useCallback((next) => {
    const cid = circle?.id ?? null;
    if (!cid) return;
    setChatFilter(next);
    chatFilterIo.save(cid, next).catch(() => {});
  }, [circle?.id, chatFilterIo]);
  // Conversation memory — a ref so the bot reads the LATEST rows without re-creating.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // δ.2 — per-message delivery state.  Lives in a ref so the map is
  // stable across renders; we bump `deliveryTick` (a state value the
  // bubble render reads through `deliveryStateFor`) to force re-renders
  // when state flips.  The map itself isn't deps-tracked.
  const deliveryStateMapRef = useRef(null);
  const feedbackMountRef = useRef(null);   // M6 — lazy feedback mount (created on first kring send)
  const feedbackEditRef = useRef(null);    // the review-point id whose text is prefilled in the composer (✏)
  const [expandedBubbles, setExpandedBubbles] = useState(() => new Set());   // bot bubbles whose long text is fully shown
  const toggleBubble = useCallback((id) => setExpandedBubbles((prev) => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
  }), []);
  const lastKringListingRef = useRef(null); // { appOrigin, items } from the last list reply, for bulk "/done all"
  const streamScrollRef = useRef(null);     // the Conversation viewport — kept at the newest bubble (see the ScrollView)
  // Prefer the SHARED map from App.js — inbound receipts land there. The local fallback keeps older
  // callers/tests working, but a private map here means receipts advance a state no bubble reads.
  if (deliveryStateMapRef.current == null) {
    deliveryStateMapRef.current = deliveryStateMap ?? createDeliveryStateMap();
  }
  const [deliveryTick, setDeliveryTick] = useState(0);
  // …and REDRAW when something else writes to that map. The send path bumps the tick itself (it owns the
  // `onChange` hook), so an inbound RECEIPT was the one writer with nothing to announce it: the receipt
  // arrived, the map advanced to `stored`, and the bubble kept saying "maybe received" until an unrelated
  // render happened to repaint it. The map has had `subscribe` since δ.2; nobody had used it.
  // Unconditional here (web narrows to `stored`): a tick is a cheap React state bump rather than a DOM
  // rebuild, and App.js writes `failed` into this same map from outside this screen with no other hook.
  useEffect(() => deliveryStateMapRef.current?.subscribe?.(() => setDeliveryTick((n) => n + 1)), []);
  const deliveryStateFor = useCallback((msgId) => {
    // eslint-disable-next-line no-unused-expressions
    deliveryTick; // read tick so memoised consumers re-evaluate on bumps
    return deliveryStateMapRef.current.get(msgId);
  }, [deliveryTick]);
  const [composerText, setComposerText] = useState('');
  // Conversational follow-up: a single-field needsForm awaiting the user's next message (shared followUp).
  const [pendingFollowUp, setPendingFollowUp] = useState(null);
  const [pendingForm, setPendingForm] = useState(null);   // 2+-field needsForm → inline form (parity with web)
  // The bot asked a free-text QUESTION (an llm-reply containing '?') — route the user's NEXT line straight
  // back to it (no '@assistant' needed) so the conversation continues. We stash {question, query} so the
  // answer is interpreted WITH the prior exchange threaded as conversation. Cleared once consumed.
  const [awaitingBotReply, setAwaitingBotReply] = useState(null);
  const noteBotTurn = useCallback((r, query) => {
    const reply = r && r.via === 'llm-reply' && typeof r.reply === 'string' ? r.reply.trim() : '';
    setAwaitingBotReply(reply && /\?/.test(reply) ? { question: reply, query: String(query || '') } : null);
  }, []);
  // Composer parity — slash-command auto-suggest off the merged catalog (shared `suggestCommands`,
  // same logic + set as web's dropdown). Tapping a row fills the command; the bash-style ArrowUp/Down
  // history that web also has is a keyboard affordance with no touch-gesture equivalent, so it's
  // intentionally desktop-only (the suggest list is the mobile parity surface).
  const suggestMatches = useMemo(
    () => (catalog ? suggestCommands(catalog, composerText) : []),
    [catalog, composerText],
  );
  // Permission gate (classic shell's `allowCommands` analog): chat disabled for this circle ⇒ read-only.
  const canPost = isFeatureEnabled(policy, 'chat');
  // per-kring bottom tabs derived from policy.features.
  const tabs = useMemo(() => buildKringTabs(policy, t), [policy]);
  const [activeTab, setActiveTab] = useState(DEFAULT_KRING_TAB);
  // Reset to GESPREK whenever we switch kringen so a non-default tab
  // doesn't persist across opens.
  useEffect(() => { setActiveTab(DEFAULT_KRING_TAB); }, [circle?.id]);

  // (roster state `tabMembers` is declared above the rows memo — it feeds the sender labels.)
  // Profile-update propagation — the PULL: a silent `roster-updated` entry for THIS circle means a
  // member's row moved; bump this tick to re-read the roster (no bubble, no toast — just a refresh).
  const [membersReloadTick, setMembersReloadTick] = useState(0);
  useEffect(() => {
    if (!eventLog?.subscribe || !circle?.id) return undefined;
    return eventLog.subscribe((e) => {
      if (e?.type === ROSTER_UPDATED_KIND && e?.circleId === circle.id) {
        setMembersReloadTick((n) => n + 1);
      }
      // …and the conversation itself. `rows` is a memo re-pulled off a hand-bumped `streamTick`, and the
      // SEND path was the only thing bumping it — so a message that ARRIVED while this pane was open
      // could not appear until something unrelated re-rendered it. Web has no equivalent gap: it
      // re-renders on every event. `eventCircleId` reads the same circle the projection filters on, so a
      // first-class `circleId` and the older payload dig both match.
      if (e?.type === CHAT_KIND && eventCircleId(e) === circle.id) setStreamTick((n) => n + 1);
    });
  }, [eventLog, circle?.id]);
  useEffect(() => {
    if (!circle?.id || typeof rawCallSkill !== 'function') return undefined;
    let alive = true;
    setTabMembers(null);
    (async () => {
      let mem = [];
      try { mem = normalizeCircleMembers(await rawCallSkill('stoop', 'listGroupMembers', { groupId: circle.id })); } catch { /* keep empty */ }
      if (alive) setTabMembers(mem);
    })();
    return () => { alive = false; };
  }, [circle?.id, rawCallSkill, membersReloadTick]);

  // Taken (tasks) tab — the circle's tasks from the composed tasks agent, projected to
  // stream rows via the SHARED buildTaskRows (web≡mobile), so the tab's lifecycle chips +
  // the owner-only entrust action come from the same actionsForStreamRow the chat stream
  // uses. Loads lazily when the tab opens; `tasksReloadTick` forces a refresh after a task
  // op or an /addtask turn. The explicit circleId scopes the read (basis is multi-pod).
  const [kringTasks, setKringTasks] = useState([]);
  const [tasksReloadTick, setTasksReloadTick] = useState(0);
  useEffect(() => {
    if (activeTab !== 'taken' || !circle?.id || typeof rawCallSkill !== 'function') return undefined;
    let alive = true;
    (async () => {
      let items = [];
      try {
        const res = await rawCallSkill('tasks', 'listOpen', { circleId: circle.id });
        items = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
      } catch { items = []; }
      if (alive) setKringTasks(buildTaskRows(items, { circleId: circle.id }));
    })();
    return () => { alive = false; };
  }, [activeTab, circle?.id, rawCallSkill, tasksReloadTick]);

  // α.1e — materialized scherm blocks for the active recipe.  null
  // until the load below resolves; [] when the book is empty.
  // D1 — `screenReloadTick` bumps after a quickActions tap to re-rank.
  const [screenBlocks, setScreenBlocks] = useState(null);
  const [screenReloadTick, setScreenReloadTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setScreenBlocks(null);  // reset on circle change
    if (!recipeStore || !circle?.id) { setScreenBlocks([]); return () => { alive = false; }; }
    (async () => {
      try {
        const book = await recipeStore.get(circle.id);
        // D1 (§5A) — fall back to the quickActions-only default recipe so
        // every scherm leads with the Veel-gebruikt row.
        const active = getActiveRecipe(book) ?? DEFAULT_SCHERM_RECIPE;
        const blocks = await materializeRecipe({
          recipe:   active,
          circleId: circle.id,
          // D1 — policy + actionFrequency feed the quickActions block. The block
          // materializers call `callSkill(appOrigin, opId, args)` (3-arg), so pass
          // the RAW 3-arg dispatch, not the 2-arg `callSkill` resolver (#16; also
          // un-breaks the tasks/agenda scherm blocks that shared the latent bug).
          // `stoopCall` = the raw 3-arg `rawCallSkill` scoped to this circle (the
          // earlier `bundle?.callSkill` was undefined here — `bundle` isn't a prop).
          hostOps:  {
            callSkill: stoopCall, eventLog, circles, policy, actionFrequency,
            fetchImpl: getCirclePodFetch() || undefined,
            // Sender labels through the reveal ladder (batch 4, web≡mobile) — the noticeboard
            // block stamps `senderLabel`; `revealPolicy` (not `policy`, taken above) gates names.
            members: tabMembers, viewerId: mandateViewer.viewerWebid ?? null,
            revealPolicy: policy?.revealPolicy ?? 'pairwise',
          },
        });
        if (alive) setScreenBlocks(blocks);
      } catch (err) {
        console.warn('[CircleDetail] recipe load failed:', err?.message ?? err);
        if (alive) setScreenBlocks([]);
      }
    })();
    return () => { alive = false; };
  }, [recipeStore, circle?.id, callSkill, eventLog, circles, policy, screenReloadTick,
    tabMembers, mandateViewer]);

  // Chat ↔ Scherm pill state (v2 §4 "De Schakelaar").
  // Per-circle preference persists in AsyncStorage at cc.circleViewMode.
  // §4 — until the member has flipped the pill for this kring, the
  // landing surface is the admin's policy.view front door
  // (defaultViewModeFromPolicy): 'screen' → scherm, else → chat.
  const [viewMode, setViewModeState] = useState(() => defaultViewModeFromPolicy(policy));
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!circle?.id) return;
      const fallback = defaultViewModeFromPolicy(policy);
      try {
        const raw = await AsyncStorage.getItem('cc.circleViewMode');
        const map = raw ? JSON.parse(raw) : {};
        const saved = map?.[circle.id];
        if (alive) setViewModeState(saved === 'scherm' || saved === 'chat' ? saved : fallback);
      } catch { if (alive) setViewModeState(fallback); }
    })();
    return () => { alive = false; };
  }, [circle?.id, policy]);
  const setViewMode = useCallback(async (mode) => {
    if (mode !== 'chat' && mode !== 'scherm') return;
    setViewModeState(mode);
    if (!circle?.id) return;
    try {
      const raw = await AsyncStorage.getItem('cc.circleViewMode');
      const map = raw ? JSON.parse(raw) : {};
      map[circle.id] = mode;
      await AsyncStorage.setItem('cc.circleViewMode', JSON.stringify(map));
    } catch { /* quota / disabled */ }
  }, [circle?.id]);

  // D1 (§5A) — a "Veel-gebruikt" pill tap: bump the feature's count, route
  // it (tab feature → switch to it in chat view; houseRules → rules panel),
  // then re-rank the row.  Mirrors the web onScreenAction.
  const onScreenAction = useCallback((featureKey) => {
    if (!circle?.id) return;
    actionFrequency.bump(circle.id, featureKey);
    if (featureKey === 'houseRules') { onRules?.(); }
    else {
      const tabId = featureTabId(featureKey);
      if (tabId) { setActiveTab(tabId); setViewMode('chat'); }
    }
    setScreenReloadTick((n) => n + 1);
  }, [circle?.id, onRules, setViewMode]);

  // δ.2 — fan-out helper used by both the initial send and the
  // tap-to-retry handler for failed bubbles.  Re-fires with the
  // SAME msgId so receiver-side dedup suppresses duplicates.
  const broadcastFanOut = useCallback(({ msgId, text, ts, media }) => {
    // Shared fan-out (Phase 2). RAW 3-arg callSkill (app-targeted at stoop) — the 2-arg resolving one
    // arg-shifts (op→'stoop') and never delivers. The helper marks δ.2 delivery state; onChange = the
    // RN rerender tick. `media` rides through like on web — the helper's wire whitelist projects it —
    // so a media-carrying message fans with its embed instead of arriving as bare text.
    broadcastKringFanOut({
      rawCallSkill, circleId: circle?.id, msgId, text, ts, media,
      deliveryStateMap: deliveryStateMapRef.current,
      onChange: () => setDeliveryTick((n) => n + 1),
    });
  }, [rawCallSkill, circle?.id]);

  // append a kring chat bubble to the local eventLog (optimistic). Returns {msgId, ts}
  // so the caller can fan out the same id (receiver-side dedup suppresses any mirrored echo).
  const appendKringMessage = useCallback(({ actor, text, buttons, scope, embeds, review, provenance, consent }) => {
    if (!eventLog?.append || !circle?.id) return null;
    const msgId = `kring-${circle.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ts    = Date.now();
    // `review` (Stage-1 feedback cards) is private by construction → scope 'self' (never fanned out).
    // `provenance`/`consent` (Task #13 help Q&A) light the transparency badge + the dashed-rust consent card.
    eventLog.append(kringChatMessageEvent({ msgId, ts, circleId: circle.id, actor, text, buttons, scope: review ? 'self' : scope, embeds, review, provenance, consent }));
    setStreamTick((n) => n + 1);
    return { msgId, ts };
  }, [eventLog, circle?.id]);

  // The fallback offer speaks HERE while this kring is open (web parity: the chat makes the offer, at the
  // moment the person is confused about why nobody replied). `scope: 'self'` — a local bubble, never
  // fanned: the offer is about MY setting, and broadcasting it would tell the circle I have it off.
  useEffect(() => {
    if (typeof registerKringBotSink !== 'function') return undefined;
    registerKringBotSink(({ messageKey, costKey, actionKey } = {}) => {
      const text = [messageKey && t(messageKey), costKey && t(costKey)].filter(Boolean).join(' ');
      if (!text) return;
      // The one-tap accept rides the EXISTING bubble-button pipeline (`onBubbleButton` routes by id).
      const buttons = actionKey ? [{ id: 'delivery:allow-fallback', label: t(actionKey) }] : undefined;
      appendKringMessage({ actor: 'bot', text, buttons, scope: 'self' });
    });
    return () => registerKringBotSink(null);
  }, [registerKringBotSink, appendKringMessage]);

  // Build the co-hosted feedback surface + mount for a circle in a given language, over the given (cached) pods.
  // Factored out so a language switch can REBUILD reusing the same pods (local Stage-1 survives). Rich emit sink:
  // kind:'review' → editable cards · kind:'report' → a chunked text bubble · else text + buttons.
  const buildFeedbackMount = useCallback((circ, pods, lg) => {
    const surface = createFeedbackSurface({
      projectId: circ.id,
      lang: lg,
      llmBaseURL: FEEDBACK_LLM_BASEURL,
      pod: pods.ownPod,
      ...(pods.centralPod ? { centralPod: pods.centralPod, controlStore: pods.controlStore, verify: true } : {}),
      identityFor: () => signerForIdentity(coreIdentity),
      emit: ({ kind, text: btext, buttons, points, labels, logText }) => {
        if (kind === 'review' && Array.isArray(points)) appendKringMessage({ actor: 'bot', review: { intro: btext, points, labels } });
        else if (kind === 'report') appendKringMessage({ actor: 'bot', text: `${btext}\n\n${logText || ''}`.trimEnd() });
        else appendKringMessage({ actor: 'bot', text: btext, buttons });
      },
    });
    return createFeedbackMount({
      surface,
      appendUserBubble: (_tid, txt) => appendKringMessage({ actor: 'me', text: txt }),
      appendBotBubble:  () => {},   // unused: the pre-built surface owns its emit above
    });
  }, [appendKringMessage, coreIdentity]);

  // Offer the OTHER languages as tappable bubble-buttons (web-kring parity). Prompt + label are read from the
  // locale files IN each TARGET language (t(key, {}, l)) — a speaker of that language recognises the invite; NO
  // hardcoded strings (unlike the web's LANG_INFO constant).
  const emitFeedbackLangOptions = useCallback((currentLang) => {
    const others = FEEDBACK_LANGS.filter((l) => l !== currentLang);
    if (!others.length) return;
    appendKringMessage({
      actor: 'bot',
      text: `🌐 ${others.map((l) => t('circle.feedback.switch_prompt', {}, l)).join('  ·  ')}`,
      buttons: others.map((l) => ({ id: `fp-lang:${l}`, label: t('circle.feedback.lang_name', {}, l) })),
    });
  }, [appendKringMessage]);

  // Switch the kring feedback bot's language: rebuild the surface in newLang REUSING the cached pods (Stage-1
  // survives), re-greet, and re-offer the other langs. Routed here from an `fp-lang:<code>` bubble-button tap.
  const switchKringFeedbackLang = useCallback(async (circleId, newLang) => {
    const ref = feedbackMountRef.current;
    if (!ref || ref.circleId !== circleId || ref.lang === newLang || !FEEDBACK_LANGS.includes(newLang)) return;
    try { ref.mount.surface.stop(circleId); } catch { /* best-effort */ }
    const mount = buildFeedbackMount({ id: circleId }, ref.pods, newLang);
    feedbackMountRef.current = { circleId, mount, pods: ref.pods, lang: newLang };
    try { await mount.open(circleId); } catch { /* a greeting error surfaces via emit */ }
    emitFeedbackLangOptions(newLang);
  }, [buildFeedbackMount, emitFeedbackLangOptions]);

  // Entrust (mandate) — the open picker's gathered inputs (null = closed), plus my
  // owner-visibility signals (WebID + admin role in THIS circle). The signals gate
  // the owner-only "entrust" row action via the SHARED actionsForStreamRow (web≡mobile);
  // fail-closed until resolved (a locally-authored row still offers it via isOwn).
  const [mandatePicker, setMandatePicker] = useState(null);
  // 1:1-bot chat gate (web≡mobile) — the assistant-header strip shows ONLY when this circle is
  // you + exactly one participant, and that participant is a bot. Computed from THIS circle's raw
  // roster (relation/webid rows) + my webid via the SHARED oneToOneBotLabel; null (roster not yet
  // resolved, group, or 1:1-human) → NO strip (fail-closed). Rides the same listGroupMembers load.
  const [botLabel, setBotLabel] = useState(null);
  // Task #13 — this circle's raw roster + my webid, captured on open so the standing help Q&A can run the
  // shared `botIsAddressed` gate (1:1 help circle → always; a group → only when @-tagged). The help
  // circle's membership is a product constant, so its roster comes from the shared `helpCircleRoster`.
  const kringMembersRef = useRef(null);
  const myWebidRef = useRef(null);
  // Task #13 — set below to the latest onboarding/help button router (so onBubbleButton, a memoised
  // callback defined earlier, always reaches the current handlers without a stale closure).
  const task13ButtonRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    kringMembersRef.current = null; myWebidRef.current = null;
    if (!circle?.id || typeof rawCallSkill !== 'function') { setMandateViewer({ viewerWebid: null, isAdmin: false }); setBotLabel(null); return undefined; }
    setBotLabel(null);   // reset on circle change — fail-closed until the roster resolves
    (async () => {
      let webid = null;
      try { const r = await rawCallSkill('stoop', 'whoAmI', {}); webid = r?.webid ?? r?.webId ?? null; } catch { /* best-effort */ }
      if (!cancelled) myWebidRef.current = webid;
      // The help circle: you + the Onderling-bot (a product constant) — no listGroupMembers round-trip.
      if (circle.id === HELP_CIRCLE_ID) {
        const roster = helpCircleRoster({ selfWebid: webid || null, botName: t('circle.onboarding.help_name') });
        if (!cancelled) {
          kringMembersRef.current = roster;
          setBotLabel(oneToOneBotLabel({ members: roster, selfWebid: webid, fallbackLabel: t('circle.kring.bot_header') }));
          setMandateViewer({ viewerWebid: webid, isAdmin: true });
        }
        return;
      }
      let isAdmin = false;
      try {
        const res = await rawCallSkill('stoop', 'listGroupMembers', { groupId: circle.id });
        const mem = Array.isArray(res?.members) ? res.members : [];
        if (!cancelled) kringMembersRef.current = mem;
        const me = mem.find((m) => (m?.webid ?? m?.id) === webid);
        isAdmin = me?.role === 'admin';
        // Shared gate — decides the assistant-header strip from the raw roster (carries `relation`).
        if (!cancelled) setBotLabel(oneToOneBotLabel({ members: mem, selfWebid: webid, fallbackLabel: t('circle.kring.bot_header') }));
      } catch { /* creator/own-row path still works; the handler gate is the real boundary */ }
      if (!cancelled) setMandateViewer({ viewerWebid: webid, isAdmin });
    })();
    return () => { cancelled = true; };
  }, [circle?.id, rawCallSkill]);

  // B (circle bot) — run a FULLY-RESOLVED command ({opId, args}) against the circle's catalog, scoped
  // to THIS circle, and post a one-line bot reply. Local-only (the command's substrate effect reaches
  // members on its own). Target resolution / ambiguity is handled upstream by the clarifying dispatch.
  const runCircleCommandResolved = useCallback(async ({ opId, args, appOrigin }) => {
    if (!catalog) { appendKringMessage({ actor: 'bot', text: t('circle.bot.unknown') }); return; }
    let dispatch;
    try {
      // K0 de-shadow: forward the app-origin hint so a colliding bare op-id (from the gate) routes to the
      // gate's app, not the merge's first-declarer (web≡mobile parity with circleApp.dispatchReady).
      dispatch = resolveDispatch({ kind: 'slash', opId, args: args || {}, appOrigin, command: '(bot)', body: '' }, catalog);
    } catch { appendKringMessage({ actor: 'bot', text: t('circle.bot.unknown') }); return; }
    if (dispatch.kind === 'needsForm') {
      // Conversational elicitation (parity with web): single missing field → ask in the kring + capture
      // the user's next message (sendKringChat's pending branch); 2+ missing fields → an inline form bubble.
      const pending = beginFollowUp({ dispatch, t });
      if (pending) { setPendingFollowUp(pending); appendKringMessage({ actor: 'bot', text: pending.promptText }); return; }
      const form = beginFormFollowUp({ dispatch, t });
      if (form) { setPendingForm(form); return; }   // renderer draws MultiFieldFormBubble
      appendKringMessage({ actor: 'bot', text: t('circle.bot.needsInfo') });   // no missing param names
      return;
    }
    // confirm gate (web≡mobile parity with circleApp.dispatchReady) — an op declaring
    // surfaces.ui.confirm (warn/danger) NEVER executes without an explicit accept. Sits at the dispatch
    // waist, so the row-button path and the chat/slash path are gated uniformly (shared runConfirmGate;
    // Alert.alert with a destructive accept is only the presenter). Cancel = quiet notice.
    if (dispatch.kind === 'needsConfirm') {
      await runConfirmGate({
        route: dispatch, catalog, t,
        present: alertConfirmPresenter(Alert.alert),
        onCancelNotice: () => appendKringMessage({ actor: 'bot', text: t('circle.confirm.cancelled') }),
        execute: executeResolved,
      });
      return;
    }
    if (dispatch.kind !== 'ready')     { appendKringMessage({ actor: 'bot', text: t('circle.bot.unknown') }); return; }
    await executeResolved(dispatch);

    // The execute tail every accepted route runs (direct 'ready' or confirmed 'needsConfirm' → 'ready').
    async function executeResolved(dispatch) {
      // DEFAULT-DENY capability gate (web≡mobile parity with circleApp.dispatchReady). Every
      // user-initiated dispatch (slash/LLM/gate/button/follow-up) converges on runCircleCommandResolved.
      // Enablement comes from the SAME per-circle source the UI uses (isAppSurfaceEnabled → policy.features,
      // already consulted for the screen button below); the pure (verb×noun) gate evaluates the capability.
      if (circle?.id) {
        const gateEntry = catalog?.opsById?.get(dispatch.opId);
        const gOrigin = dispatch.appOrigin || gateEntry?.appOrigin;
        if (gOrigin) {
          const enabled = isAppSurfaceEnabled(gOrigin, policy, isFeatureEnabled);
          const eff = effectiveCapabilities(capabilitySources, { apps: enabled ? [gOrigin] : [] });
          const verdict = checkCapability({ op: gateEntry?.op, appOrigin: gOrigin, args: dispatch.args }, eff);
          if (!verdict.allow) {
            appendKringMessage({ actor: 'bot', text: t(verdict.code === 'app-disabled' ? 'circle.gate.appDisabled' : 'circle.gate.capabilityDenied') });
            return;
          }
        }
      }
      // scopeReadyDispatch takes the active-circle id STRING (it writes it into the scope arg keys);
      // an {id} object would land as the literal scope value (device-verify 2026-06-11).
      const scoped = scopeReadyDispatch(dispatch, circle?.id);
      if (typeof rawCallSkill !== 'function') { appendKringMessage({ actor: 'bot', text: t('circle.bot.unknown') }); return; }
      let reply;
      // runDispatch calls callSkill(appOrigin, opId, args) — the RAW 3-arg shape, with appOrigin from
      // resolveDispatch. Pass the raw `rawCallSkill` (bundle.callSkill) DIRECTLY. The 2-arg *resolving*
      // callSkill (used for the picker lookup) silently arg-shifts here: appOrigin→opId, opId→args, real
      // args dropped — so the dispatched op was literally 'tasks-v0' and NO circle-bot command ever
      // executed on mobile (device-verify 2026-06-11: logs showed `[callSkill] tasks-v0 →` not `addTask →`).
      try { reply = await runDispatch(scoped, rawCallSkill); }
      catch (e) { appendKringMessage({ actor: 'bot', text: t('circle.bot.failed', { msg: e?.message ?? String(e) }) }); return; }
      // The op's verb drives Added:/Completed: phrasing (a bare "✓ X" was identical for add + complete).
      const entry = catalog?.opsById?.get(dispatch.opId);
      const verb = entry?.op?.verb;
      // S6.A — manifest-driven inline buttons for the reply's item(s), gated by appliesTo (web parity).
      // B · (4c) — grey/hide affordances per the member's effective capability + consequence (web≡mobile).
      let capMatrix = [];
      try {
        const ovr = circle?.id ? (await overrideStore.get(circle.id)) : null;
        capMatrix = buildCapabilityMatrix(capabilitySources, {
          enabledApps: Array.isArray(policy?.apps) && policy.apps.length ? policy.apps : null,
          template: policy?.capabilities || {}, optOuts: ovr?.capabilityOptOuts || [],
        });
      } catch { /* best-effort — no greying on error */ }
      const inlineButtons = embedButtonsForReply({ reply, appOrigin: entry?.appOrigin, manifestsByOrigin, capabilityMatrix: capMatrix });
      // S6.B/C — a screen surface (surfaces.ui.screen) becomes an "Open …" button,
      // gated by the circle's policy.features for that app (web parity).
      const screen = entry?.op?.surfaces?.ui?.screen;
      const screenButton = (screen && isAppSurfaceEnabled(entry?.appOrigin, policy, isFeatureEnabled))
        ? [{ id: `screen:${screen}`, screen, label: t(`circle.screen.open.${screen}`, { defaultValue: t('circle.screen.open_generic') }) }]
        : [];
      // S6.C — the user's preference picks the projection (inline / screen / minimal). web parity.
      const buttons = selectSurfaceButtons({ inlineButtons, screenButton, pref: surfacePrefStore.get() });
      // Scope: a mutating op's reply reaches the whole kring; a read/info/error reply is private (web parity).
      const scope = scopeForReply({ verb, error: !!reply?.error });
      // embeds[] — the bot reply references the item it acted on (web parity); title pre-filled.
      const embeds = embedsFromReply(reply, { appOrigin: entry?.appOrigin });
      appendKringMessage({ actor: 'bot', text: kringReplyText(reply, { verb, t }), buttons, scope, embeds });
      // Remember the most-recent listing so a bulk "/done all" can fan out over it (web≡mobile).
      if (Array.isArray(reply?.payload?.items)) lastKringListingRef.current = { appOrigin: entry?.appOrigin, items: reply.payload.items };
      // Shared find-result enrichment (skill matches + hop prompt), web≡mobile via buildFindExtras. Best-effort.
      try {
        const { offeringMatches, hopCard } = await buildFindExtras({
          query: reply?.payload?.query, groups: reply?.payload?.groups,
          circleId: circle?.id, callSkill: (op, a) => rawCallSkill('stoop', op, a), t,
        });
        if (offeringMatches.length) appendKringMessage({ actor: 'bot', text: `${t('circle.offeringMatches.title')}\n${offeringMatches.map((m) => `• ${m.label} — ${m.skill}`).join('\n')}` });
        if (hopCard) appendKringMessage({ actor: 'bot', text: `${hopCard.title}\n${hopCard.body}` });
      } catch { /* enrichment is non-essential */ }
    }
  }, [catalog, circle?.id, rawCallSkill, appendKringMessage, manifestsByOrigin, policy, capabilitySources, overrideStore]);

  // Entrust (mandate) — open the task-scoped grant picker. Gathers WHO (the circle
  // roster), WHAT (MY offerings, kind 'offering'), my WebID (the granter), and any
  // mandates already on the task (legibility) — the SAME reads web's openMandatePicker
  // uses, via the mobile 3-arg rawCallSkill. All best-effort; a miss just narrows.
  const openMandatePicker = useCallback(async ({ taskId }) => {
    if (!taskId || !circle?.id || typeof rawCallSkill !== 'function') return;
    let myWebid = '';
    try { const r = await rawCallSkill('stoop', 'whoAmI', {}); myWebid = r?.webid ?? r?.webId ?? ''; } catch { /* */ }
    let members = [];
    try {
      const res = await rawCallSkill('stoop', 'listGroupMembers', { groupId: circle.id });
      members = Array.isArray(res?.members) ? res.members : [];
    } catch { members = []; }
    // WHAT — only offerings I hold appear; that IS the attenuation, made visible.
    let offerings = [];
    try {
      const drivers = (await rawCallSkill('agents', 'getProfileDrivers', { id: 'default' }))?.drivers ?? {};
      offerings = Object.entries(drivers)
        .filter(([, v]) => v && v.kind === 'offering')
        .map(([key, v]) => ({ key, text: v.text || key }));
    } catch { offerings = []; }
    let existingGrants = [];
    try {
      const snap = await rawCallSkill('tasks', 'getTaskSnapshot', { id: taskId, circleId: circle.id });
      const grants = snap?.source?.taskGrants ?? snap?.taskGrants ?? snap?.item?.source?.taskGrants ?? null;
      existingGrants = Array.isArray(grants) ? grants : [];
    } catch { existingGrants = []; }
    setMandatePicker({ taskId, members, offerings, myWebid, existingGrants });
  }, [circle?.id, rawCallSkill]);

  // Confirm → route the mandate through the SAME dispatch waist the bot/slash path uses
  // (runCircleCommandResolved). attachTaskGrant declares surfaces.ui.confirm, so this hits
  // the shared confirm gate (needsConfirm → "weet je het zeker?" Alert) before ANY grant
  // issues — no direct callSkill bypass — and the op's success/failure surfaces as a kring
  // bubble. Close the picker first so the confirm Alert isn't stacked under it.
  const onMandateConfirm = useCallback(async ({ taskId, member, grant }) => {
    setMandatePicker(null);
    await runCircleCommandResolved({
      opId: 'attachTaskGrant',
      args: { taskId, member, grant, circleId: circle?.id },
      appOrigin: 'tasks',
    });
  }, [runCircleCommandResolved, circle?.id]);

  // Row-action dispatcher for the stream bubbles — the "entrust" (mandate) action opens the
  // picker (owner-only visibility got it here; the handler is the real gate). Other row actions
  // are not yet wired on mobile (parity gap tracked in web-mobile-exceptions is unrelated).
  const onRowAction = useCallback(async (a, row) => {
    if (a?.action === 'mandate') {
      const taskId = a?.payload?.taskId ?? a?.payload?.ref ?? null;
      if (taskId) openMandatePicker({ taskId });
      return;
    }
    // Task lifecycle — claim / done route to the tasks agent through the SAME dispatch waist
    // (runCircleCommandResolved → scope-injected to the active circle), then refresh the tab.
    if (a?.action === 'claim' || a?.action === 'done') {
      const taskId = a?.payload?.taskId ?? a?.payload?.ref ?? null;
      if (taskId) {
        const opId = a.action === 'claim' ? 'claimTask' : 'completeTask';
        await runCircleCommandResolved({ opId, args: { id: taskId }, appOrigin: 'tasks' });
        setTasksReloadTick((n) => n + 1);
      }
      return;
    }
    console.info('[kring] action', a?.action, row?.id);
  }, [openMandatePicker, runCircleCommandResolved]);

  // E2 — run a bulk route ("/done all") over the most-recent listing's items (web≡mobile parity via the shared
  // executeBulkDispatch). Mobile has no filter-router; cross-thread propagation is the fan-out itself.
  const handleKringBulk = useCallback(async (route) => {
    const itemIds = (lastKringListingRef.current?.items ?? []).map((it) => it.id).filter(Boolean);
    if (!itemIds.length) { appendKringMessage({ actor: 'bot', text: t('circle.bulk.noList') }); return; }
    try {
      const { message } = await executeBulkDispatch({ bulk: route, itemIds, callSkill: rawCallSkill, opLabel: route.opId });
      appendKringMessage({ actor: 'bot', text: message });
    } catch (e) { appendKringMessage({ actor: 'bot', text: t('circle.bot.failed', { msg: e?.message ?? String(e) }) }); }
  }, [appendKringMessage, rawCallSkill]);

  // 2+-field inline form submit: echo the filled values, complete the dispatch, run it (parity with web).
  const onFormSubmit = useCallback((values) => {
    const pending = pendingForm;
    if (!pending) return;
    setPendingForm(null);
    const summary = (pending.fields || []).map((f) => `${f.label || f.name}: ${values?.[f.name] ?? ''}`).join(' · ');
    if (summary) appendKringMessage({ actor: 'me', text: summary });
    const ready = completeMultiFieldFollowUp({ pending, values });
    runCircleCommandResolved({ opId: ready.opId, args: ready.args });
  }, [pendingForm, appendKringMessage, runCircleCommandResolved]);

  // B (clarification) — candidate source for an id-like param. Base = the circle's already-loaded
  // items (tasks + stoop posts, circle-scoped). Part C cross-app: ALSO pull the op's OWN list via the
  // auto-resolving callSkill (makeResolvingCallSkill probes the right app by opId), so labels for item
  // types NOT in the preloaded set — folio files (listFiles), calendar events (listEvents) — resolve
  // too. Scoped to the circle (circleId/circleId/groupId); deduped by id; best-effort (failures keep base).
  // B (clarification) — the SHARED circle lookup (Phase 3, src/v2/circleLookup): base = the circle's
  // already-loaded items (tasks + stoop posts), plus the op's OWN list via the app-qualified
  // rawCallSkill (so `listOpen` resolves on the right app, not probe-first-origin). Was an inline copy.
  const circleLookup = useMemo(
    () => makeCircleLookup({ getBase: () => items, appCallSkill: rawCallSkill }),
    [items, rawCallSkill],
  );

  // B (clarification) — wraps dispatch: a unique target dispatches; an ambiguous one posts a bot
  // message with candidate BUTTONS (tapping → pick → re-run bound to that id); a missing one asks.
  const clarify = useMemo(() => createClarifyingDispatch({
    catalog: () => catalog,
    lookup: circleLookup,
    dispatchReady: runCircleCommandResolved,
    ask: ({ query, candidates }) => appendKringMessage({
      actor: 'bot',
      text: t('circle.clarify.which', { query }),
      buttons: candidates.map((c) => ({ id: c.id, label: c.hint ? `${c.label} — ${c.hint}` : c.label })),
    }),
    askMissing: async ({ opId, param, query }) => {
      // A non-empty label that matched nothing → "couldn't find X". A picker command given with NO value
      // (bare /complete-task) shouldn't say «couldn't find ''» — list the options to choose from.
      if (query && query.trim()) { appendKringMessage({ actor: 'bot', text: t('circle.clarify.notFound', { query }) }); return; }
      const entry = catalog?.opsById?.get(opId);
      const listOp = (entry?.op?.params || []).find((p) => p.name === param)?.pickerSource?.listOp;
      let cand = [];
      try { if (listOp) cand = (await circleLookup(listOp, '', circle?.id, entry?.appOrigin)) || []; } catch { /* keep empty */ }
      if (cand.length) {
        appendKringMessage({ actor: 'bot', text: `${t('circle.clarify.whichMissing')}\n${cand.map((c) => `• ${c.label}`).join('\n')}` });
      } else {
        appendKringMessage({ actor: 'bot', text: t('circle.clarify.noneToPick') });
      }
    },
  }), [catalog, circleLookup, runCircleCommandResolved, appendKringMessage, circle?.id]);

  // S6.B — chat-triggered screen panel ({screen} | null) + its materialized blocks.
  const [screenPanel, setScreenPanel] = useState(null);
  // §2 — the LEDEN-tab card overlay: `{ member, self }` when a member row is tapped
  // (self = the row is the viewer's own → self-view; otherwise the member-persona card).
  const [memberCard, setMemberCard] = useState(null);
  const [panelBlocks, setPanelBlocks] = useState(null);
  const [listScreenData, setListScreenData] = useState(null);   // { items, categoryField, appOrigin, capabilityMatrix }
  const [aboutMePersona, setAboutMePersona] = useState(null);   // personas#1 — the persona id whose "About me" view is open
  // S6.B precise scroll-to — the panel ScrollView, its content wrapper, and the
  // single highlighted row.  measureLayout(row → content) gives the row's y in
  // content space, which scrollTo consumes directly.
  const panelScrollRef = useRef(null);
  const panelContentRef = useRef(null);
  const highlightRowRef = useRef(null);
  const scrollPanelToHighlight = useCallback(() => {
    const row = highlightRowRef.current;
    const content = panelContentRef.current;
    const scroller = panelScrollRef.current;
    if (!row || !content || !scroller || typeof row.measureLayout !== 'function') return;
    const contentNode = findNodeHandle(content);
    if (contentNode == null) return;
    row.measureLayout(
      contentNode,
      (_x, y) => { scroller.scrollTo({ y: Math.max(0, y - 12), animated: true }); },
      () => { /* measure failed (row unmounted) — leave scroll where it is */ },
    );
  }, []);
  // Re-nav within the panel (tapping a chip in an open panel changes highlightRef
  // without remounting the row, so onLayout won't refire) — scroll on ref change.
  useEffect(() => {
    if (screenPanel?.highlightRef) scrollPanelToHighlight();
  }, [screenPanel?.highlightRef, panelBlocks, scrollPanelToHighlight]);
  useEffect(() => {
    if (!screenPanel) { setPanelBlocks(null); setListScreenData(null); return undefined; }
    let alive = true;
    setPanelBlocks(null); setListScreenData(null);   // loading

    // a declared LIST-SCREEN fetches rows + builds the member matrix, then renders the
    // interactive CircleListScreen (search + category chips + capability-gated rows) instead of a block.
    // D-mig-mobile-1b — resolve the list-screen config from the projected manifest
    // section (shared selector) instead of the retired hardcoded literal.
    // (web parity with openCircleScreenPanel) — the fetch now rides the SHARED
    // seam `fetchScreenItems`: static `dataSource.args` merged with `argsFromContext`
    // `$keys` substituted from the panel's context (`$circleId` host-materialized
    // from the active circle; `$uri`/`$agentId` selection-derived from a picked row).
    // The old path passed ONLY the static args — argsFromContext was ignored.
    const found = sectionForScreen(manifestsByOrigin, screenPanel.screen);
    if (found) {
      const { section, appOrigin } = found;
      const categoryField = section.categoryField;
      const searchFields = section.searchFields;
      const labelField = section.labelField ?? 'label';
      const screenContext = screenPanelContext(circle?.id, screenPanel.context);
      (async () => {
        try {
          const res = await fetchScreenItems(section, {
            callSkill: (skillId, args) => rawCallSkill(appOrigin, skillId, args),
            context: screenContext,
          });
          // a record-shaped DETAIL (e.g. agent-detail) renders as a
          // read-only key→value record, not a list (web parity).
          if (section.shape === 'record') {
            if (alive) setListScreenData({ shape: 'record', record: recordFromReply(res), appOrigin });
            return;
          }
          const items = itemsFromReply(res);
          let capabilityMatrix = [];
          try {
            const ovr = circle?.id ? (await overrideStore.get(circle.id)) : null;
            capabilityMatrix = buildCapabilityMatrix(capabilitySources, {
              enabledApps: Array.isArray(policy?.apps) && policy.apps.length ? policy.apps : null,
              template: policy?.capabilities || {}, optOuts: ovr?.capabilityOptOuts || [],
            });
          } catch { /* best-effort */ }
          // drill-down — when a sibling DETAIL view needs a selection-derived
          // context key (shared screenDrilldown over renderMobile), picking a row
          // opens it with that key materialized from the picked row; no drill
          // target → the rows stay plain (no row-open affordance), like web.
          const drill = drilldownForScreen(manifestsByOrigin, screenPanel.screen, screenContext);
          if (alive) setListScreenData({ items, categoryField, searchFields, labelField, appOrigin, capabilityMatrix, drill, screenContext });
        } catch {
          if (alive) {
            setListScreenData(section.shape === 'record'
              ? { shape: 'record', record: null, appOrigin }
              : { items: [], categoryField, searchFields, labelField, appOrigin, capabilityMatrix: [], drill: null, screenContext });
          }
        }
      })();
      return () => { alive = false; };
    }

    const block = { id: `panel-${screenPanel.screen}`, type: screenPanel.screen, config: { scope: 'all' } };
    materializeBlock({ block, circleId: circle?.id, hostOps: { callSkill: rawCallSkill, eventLog, circles, fetchImpl: getCirclePodFetch() || undefined } })
      .then((m) => { if (alive) setPanelBlocks([m]); })
      .catch(() => { if (alive) setPanelBlocks([]); });
    return () => { alive = false; };
  }, [screenPanel, circle?.id, rawCallSkill, eventLog, circles, policy, capabilitySources, overrideStore, manifestsByOrigin]);

  // A tapped bubble button: S6.B screen button (has screen) → open the panel;
  // S6.A inline manifest button (has opId) → dispatch its op against the item;
  // otherwise (B clarification candidate) → bind the id + re-run.
  const onBubbleButton = useCallback((button) => {
    // One-tap fallback accept (the offer bubble's button) — App owns the store + offer.
    if (button?.id === 'delivery:allow-fallback') { onAcceptFallback?.(); return; }
    // Task #13 — an onboarding option (onboarding:*) or help affordance (help:topic:* / help:consent:*)
    // routes to the shared onboarding/help handlers before anything else.
    if (typeof button?.id === 'string' && task13ButtonRef.current?.(button.id)) return;
    // Feedback language switch (fp-lang:<code>) → rebuild the surface in that language (reusing the pods).
    if (typeof button?.id === 'string' && button.id.startsWith('fp-lang:')) {
      switchKringFeedbackLang(circle?.id, button.id.slice('fp-lang:'.length));
      return;
    }
    // Feedback control ids (review-card sends, verify buttons, etc.) route to the co-hosted feedback surface.
    if (typeof button?.id === 'string' && /^fp:/.test(button.id)) {
      feedbackMountRef.current?.mount?.surface?.handle(button.id, circle?.id).catch(() => {});
      return;
    }
    if (button?.screen) { setScreenPanel({ screen: button.screen }); return; }
    if (button?.opId) {
      const op = catalog?.opsById?.get(button.opId)?.op;
      const arg = op?.surfaces?.slash?.match?.arg
        ?? (op?.params || []).find((p) => p?.pickerSource)?.name
        ?? 'id';
      runCircleCommandResolved({ opId: button.opId, args: button.itemId != null ? { [arg]: button.itemId } : {} });
      return;
    }
    if (button?.id) clarify.pick(button.id, { id: circle?.id });
  }, [clarify, circle?.id, catalog, runCircleCommandResolved, switchKringFeedbackLang, onAcceptFallback]);

  // B (two-level LLM policy) — the member's PERSONAL default, consulted when the circle policy is
  // 'user'. Persisted via AsyncStorage; seeded from the configured route until a settings UI lands
  // (a stored preference always wins once set).
  const [userLlmDefault, setUserLlmDefault] = useState({ mode: CIRCLE_LLM_BASEURL ? 'local' : 'off' });
  useEffect(() => {
    let alive = true;
    createUserLlmDefaultStore(asyncStorageUserLlmIo(AsyncStorage)).get()
      .then((v) => { if (alive && v && v.mode !== 'off') setUserLlmDefault(v); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // B (per-circle policy) — THIS circle's llmTool is authoritative (same cc.circlePolicy.<id> store the
  // settings screen writes). Unset → the deployment default CIRCLE_LLM_POLICY. Reloads per circle.
  const [circleLlmPolicy, setCircleLlmPolicy] = useState(CIRCLE_LLM_POLICY);
  // This circle's app scope for the LLM tool list (the S6.C per-circle apps). Empty → fall back to the
  // deployment env default (CIRCLE_LLM_APPS), else all apps. Per-circle so a household circle offers
  // household tools while a chores circle offers its own — not a blunt global switch.
  const [circleApps, setCircleApps] = useState([]);
  useEffect(() => {
    let alive = true;
    if (!circle?.id) { setCircleLlmPolicy(CIRCLE_LLM_POLICY); setCircleApps([]); return undefined; }
    AsyncStorage.getItem(`cc.circlePolicy.${circle.id}`)
      .then((s) => {
        if (!alive) return;
        let raw = null;
        try { raw = s ? JSON.parse(s) : null; } catch { raw = null; }
        setCircleLlmPolicy(raw && typeof raw.llmTool === 'string' ? raw.llmTool : CIRCLE_LLM_POLICY);
        setCircleApps(Array.isArray(raw?.apps) ? raw.apps.filter((a) => typeof a === 'string' && a) : []);
      })
      .catch(() => { if (alive) { setCircleLlmPolicy(CIRCLE_LLM_POLICY); setCircleApps([]); } });
    return () => { alive = false; };
  }, [circle?.id]);
  // Per-circle apps win; deployment env is the fallback; neither → all apps (undefined → no scoping).
  const llmApps = circleApps.length ? circleApps : (CIRCLE_LLM_APPS.length ? CIRCLE_LLM_APPS : null);

  // B (circle bot) — the kring composer router: slash command → dispatch; free text addressed to the
  // bot (when the circle's LLM route is on) → interpret → dispatch; everything else → normal kring
  // post (fan-out the already-echoed message). Shared core with web (createCircleDispatch).
  // LLM + embed providers from the member's saved endpoint config (settings), falling back to the
  // EXPO_PUBLIC_* env. Shared with web via buildUserLlmRuntime (the confidential-route guard runs inside).
  // Rebuilds when userLlmDefault changes → a settings save live-applies (the bot useMemo depends on it).
  const llmRuntime = useMemo(() => {
    try {
      return buildUserLlmRuntime(userLlmDefault, { env: {
        mode: CIRCLE_LLM_BASEURL ? 'local' : 'off',
        llmBaseUrl: CIRCLE_LLM_BASEURL, llmModel: CIRCLE_LLM_MODEL,
        embedBaseUrl: CIRCLE_EMBED_BASEURL, embedModel: CIRCLE_EMBED_MODEL,
        timeoutMs: CIRCLE_LLM_TIMEOUT_MS,
      } });
    } catch { return { llmProviders: {}, embedProviders: {}, mode: 'off' }; }
  }, [userLlmDefault]);
  const hasEmbedProvider = !!(llmRuntime.embedProviders.local || llmRuntime.embedProviders.cloud);

  const circleBot = useMemo(() => createCircleDispatch({
    catalog,
    // Circle policy is authoritative (this circle's own llmTool); 'user' delegates to the member default.
    // `apps` scopes the LLM's tool list to the relevant app origins (was never passed → all 105 tools).
    // Per-circle (circle policy.apps) with the deployment env as fallback.
    policy: { llmTool: circleLlmPolicy, ...(llmApps ? { apps: llmApps } : {}) },
    userDefault: { mode: llmRuntime.mode },
    llmProviders: llmRuntime.llmProviders,
    interpret: interpretToCommand,
    // Conversation memory — the recent kring turns (latest via rowsRef), web parity.
    recentTurns: () => recentKringTurns({ rows: rowsRef.current, limit: 6 }),
    botName: CIRCLE_BOT_NAME,
    // Deterministic pre-LLM gate (manifest-derived via renderGate): "add X" / "done X" / "claim X"
    // route to the task op WITHOUT the (unreliable) small-model tool pick; else falls to interpret.
    // Gate built for the user's locale so trailing verbs ("kaas done"/"afwas klaar") match per-language.
    // F-retrieve (web parity): `makeCircleRetriever` auto-tiers — tier-2 SEMANTIC
    // when an embed route is configured (rides this circle's embed policy via
    // `resolveEmbed`), else tier-1 LEXICAL; an embedder error falls back to lexical.
    // Ranking lives once in circleRetriever; this shell injects the loadItems + embed adapters.
    gate: createTokenGate({
      rules: circleGateRules(lang()),
      retrieve: makeCircleRetriever({
        embed: hasEmbedProvider
          ? async (texts) => {
              const embedder = resolveCircleEmbedder({
                circlePolicy: { llmTool: circleLlmPolicy },
                userDefault:  { mode: llmRuntime.mode },
                providers:    llmRuntime.embedProviders,
              });
              if (!embedder) throw new Error('no-embedder');   // → graceful tier-1 lexical fallback
              return embedder.embed(texts);
            }
          : undefined,
        loadItems: (ctx) => loadCircleItems({ callSkill, circleId: ctx?.circleId ?? circle?.id }),
        // Persistence seam (vectorStore) — web parity. Threaded end-to-end into
        // PodSearch, which persists vectors under
        // private/state/search-index/circle-rag/<id>/ (never sharing/). Wires the
        // circle's available pseudo-pod StorageBackend; in-memory in the standalone
        // posture (live-pod dependency documented at circleSearchVectorStore).
        vectorStore: circleSearchVectorStore,
        scope: 'circle-rag',
      }),
    }),
    // A slash command is parsed to {opId,args}; the LLM already yields {opId,args}. Both then flow
    // through the clarifying dispatch (unique → run; ambiguous → ask with buttons).
    dispatch: (input) => {
      let cmd = input;
      if (typeof input === 'string') {
        const parsed = catalog ? parseInput(input, catalog) : null;
        cmd = parsed && parsed.kind === 'slash' && parsed.opId ? { opId: parsed.opId, args: parsed.args || {} } : null;
      }
      if (!cmd || !cmd.opId) { appendKringMessage({ actor: 'bot', text: t('circle.bot.unknown') }); return; }
      // E2 bulk fan-out ("/done all"): resolveDispatch flags it; run over the last listing, bypassing clarify.
      try {
        const r = resolveDispatch({ kind: 'slash', opId: cmd.opId, args: cmd.args || {} }, catalog);
        if (r && r.kind === 'bulk') return handleKringBulk(r);
      } catch { /* not bulk → normal path */ }
      return clarify.run(cmd, { id: circle?.id });
    },
    postToKring: (text, ctx) => { if (ctx?.msgId) broadcastFanOut({ msgId: ctx.msgId, text, ts: ctx.ts ?? Date.now() }); },
    // Addressed the bot, but the LLM mapped it to no tool → reply instead of going silent.
    onNoMatch: (_text, _ctx, opts) => { appendKringMessage({ actor: 'bot', text: (opts && opts.reply) || t('circle.bot.unknown') }); },
    // Smart chat off / unreachable → plain-language "basic mode" reply (contextual indicator, no badge).
    onLlmUnavailable: () => { appendKringMessage({ actor: 'bot', text: t('circle.bot.basic_mode') }); },
  }), [catalog, clarify, circle?.id, callSkill, appendKringMessage, broadcastFanOut, llmRuntime, hasEmbedProvider, circleLlmPolicy, llmApps, handleKringBulk]);

  // ── Task #13 — onboarding-as-bot-chat + standing help Q&A (thin twin of web circleApp.js) ──────────
  // The confidential-route-aware help LLM binding (parity with web's circleHelpLlm): ready() reflects
  // whether an LLM is actually resolved for this circle; confidential() carries the #37 honesty signal;
  // answer() returns the model's spoken reply (or null → never faked). Reuses the SAME resolution the
  // circle bot uses (resolveCircleLlm over this circle's policy + the member's live providers).
  const circleHelpLlm = useMemo(() => {
    const resolve = () => resolveCircleLlm({
      circlePolicy: { llmTool: circleLlmPolicy },
      userDefault:  { mode: llmRuntime.mode },
      providers:    llmRuntime.llmProviders,
    });
    return {
      ready: () => { try { return resolve() != null; } catch { return false; } },
      confidential: () => !!llmRuntime.confidential,
      answer: async (query) => {
        const llm = resolve();
        if (!llm) return null;
        // #38 — DEDICATED help-answer path (grounded in the kaartjes), NOT interpretToCommand's tool prompt.
        const ans = await answerHelpViaLlm({ query, lang: lang(), client: llm, deck: helpDeck });
        return ans && ans.text ? ans.text : null;
      },
    };
  }, [circleLlmPolicy, llmRuntime]);

  // The onboarding conversation run-state (shared driver) + the first-run guards. The template is built for
  // the language ACTIVE when the flow starts (see maybeStartOnboarding) — NOT at mount, which resolved
  // before the app language settled and rendered English bubbles on a Dutch app. Mirrors how the kaartjes
  // answers localise at call-time. (Web additionally hot-loads a remote copy — parity tail.)
  const onboardingTemplateRef = useRef(null);
  const onboardingRunStateRef = useRef(null);
  const onboardingPostedRef = useRef(false);
  const helpPendingQueryRef = useRef(null);   // the miss awaiting a "ja, doorsturen" tap

  // Post the driver's bot bubbles into the kring (each a bot bubble; a choice bubble carries its option
  // buttons, mapped from the shared {label, action} to the mobile {id, label} bubble-button model).
  const postOnboardingBubbles = useCallback((bubbles) => {
    for (const b of (Array.isArray(bubbles) ? bubbles : [])) {
      const buttons = Array.isArray(b.buttons) ? b.buttons.map((btn) => ({ id: btn.action, label: btn.label })) : undefined;
      appendKringMessage({ actor: 'bot', text: b.text, buttons });
    }
  }, [appendKringMessage]);

  // Kick off onboarding the first time the help circle opens (unless it already ran, or an onboarding is
  // already in the persisted stream — a reopen mid-flow). Idempotent via the persisted onboardingDone flag.
  const maybeStartOnboarding = useCallback(async () => {
    if (circle?.id !== HELP_CIRCLE_ID || onboardingPostedRef.current || !onboardingFlags) return;
    if (await onboardingFlags.isOnboardingDone()) { onboardingPostedRef.current = true; return; }
    if ((rowsRef.current || []).some((r) => r.actor === 'bot' || r.event?.actor === 'bot')) { onboardingPostedRef.current = true; return; }
    onboardingPostedRef.current = true;
    const template = buildOnboardingTemplate(lang());   // resolve language NOW, not at mount
    onboardingTemplateRef.current = template;
    const turn = onboardingTurn(template, startGuidedSetup(template));
    postOnboardingBubbles(turn.bubbles);
    onboardingRunStateRef.current = turn.state;
    if (turn.done) {
      if (turn.handoff) onCreateCircle?.();
      await onboardingFlags.markOnboardingDone();
    }
  }, [circle?.id, onboardingFlags, postOnboardingBubbles, onCreateCircle]);

  // A tapped onboarding option: echo the pick, advance the flow, post the next bubbles, and on a handoff
  // open the mobile create flow (marking onboarding done either way).
  const handleOnboardingAnswer = useCallback(async (value) => {
    if (circle?.id !== HELP_CIRCLE_ID || !onboardingRunStateRef.current) return;
    const r = answerOnboarding(onboardingTemplateRef.current, onboardingRunStateRef.current, value);
    if (r.echo) appendKringMessage({ actor: 'me', text: r.echo });
    onboardingRunStateRef.current = r.state;
    if (r.handoff) { await onboardingFlags?.markOnboardingDone(); onCreateCircle?.(); return; }
    postOnboardingBubbles(r.bubbles);
    if (r.done) await onboardingFlags?.markOnboardingDone();
  }, [circle?.id, appendKringMessage, postOnboardingBubbles, onboardingFlags, onCreateCircle]);

  // Post the deterministic set-topic chips ("of kies zelf"); honest=true frames them as the ONLY answerable
  // topics (the no-assistant fallback). Each chip carries its help:topic:<id> action as the mobile button id.
  const postHelpTopicChips = useCallback(({ honest = false } = {}) => {
    const chips = helpTopicChips({ lang: lang() }).map((c) => ({ id: c.action, label: c.label }));
    appendKringMessage({ actor: 'bot', text: honest ? t('circle.help.no_llm_topics') : t('circle.help.pick_topic'), buttons: chips });
  }, [appendKringMessage]);

  // Layer-2 execution — forward the query through the consent-gated route; badge the provenance for the
  // ACTUAL route (#37). A null/failed answer is surfaced HONESTLY (never faked) + the set topics.
  const runHelpLlm = useCallback(async (query) => {
    let reply = null;
    try { reply = await circleHelpLlm.answer(query); }
    catch { appendKringMessage({ actor: 'bot', text: t('circle.help.llm_unavailable') }); return; }
    if (reply) {
      const { badgeKey } = helpLlmLabelKeys({ confidential: circleHelpLlm.confidential() });
      appendKringMessage({ actor: 'bot', text: reply, provenance: t(badgeKey) });
      return;
    }
    appendKringMessage({ actor: 'bot', text: t('circle.help.llm_no_answer') });
    postHelpTopicChips();
  }, [circleHelpLlm, appendKringMessage, postHelpTopicChips]);

  // Answer a posted help message. HIT → the card + its transparency badge (deterministic, nothing leaves).
  // MISS → the consent card when an LLM is connected, else the honest set-topics.
  const answerHelpMessage = useCallback(async (query) => {
    const route = routeHelpMessage(query, { lang: lang(), llmReady: circleHelpLlm.ready() });
    if (route.kind === 'hit') { appendKringMessage({ actor: 'bot', text: route.text, provenance: route.provenance }); return; }
    if (route.kind === 'consent') {
      helpPendingQueryRef.current = { circleId: circle?.id, query };
      // #37 — name the route honestly: "vertrouwelijke assistent" only when it truly is confidential.
      const { consentKey } = helpLlmLabelKeys({ confidential: circleHelpLlm.confidential() });
      appendKringMessage({
        actor: 'bot', text: t(consentKey), consent: true,
        buttons: [
          { id: helpConsentAction('yes'), label: t('circle.help.consent_yes'), variant: 'primary' },
          { id: helpConsentAction('no'),  label: t('circle.help.consent_no'),  variant: 'secondary' },
        ],
      });
      return;
    }
    postHelpTopicChips({ honest: true });
  }, [circleHelpLlm, appendKringMessage, circle?.id, postHelpTopicChips]);

  // A tapped help button: a topic chip resolves deterministically; a consent choice forwards to the LLM
  // ("ja, doorsturen") or offers the set topics to pick from ("nee, ik kies zelf").
  const handleHelpAction = useCallback(async (help) => {
    if (help.kind === 'topic') {
      const ans = resolveHelpTopic(help.id, { lang: lang() });
      if (ans) appendKringMessage({ actor: 'bot', text: ans.text, provenance: ans.provenance });
      return;
    }
    if (help.kind === 'consent') {
      if (help.value === 'no') { postHelpTopicChips(); return; }
      if (help.value === 'yes') {
        const pending = helpPendingQueryRef.current && helpPendingQueryRef.current.circleId === circle?.id ? helpPendingQueryRef.current.query : null;
        helpPendingQueryRef.current = null;
        if (pending != null) await runHelpLlm(pending);
      }
    }
  }, [appendKringMessage, postHelpTopicChips, circle?.id, runHelpLlm]);

  // Latest-ref for onBubbleButton (defined earlier): route an onboarding/help button id, or return false.
  const routeTask13Button = useCallback((id) => {
    const ob = parseOnboardingAction(id);
    if (ob) { handleOnboardingAnswer(ob); return true; }
    const hp = parseHelpAction(id);
    if (hp) { handleHelpAction(hp); return true; }
    return false;
  }, [handleOnboardingAnswer, handleHelpAction]);
  task13ButtonRef.current = routeTask13Button;

  // Run the guided onboarding the first time the help circle opens; reset the per-circle guards on change.
  useEffect(() => {
    onboardingPostedRef.current = false;
    onboardingRunStateRef.current = null;
    helpPendingQueryRef.current = null;
    maybeStartOnboarding().catch((e) => console.warn('[kring] onboarding start failed', e?.message ?? e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circle?.id, maybeStartOnboarding]);

  // kring chat send: the feedback bot gets first refusal (it owns the turn only
  // for /feedback, /feedback-stop, and free text while active); otherwise echo + route to the circle bot.
  const sendKringChat = useCallback(async () => {
    const text = composerText.trim();
    if (!text || !eventLog?.append || !circle?.id) return;
    // a slash command opens a declared list-screen (the CHAT entry; web≡mobile).
    const scr = text.match(/^\/(contacts|prikbord)\b/i);
    if (scr && sectionForScreen(manifestsByOrigin, scr[1].toLowerCase())) { setComposerText(''); setScreenPanel({ screen: scr[1].toLowerCase() }); return; }
    // G17 — circle/transport slash commands (`/set-relay`, `/transport-mode`, `/settings`, `/transports`)
    // dispatch as BUILT-INS (settings/transport handlers) instead of routing to the bot/LLM. Same shared
    // classifier the web composer uses (invariants #1/#2).
    const builtin = parseCircleBuiltin(text);
    if (builtin) {
      setComposerText('');
      if (builtin.opId === 'settings') { onSettings?.(); return; }
      if (builtin.opId === 'set-relay') {
        // web≡mobile: report the STORED/effective relay + whether the reconnect actually
        // succeeded — not a blind echo of the typed URL (circleApp.js set-relay builtin).
        const r = await onCircleControl('set-relay', builtin.args);
        appendKringMessage({ actor: 'bot', text: r?.ok
          ? t('circle.settings.relay_applied', { url: r.effective || t('circle.settings.transports_none') })
          : t('circle.settings.relay_failed', { error: r?.error ?? 'unknown' }) });
        return;
      }
      if (builtin.opId === 'transport-mode') {
        const mode = builtin.args?.mode;
        if (['nkn', 'relay', 'both'].includes(String(mode))) {
          await onCircleControl('transport-mode', builtin.args);
          appendKringMessage({ actor: 'bot', text: t('circle.settings.transport_set', { mode }) });
        } else {
          appendKringMessage({ actor: 'bot', text: t('circle.settings.transport_bad', { mode: mode ?? '—' }) });
        }
        return;
      }
      if (builtin.opId === 'transports') {
        const ts = circleTransport || {};
        appendKringMessage({ actor: 'bot', text: t('circle.settings.transports_status', {
          mode: ts.mode ?? 'nkn', relay: ts.relayUrl || t('circle.settings.transports_none'),
        }) });
        return;
      }
      if (builtin.opId === 'security-status') {
        // web≡mobile parity (circleApp.js): the shared security-status report — what the circle boundary is
        // ENFORCING (refused senders + members still on their canonical key). Without this branch it fell
        // through to the bot path and never ran (#18). Routed via `onCircleControl` (the launcher owns the
        // agent `bundle`; CircleDetail is threaded the specific callback, not the whole bundle).
        const r = await onCircleControl?.('security-status', {});
        appendKringMessage({ actor: 'bot', text: r?.message ?? '' });
        return;
      }
    }
    setComposerText('');
    // Feedback review-card edit: the ✏ prefilled the composer with a point's text; this send is the EDIT.
    // Route it as an `fp:edit:<id>:<text>` control to the feedback surface (its dispatcher re-curates + shows
    // the updated card), echoing the edited line locally. Mirrors web's composer-prefill edit.
    if (feedbackEditRef.current && feedbackMountRef.current?.mount?.surface) {
      const pid = feedbackEditRef.current; feedbackEditRef.current = null;
      appendKringMessage({ actor: 'me', text });
      feedbackMountRef.current.mount.surface.handle(`fp:edit:${pid}:${text}`, circle.id).catch(() => {});
      return;
    }
    // Conversational follow-up: the bot asked for a missing field (needsForm); THIS message is the answer.
    // Append it, complete the pending dispatch, and run it — don't route to feedback or re-interpret.
    if (pendingFollowUp) {
      const pending = pendingFollowUp;
      setPendingFollowUp(null);
      appendKringMessage({ actor: 'me', text });
      const ready = completeFollowUp({ pending, text });
      await runCircleCommandResolved({ opId: ready.opId, args: ready.args });
      return;
    }
    // Conversational follow-up: the bot just asked a free-text question (llm-reply '?'). Route THIS line
    // back to it — force-addressed so handle() interprets it (recent turns give it the context) — instead
    // of broadcasting it to the kring. So "which list?" → "shopping" continues the conversation, no tag.
    if (awaitingBotReply && !text.startsWith('/')) {
      const prev = awaitingBotReply;
      setAwaitingBotReply(null);
      const appended = appendKringMessage({ actor: 'me', text });
      const line = addressesBot(text, CIRCLE_BOT_NAME) ? text : `@${CIRCLE_BOT_NAME} ${text}`;
      // Thread the prior exchange so a bare answer resolves: [original ask] → [bot's question] → [answer].
      const history = [
        { role: 'user', content: prev.query },
        { role: 'assistant', content: prev.question },
      ].filter((m) => m.content);
      const r = await Promise.resolve(circleBot.handle(line, { id: circle.id, msgId: appended?.msgId, ts: appended?.ts, history })).catch(() => null);
      noteBotTurn(r, text);
      return;
    }
    // M6 — lazy shared feedback mount; its appendUserBubble/appendBotBubble render into the kring. Text
    // bubbles (incl. the bot's button labels); interactive M12 chips on mobile are a follow-up.
    // The co-hosted feedback bot runs a REAL no-login session bound to THIS circle: the circle IS the feedback
    // project (projectId = circle.id, so a PM/admin opens verify rounds for it). Raw stays in the device's OWN
    // pod (persisted in AsyncStorage → survives reload); the round-approved summary is SIGNED with the device
    // agent identity and released to the companion collector. Rich emit sink: kind:'review' → editable CARDS,
    // kind:'report' → a chunked text bubble (web parity), else text + buttons. Rebuilt when the active circle
    // changes so pods/projectId/identity can't leak across circles.
    // NON-FATAL to the kring: a feedback build/route failure must NEVER break normal circle chat — on any
    // error we log and fall through to the regular fan-out path below.
    try {
      if (feedbackMountRef.current?.circleId !== circle.id) {
        const pods = makeNoLoginFeedbackPods({
          collectorUrl: FEEDBACK_COLLECTOR_URL,
          participantKey: coreIdentity?.pubKey,
          storage: AsyncStorage,
          podKey: `fp.ownpod.${circle.id}`,
        });
        const lg = lang();   // device language as the starting bot language; switchable via the fp-lang buttons
        feedbackMountRef.current = { circleId: circle.id, mount: buildFeedbackMount(circle, pods, lg), pods, lang: lg };
      }
      const startedFeedback = /^\/feedback(\s|$)/i.test(text);
      if (await feedbackMountRef.current.mount.tryHandle(text, circle.id)) {
        if (startedFeedback) emitFeedbackLangOptions(feedbackMountRef.current.lang);   // offer the other langs
        return;   // feedback owned the turn
      }
    } catch (e) {
      console.warn('[kring] feedback mount unavailable (chat continues):', e?.message ?? e);
    }
    // Task #13 — /help (+/hulp) opens the deterministic set-topic chips (no assistant needed).
    if (/^\/(help|hulp)\b/i.test(text)) { appendKringMessage({ actor: 'me', text }); postHelpTopicChips(); return; }
    // Task #13 — standing help Q&A. When the Onderling-bot is ADDRESSED in this circle (the 1:1 help
    // circle: always; a group: only when @-tagged, per the shared botIsAddressed gate), answer from the
    // deterministic kaartjes engine BEFORE the command bot / fan-out. A miss offers the consent-gated LLM
    // (when one is connected) or the honest set topics. Uses the #37 route-conditional wording (shared).
    const members = kringMembersRef.current;
    const helpBot = (members || []).find((m) => m && (m.relation === 'agent' || m.isBot === true));
    if (helpBot && botIsAddressed({ text, circleMembers: members, selfWebid: myWebidRef.current || null, botMember: helpBot })) {
      // Strip the @-tag from a GROUP mention before matching; a 1:1 line (no tag) is passed verbatim.
      const solo = oneToOneBotLabel({ members, selfWebid: myWebidRef.current || null, fallbackLabel: 'bot' }) != null;
      const q = solo ? text : stripBotTag(text, helpBot.name ?? helpBot.displayName ?? helpBot.label ?? '');
      appendKringMessage({ actor: 'me', text, scope: 'kring' });
      await answerHelpMessage(q);
      return;
    }
    // A plain typed line fans out to the whole kring → scope 'kring' (web parity).
    const appended = appendKringMessage({ actor: 'me', text, scope: 'kring' });
    // Fire-and-forget: the bot posts its own reply bubble; swallow rejections so a failed turn can't
    // surface as an unhandled promise rejection. noteBotTurn arms the conversational follow-up if the
    // bot replied with a question.
    Promise.resolve(circleBot.handle(text, { id: circle.id, msgId: appended?.msgId, ts: appended?.ts })).then((r) => {
      noteBotTurn(r, text);
      // An /addtask (or any task-touching) turn ran through the bot — refresh the Taken tab
      // so a newly-created task appears there without a manual reload.
      if (activeTab === 'taken') setTasksReloadTick((n) => n + 1);
    }).catch(() => {});
  }, [composerText, eventLog, circle?.id, appendKringMessage, circleBot, pendingFollowUp, runCircleCommandResolved, awaitingBotReply, noteBotTurn, manifestsByOrigin, buildFeedbackMount, emitFeedbackLangOptions, postHelpTopicChips, answerHelpMessage, activeTab, onCircleControl, circleTransport, onSettings, t]);

  // δ.2 — tap-to-retry on the failed icon.  Looks up the original
  // text from the eventLog so we don't have to remember it elsewhere.
  const onRetryDelivery = useCallback((msgId) => {
    if (!eventLog?.query) return;
    const evt = eventLog.query({ excludeMuted: true }).find((e) => e.id === msgId);
    const text = evt?.payload?.text;
    const ts   = evt?.ts ?? Date.now();
    if (typeof text !== 'string' || !text) return;
    // Web parity: a retry re-fans the ORIGINAL message including its media embed, not a text-only copy.
    broadcastFanOut({ msgId, text, ts, media: evt?.payload?.media });
  }, [eventLog, broadcastFanOut]);

  // Proof-of-Location: the passive placeholder row was removed 2026-06-25 (parked feature, /
  // ). The seam stays in the tree (src/v2/circlePol.js + getPolStatus + circle.pol.* locale) so
  // re-surfacing it later is just re-adding the row. See REMAINING-WORK.md "Proof-of-Location (parked)".

  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <View style={styles.page} testID="circle-detail">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
        {/* Chat ↔ Scherm pill (v2 §4).
            React Native's accessibilityRole vocabulary doesn't include
            'group' (that's a web-only ARIA role).  The buttons inside
            carry their own role + accessibilityState; the wrapper just
            needs a label for screen-reader context. */}
        <View
          style={styles.viewToggle}
          accessibilityLabel={t('circle.kring.view_toggle_label')}
          testID="circle-detail-view-toggle"
        >
          {['chat', 'scherm'].map((mode) => (
            <Pressable
              key={mode}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === viewMode }}
              testID={`circle-detail-view-${mode}`}
              onPress={() => { if (mode !== viewMode) setViewMode(mode); }}
              style={[styles.viewToggleBtn, mode === viewMode && styles.viewToggleBtnActive]}
            >
              <Text style={[styles.viewToggleText, mode === viewMode && styles.viewToggleTextActive]}>
                {t(`circle.kring.view_${mode}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('circle.kring.more')}
          testID="circle-detail-more"
          onPress={() => setMenuOpen((v) => !v)}
          style={styles.moreBtn}
        >
          <Text style={styles.moreBtnText}>⋯</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{circle.name || circle.id}</Text>
      {circle.memberCount != null ? (
        <Text style={styles.tileMeta}>{t('circle.members', { count: circle.memberCount })}</Text>
      ) : null}

      {menuOpen ? (
        <View style={styles.moreMenu} testID="circle-detail-more-menu">
          {/* D / Surface 2 — the ⋯ menu items are PROJECTED from manifest.actions
              via the shared `circleActionsMobile` selector (platform + feature
              gated), NOT a hand-written list.  `back` is rendered in the header
              bar above (a nav affordance), so it's excluded here.  id → the
              host-wired handler; each shell wires its own mechanism for a
              destination (e.g. `contacts` → setScreenPanel here, openCircleScreenPanel
              on web — the doorgeefluik model).  web ≡ mobile by construction. */}
          {circleActionsMobile(basisManifest, { policy })
            .filter((action) => action.id !== 'back')
            .map((action) => {
              const handlers = {
                invite: onInvite, settings: onSettings, lists: onLists,
                contacts: () => setScreenPanel({ screen: 'contacts' }),   // filterable list-screen
                override: onMine, viewAs: onViewAs, advisor: onAdvisor, skills: onSkills,
                files: onFiles, rules: onRules, recipes: onRecipes, admin: onAdmin, share: onShare,
                governance: onGovernance,
              };
              const on = handlers[action.id];
              const token = { override: 'mine', viewAs: 'viewas' }[action.id] ?? action.id;
              return (
                <Pressable
                  key={action.id}
                  onPress={() => { setMenuOpen(false); on?.(); }}
                  style={styles.moreItem}
                  testID={`circle-detail-${token}`}
                >
                  <Text style={styles.moreItemText}>{t(action.labelKey)}</Text>
                </Pressable>
              );
            })}
        </View>
      ) : null}

      {/* Proof-of-Location row removed 2026-06-25 (parked — see REMAINING-WORK.md). */}
      {myListTasks.length > 0 ? (
        <View style={styles.onYourList} testID="circle-detail-on-your-list">
          <Text style={styles.onYourListTitle}>{t('circle.on_your_list')}</Text>
          {myListTasks.map((task) => (
            <View key={task.id} style={styles.onYourListRow}>
              <Text style={styles.onYourListText} numberOfLines={2}>
                {task.text || task.title || task.label || String(task.id ?? '')}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* body switches by active tab. GESPREK = chat-style
          mixed stream; other tabs are placeholders until their content
          surfaces land in follow-up slices.
          scherm-mode wins over the tab body: the whole pane
          becomes the (placeholder) recept'd page. */}
      {/* Bulletin restyle — the GESPREK chat stream renders as ONE bot card (mirror of
          onderling.org's .chatbox / web's circle-kring__chat-card): a header strip (green
          presence dot + the kring assistant's name) over the message log, framed by a
          2px-ink border. The prikbord / scherm / leden tabs keep the plain body. The
          header + the bordered scroll are stacked siblings that read as one contiguous
          card (matching 2px-ink sides). */}
      {/* P1.7 — the viewer's conversation filter strip (kinds × people/agents), web parity. Only in the
          conversation view: elsewhere it would read as a control over tabs it does not touch. The chip
          model is shared, so a tap means the same thing on both platforms. */}
      {viewMode !== 'scherm' && activeTab === 'gesprek' ? (
        <ChatFilterStrip
          model={chatFilterChips({ allowedKinds, filter: viewerFilter })}
          onPick={onChatFilter}
          t={t}
          styles={styles}
        />
      ) : null}
      {viewMode !== 'scherm' && activeTab === 'gesprek' && botLabel ? (
        <View style={styles.chatHead} testID="circle-detail-bot-head">
          <View style={styles.chatDot} />
          <Text style={styles.chatName}>{botLabel}</Text>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={viewMode !== 'scherm' && activeTab === 'gesprek' ? [styles.list, styles.chatListPad] : styles.list}
        style={viewMode !== 'scherm' && activeTab === 'gesprek' ? styles.chatScroll : undefined}
        testID="circle-detail-stream"
        ref={streamScrollRef}
        // "My own message never appears in the Conversation" — it DID appear, at the bottom, below the
        // fold. Bubbles render oldest-first, this pane never scrolled, and nothing here moved the
        // viewport, so a send into a conversation that already filled the screen looked like a message
        // that had been dropped (it reached the peers the whole time). The sibling chat surface
        // (`ChatScreen`) has had this since it was written; this one never got it.
        // Gated on the chat tab: the prikbord / leden / taken bodies are lists you read from the top.
        onContentSizeChange={() => {
          if (viewMode === 'scherm' || activeTab !== 'gesprek') return;
          streamScrollRef.current?.scrollToEnd?.({ animated: true });
        }}
      >
        {viewMode === 'scherm' ? (
          // α.1e — render the materialized recipe blocks.  CircleScreenView
          // handles per-block status (ok / empty / error) + top-level
          // empty-state when no recipe is set up yet.
          <CircleScreenView blocks={screenBlocks} onAction={onScreenAction}
            onEmbedOpen={({ screen, ref }) => { if (screen) setScreenPanel({ screen, highlightRef: ref }); }} />
        ) : activeTab === 'prikbord' ? (
          // S1 #1 — the buurt noticeboard (its own composer + post list), scoped to
          // the open circle (S4 per-circle restructure — see stoopCall above).
          <CircleNoticeboard callSkill={stoopCall} onStoopEvent={onStoopEvent} media={circleMedia}
            onReportPost={onReportPost}
            onEmbedOpen={({ screen, ref }) => { if (screen) setScreenPanel({ screen, highlightRef: ref }); }} />
        ) : activeTab === 'leden' ? (
          // LEDEN — the circle's member roster (listGroupMembers → normalizeCircleMembers). web≡mobile.
          tabMembers == null ? (
            <Text style={styles.placeholder}>{t('circle.leden_tab.loading')}</Text>
          ) : tabMembers.length === 0 ? (
            <Text style={styles.placeholder}>{t('circle.leden_tab.empty')}</Text>
          ) : (
            tabMembers.map((m) => {
              const isSelf = mandateViewer.viewerWebid != null && m.id === mandateViewer.viewerWebid;
              return (
                // §2 — tap a member row → their persona card; tap your own row → self-view.
                <Pressable
                  key={m.id}
                  style={styles.memberRow}
                  accessibilityRole="button"
                  testID="circle-member-row"
                  onPress={() => setMemberCard({ member: m, self: isSelf })}
                >
                  <View style={{ flex: 1 }}>
                    {/* Reveal-gated via the SHARED helper (web parity): the roster row carries `realName`
                        ungated, so an unrevealed member must show their handle, never their name. */}
                    <Text style={styles.memberHandle} numberOfLines={1}>
                      {revealedMemberLabel(m, { viewerId: mandateViewer.viewerWebid ?? null, policy: policy?.revealPolicy ?? 'pairwise' }).primary}
                    </Text>
                    {(() => {
                      const sec = revealedMemberLabel(m, { viewerId: mandateViewer.viewerWebid ?? null, policy: policy?.revealPolicy ?? 'pairwise' }).secondary;
                      return sec ? <Text style={styles.memberName} numberOfLines={1}>{sec}</Text> : null;
                    })()}
                  </View>
                  {isSelf ? <Text style={styles.memberYou}>{t('circle.leden_tab.you')}</Text> : null}
                </Pressable>
              );
            })
          )
        ) : activeTab === 'taken' ? (
          // Taken (tasks) tab — list the circle's tasks with their lifecycle chips + the
          // owner-only entrust chip (the same seam the chat stream uses). Tapping entrust
          // opens the mandate picker; claim/done route to the tasks agent. web≡mobile.
          <View testID="circle-detail-taken">
            <Pressable
              style={styles.takenAdd}
              accessibilityRole="button"
              testID="circle-taken-add"
              onPress={() => setComposerText('/addtask ')}
            >
              <Text style={styles.takenAddText}>{t('circle.kring.taken_add')}</Text>
            </Pressable>
            {kringTasks.length === 0 ? (
              <Text style={styles.placeholder}>{t('circle.kring.taken_empty')}</Text>
            ) : (
              kringTasks.map((row) => (
                <View key={row.id} style={styles.taskCard} testID="circle-task-row">
                  <Text style={styles.taskText} numberOfLines={2}>
                    {row.text || t('circle.kring.taken_untitled')}
                  </Text>
                  <Text style={styles.taskStatus}>
                    {t(`circle.taskStatus.${row.status || 'open'}`, { defaultValue: row.status || '' })}
                  </Text>
                  <View style={styles.rowActions}>
                    {actionsForStreamRow(row, {
                      viewerWebid: mandateViewer.viewerWebid ?? null,
                      isAdmin: mandateViewer.isAdmin ?? false,
                    }).map((a) => (
                      <Pressable
                        key={a.id}
                        style={[styles.rowActionBtn, a.action === 'mandate' && styles.taskChipMandate]}
                        accessibilityRole="button"
                        testID={`circle-task-chip-${a.action}`}
                        onPress={() => onRowAction(a, row)}
                      >
                        <Text style={styles.rowActionText}>{t(a.label)}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))
            )}
          </View>
        ) : activeTab !== 'gesprek' ? (
          <Text style={styles.placeholder}>
            {t('circle.kring.tab_coming', { tab: t(`circle.tabs.${activeTab}`) })}
          </Text>
        ) : rows.length === 0 ? (
          <Text style={styles.muted}>{t('circle.kring.empty')}</Text>
        ) : (
          renderBubblesWithDayDividers(rows, t, {
            deliveryStateFor,
            localActor: 'me',
            onRetryDelivery,
            onBubbleButton,
            // Feedback review-card ✏ → prefill the composer with the point's text (web parity); the next send
            // becomes an `fp:edit:<id>:<text>` turn (see sendKringChat). feedbackLang labels the card buttons.
            onFeedbackEdit: (p) => { feedbackEditRef.current = p.id; setComposerText(p.text || ''); },
            // Long BOT bubbles (e.g. a verify-summary) chunk to a preview + Show more/less instead of the 4-line cap.
            isBubbleExpanded: (id) => expandedBubbles.has(id),
            onToggleBubble: toggleBubble,
            // tap a "See also" embed chip → open the item's screen panel (S6.B).
            onEmbedOpen: ({ screen, ref }) => { if (screen) setScreenPanel({ screen, highlightRef: ref }); },
            // Entrust (mandate) — owner-visibility signals + the row-action dispatcher (opens the picker).
            mandateViewer: { ...mandateViewer, localActor: 'me' },
            onRowAction,
            // §8 — report another member's message (a governance `message` report).
            onReportMessage,
          }, styles)
        )}
      </ScrollView>

      {/* S6.B — chat-triggered screen panel (tasks/agenda overview) in a modal. */}
      <Modal visible={!!screenPanel} animationType="slide" transparent onRequestClose={() => setScreenPanel(null)}>
        <View style={styles.panelBackdrop}>
          <View style={styles.panelCard} testID="circle-screen-panel">
            <View style={styles.panelHead}>
              <Text style={styles.panelTitle}>
                {screenPanel ? t(`circle.screen.open.${screenPanel.screen}`, { defaultValue: t('circle.screen.open_generic') }) : ''}
              </Text>
              <Pressable onPress={() => setScreenPanel(null)} testID="circle-screen-panel-close">
                <Text style={styles.panelClose}>✕</Text>
              </Pressable>
            </View>
            {listScreenData?.shape === 'record' ? (
              /* a record-shaped DETAIL screen (read-only key→value, web parity). */
              <ScrollView>
                <CircleRecordScreen record={listScreenData.record} />
              </ScrollView>
            ) : listScreenData ? (
              /* the interactive list-screen (owns its own scroll + search). */
              <CircleListScreen
                items={listScreenData.items}
                categoryField={listScreenData.categoryField}
                searchFields={listScreenData.searchFields}
                labelField={listScreenData.labelField}
                manifestsByOrigin={manifestsByOrigin}
                appOrigin={listScreenData.appOrigin}
                capabilityMatrix={listScreenData.capabilityMatrix}
                onRowAction={({ opId, itemId }) => { setScreenPanel(null); runCircleCommandResolved({ opId, args: { id: itemId } }); }}
                onRowOpen={(screenPanel?.screen === 'agents' || listScreenData.drill)
                  /* personas#1 — on the agents surface a PROFILE row opens the
                     "About me" persona view; other rows keep the drill-down
                     (web parity with openCircleScreenPanel's onRowOpen). */
                  ? ({ item }) => {
                      if (screenPanel?.screen === 'agents' && item?.role === 'profile') {
                        setScreenPanel(null);
                        setAboutMePersona(item?.agentId ?? item?.id);
                        return;
                      }
                      if (listScreenData.drill) setScreenPanel({
                        screen: listScreenData.drill.screenId,
                        context: selectionContextFor(listScreenData.drill, item, listScreenData.screenContext),
                      });
                    }
                  : undefined}
              />
            ) : (
              <ScrollView ref={panelScrollRef}>
                <View ref={panelContentRef} collapsable={false}>
                  <CircleScreenView blocks={panelBlocks} highlightRef={screenPanel?.highlightRef}
                    highlightRowRef={highlightRowRef} onHighlightLayout={scrollPanelToHighlight}
                    onEmbedOpen={({ screen, ref }) => { if (screen) setScreenPanel({ screen, highlightRef: ref }); }} />
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* §2 — member-persona card / self-view, opened by tapping a LEDEN-tab row. */}
      <Modal visible={!!memberCard} animationType="slide" transparent onRequestClose={() => setMemberCard(null)}>
        <View style={styles.panelBackdrop}>
          <View style={styles.panelCard}>
            {memberCard ? (
              <CircleMemberCardScreen
                member={memberCard.member}
                self={memberCard.self}
                roster={Array.isArray(tabMembers) ? tabMembers : []}
                myWebid={mandateViewer.viewerWebid ?? null}
                policy={policy?.revealPolicy ?? 'pairwise'}
                onBack={() => setMemberCard(null)}
                onReport={onReportMember ? (m) => { onReportMember(m); setMemberCard(null); } : undefined}
                resolvePicture={(ref) => resolveSealedThumbUri(ref, circleMedia?.mediaGateway?.opener)}
              />
            ) : null}
          </View>
        </View>
      </Modal>

      {/* mij#personas — the "Mij → persona's" surface (web parity with openAboutMePanel). */}
      <Modal visible={!!aboutMePersona} animationType="slide" transparent onRequestClose={() => setAboutMePersona(null)}>
        <View style={styles.panelBackdrop}>
          <View style={styles.panelCard} testID="circle-aboutme-panel">
            <View style={styles.panelHead}>
              <Text style={styles.panelTitle}>{t('circle.mij.title')}</Text>
              <Pressable onPress={() => setAboutMePersona(null)} testID="circle-aboutme-panel-close">
                <Text style={styles.panelClose}>✕</Text>
              </Pressable>
            </View>
            {aboutMePersona ? (
              <CircleMijScreen callSkill={rawCallSkill} sendPersonaUpdate={sendPersonaUpdate} lastShared={disclosureShareMemo} resealMediaForCircle={resealMediaForCircle} profilePicture={profilePicture} personaId={aboutMePersona} circles={circles} />
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Entrust (mandate) — the task-scoped grant picker (RN twin of web's openMandatePicker
          overlay). Confirm routes through the shared confirm/gate waist via onMandateConfirm. */}
      <CircleMandatePicker
        visible={!!mandatePicker}
        members={mandatePicker?.members ?? []}
        offerings={mandatePicker?.offerings ?? []}
        taskId={mandatePicker?.taskId ?? null}
        myWebid={mandatePicker?.myWebid ?? null}
        existingGrants={mandatePicker?.existingGrants ?? []}
        onConfirm={onMandateConfirm}
        onCancel={() => setMandatePicker(null)}
      />

      {/* 2+-field needsForm → an inline labelled form above the composer (parity with web). */}
      {pendingForm && viewMode !== 'scherm' && activeTab === 'gesprek' ? (
        <MultiFieldFormBubble pending={pendingForm} onSubmit={onFormSubmit} />
      ) : null}

      {/* inline composer. V0 appends a chat-message event to
          the local EventLog so the user sees their own write; peer
          broadcast lands in. Slash commands stay as a
          deeper follow-up (would need the chat-shell composition).
          composer suppressed in scherm-mode (recept page is
          not a chat surface). */}
      {/* S1 #1 — the noticeboard (prikbord) tab owns its own composer. */}
      {viewMode !== 'scherm' && activeTab === 'prikbord' ? null
      : viewMode !== 'scherm' && !canPost ? (
        /* Permission gate — chat disabled for this circle; read-only note in place of the composer. */
        <Text style={styles.composerDisabled} testID="circle-detail-composer-disabled">
          {t('circle.kring.chat_disabled')}
        </Text>
      ) : viewMode !== 'scherm' ? (
      <>
        {/* Slash-command auto-suggest — sits above the composer, mirrors the web dropdown. Tap a row
            to fill the command + a trailing space (then keep typing args). Hidden when there's no
            "/command" prefix match (suggestCommands closes once a space is typed). */}
        {suggestMatches.length > 0 ? (
          <View style={styles.suggest} testID="circle-detail-suggest">
            {suggestMatches.map((m) => (
              <Pressable
                key={m.command}
                style={styles.suggestItem}
                accessibilityRole="button"
                testID={`circle-detail-suggest-${m.opId}`}
                onPress={() => setComposerText(`${m.command} `)}
              >
                <Text style={styles.suggestCmd}>{m.command}</Text>
                {m.hint ? <Text style={styles.suggestHint} numberOfLines={1}>{m.hint}</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={styles.composer} testID="circle-detail-composer">
          <TextInput
            style={styles.composerInput}
            value={composerText}
            onChangeText={setComposerText}
            placeholder={t('circle.kring.composer_placeholder')}
            placeholderTextColor={theme.color.inkSoft}
            accessibilityLabel={t('circle.kring.composer_placeholder')}
            returnKeyType="send"
            onSubmitEditing={sendKringChat}
          />
          <Pressable
            style={styles.composerSend}
            accessibilityRole="button"
            accessibilityLabel={t('circle.kring.send')}
            testID="circle-detail-composer-send"
            onPress={sendKringChat}
          >
            <Text style={styles.composerSendText}>↑</Text>
          </Pressable>
        </View>
      </>
      ) : null}

      {/* per-kring bottom tab bar (derived from policy.features).
          Only renders when there are ≥ 2 tabs (a single-tab kring has
          nothing to switch between).
          also suppress in scherm-mode. */}
      {tabs.length >= 2 && viewMode !== 'scherm' ? (
        <View style={styles.kringTabs} testID="circle-detail-tabs">
          {tabs.map((tab) => (
            <Pressable
              key={tab.id}
              accessibilityRole="button"
              testID={`circle-detail-tab-${tab.id}`}
              onPress={() => {
                if (tab.id === activeTab) return;
                setActiveTab(tab.id);
                // D1 — count tab use so the Veel-gebruikt row reflects reality.
                const f = featureForTabId(tab.id);
                if (f && circle?.id) actionFrequency.bump(circle.id, f);
              }}
              style={[styles.kringTab, tab.id === activeTab && styles.kringTabActive]}
            >
              <Text style={[styles.kringTabText, tab.id === activeTab && styles.kringTabTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// render rows chronologically with day-dividers, mirroring
// the web circleKring renderer.  Keeps the mobile parity tight.
// δ.2 — `deliveryOpts` carries the per-message delivery-state hooks
// for locally-sent bubbles (clock / warning + tap-to-retry).
/**
 * P1.7 — the conversation filter strip (mobile mirror of web's `buildChatFilterStrip`).
 *
 * Pure projection of the SHARED chip model: each chip carries its own `nextFilter`, so neither shell
 * decides what a tap means. The note under the chips says this changes only what YOU see — it is a
 * reading preference, not a circle setting, and must not read like an admin control.
 */
function ChatFilterStrip({ model, onPick, t, styles }) {
  if (!model || typeof onPick !== 'function') return null;
  const chip = (key, label, c) => (
    <Pressable
      key={key}
      onPress={() => { if (!c.disabled) onPick(c.nextFilter); }}
      disabled={c.disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: c.selected, disabled: !!c.disabled }}
      style={[styles.filterChip, c.selected && styles.filterChipOn, c.disabled && styles.filterChipOff]}
      testID={`chat-filter-${key}`}
    >
      <Text style={[styles.filterChipText, c.selected && styles.filterChipTextOn]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.filterStrip, model.active && styles.filterStripActive]} testID="chat-filter-strip">
      <View style={styles.filterRow}>
        {(model.kindChips ?? []).map((c) =>
          chip(c.kind, t(`circle.chatFilter.kind.${c.kind}`, { defaultValue: c.kind }), c))}
        <View style={styles.filterSep} />
        {(model.authorChips ?? []).map((c) =>
          chip(c.authors, t(`circle.chatFilter.authors.${c.authors}`), c))}
      </View>
      <Text style={styles.filterNote}>{t('circle.chatFilter.note')}</Text>
    </View>
  );
}

function renderBubblesWithDayDividers(rows, t, deliveryOpts = null, styles) {
  const chronological = [...rows].reverse();
  const nodes = [];
  let lastKey = null;
  for (const row of chronological) {
    const key = dayKeyOf(row.ts);
    if (key !== lastKey) {
      nodes.push(
        <Text key={`d-${row.id}`} style={styles.dayDivider}>
          {formatDayLabel(row.ts, t)}
        </Text>,
      );
      lastKey = key;
    }
    nodes.push(renderBubble(row, t, deliveryOpts, styles));
  }
  return nodes;
}

function renderBubble(row, t, deliveryOpts = null, styles) {
  const payload = row.event?.payload ?? {};
  // Rich feedback: a Stage-1 review renders as editable CARDS (shared component), NOT a flattened text bubble
  // — parity with the web invite-circle kring. Card actions route through the same `onBubbleButton` as other
  // bot chips (send/send-all/cancel → fp:consent:*/fp:cancel); ✏ prefills the composer via onFeedbackEdit.
  const review = payload.review;
  if (review && Array.isArray(review.points)) {
    const onBtn = typeof deliveryOpts?.onBubbleButton === 'function' ? deliveryOpts.onBubbleButton : null;
    return (
      <View key={row.id} style={styles.bubble} testID={`kring-bubble-${row.id}`}>
        <FeedbackReviewCards
          intro={review.intro} points={review.points} labels={review.labels} botLang={deliveryOpts?.feedbackLang}
          editing={null}
          onEditPoint={(p) => deliveryOpts?.onFeedbackEdit?.(p)}
          onSend={(pid) => onBtn?.({ id: `fp:consent:${pid}` })}
          onSendAll={() => onBtn?.({ id: 'fp:consent:all' })}
          onSendNone={() => onBtn?.({ id: 'fp:cancel' })}
        />
      </View>
    );
  }
  const text = payload.text || payload.title || payload.body || String(row.id ?? '');
  // Stamped by `chatRows` through the reveal ladder (batch 4, web≡mobile) — paint only. An
  // unstamped row (roster still loading) shows no label; a stamped-unknown row shows the neutral
  // key. Never a payload-claimed name — that was the leak the old fallback chain carried.
  const sender = row?.senderSelf
    ? null
    : (row?.senderLabel ?? (row?.senderLabelKey ? t(row.senderLabelKey) : null));
  const kindRaw = payload.kind;
  const kind = (typeof kindRaw === 'string' && kindRaw && kindRaw !== 'message' && kindRaw !== 'chat-message')
    ? kindRaw.toUpperCase() : null;
  // Owner-only "entrust" (mandate) action rides the SAME actionsForStreamRow seam as web's
  // circleKring — gated by the viewer's identity signals (WebID + admin) plus the locally-
  // authored `isOwn` path. Without signals threaded the mandate action stays hidden (fail-closed).
  const mandateViewer = deliveryOpts?.mandateViewer ?? {};
  const rowIsOwn = mandateViewer.localActor != null && row?.actor === mandateViewer.localActor;
  const actions = actionsForStreamRow(row, {
    viewerWebid: mandateViewer.viewerWebid ?? null,
    isAdmin: !!mandateViewer.isAdmin,
    isOwn: rowIsOwn,
  });
  const onRowAction = typeof deliveryOpts?.onRowAction === 'function' ? deliveryOpts.onRowAction : null;
  // B (clarification) — per-message candidate buttons carried in the payload (e.g. "which item?").
  const msgButtons = Array.isArray(payload.buttons) ? payload.buttons : [];
  const onBubbleButton = typeof deliveryOpts?.onBubbleButton === 'function' ? deliveryOpts.onBubbleButton : null;
  // δ.2 — delivery-state icon for locally-sent chat messages only.
  // Mirrors web circleKring renderer's gate.
  const deliveryStateFor = typeof deliveryOpts?.deliveryStateFor === 'function'
    ? deliveryOpts.deliveryStateFor : null;
  const localActor      = deliveryOpts?.localActor ?? null;
  const onRetryDelivery = typeof deliveryOpts?.onRetryDelivery === 'function'
    ? deliveryOpts.onRetryDelivery : null;
  const isLocalChat = deliveryStateFor != null
    && localActor != null
    && row?.actor === localActor
    && (row?.type === 'chat-message' || row?.event?.type === 'chat-message');
  const deliveryState = isLocalChat ? deliveryStateFor(row.id) : null;
  // Bulletin restyle (web parity) — my own chat messages align right on --me-bg
  // (no border); everyone else's + the bot's stay left on --bot-bg + --bot-line.
  // Same gate the delivery icon uses: a locally-authored chat-message.
  const isMine = localActor != null
    && row?.actor === localActor
    && (row?.type === 'chat-message' || row?.event?.type === 'chat-message');
  // LLM-forward consent/handoff card — a bot bubble variant (dashed rust border,
  // peach fill). SEAM: nothing emits a consent bubble in the kring yet; the restyle
  // lights up when payload.consent is stamped. No backend consent logic is invented.
  const isConsent = !!payload.consent;
  const isBotRow = row.event?.actor === 'bot' || row.actor === 'bot';
  return (
    <View
      key={row.id}
      style={[styles.bubble, isMine && styles.bubbleMine, isConsent && styles.bubbleConsent]}
      testID={`kring-bubble-${row.id}`}
    >
      {sender && !isMine ? <Text style={styles.bubbleSender}>{sender}</Text> : null}
      {/* "only you" vs "whole kring" scope badge — one presentation of payload.scope. */}
      {payload.kind === 'chat-message' ? (
        <Text
          style={[styles.bubbleScope, payload.scope === 'kring' ? styles.bubbleScopeKring : styles.bubbleScopeSelf]}
          testID={`kring-scope-${payload.scope === 'kring' ? 'kring' : 'self'}-${row.id}`}
        >
          {payload.scope === 'kring' ? `👥 ${t('circle.scope.kring')}` : `👤 ${t('circle.scope.self')}`}
        </Text>
      ) : null}
      {(() => {
        // Long BOT bubbles (verify-summary et al.) chunk to a preview + a Show more/less toggle so a long
        // summary isn't hard-truncated at 4 lines; short bot bubbles + non-bot bubbles keep the 4-line cap.
        const isBot = row.event?.actor === 'bot' || row.actor === 'bot';
        const { head, rest } = isBot ? chunkBubble(text) : { head: text, rest: '' };
        const chunked = rest !== '';
        const shown = !chunked || deliveryOpts?.isBubbleExpanded?.(row.id) ? text : `${head}…`;
        const expanded = chunked && deliveryOpts?.isBubbleExpanded?.(row.id);
        return (
          <>
            <Text style={styles.bubbleText} numberOfLines={chunked ? undefined : 4}>
              {kind ? (<Text style={styles.bubbleKind}>{kind}  </Text>) : null}
              {shown}
            </Text>
            {chunked ? (
              <Pressable onPress={() => deliveryOpts?.onToggleBubble?.(row.id)} hitSlop={6} testID={`kring-more-${row.id}`}>
                <Text style={styles.bubbleMore}>{expanded ? t('circle.feedback.show_less') : t('circle.feedback.show_more')}</Text>
              </Pressable>
            ) : null}
          </>
        );
      })()}
      {/* Per-answer transparency badge (web parity, site .msg .src) — how a BOT
          answer came about. Only when a bot row carries payload.provenance: a string
          renders verbatim (pipeline-stamped, already localized), an object {llmUsed}
          localizes here. SEAM: nothing stamps provenance onto kring replies yet, so
          it stays dormant until the answer pipeline carries it. Never fabricated. */}
      {payload.provenance != null && isBotRow ? (
        <Text style={styles.bubbleProvenance} testID={`kring-provenance-${row.id}`}>
          {typeof payload.provenance === 'string'
            ? payload.provenance
            : t(payload.provenance.llmUsed ? 'circle.kring.provenance_llm' : 'circle.kring.provenance_direct')}
        </Text>
      ) : null}
      {embedChipsOf(payload).length > 0 ? (
        <View style={styles.bubbleEmbeds}>
          {embedChipsOf(payload).map((e) => {
            const typeKey = embedTypeLabelKey(e.type);
            const typeLabel = t(typeKey);
            const typeText = (typeLabel && typeLabel !== typeKey) ? typeLabel : e.type;
            const screen = screenForEmbedType(e.type);
            const onEmbedOpen = deliveryOpts?.onEmbedOpen;
            const tappable = !!(screen && !e.locked && typeof onEmbedOpen === 'function');
            const label = `${e.icon} ${typeText}: ${e.label ?? shortRef(e.ref)}`;
            return tappable ? (
              <Pressable key={e.ref} style={styles.bubbleEmbed} testID={`kring-embed-${e.ref}`}
                onPress={() => onEmbedOpen({ type: e.type, ref: e.ref, screen })}>
                <Text style={styles.bubbleEmbedText}>{label}</Text>
              </Pressable>
            ) : (
              <View key={e.ref} style={styles.bubbleEmbed} testID={`kring-embed-${e.ref}`}>
                <Text style={styles.bubbleEmbedText}>{label}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {actions.length > 0 ? (
        <View style={styles.rowActions}>
          {actions.map((a) => (
            <Pressable
              key={a.id}
              style={styles.rowActionBtn}
              testID={`kring-rowaction-${a.action}`}
              onPress={() => { if (onRowAction) onRowAction(a, row); else console.info('[kring] action', a.action, row.id); }}
            >
              <Text style={styles.rowActionText}>{t(a.label)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {/* §8 — report another member's human message (a governance `message` report). */}
      {typeof deliveryOpts?.onReportMessage === 'function' && !isMine && !isBotRow && payload.kind === 'chat-message' ? (
        <Pressable onPress={() => deliveryOpts.onReportMessage(row)} hitSlop={6} testID={`kring-report-${row.id}`}>
          <Text style={styles.bubbleReport}>{t('circle.governance.report_message')}</Text>
        </Pressable>
      ) : null}
      {msgButtons.length > 0 ? (
        <View style={styles.rowActions}>
          {msgButtons.map((b) => {
            // Bulletin restyle — a consent-card button carries `variant` so the
            // "ja, doorsturen" (primary, filled ink) / "nee, ik kies zelf"
            // (secondary, ink-outline) pair reads right (web parity).
            const primary = b.variant === 'primary';
            const secondary = b.variant === 'secondary';
            return (
              <Pressable
                key={b.id}
                style={[styles.rowActionBtn, primary && styles.consentBtnPrimary, secondary && styles.consentBtnSecondary]}
                accessibilityRole="button"
                testID={`kring-msgbtn-${b.id}`}
                onPress={() => { if (onBubbleButton) onBubbleButton(b); }}
              >
                <Text style={[styles.rowActionText, primary && styles.consentBtnPrimaryText]}>{b.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {/* Delivery state, driven by the SHARED presentation table (deliverySettings.js) — the same one
          the web bubble reads, replacing a three-state chain that knew nothing of the far-end states
          (`maybe-received` / `reached-device` / `stored` would have rendered as silence here). Retryable
          states are a Pressable; the rest a static Text with role=text. */}
      {(() => {
        const p = deliveryPresentation(deliveryState);
        if (!p) return null;
        const label = t(p.labelKey);
        const line = `${p.glyph} ${label}`;
        return p.retryable ? (
          <Pressable
            style={styles.deliveryFailed}
            accessibilityRole="button"
            accessibilityLabel={label}
            testID={`kring-delivery-${p.state}-${row.id}`}
            onPress={() => { if (onRetryDelivery) onRetryDelivery(row.id); }}
          >
            <Text style={styles.deliveryFailedText}>{line}</Text>
          </Pressable>
        ) : (
          <Text
            style={styles.deliveryPending}
            accessibilityLabel={label}
            accessibilityRole="text"
            testID={`kring-delivery-${p.state}-${row.id}`}
          >
            {line}
          </Text>
        );
      })()}
    </View>
  );
}

function dayKeyOf(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'unknown';
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function formatDayLabel(ts, t) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  if (sameDay) return t('circle.kring.day_today');
  if (isYest)  return t('circle.kring.day_yesterday');
  return d.toLocaleDateString();
}

// Compose the network sources ONCE. netinfo lives behind its own subpath because it imports a native
// module; if the binary predates it, `require` throws and we fall back to AppState alone rather than
// failing to render the screen.
let _netSource = null;
function subscribeToNetworkChange(fn) {
  if (!_netSource) {
    let netinfo = null;
    try {
      // eslint-disable-next-line global-require
      netinfo = require('@onderling/react-native/netinfo').subscribeToNetInfo;
    } catch { netinfo = null; }
    _netSource = netinfo ? combineSources([subscribeAppState, netinfo]) : subscribeAppState;
  }
  return _netSource(fn);
}

// Owns the connection-point store: hydrate from storage, fold in the OLD single-relay setting, and hold
// the remove-confirmation state. The store itself decides everything; this is lifecycle only.
function ConnectionPointsHost({ onBack }) {
  const [points, setPoints] = useState([]);
  const [removing, setRemoving] = useState(null);
  const storeRef = useRef(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const io = asyncStorageConnectionPointsIo(AsyncStorage);
      const initial = await io.load();
      const store = createConnectionPoints({ initial, save: (v) => { io.save(v); } });
      // Non-destructive: the old key still drives what boot connects to, so this seeds the list from it
      // rather than replacing it — and marks it live, because it IS the connection this device has.
      try { adoptExistingRelay({ relayUrl: await resolveMobileRelayUrl(), points: store }); } catch { /* best-effort */ }
      if (!alive) return;
      storeRef.current = store;
      store.subscribe(setPoints);
      setPoints(store.list());
    })();
    return () => { alive = false; };
  }, []);

  return (
    <ConnectionPointsScreen
      points={points}
      onBack={onBack}
      onAdopt={(url) => storeRef.current?.adopt(url)}
      onRemove={(url) => setRemoving({ url, ...storeRef.current?.impactOfRemoving(url) })}
      onCancelRemove={() => setRemoving(null)}
      onConfirmRemove={(url) => { storeRef.current?.remove(url); setRemoving(null); }}
      removing={removing}
    />
  );
}

// Connection points (Nearby step I). A projector over `createConnectionPoints` — the shared store makes
// every decision; this draws it.
//
// The one thing it must get right is the removal warning: "cut off" and "still reachable another way" are
// two separate statements, never one merged list of affected circles. Merging them is how someone clicks
// through the warning that mattered.
function ConnectionPointsScreen({ points = [], onBack, onAdopt, onRemove, onConfirmRemove, onCancelRemove, removing }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();   // clear the status bar so the header bar is fully tappable
  const styles = useMemo(() => makeStyles(theme, insets), [theme, insets]);
  return (
    <View style={styles.page} testID="circle-points">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-points-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.nearbyScreen.points_title')}</Text>
      <Text style={styles.muted}>{t('circle.nearbyScreen.points_intro')}</Text>
      {points.length === 0 ? (
        <Text style={styles.muted}>{t('circle.nearbyScreen.points_empty')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {points.map((point) => (
            <View key={point.url} style={styles.row} testID={`point-${point.url}`}>
              <Text style={styles.rowName}>{point.url}</Text>
              {/* One RELAY is live at a time (a socket); a POD has no socket — it is used whenever the
                  circle syncs — so it gets its own line + the host-sees disclosure instead. */}
              {point.kind === 'pod' ? (
                <>
                  <Text style={styles.rowMeta} testID={`point-live-${point.url}`}>
                    {t('circle.nearbyScreen.point_kind_pod')}
                  </Text>
                  <Text style={styles.rowMeta}>{t('circle.nearbyScreen.point_pod_host_sees')}</Text>
                </>
              ) : (
                <Text style={styles.rowMeta} testID={`point-live-${point.url}`}>
                  {t(point.active ? 'circle.nearbyScreen.point_active' : 'circle.nearbyScreen.point_standby')}
                </Text>
              )}
              <Text style={styles.rowMeta}>
                {t(POINT_SOURCE_LABELS[point.source] ?? POINT_SOURCE_LABELS.manual)}
              </Text>
              <Text style={styles.rowMeta}>
                {point.circles.length
                  ? t('circle.nearbyScreen.point_carries', { circles: point.circles.join(', ') })
                  : t('circle.nearbyScreen.point_carries_none')}
              </Text>
              <View style={styles.nearbyActions}>
                {!point.adopted ? (
                  <Pressable onPress={() => onAdopt?.(point.url)} accessibilityRole="button" testID={`point-adopt-${point.url}`} style={styles.nearbyAction}>
                    <Text style={styles.nearbyActionText}>{t('circle.nearbyScreen.point_adopt')}</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => onRemove?.(point.url)} accessibilityRole="button" testID={`point-remove-${point.url}`} style={styles.nearbyAction}>
                  <Text style={styles.nearbyActionText}>{t('circle.nearbyScreen.point_remove')}</Text>
                </Pressable>
              </View>
              {removing?.url === point.url ? (
                <View style={styles.nearbyBannerAlert} accessibilityRole="alert" testID={`point-impact-${point.url}`}>
                  {removing.losesReachability?.length ? (
                    <Text style={styles.rowName} testID="point-impact-cutoff">
                      {t('circle.nearbyScreen.remove_cuts_off', { circles: removing.losesReachability.join(', ') })}
                    </Text>
                  ) : null}
                  {removing.stillReachable?.length ? (
                    <Text style={styles.rowMeta}>
                      {t('circle.nearbyScreen.remove_still_ok', { circles: removing.stillReachable.join(', ') })}
                    </Text>
                  ) : null}
                  {removing.wasActive ? (
                    <Text style={styles.rowName}>{t('circle.nearbyScreen.remove_was_active')}</Text>
                  ) : null}
                  {!removing.losesReachability?.length && !removing.stillReachable?.length && !removing.wasActive ? (
                    <Text style={styles.rowMeta}>{t('circle.nearbyScreen.remove_nothing')}</Text>
                  ) : null}
                  <View style={styles.nearbyActions}>
                    <Pressable onPress={() => onConfirmRemove?.(point.url)} accessibilityRole="button" testID="point-confirm" style={styles.nearbyAction}>
                      <Text style={styles.nearbyActionText}>{t('circle.nearbyScreen.remove_confirm')}</Text>
                    </Pressable>
                    <Pressable onPress={onCancelRemove} accessibilityRole="button" testID="point-cancel" style={styles.nearbyAction}>
                      <Text style={styles.nearbyActionText}>{t('circle.nearbyScreen.remove_cancel')}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

// Host for the Nearby screen: owns the controller's lifecycle so the screen component stays a projector.
//
// Mounting is what makes the device discoverable and unmounting is what stops it, which is rule (c) — and
// it is deliberately tied to the React lifecycle rather than to a button, because the failure mode is a
// user who *thinks* they left. Navigating away, backgrounding, or a crash mid-render all unmount, and all
// must stop the announcement.
function NearbyScreenHost({ bundle, onBack, onAction, onOpenThread, onJoinInvite }) {
  const [model, setModel] = useState(null);
  // View state, not model state: whether THIS device currently has a text box open says nothing about
  // the room. `answering` holds the ask id being replied to.
  const [composing, setComposing] = useState(false);
  const [answering, setAnswering] = useState(null);
  const [notice, setNotice] = useState(null);

  const screen = useMemo(() => createNearbyScreen({
    control:            bundle?.discoverability ?? null,
    subscribeToPeers:   bundle?.nearbyPeers ? (fn) => bundle.nearbyPeers.subscribe(fn) : null,
    subscribeToNetwork: (fn) => subscribeToNetworkChange(fn),
    mySkills:           () => [],
    t,
    // Only what this host can actually carry out today. `request-join` needs the ask/invite exchange
    // (Nearby steps F + H) and is deliberately NOT offered until it works.
    supportedActions:   ['invite-to-circle', 'open-shared-circle'],
    onError: (err, phase) => console.warn(`[nearby] ${phase}:`, err?.message ?? err),
  }), [bundle]);

  useEffect(() => {
    const off = screen.subscribe(setModel);
    screen.open();
    return () => { off(); screen.close(); };
  }, [screen]);

  const submitAsk = useCallback(async (text) => {
    const r = await screen.askRoom({ text });
    setComposing(false);
    // Names the REAL reach — "asked 3 of 5 nearby" — rather than implying the whole room heard it.
    setNotice(r.ok ? { key: 'ask_sent', vars: { sent: r.sent, peers: r.peers } } : { key: 'ask_expired' });
  }, [screen]);

  const submitAnswer = useCallback(async (text) => {
    const askId = answering;
    setAnswering(null);
    const r = await screen.answer(askId, text);
    if (!r.ok) { setNotice({ key: 'ask_expired' }); return; }
    // Say plainly what just happened: answering is the disclosure.
    setNotice({ key: 'answer_sent' });
    if (r.thread) onOpenThread?.(r.thread);
  }, [screen, answering, onOpenThread]);

  const askAction = useCallback((action, ask) => {
    if (action === 'dismiss-ask') { screen.dismissAsk(ask?.id); return; }
    if (action === 'answer-ask')  { setNotice(null); setAnswering(ask?.id ?? null); }
  }, [screen]);

  const toggleAllow = useCallback((key, value) => { screen.setAllow(key, value); setNotice(null); }, [screen]);

  const submitCard = useCallback(async (fields) => {
    const r = await screen.showCard(fields);
    // Names the real reach, like an ask — "shown to 3 of 5" rather than "saved".
    setNotice(r.ok ? { key: 'card_shown', vars: { sent: r.sent, peers: r.peers } } : { key: 'ask_expired' });
  }, [screen]);

  const say = useCallback((text) => { screen.say(text); }, [screen]);

  // Joining a broadcast invite runs the SAME join as a scanned QR — the host hands the uri to the existing
  // wizard rather than to anything new, which is the point of step H.
  const inviteAction = useCallback((action, invite) => {
    if (action !== 'join-published-circle' || !invite?.uri) return;
    onJoinInvite?.(invite.uri);
  }, [onJoinInvite]);

  return (
    <NearbyScreen
      model={model}
      onBack={onBack}
      onAction={onAction}
      onAskAction={askAction}
      onToggleAllow={toggleAllow}
      onSubmitCard={submitCard}
      onSay={say}
      onInviteAction={inviteAction}
      onCompose={() => { setNotice(null); setComposing(true); }}
      composing={composing}
      answering={!!answering}
      notice={notice}
      onSubmitAsk={submitAsk}
      onSubmitAnswer={submitAnswer}
      onCancel={() => { setComposing(false); setAnswering(null); }}
    />
  );
}

// Nearby screen. Renders the model `createNearbyScreen` produces — the same model the
// web renderer draws (invariant 2), so the two cannot drift on what proximity entitles a stranger to.
// Self-contained so vitest can target it without the RN test renderer.
//
// Step E added two things the row list could not say:
//   • a VISIBILITY banner — what the device is actually doing, from the transports rather than from what
//     the screen asked for. The disagreement case ("hidden" but still announcing) outranks the rest.
//   • per-row ACTIONS, already decided on the row by `nearbyActions`. This renderer only labels them.

// `NEARBY_ACTION_LABELS` + `nearbyVisibilityKey` are imported from the basis app above — one definition,
// so web and mobile cannot drift on what a row offers or on when the "still visible" warning fires.
function NearbyScreen({
  model, onBack, onAction, onAskAction, onCompose, composing, notice, onSubmitAsk,
  answering, onSubmitAnswer, onCancel, onToggleAllow, onSubmitCard, onSay, onInviteAction,
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();   // clear the status bar so the header bar is fully tappable
  const styles = useMemo(() => makeStyles(theme, insets), [theme, insets]);
  const rows       = Array.isArray(model?.rows) ? model.rows : [];
  const own        = model?.ownProfile ?? {};
  const headerText = model?.headerLabel ?? '';
  const visKey     = nearbyVisibilityKey(model?.visibility);
  const asks       = Array.isArray(model?.asks) ? model.asks : [];
  const [draft, setDraft] = useState('');
  const allows     = model?.allows ?? { card: false, chat: false };
  // `null` means "I have not joined" — deliberately distinct from an empty conversation.
  const chat       = Array.isArray(model?.chat) ? model.chat : null;
  const [cardLabel, setCardLabel] = useState('');
  const [cardLine, setCardLine]   = useState('');
  const [chatDraft, setChatDraft] = useState('');
  const invites    = Array.isArray(model?.invites) ? model.invites : [];
  // Cleared whenever the composer opens or closes, so a previous question is never re-sent by accident.
  useEffect(() => { setDraft(''); }, [composing, answering]);
  return (
    <View style={styles.page} testID="circle-nearby-screen">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-nearby-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.nearbyScreen.title')}</Text>
      {visKey ? (
        <View
          style={[styles.nearbyBanner, visKey === 'still_visible' ? styles.nearbyBannerAlert : null]}
          testID={`nearby-visibility-${visKey}`}
          accessibilityRole={visKey === 'still_visible' ? 'alert' : undefined}
        >
          <Text style={styles.nearbyBannerTitle}>{t(`circle.nearbyScreen.${visKey}_title`)}</Text>
          <Text style={styles.muted}>{t(`circle.nearbyScreen.${visKey}_body`)}</Text>
        </View>
      ) : null}
      <Text style={styles.muted}>{headerText}</Text>
      {rows.length === 0 ? (
        <Text style={styles.muted}>{t('circle.nearbyScreen.header_empty')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {rows.map((row) => (
            <View
              key={row.id || row.pseudonym}
              style={styles.row}
              testID={`nearby-row-${row.id || row.pseudonym}`}
            >
              <Text style={styles.rowName}>{row.pseudonym}</Text>
              {row.sharedSkills.length ? (
                <Text style={styles.rowMeta}>{row.sharedSkills.join(', ')}</Text>
              ) : null}
              {row.proximity ? <Text style={styles.rowMeta}>{row.proximity}</Text> : null}
              {/* Attached to the person, not a separate list — a face and a card are one thing. */}
              {row.card?.line ? <Text style={styles.rowMeta}>{row.card.line}</Text> : null}
              {row.card?.tags?.length ? <Text style={styles.rowMeta}>{row.card.tags.join(', ')}</Text> : null}
              {/* Rule (b): a stranger you can see is still a stranger — say it, rather than letting the
                  absence of an "open" button be the only hint. */}
              {row.note === 'nearby-not-member' ? (
                <Text style={styles.rowMeta} testID={`nearby-note-${row.id || row.pseudonym}`}>
                  {t('circle.nearbyScreen.not_member_note')}
                </Text>
              ) : null}
              {Array.isArray(row.actions) && row.actions.some((a) => NEARBY_ACTION_LABELS[a]) ? (
                <View style={styles.nearbyActions}>
                  {row.actions.filter((a) => NEARBY_ACTION_LABELS[a]).map((action) => (
                    <Pressable
                      key={action}
                      onPress={() => { if (typeof onAction === 'function') onAction(action, row); }}
                      accessibilityRole="button"
                      testID={`nearby-action-${action}-${row.id || row.pseudonym}`}
                      style={styles.nearbyAction}
                    >
                      <Text style={styles.nearbyActionText}>{t(NEARBY_ACTION_LABELS[action])}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
      {/* Asks (step F). Every live ask shows, matching or not — filtering the room to what resonates
          would make it a recommender, and would leak my own drivers into what I am able to see. */}
      <View style={styles.nearbyAsks} testID="nearby-asks">
        <Text style={styles.ownProfileTitle}>{t('circle.nearbyScreen.asks_title')}</Text>
        {composing || answering ? (
          // Inline, not a modal: the room stays visible while you type. You are about to say something out
          // loud in a place where you can see who is standing there.
          <View style={styles.nearbyComposer} testID="nearby-ask-composer">
            <TextInput
              style={styles.nearbyInput}
              value={draft}
              onChangeText={setDraft}
              maxLength={280}
              placeholder={t('circle.nearbyScreen.ask_placeholder')}
              testID="nearby-ask-input"
              autoFocus
            />
            <Pressable
              onPress={() => {
                const text = draft.trim();
                if (!text) return;
                if (answering) onSubmitAnswer?.(text); else onSubmitAsk?.(text);
              }}
              accessibilityRole="button"
              testID="nearby-ask-send"
              style={styles.nearbyAction}
            >
              <Text style={styles.nearbyActionText}>{t('circle.nearbyScreen.ask_send')}</Text>
            </Pressable>
            <Pressable onPress={onCancel} accessibilityRole="button" testID="nearby-ask-cancel" style={styles.nearbyAction}>
              <Text style={styles.nearbyActionText}>{t('circle.back')}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={onCompose} accessibilityRole="button" testID="nearby-ask-compose" style={styles.nearbyAction}>
            <Text style={styles.nearbyActionText}>{t('circle.nearbyScreen.ask_compose')}</Text>
          </Pressable>
        )}
        {notice ? (
          <Text style={styles.muted} accessibilityRole="text" testID={`nearby-notice-${notice.key}`}>
            {t(`circle.nearbyScreen.${notice.key}`, notice.vars ?? {})}
          </Text>
        ) : null}
        {asks.length === 0 ? (
          <Text style={styles.muted}>{t('circle.nearbyScreen.asks_empty')}</Text>
        ) : asks.map((entry) => (
          <View key={entry.ask?.id} style={styles.nearbyAsk} testID={`nearby-ask-${entry.ask?.id}`}>
            <Text style={styles.rowName}>{entry.ask?.text}</Text>
            {entry.resonant && entry.reason ? (
              // Names the SHARED tags only; my unmatched drivers never appear here.
              <Text style={styles.rowMeta}>{t('circle.nearbyScreen.ask_resonant', { reason: entry.reason })}</Text>
            ) : null}
            {/* Shown to me, sent nowhere — the reminder that replying is what reveals me. */}
            <Text style={styles.rowMeta}>{t('circle.nearbyScreen.ask_disclosure')}</Text>
            {Array.isArray(entry.actions) && entry.actions.some((a) => NEARBY_ASK_LABELS[a]) ? (
              <View style={styles.nearbyActions}>
                {entry.actions.filter((a) => NEARBY_ASK_LABELS[a]).map((action) => (
                  <Pressable
                    key={action}
                    onPress={() => { if (typeof onAskAction === 'function') onAskAction(action, entry.ask); }}
                    accessibilityRole="button"
                    testID={`nearby-ask-action-${action}-${entry.ask?.id}`}
                    style={styles.nearbyAction}
                  >
                    <Text style={styles.nearbyActionText}>{t(NEARBY_ASK_LABELS[action])}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ))}
      </View>
      {/* Circles being advertised here (step H). Its own block, not on peer rows: what matters is which
          CIRCLE is open, not who is holding the door. */}
      <View style={styles.nearbyAsks} testID="nearby-invites">
        <Text style={styles.ownProfileTitle}>{t('circle.nearbyScreen.invites_title')}</Text>
        {invites.length === 0 ? (
          <Text style={styles.muted}>{t('circle.nearbyScreen.invites_empty')}</Text>
        ) : invites.map((entry) => (
          <View key={entry.invite?.circleId} style={styles.nearbyAsk} testID={`nearby-invite-${entry.invite?.circleId}`}>
            <Text style={styles.rowName}>{entry.invite?.circleName || entry.invite?.circleId}</Text>
            {/* On every invite: the carrier changed, the gate did not. */}
            <Text style={styles.rowMeta}>{t('circle.nearbyScreen.join_is_a_join')}</Text>
            <View style={styles.nearbyActions}>
              {(entry.actions ?? []).filter((a) => NEARBY_INVITE_LABELS[a]).map((action) => (
                <Pressable
                  key={action}
                  onPress={() => onInviteAction?.(action, entry.invite)}
                  accessibilityRole="button"
                  testID={`nearby-invite-action-${action}-${entry.invite?.circleId}`}
                  style={styles.nearbyAction}
                >
                  <Text style={styles.nearbyActionText}>{t(NEARBY_INVITE_LABELS[action])}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </View>

      {/* Cards + chat, each behind its own per-device allow (step G). */}
      <View style={styles.nearbyAsks} testID="nearby-allows">
        {['card', 'chat'].map((key) => (
          <View key={key}>
            <Pressable
              onPress={() => onToggleAllow?.(key, !allows[key])}
              accessibilityRole="switch"
              accessibilityState={{ checked: !!allows[key] }}
              testID={`nearby-allow-${key}`}
              style={styles.nearbyAction}
            >
              <Text style={styles.nearbyActionText}>
                {`${allows[key] ? '☑' : '☐'} ${t(`circle.nearbyScreen.allow_${key}`)}`}
              </Text>
            </Pressable>
            {/* Says what OTHERS see, not what the switch position is. */}
            {!allows[key] ? (
              <Text style={styles.muted} testID={`nearby-allow-off-${key}`}>
                {t(`circle.nearbyScreen.allow_${key}_off`)}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      {allows.card ? (
        <View style={styles.nearbyAsks} testID="nearby-card-form">
          <Text style={styles.ownProfileTitle}>{t('circle.nearbyScreen.card_title')}</Text>
          <TextInput
            style={styles.nearbyInput}
            value={cardLabel}
            onChangeText={setCardLabel}
            maxLength={40}
            placeholder={t('circle.nearbyScreen.card_label')}
            testID="nearby-card-label"
          />
          <TextInput
            style={styles.nearbyInput}
            value={cardLine}
            onChangeText={setCardLine}
            maxLength={140}
            placeholder={t('circle.nearbyScreen.card_line')}
            testID="nearby-card-line"
          />
          {/* The consequence, next to the fields. */}
          <Text style={styles.muted}>{t('circle.nearbyScreen.card_visible_to')}</Text>
          <Pressable
            onPress={() => {
              const label = cardLabel.trim();
              if (!label) return;
              onSubmitCard?.({ label, line: cardLine.trim() });
            }}
            accessibilityRole="button"
            testID="nearby-card-save"
            style={styles.nearbyAction}
          >
            <Text style={styles.nearbyActionText}>{t('circle.nearbyScreen.card_save')}</Text>
          </Pressable>
        </View>
      ) : null}

      {chat ? (
        <View style={styles.nearbyAsks} testID="nearby-chat">
          <Text style={styles.ownProfileTitle}>{t('circle.nearbyScreen.chat_title')}</Text>
          {/* A chat window normally implies history; this one has none, so it says so. */}
          <Text style={styles.muted}>{t('circle.nearbyScreen.chat_ephemeral')}</Text>
          {chat.length === 0 ? (
            <Text style={styles.muted}>{t('circle.nearbyScreen.chat_empty')}</Text>
          ) : chat.map((m) => (
            <Text key={m.id} style={styles.rowMeta} testID={`nearby-chat-${m.id}`}>{m.text}</Text>
          ))}
          <View style={styles.nearbyComposer}>
            <TextInput
              style={styles.nearbyInput}
              value={chatDraft}
              onChangeText={setChatDraft}
              maxLength={500}
              placeholder={t('circle.nearbyScreen.chat_placeholder')}
              testID="nearby-chat-input"
            />
            <Pressable
              onPress={() => {
                const text = chatDraft.trim();
                if (!text) return;
                onSay?.(text);
                setChatDraft('');
              }}
              accessibilityRole="button"
              testID="nearby-chat-send"
              style={styles.nearbyAction}
            >
              <Text style={styles.nearbyActionText}>{t('circle.nearbyScreen.chat_send')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.ownProfile}>
        <Text style={styles.ownProfileTitle}>{t('circle.nearbyScreen.own_profile')}</Text>
        <Text style={styles.muted}>
          {Array.isArray(own.publishedSkills) && own.publishedSkills.length
            ? own.publishedSkills.join(', ')
            : t('circle.nearbyScreen.own_profile_empty')}
        </Text>
      </View>
    </View>
  );
}

// Mijn dingen notes-list: the Folio screen
// scoped to the private kring.  Empty state by default; rows fill in
// when callSkill('listFiles') returns mine-and-circle-less items.
function MyThingsScreen({ files = [], onBack }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();   // clear the status bar so the header bar is fully tappable
  const styles = useMemo(() => makeStyles(theme, insets), [theme, insets]);
  return (
    <View style={styles.page} testID="circle-mythings">
      <View style={styles.bar}>
        <Pressable onPress={onBack} accessibilityRole="button" testID="circle-mythings-back">
          <Text style={styles.back}>{t('circle.back')}</Text>
        </Pressable>
      </View>
      <Text style={styles.title}>{t('circle.folio.my_things_title')}</Text>
      {files.length === 0 ? (
        <Text style={styles.muted}>{t('circle.folio.my_things_empty')}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {files.map((file) => (
            <View key={file.id} style={styles.row} testID={`mythings-row-${file.id}`}>
              <Text style={styles.rowName}>{file.name}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * `insets` — the safe-area insets of the screen this stylesheet is for (`useSafeAreaInsets()`).
 *
 * Every screen in this file is a full-bleed `styles.page` whose FIRST child is a header bar with the
 * `← circles` back button and (on the detail screen) the Chat/Scherm toggle. With a flat 12px top pad
 * those controls render level with the system clock: their upper halves are behind the status bar and
 * simply do not receive touches — `← circles` could not be hit at all. So the inset belongs to `page`,
 * the one style all of them share, rather than to each header.
 *
 * Defaults to zero so a caller with no header (the launcher TILE) keeps the exact previous padding.
 */
const makeStyles = (theme, insets = null) => StyleSheet.create({
  // S6.B — chat-triggered screen panel.
  panelBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  panelCard:  { backgroundColor: theme.color.paper, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%', minHeight: '50%', padding: 16 },
  panelHead:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  panelTitle: { fontFamily: theme.font.serif, fontSize: 18, fontWeight: '600', color: theme.color.ink },
  panelClose: { fontSize: 16, color: theme.color.inkSoft, paddingHorizontal: 6 },
  page:       { flex: 1, paddingHorizontal: 16, paddingTop: (insets?.top ?? 0) + 12, backgroundColor: theme.color.paper },
  bar:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 22 },
  back:       { fontSize: 13, color: theme.color.inkSoft },
  barActions: { flexDirection: 'row', gap: 14, marginLeft: 'auto' },
  availText:  { fontSize: 13, color: theme.color.inkSoft, fontWeight: '600' },
  detailActions:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 6 },
  // 5.9c — passive Nearby row at the top of the kringen list.
  nearbyRow:       { paddingHorizontal: 2, paddingVertical: 6, marginBottom: 2 },
  nearbyText:      { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic' },
  // 5.9d — passive Proof-of-Location row (placeholder; not tappable).
  polRow:          { flexDirection: 'row', gap: 6, alignItems: 'baseline', marginTop: 4, marginBottom: 8, paddingHorizontal: 2 },
  polLabel:        { fontSize: 12, color: theme.color.inkSoft, fontWeight: '600' },
  polValue:        { fontSize: 12, color: theme.color.inkSoft, fontStyle: 'italic' },
  detailAction:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.card },
  detailActionText: { fontSize: 12, color: theme.color.inkSoft },
  title:      { fontSize: 24, fontWeight: '600', fontFamily: theme.font.serif, color: theme.color.ink, marginVertical: 10 },
  list:       { gap: 6, paddingBottom: 32 },
  // β.3 — per-kind grouping in the launcher (small-caps muted header,
  // matches the web `.circle-launcher__section-title` look).
  section:        { marginTop: 10, gap: 6 },
  sectionTitle:   { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2, color: theme.color.inkSoft, marginBottom: 4, paddingHorizontal: 2 },
  tile:       { padding: 13, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card, flexDirection: 'row', alignItems: 'center', gap: 10, position: 'relative' },
  // β.5 — pinned tile gets the accent border + the 📌 indicator in the
  // top-right corner so users see "this floated to the top on purpose".
  tilePinned:        { borderColor: theme.color.accent },
  tilePinIndicator:  { position: 'absolute', top: 4, right: 8, fontSize: 11, opacity: 0.7 },
  tileBody:   { flex: 1, minWidth: 0 },
  tileName:   { fontSize: 14, fontWeight: '600', color: theme.color.ink },
  tileMeta:   { fontSize: 11, color: theme.color.inkSoft, marginTop: 2 },
  // unread badge on the tile.
  tileUnread: {
    minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11,
    backgroundColor: theme.color.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  tileUnreadText: { color: theme.color.white, fontSize: 12, fontWeight: '700' },
  // pending voorstellen badge (uses a yellow-ish hint to
  // separate it visually from the unread-red).
  tileProposals: {
    minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11,
    backgroundColor: theme.color.amber,
    alignItems: 'center', justifyContent: 'center',
  },
  tileProposalsText: { color: theme.color.white, fontSize: 12, fontWeight: '700' },
  // Launcher shortcut button row (Nearby, Mijn dingen).
  shortcut:     { paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: theme.color.line, borderRadius: 16, backgroundColor: theme.color.card, marginBottom: 6, alignSelf: 'flex-start' },
  shortcutText: { fontSize: 13, color: theme.color.ink },
  muted:      { color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 10 },
  newBtn:     { marginTop: 12, padding: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.line, borderRadius: 8, alignItems: 'center' },
  newText:    { color: theme.color.inkSoft },
  joinBtn:    { marginTop: 8, padding: 12, borderWidth: 1, borderColor: theme.color.accent, borderRadius: 8, alignItems: 'center' },
  joinText:   { color: theme.color.accent, fontWeight: '600' },
  inviteBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  inviteCard: { backgroundColor: theme.color.paper, borderRadius: 14, padding: 20, alignItems: 'center', maxWidth: 320 },
  inviteTitle:{ fontSize: 16, fontWeight: '700', color: theme.color.ink, marginBottom: 12 },
  inviteHint: { fontSize: 13, color: theme.color.inkSoft, marginTop: 10, textAlign: 'center' },
  createRow:  { marginTop: 12, flexDirection: 'row', gap: 8, alignItems: 'center' },
  input:      { flex: 1, padding: 11, borderWidth: 1, borderColor: theme.color.accent, borderRadius: 8, backgroundColor: theme.color.white, fontSize: 14 },
  createBtn:  { width: 42, paddingVertical: 11, borderRadius: 8, backgroundColor: theme.color.accent, alignItems: 'center' },
  createBtnText: { color: theme.color.white, fontSize: 16, fontWeight: '700' },
  // Shared row styles used by NearbyScreen + MyThingsScreen + kring stream.
  row:        { padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card, marginBottom: 6 },
  rowName:    { fontSize: 14, fontWeight: '600', color: theme.color.ink },
  rowMeta:    { fontSize: 12, color: theme.color.inkSoft, marginTop: 2 },
  // header overflow `⋯` trigger + collapsible menu.
  moreBtn:        { paddingHorizontal: 10, paddingVertical: 4 },
  moreBtnText:    { fontSize: 22, color: theme.color.inkSoft, lineHeight: 24 },
  moreMenu:       { borderWidth: 1, borderColor: theme.color.line, borderRadius: 8, backgroundColor: theme.color.card, padding: 4, marginTop: 4, marginBottom: 4 },
  moreItem:       { paddingVertical: 9, paddingHorizontal: 12 },
  moreItemText:   { fontSize: 13, color: theme.color.ink },
  // Bulletin restyle — the GESPREK stream is ONE bot card (mirror of onderling.org's
  // .chatbox / web's circle-kring__chat-card). The header strip + the bordered scroll
  // are stacked siblings sharing a 2px-ink frame so they read as one card.
  chatHead:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: theme.color.card, borderTopWidth: 2, borderLeftWidth: 2, borderRightWidth: 2, borderColor: theme.color.ink, borderTopLeftRadius: theme.radius.md, borderTopRightRadius: theme.radius.md, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  // P1.7 — the conversation filter strip. Quiet by default; the strip warms when a filter is active so
  // a narrowed conversation never reads as a missing one (web parity).
  filterStrip:      { paddingHorizontal: 4, paddingTop: 6, paddingBottom: 2, gap: 4 },
  filterStripActive:{ backgroundColor: theme.color.surface2 ?? theme.color.card, borderRadius: theme.radius.sm },
  filterRow:        { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  filterChip:       { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: theme.color.line },
  filterChipOn:     { backgroundColor: theme.color.card, borderColor: theme.color.ink },
  filterChipOff:    { opacity: 0.55 },
  filterChipText:   { fontSize: 12, color: theme.color.inkSoft },
  filterChipTextOn: { color: theme.color.ink, fontWeight: '600' },
  filterSep:        { width: 1, height: 14, backgroundColor: theme.color.line, marginHorizontal: 2 },
  filterNote:       { fontSize: 11, color: theme.color.inkSoft, paddingHorizontal: 2 },
  chatDot:   { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.color.green },
  chatName:  { fontSize: 12.5, fontWeight: '700', color: theme.color.ink },
  chatScroll:{ flex: 1, backgroundColor: theme.color.card, borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: theme.color.ink, borderBottomLeftRadius: theme.radius.md, borderBottomRightRadius: theme.radius.md },
  chatListPad:{ padding: 14 },
  // chat bubbles + composer (v2 §1+§5). Others'/bot = --bot-bg + --bot-line (left);
  // mine = --me-bg block (right, no border) — web parity.
  bubble:           { padding: 10, borderWidth: 1, borderColor: theme.color.botLine, borderRadius: theme.radius.md, backgroundColor: theme.color.botBg, marginBottom: 6, maxWidth: '78%', alignSelf: 'flex-start' },
  bubbleMine:       { backgroundColor: theme.color.meBg, borderWidth: 0, alignSelf: 'flex-end', maxWidth: '74%' },
  // LLM-forward consent/handoff card — a bot bubble variant: dashed rust border, peach fill, full width.
  bubbleConsent:    { alignSelf: 'stretch', maxWidth: '100%', backgroundColor: theme.color.consentBg, borderWidth: 1.5, borderColor: theme.color.accentInk, borderStyle: 'dashed' },
  bubbleSender:     { fontSize: 11, color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  // Per-answer transparency badge (web parity, site .msg .src) — one small mono line.
  bubbleProvenance: { marginTop: 5, fontFamily: theme.font.mono, fontSize: 10.5, color: theme.color.inkSoft },
  bubbleScope:      { alignSelf: 'flex-start', fontSize: 10, fontWeight: '600', paddingHorizontal: 7, paddingVertical: 1, borderRadius: 9, marginBottom: 3, overflow: 'hidden' },
  bubbleScopeSelf:  { backgroundColor: theme.color.paper, color: theme.color.inkSoft },
  bubbleScopeKring: { backgroundColor: theme.color.blueBg, color: theme.color.blue },
  bubbleText:       { fontSize: 14, color: theme.color.ink },
  bubbleKind:       { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: theme.color.accent },
  bubbleMore:       { marginTop: 4, fontSize: 12, fontWeight: '700', color: theme.color.accent },
  bubbleReport:     { marginTop: 4, fontSize: 11, color: theme.color.inkSoft },
  // embeds[] — cross-object "See also" chips on a kring message.
  bubbleEmbeds:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  bubbleEmbed:      { borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.card, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 9 },
  bubbleEmbedText:  { fontSize: 12, color: theme.color.ink },
  dayDivider:       { alignSelf: 'center', fontSize: 11, color: theme.color.inkSoft, fontStyle: 'italic', paddingVertical: 8 },
  composer:         { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 8, paddingBottom: 4, borderTopWidth: 1, borderTopColor: theme.color.line, marginTop: 4 },
  // Bulletin restyle — composer input on the card fill with a soft placeholder (web parity).
  composerInput:    { flex: 1, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: theme.color.line, borderRadius: 22, backgroundColor: theme.color.card, fontSize: 14, color: theme.color.ink },
  composerSend:     { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.color.accent, alignItems: 'center', justifyContent: 'center' },
  composerSendText: { color: theme.color.white, fontSize: 18, fontWeight: '700' },
  // Slash-command auto-suggest list above the composer (web↔mobile parity with the classic dropdown).
  suggest:          { borderWidth: 1, borderColor: theme.color.line, borderRadius: 12, backgroundColor: theme.color.card, paddingVertical: 4, marginBottom: 6 },
  suggestItem:      { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingVertical: 6, paddingHorizontal: 12 },
  suggestCmd:       { fontFamily: theme.font?.mono ?? undefined, color: theme.color.accent, fontWeight: '600', fontSize: 13 },
  suggestHint:      { color: theme.color.inkSoft, fontSize: 12, flexShrink: 1 },
  // Permission gate — read-only note shown when the circle's chat feature is off.
  composerDisabled: { paddingTop: 12, paddingBottom: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: theme.color.line, color: theme.color.inkSoft, fontSize: 13, fontStyle: 'italic', textAlign: 'center' },
  // per-kring bottom tab bar + tab-coming placeholder.
  kringTabs:        { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.color.line, marginTop: 4 },
  kringTab:         { flex: 1, paddingVertical: 12, alignItems: 'center', borderTopWidth: 2, borderTopColor: 'transparent', marginTop: -1 },
  kringTabActive:   { borderTopColor: theme.color.accent },
  kringTabText:     { fontSize: 11, color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 1.4 },
  kringTabTextActive:{ color: theme.color.accentInk, fontWeight: '600' },
  // Chat ↔ Scherm header pill.
  viewToggle:          { flexDirection: 'row', borderWidth: 1, borderColor: theme.color.line, borderRadius: 999, overflow: 'hidden', backgroundColor: theme.color.paper, marginLeft: 'auto', marginRight: 8 },
  viewToggleBtn:       { paddingHorizontal: 12, paddingVertical: 5 },
  viewToggleBtnActive: { backgroundColor: theme.color.accent },
  viewToggleText:      { fontSize: 12, color: theme.color.inkSoft },
  viewToggleTextActive:{ color: theme.color.white, fontWeight: '600' },
  placeholder:      { color: theme.color.inkSoft, fontStyle: 'italic', textAlign: 'center', paddingVertical: 24, paddingHorizontal: 12 },
  memberRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  memberHandle:     { fontSize: 15, color: theme.color.ink, fontWeight: '600' },
  memberName:       { fontSize: 13, color: theme.color.inkSoft, marginTop: 1 },
  memberYou:        { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, color: theme.color.inkSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: theme.color.card },
  // Per-row action buttons (Ik help / Negeer …) — used by chat bubbles.
  rowActions:     { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  rowActionBtn:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.paper },
  rowActionText:  { fontSize: 12, color: theme.color.ink },
  // Taken (tasks) tab — compose affordance + one card per task (text + status + chips).
  takenAdd:       { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.color.line, backgroundColor: theme.color.card, marginBottom: 10 },
  takenAddText:   { fontSize: 13, fontWeight: '600', color: theme.color.ink },
  taskCard:       { padding: 12, borderWidth: 1, borderColor: theme.color.line, borderRadius: theme.radius.md, backgroundColor: theme.color.card, marginBottom: 8 },
  taskText:       { fontSize: 14, color: theme.color.ink },
  taskStatus:     { fontSize: 11, color: theme.color.inkSoft, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 3 },
  taskChipMandate:{ borderColor: theme.color.accentInk },
  // Consent-card button variants (web parity): primary = filled ink, secondary = ink-outline.
  consentBtnPrimary:     { backgroundColor: theme.color.accent, borderColor: theme.color.accent },
  consentBtnPrimaryText: { color: theme.color.accentContrast, fontWeight: '700' },
  consentBtnSecondary:   { backgroundColor: theme.color.card, borderColor: theme.color.ink },
  // δ.2 — per-message delivery state.  Pending = subtle clock-line,
  // Failed = warning pill (tap-to-retry).  Sent renders nothing.
  deliveryPending:    { marginTop: 4, fontSize: 11, color: theme.color.inkSoft },
  deliveryFailed:     { marginTop: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: theme.color.danger, backgroundColor: theme.color.dangerBg },
  deliveryFailedText: { fontSize: 11, color: theme.color.danger },
  deliveryUndeliverable: { marginTop: 4, fontSize: 11, color: theme.color.inkSoft },
  ownProfile: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.color.line },
  ownProfileTitle: { fontSize: 13, fontWeight: '600', color: theme.color.ink, marginBottom: 4 },
  // Nearby visibility banner (step E). The alert variant is for the ONE case that matters: the device is
  // announcing itself after being asked not to, so it must not look like the ordinary states.
  nearbyBanner:      { marginTop: 8, marginBottom: 4, padding: 10, borderRadius: 8, backgroundColor: theme.color.surfaceSoft ?? theme.color.surface, borderWidth: 1, borderColor: theme.color.line },
  nearbyBannerAlert: { borderColor: theme.color.warn ?? theme.color.ink, borderWidth: 2 },
  nearbyBannerTitle: { fontSize: 13, fontWeight: '600', color: theme.color.ink, marginBottom: 2 },
  nearbyActions:     { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  nearbyAsks:        { marginTop: 12, paddingHorizontal: 2 },
  nearbyAsk:         { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  nearbyComposer:    { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 6 },
  nearbyInput:       { flexGrow: 1, minWidth: 160, paddingVertical: 6, paddingHorizontal: 8, borderWidth: 1, borderColor: theme.color.line, borderRadius: 6, color: theme.color.ink, marginRight: 6 },
  nearbyAction:      { paddingVertical: 6, paddingHorizontal: 10, marginRight: 6, marginTop: 4, borderRadius: 6, borderWidth: 1, borderColor: theme.color.line },
  nearbyActionText:  { fontSize: 13, color: theme.color.ink },
  // "ON YOUR LIST" section on CircleDetail.
  onYourList:       { marginTop: 8, paddingHorizontal: 2, paddingVertical: 8 },
  onYourListTitle:  { fontSize: 11, letterSpacing: 1.0, color: theme.color.inkSoft, textTransform: 'uppercase', marginBottom: 6 },
  onYourListRow:    { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.color.line },
  onYourListText:   { fontSize: 13, color: theme.color.ink },
  // β.5 — per-tile context menu (Modal-backed sheet).  Backdrop catches
  // outside-tap to dismiss; sheet hugs the bottom for thumb reach.
  tileMenuBackdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.32)', justifyContent: 'flex-end' },
  tileMenuSheet:     { backgroundColor: theme.color.card, borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 8, paddingBottom: 20 },
  tileMenuItem:      { paddingVertical: 14, paddingHorizontal: 16, borderRadius: 8 },
  tileMenuItemText:  { fontSize: 15, color: theme.color.ink },
});
