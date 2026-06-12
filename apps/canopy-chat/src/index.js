/**
 * canopy-chat — entry point.
 *
 * v0.1 stage: parser + manifestMerge are landed.  Future phases add
 * router, dispatch, renderer, threadStore, events.  The full anatomy
 * lives in `/DESIGN-canopy-chat.md`; phase-by-phase build is in
 * `/Project Files/canopy-chat/coding-plan.md`.
 */

export { canopyChatManifest } from '../manifest.js';
export { parseInput, parseSlash }    from './parser.js';
export { mergeManifests }            from './manifestMerge.js';
export { resolveDispatch, scopeReadyDispatch, bindMatchArg } from './router.js';
export { runDispatch }               from './dispatch.js';
export { renderReply, formatText }   from './renderer.js';
export { Thread, newThread }         from './thread.js';
export {
  ThreadStore, createDefaultThreadStore,
} from './threadStore.js';
export {
  matchesFilter, normaliseFilter, isWildcardFilter, describeFilter,
} from './filter.js';
export {
  EventRouter, createEventRouter, defaultFormatNotification,
} from './events.js';
export {
  runBulkOp, summariseBulkOp, executeBulkDispatch, isBulkKeyword, BULK_KEYWORDS,
  lastListingItems,
} from './bulkOps.js';
export {
  collectFollowUps, createFollowUpResolver, DEFAULT_CROSS_APP_CHAINS,
} from './followUps.js';
export { buildEmbed, claimEmbed, actionsFor as embedActionsFor } from './embed.js';
export { formatSyncHints, formatLastSync, relativeAgo } from './syncHints.js';
export { AppRegistry, filterCatalog } from './appRegistry.js';
export {
  openExternalFlow, parseCallbackUrl, resumeInFlightFlows,
  generateSessionId, IN_FLIGHT_STORE_KEY,
} from './externalFlow.js';
export { runBrief, createBriefCache } from './brief.js';
export { QR_URI_PREFIXES, isQrUri }   from './core/qrSchemes.js';
// α.5a (audit #3) — inline-keuze quick-reply pill row helper.
export { normalizeQuickReplies }      from './core/quickReplies.js';
// v2 circle model — re-exported here so canopy-chat-mobile can import via
// '@canopy-app/canopy-chat' (Metro can't resolve src/v2 subpaths directly).
export { normalizeCircle, mergeCircles, loadCircles } from './v2/circleModel.js';
export { circleSourcesFromAgent, makeResolvingCallSkill, DEFAULT_CIRCLE_ORIGINS } from './v2/circleSources.js';
export { loadCircleItems, normalizeContentItem }      from './v2/circleContent.js';
export { quickCreateCircle }                          from './v2/circleCreate.js';
export { itemCircleId, isInCircle, scopeItems }       from './v2/circleScope.js';
export { getActiveCircle, setActiveCircle, subscribeActiveCircle } from './v2/activeCircle.js';
export {
  CIRCLE_FEATURES, CIRCLE_POLICY_ENUMS,
  DEFAULT_CIRCLE_POLICY, normalizeCirclePolicy, mergeCirclePolicy,
  // P6.1 — feature-flag consumption seam.
  isFeatureEnabled, enabledFeatures,
  // §4 — admin's policy.view → default Chat/Scherm landing surface.
  defaultViewModeFromPolicy,
  DEFAULT_MEMBER_OVERRIDE, normalizeMemberOverride, mergeMemberOverride,
  // P6.M4 — split @-mention vs every-message push toggles (board 6A).
  shouldPushNotify,
} from './v2/circlePolicy.js';
export {
  createCirclePolicyStore, localStoragePolicyIo,
  createMemberOverrideStore, localStorageOverrideIo,
  podPolicyIo, tieredPolicyIo,
} from './v2/circlePolicyStore.js';
// β.5 — "pin to top" per-user preference (single keyless map of circleId → true).
export { createCirclePinStore, localStoragePinIo } from './v2/circlePinStore.js';
// N2 — per-option consequence registry (ⓘ "Gevolgen als je dit kiest…").
export {
  CONSEQUENCE_OPTIONS, hasConsequence, consequenceKeyFor, attachConsequences,
} from './v2/optionConsequences.js';
// N3 — role templates (gast / observer / externe-vrijwilliger starter set).
export {
  ROLE_TEMPLATES, ROLE_TEMPLATE_IDS, roleTemplateById, applyRoleTemplates,
} from './v2/roleTemplates.js';
export { makeProposal, approveProposal, pendingApprovers } from './v2/circleConsensus.js';
// P6.2 — persistence layer for multi-admin proposals.
export { createProposalStore, localStorageProposalIo } from './v2/circleProposalStore.js';
export {
  eventCircleId, buildCircleStream,
  // SP-13 — kring-scoped stream + chip filters (board 2B / 8C).
  buildKringStream, KRING_STREAM_KIND_FILTERS,
} from './v2/circleStream.js';
// SP-13.3 — per-kring bottom tabs derived from policy.features (v2 §1).
export { buildKringTabs, DEFAULT_KRING_TAB, featureActionLabelKey, featureTabId, featureForTabId } from './v2/kringTabs.js';
// δ.2 — per-message delivery state (pending / sent / failed) for the
// optimistic kring chat send.  Sibling of the in-memory EventLog;
// read at bubble render time so users can see fan-out status + retry
// failed sends.
export { createDeliveryStateMap } from './v2/deliveryState.js';
// Phase 2 — shared kring chat send primitives (optimistic event + best-effort fan-out) for web + mobile.
export { kringChatMessageEvent, broadcastKringFanOut } from './v2/kringBroadcast.js';
// Phase 3 — the shared circle label→candidate lookup (live fetch + base), web + mobile.
export { makeCircleLookup } from './v2/circleLookup.js';
// Shared composer affordances — slash-suggest pool/filter + bash-style input history (web + mobile).
export { buildCommandPool, suggestCommands, createInputHistory } from './v2/commandSuggest.js';
// E3 — shared record-panel auto-refresh helpers (web EventRouter + mobile post-mutation).
export {
  REFRESHABLE_VERBS, panelMatchesItemRef, itemRefFromReply, collectStalePanels,
} from './panelRefresh.js';
// D1 (§5A) — per-circle action-frequency counter behind the quickActions block.
export { createActionFrequencyStore } from './v2/actionFrequency.js';
// ε.2 — per-group catch-up strategy router (substrate).  Decides
// pod / peer / hybrid / none based on circle.policy.pod, then routes
// through injected handlers.  Host wiring lands once ε.1 is also in.
export {
  pickCatchUpStrategy, scheduleCatchUp,
  KNOWN_POD_AXES, CATCH_UP_STRATEGIES,
} from './v2/catchUpStrategy.js';
// α.1a/b — scherm "recipe book" model + per-block content materializer
// (v2 §2 RECEPT · SCHERM-WEERGAVE INRICHTEN).
export {
  BLOCK_TYPES, EMPTY_RECIPE_BOOK,
  emptyRecipe, normalizeRecipe, defaultConfigForBlock,
  addBlock, removeBlock, moveBlock, updateBlock,
  normalizeRecipeBook,
  addRecipe, renameRecipe, removeRecipe,
  setActiveRecipe, getActiveRecipe, updateRecipe,
  createKringRecipeStore, localStorageRecipeIo,
} from './v2/kringRecipe.js';
export {
  BLOCK_REGISTRY, materializeBlock, materializeRecipe,
} from './v2/kringRecipeBlocks.js';
// γ.3 — recipe conflict detection + resolution (Phase 9 sync absorption).
export { detectRecipeConflicts, applyResolution } from './v2/recipeConflict.js';
// γ.4 — rules-doc + circle-policy conflict detection + resolution (same flow).
export { detectRulesConflicts,  applyRulesResolution  } from './v2/rulesConflict.js';
export { detectPolicyConflicts, applyPolicyResolution } from './v2/policyConflict.js';
// γ-next.recipe — receiver + pending-cache substrate for the recipe broadcast.
export { makeKringRecipePeerHandler }              from './v2/kringRecipeReceiver.js';
export { createKringRecipePendingStore }           from './v2/kringRecipePending.js';
export {
  createKringRecipePendingStoreLocal,
  localStorageKringRecipePendingIo,
} from './v2/kringRecipePendingStorage.js';
// α.2a/b — user-owned cross-kring screens (Stream / custom views).
export {
  EMPTY_SCREEN_BOOK, ALL_KRINGEN,
  emptyScreen, normalizeScreen, isAllKringen, effectiveKringIds,
  addKringToScreen, removeKringFromScreen, setAllKringen,
  normalizeScreenBook,
  addScreen, renameScreen, removeScreen, setActiveScreen, getActiveScreen, updateScreen,
  createUserScreenStore, localStorageScreenIo,
} from './v2/userScreens.js';
export { materializeScreen } from './v2/userScreenBlocks.js';
// δ.1 — per-screen materialized-blocks cache (cache-first render + bg refresh).
export { createScreenBlocksCache } from './v2/screenBlocksCache.js';
export {
  createScreenBlocksCacheLocal,
  localStorageScreenBlocksCacheIo,
} from './v2/screenBlocksCacheStorage.js';
// P6.3 — per-circle activity preview + unread count for launcher tiles.
export { buildTilePreviews, renderSubtitle, bumpSeenAt } from './v2/circleTilePreviews.js';
// P6.5 — claim router: mirror claimed tasks into the personal crew
// when the per-circle override has flowThrough.tasksToPersonal.
export { routeClaim, makeAfterClaimHook } from './v2/claimRouter.js';
// P6.4 — wederkerigheid (chat-off consumer-side): pure helpers + the
// save-for-later message queue.  Compose integration is the follow-up.
export {
  isRecipientUnavailable, buildUnavailableNotice,
  createMessageQueue,
} from './v2/wederkerigheid.js';
// P6.6 — auto-hop-prompt when a skill search returns no in-circle hits.
export {
  shouldAutoSuggestHop, buildHopPromptCard,
  rememberDismissed, hasDismissed,
} from './v2/hopPrompt.js';
// P6.7 — skill-match source: rank circle members / agents / hop candidates
// against a free-text question (board 8B).  Renderer is `buildSkillMatches`.
export { findSkillMatches, tokenize as tokenizeSkillQuery } from './v2/findSkillMatches.js';
// P6.8 — Nearby screen model (board 8C): intersect local-network peers with my skills.
export {
  buildNearbyModel,
  pickSkillText as pickNearbySkillText,
  pickPeerLabel as pickNearbyPeerLabel,
} from './v2/circleNearby.js';
// P6.10 — agent-add admin approval (board 4B): proposal-like flow for
// joining an LLM agent to a circle whose `agents` axis is admin-approval.
export {
  shouldGateAgentJoin, buildAgentRequest,
  approveAgentRequest, rejectAgentRequest, pendingAgentApprovers,
  createAgentRequestStore,
} from './v2/agentRequest.js';
// P6.M1 — pod-migration warning on policy change (board 4A red callout).
export { classifyPodChange, renderPodMigrationCopy } from './v2/podMigrationWarning.js';
// P6.M2 — per-attribute view-as split (board 4C "WHAT SARA SEES / DOESN'T").
export {
  isVisibleTo, splitViewAsAttributes, viewAsCounts, OPENNESS_LEVELS,
} from './v2/viewAsAttributes.js';
// P6.M3 — Stream per-row actions + pinned compose (board 5B).
export { actionsForStreamRow, buildStreamComposeContext } from './v2/streamActions.js';
// P6.M5 — holiday-mode extension shortcuts + outgoing auto-reply (board 6C).
export {
  extendHolidayDays, setHolidayUntil, buildHolidayAutoReply,
} from './v2/holidayShortcuts.js';
// P6.M6 — per-contact hop overrides (board 7B).
export {
  normalizeContactHopMode, effectiveHopMode, buildContactHopList,
  HOP_PER_CONTACT_MODES,
} from './v2/contactHopOverrides.js';
// P6.M7 — Folio "My things" notes-list (private kring, board 10A).
export {
  itemOwner, isMyPrivateItem, buildMyThings, myThingsFromListFiles,
} from './v2/folioMyThings.js';
// P6.M8 — Folio "Shared by me / Shared with me" filters (board 10B).
export {
  FOLIO_SHARE_FILTERS, isSharedByMe, isSharedWithMe,
  buildSharedFiles, sharedFilesFromListFiles,
} from './v2/folioSharedFilters.js';
export { VIEWER_KINDS, viewAsDirectory } from './v2/circleViewAs.js';
export { normalizeCircleMembers, circleMemberCount } from './v2/circleMembers.js';
// 5.9d — Proof-of-Location placeholder seam (real attestation deferred).
export { getCirclePolStatus, formatPolStatus, formatAttestedAt } from './v2/circlePol.js';
export {
  COMPLAINT_TYPES, ADVISOR_DEFAULTS, makeTooBusyEvent, computeAdvice,
} from './v2/circleAdvisor.js';
export {
  MAX_HOPS, normalizeHopMode, buildHopChain, makeHopRelayRequest,
} from './v2/circleHop.js';
export {
  SKILL_AXES, DEFAULT_SKILL, normalizeSkill, mergeSkill,
  MATCH_SOURCES, buildSkillMatches,
} from './v2/circleSkills.js';
export { normalizeFolioFile, buildCircleFiles, circleFilesFromListFiles } from './v2/circleFolio.js';
// N5 — Drive tree (folder nav + rich rows).  Re-exported from folio's
// browser-safe barrel so web + mobile share one import path (folio/browser
// carries no node deps; realAgent already pulls it into both bundles).
export {
  folioLevel, breadcrumbs, parentPath, rowPath, rowName,
  formatFileSize, fileKind, glyphForFile, FILE_KIND_GLYPH,
} from '@canopy-app/folio/browser';
export {
  RULES_FIELDS, RULES_QUESTIONS, DEFAULT_RULES_DOC,
  normalizeRulesDoc, buildRulesDoc, isRulesComplete, isRulesEmpty,
  // γ.2 — per-circle rules document store (was inline localStorage in
  // launcher up to β).  Adds a single hook point for version capture.
  createCircleRulesStore, localStorageRulesIo,
} from './v2/circleRules.js';
export {
  DEFAULT_AVAILABILITY, normalizeAvailability, mergeAvailability, isPushSuppressed,
  createAvailabilityStore, localStorageAvailabilityIo,
} from './v2/memberAvailability.js';
export { THEME, tagColors, AVATAR_TINTS, circleTint } from './v2/theme.js';
export { runFind } from './find.js';
export { EventLog, createEventLog, RETENTION_MS } from './eventLog.js';
export {
  buildFormSpec, pickStrategy, validateAndCoerce,
} from './forms/buildFormSpec.js';
export { parseRelativeDate } from './forms/parseDate.js';
export { IndexedDBStore, attachPersistence } from './storage/local.js';
export { PodSyncStore }                      from './storage/podSync.js';
export {
  initLocalisation, t, setLang, currentLang,
  detectDeviceLang, isInitialised,
} from './localisation.js';
