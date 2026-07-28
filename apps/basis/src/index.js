/**
 * basis — entry point.
 *
 * v0.1 stage: parser + manifestMerge are landed.  Future phases add
 * router, dispatch, renderer, threadStore, events.  The full anatomy
 * lives in `/DESIGN-basis.md`; phase-by-phase build is in
 * `/Project Files/basis/coding-plan.md`.
 */

export { basisManifest } from '../manifest.js';
export { parseInput, parseSlash }    from './parser.js';
export { mergeManifests }            from './manifestMerge.js';
export { resolveDispatch, scopeReadyDispatch, bindMatchArg } from './router.js';
export { runDispatch, runCompositeDispatch } from './dispatch.js';
// (feedback-extension) — composite-op runner + the sandbox-by
// construction verifier (a fitness-function seed for CI).
export { runCompositeOp, verifyComposite, resolvePath } from './composite.js';
// P2b (feedback-extension) — extension-mapping load-time verify gate.
export { verifyMapping, verifyMappings, mappingToManifest, mappingsToSources } from './mappings.js';
// P2c-3 — extension install: plain consent-card model + install/uninstall.
export { buildConsentModel, installMapping, uninstallMapping } from './v2/extensionInstall.js';
// (feedback-extension) — curation compare (reuses objectDiff) + the before/after curation renderer.
export { compareForCuration, renderCuration } from './v2/curation.js';
// (feedback-extension) — contact/bot exposed skills. The PURE synth+route core …
export {
  skillCardsToManifest, skillCardToOp, contactSkillSources, makeRemoteCallSkill,
  contactManifestApp, REMOTE_SKILL_BINDING, CONTACT_THREAD_SCOPE,
} from './v2/contactSkills.js';
// … and the LIVE wiring (PeerGraph-subscribed registry + the dispatch chain).
export { createContactSkillRegistry, chainContactCallSkill } from './v2/contactSkillsLive.js';
// (feedback-extension) — the client end of a contact/bot peer link (the
// transport-agnostic conversational channel; rides sa.peer → mdns/relay/nkn),
// the Contacten roster source, and adding a bot to the app PeerGraph.
export { createContactThreadChannel, DEFAULT_CONTACT_SUBTYPES } from './v2/contactThreadChannel.js';
export { listContacts, peerToContactRow, stoopContactToRow, mergeContacts } from './v2/contactsSource.js';
// S4 (stoop dissolution — pod foundation, SAFE offline slice): per-circle sealing
// identity + control-agent composition over the @onderling/pod-client sealing substrate.
export { createCircleSealingIdentity } from './v2/circleSealingIdentity.js';
export { createCircleControlAgent } from './v2/circleControlAgent.js';
export { addBotToGraph } from './v2/addBot.js';
// The pure, offline help-answer engine (ported onderling.org matcher + cards):
// answerHelp routes a question to a human-written card over two deterministic
// layers, returns null on a miss (where a consent-gated model may step in).
export { answerHelp, helpTopics } from './v2/help/helpAnswer.js';
export { helpDeck } from './v2/help/kaartjes.js';
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
// v2 circle model — re-exported here so basis-mobile can import via
// '@onderling-app/basis' (Metro can't resolve src/v2 subpaths directly).
export { normalizeCircle, mergeCircles, loadCircles } from './v2/circleModel.js';
export { circleSourcesFromAgent, makeResolvingCallSkill, DEFAULT_CIRCLE_ORIGINS } from './v2/circleSources.js';
export { loadCircleItems, normalizeContentItem }      from './v2/circleContent.js';
export { quickCreateCircle }                          from './v2/circleCreate.js';
export { itemCircleId, isInCircle, scopeItems }       from './v2/circleScope.js';
export { scopeStoopCallSkill, keepForCircle, SCOPED_WRITE_OPS, SCOPED_LIST_OPS, isNoticeboardPost, SYSTEM_STOOP_TYPES } from './v2/circleStoopScope.js';
export { createCirclePodProducer, createCircleControlAgentRouter, seedCircleRoster } from './v2/circlePodProducer.js';
export { realPodRouting, podRootFromWebid }           from './v2/circleRealPod.js';
export { getActiveCircle, setActiveCircle, subscribeActiveCircle } from './v2/activeCircle.js';
export {
  CIRCLE_FEATURES, CIRCLE_POLICY_ENUMS, SETTINGS_ENUM_AXES, decisionDeadlineDays,
  DEFAULT_CIRCLE_POLICY, normalizeCirclePolicy, mergeCirclePolicy,
  // feature-flag consumption seam.
  isFeatureEnabled, enabledFeatures,
  // §4 — admin's policy.view → default Chat/Scherm landing surface.
  defaultViewModeFromPolicy,
  DEFAULT_MEMBER_OVERRIDE, normalizeMemberOverride, mergeMemberOverride,
  // split @-mention vs every-message push toggles.
  shouldPushNotify,
} from './v2/circlePolicy.js';
export {
  createCirclePolicyStore, localStoragePolicyIo,
  createMemberOverrideStore, localStorageOverrideIo,
  podPolicyIo, tieredPolicyIo,
} from './v2/circlePolicyStore.js';
// β.5 — "pin to top" per-user preference (single keyless map of circleId → true).
export { createCirclePinStore, localStoragePinIo } from './v2/circlePinStore.js';
// SILENT out-of-circle delivery — the per-user "shared with me" store + its pure projector/opener, and the
// inbound `shared-copy` peer handler that lands relayed sealed copies into the store (web ≡ mobile).
export { createSharedWithMeStore, localStorageSharedWithMeIo,
  podSharedWithMeIo, tieredSharedWithMeIo } from './v2/sharedWithMeStore.js';
export { buildSharedWithMe, openSharedCopy } from './v2/sharedWithMe.js';
export { makeHandleSharedCopy } from './core/handlers/sharedCopyReceive.js';
// SILENT out-of-circle delivery — the network-derived sealing OPENER bridge (web≡mobile).
export { openerForIdentity, deviceSharedCopyOpener } from './v2/sharedCopyOpener.js';
// N2 — per-option consequence registry (ⓘ "Gevolgen als je dit kiest…").
export {
  CONSEQUENCE_OPTIONS, hasConsequence, consequenceKeyFor, attachConsequences,
} from './v2/optionConsequences.js';
// N3 — role templates (gast / observer / externe-vrijwilliger starter set).
export {
  ROLE_TEMPLATES, ROLE_TEMPLATE_IDS, roleTemplateById, applyRoleTemplates,
} from './v2/roleTemplates.js';
export { makeProposal, approveProposal, pendingApprovers } from './v2/circleConsensus.js';
// persistence layer for multi-admin proposals.
export { createProposalStore, localStorageProposalIo } from './v2/circleProposalStore.js';
export {
  eventCircleId, buildCircleStream,
  // kring-scoped stream + chip filters.
  buildKringStream, KRING_STREAM_KIND_FILTERS,
  projectEntries, allCircleRows, circleRows, chatRows,
  // C15 — per-circle chat projection (excludes the silent system lane).
  buildCircleChat,
} from './v2/circleStream.js';
// profile-update propagation (Phase-4 Wave B) — the roster "pull-me" signal substrate:
// the diff comparator, the silent-entry kind, the announce (admin) + receive (member) factories.
export {
  ROSTER_UPDATED_KIND, changedReleaseKeys, releaseUnchanged,
  rosterUpdatedPayload, appendRosterUpdatedEntry, isValidRosterUpdatedEnvelope,
  makeRosterUpdateAnnouncer, makeRosterUpdatedPeerHandler,
} from './v2/rosterUpdated.js';
// per-kring bottom tabs derived from policy.features (v2 §1).
export { buildKringTabs, DEFAULT_KRING_TAB, featureActionLabelKey, featureTabId, featureForTabId } from './v2/kringTabs.js';
// δ.2 — per-message delivery state (pending / sent / failed) for the
// optimistic kring chat send.  Sibling of the in-memory EventLog;
// read at bubble render time so users can see fan-out status + retry
// failed sends.
export { createDeliveryStateMap } from '@onderling/kring-host/deliveryState';
// Phase 2 — shared kring chat send primitives (optimistic event + best-effort fan-out) for web + mobile.
export { kringChatMessageEvent, broadcastKringFanOut } from '@onderling/kring-host/kringBroadcast';
// Phase 3 — the shared circle label→candidate lookup (live fetch + base), web + mobile.
export { makeCircleLookup } from './v2/circleLookup.js';
// Shared composer affordances — slash-suggest pool/filter + bash-style input history (web + mobile).
export { buildCommandPool, suggestCommands, createInputHistory } from './v2/commandSuggest.js';
// Conversational follow-up for `needsForm` dispatches — shared so the kring composers elicit a missing
// field the same chat-native way (web + mobile); the mobile core/followUp.js re-exports these.
export { beginFollowUp, beginFormFollowUp, completeFollowUp, completeMultiFieldFollowUp, pickPromptKey } from '@onderling/kring-host/followUp';
// Shared one-line kring bot reply text (web + mobile) — verb-aware Added:/Completed: phrasing.
export { kringReplyText } from './v2/kringReply.js';
// 1:1-bot chat gate — the GESPREK assistant-header strip shows ONLY in a genuine 1:1-with-a-bot
// chat, hidden on multi-person kringen (web ≡ mobile; one shared decision).
export { oneToOneBotLabel } from './v2/botChat.js';
// Part D — scope a circle's catalog to its apps (drops basis infra ops like /me); web + mobile.
export { scopeCatalogToApps } from './v2/circleCatalogScope.js';
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
// C9 — the ONE circle data-policy: `policy.pod` is the single vocabulary,
// mapped once to the send-path dataMove branch + the PseudoPod store mode +
// the catch-up strategy, so no consumer re-derives the pod posture itself.
export {
  CIRCLE_DATA_POLICIES, DATA_MOVE_BRANCHES, STORE_MODES, DATA_POLICY_MAP,
  LEGACY_MODE_TO_POLICY, normalizeDataPolicy, resolveCircleDataPolicy,
  circleDataMove, circleStoreMode, circleCatchUpStrategy, circleHasPod,
} from './v2/circleDataPolicy.js';
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
// per-circle activity preview + unread count for launcher tiles.
export { buildTilePreviews, renderSubtitle, bumpSeenAt } from './v2/circleTilePreviews.js';
// claim router: mirror claimed tasks into the personal circle
// when the per-circle override has flowThrough.tasksToPersonal.
export { routeClaim, makeAfterClaimHook } from './v2/claimRouter.js';
// wederkerigheid (chat-off consumer-side): pure helpers + the
// save-for-later message queue.  Compose integration is the follow-up.
export {
  isRecipientUnavailable, buildUnavailableNotice,
  createMessageQueue,
} from './v2/wederkerigheid.js';
// auto-hop-prompt when a skill search returns no in-circle hits.
export {
  shouldAutoSuggestHop, buildHopPromptCard,
  rememberDismissed, hasDismissed,
} from '@onderling/kring-host/hopPrompt';
// skill-match source: rank circle members / agents / hop candidates
// against a free-text question. Renderer is `buildOfferingMatches`.
export { findOfferingMatches, tokenize as tokenizeOfferingQuery } from '@onderling/kring-host/findOfferingMatches';
// Nearby screen model: intersect local-network peers with my skills.
export {
  buildNearbyModel,
  pickSkillText as pickNearbySkillText,
  pickPeerLabel as pickNearbyPeerLabel,
} from './v2/circleNearby.js';
export { createProximitySession, nearbyActions } from './v2/circleProximity.js';
export { makeNearbySessionAdapter }             from './v2/nearbyDiscoverability.js';
export { createNetworkChangeWatcher }           from './v2/networkChangeWatcher.js';
export { createNearbyScreen, NEARBY_ACTION_LABELS, NEARBY_ASK_LABELS, NEARBY_INVITE_LABELS, nearbyVisibilityKey }
                                                from './v2/nearbyScreen.js';
export {
  createAsk, isAskLive, evaluateIncomingAsk, askActions, answerAsk, nearbyThreadDescriptor,
  ASK_DEFAULT_TTL_MS, ASK_MAX_TTL_MS, ASK_MAX_TEXT,
} from './v2/nearbyAsks.js';
export { createAskChannel, ASK_MESSAGE, ANSWER_MESSAGE, ASK_MAX_TAGS }
                                                from './v2/nearbyAskChannel.js';
export {
  roomAllows, createCard, receiveCard, createChatMessage, receiveChatMessage, createRoomChat,
  CARD_MESSAGE, CHAT_MESSAGE, CARD_MAX_LABEL, CARD_MAX_LINE, CARD_MAX_TAGS, CHAT_MAX_TEXT,
} from './v2/nearbyRoom.js';
export {
  invitePublishAllows, mayPublish, prepareBroadcastInvite, isInviteLive, receiveInvite, inviteActions,
  BROADCAST_INVITE_MAX_TTL_MS, INVITE_MESSAGE,
} from './v2/nearbyInvites.js';
export { createConnectionPoints, POINT_SOURCE, POINT_SOURCE_LABELS }
                                                from './v2/connectionPoints.js';
export {
  createFallbackPrefStore, localStorageFallbackIo, asyncStorageFallbackIo,
  createFallbackOffer, OFFER_AFTER_PEERS, OFFER_COOLDOWN_MS,
} from './v2/addressFallback.js';
export {
  DELIVERY, DELIVERY_ORDER, DELIVERY_LABELS, deliveryStates, isDeliveryState,
  advanceDelivery, deliveryAfterSend, receiptPolicy, shouldSendReceipt,
  receiveReceipt, RECEIPT_MESSAGE,
} from './v2/deliveryState.js';
export {
  deliverySettings, createDeliverySettingsStore, localStorageDeliveryIo, asyncStorageDeliveryIo,
  deliveryLabelFor, withDelivery, recordDelivery,
} from './v2/deliverySettings.js';
export {
  defaultConversationKinds, availableConversationKinds, TEMPLATE_CONVERSATION_KINDS,
  resolveConversationKinds, setConversationKind,
} from './v2/conversationKinds.js';
export { makeSharedCirclePeerScope } from './v2/sharedCirclePeerScope.js';
// agent-add admin approval: proposal-like flow for
// joining an LLM agent to a circle whose `agents` axis is admin-approval.
export {
  shouldGateAgentJoin, buildAgentRequest,
  approveAgentRequest, rejectAgentRequest, pendingAgentApprovers,
  createAgentRequestStore,
} from './v2/agentRequest.js';
// pod-migration warning on policy change (red callout).
export { classifyPodChange, renderPodMigrationCopy } from './v2/podMigrationWarning.js';
// per-attribute view-as split ("WHAT SARA SEES DOESN'T").
export {
  isVisibleTo, splitViewAsAttributes, viewAsCounts, OPENNESS_LEVELS,
} from './v2/viewAsAttributes.js';
// Stream per-row actions + pinned compose.
export { actionsForStreamRow, buildStreamComposeContext } from './v2/streamActions.js';
// Taken (tasks) tab — task-store item → stream-row projection (shared web≡mobile).
export { buildTaskRows, taskItemToStreamRow, taskStatusOf } from './v2/taskRows.js';
// holiday-mode extension shortcuts + outgoing auto-reply.
export {
  extendHolidayDays, setHolidayUntil, buildHolidayAutoReply,
} from './v2/holidayShortcuts.js';
// per-contact hop overrides.
export {
  normalizeContactHopMode, effectiveHopMode, buildContactHopList,
  HOP_PER_CONTACT_MODES,
} from './v2/contactHopOverrides.js';
// Folio "My things" notes-list (private kring).
export {
  itemOwner, isMyPrivateItem, buildMyThings, myThingsFromListFiles,
} from './v2/folioMyThings.js';
// Folio "Shared by me / Shared with me" filters.
export {
  FOLIO_SHARE_FILTERS, isSharedByMe, isSharedWithMe,
  buildSharedFiles, sharedFilesFromListFiles,
} from './v2/folioSharedFilters.js';
export { VIEWER_KINDS, viewAsDirectory } from './v2/circleViewAs.js';
// LEDEN tab → member-persona card + self-view (thin projections over the C7 reveal-state +
// amount presets `handle → profile → full`).
export {
  personaAttributes, memberPersonaView, selfViewSplit,
  personaPresetKeys, revealPresetLabelKey, PERSONA_TIER_KEYS, REVEAL_PRESETS,
} from './v2/memberCards.js';
export { normalizeCircleMembers, circleMemberCount } from '@onderling/kring-host/circleMembers';
// 5.9d — Proof-of-Location placeholder seam (real attestation deferred).
export { getCirclePolStatus, formatPolStatus, formatAttestedAt } from './v2/circlePol.js';
export {
  COMPLAINT_TYPES, ADVISOR_DEFAULTS, makeTooBusyEvent, computeAdvice,
} from './v2/circleAdvisor.js';
export {
  MAX_HOPS, normalizeHopMode, buildHopChain, makeHopRelayRequest,
} from '@onderling/kring-host/circleHop';
export {
  OFFERING_AXES, DEFAULT_OFFERING, normalizeOffering, mergeOffering,
  MATCH_SOURCES, buildOfferingMatches,
} from '@onderling/kring-host/circleOfferings';
export { normalizeFolioFile, buildCircleFiles, circleFilesFromListFiles, folioFileOpenTreatment } from './v2/circleFolio.js';
// N5 — Drive tree (folder nav + rich rows).  Re-exported from folio's
// browser-safe barrel so web + mobile share one import path (folio/browser
// carries no node deps; realAgent already pulls it into both bundles).
export {
  folioLevel, breadcrumbs, parentPath, rowPath, rowName,
  formatFileSize, fileKind, glyphForFile, FILE_KIND_GLYPH,
} from '@onderling-app/folio/browser';
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
  // Objective D — publish the pref to the shared substrate so other agents read it.
  podAvailabilityIo, tieredAvailabilityIo,
} from './v2/memberAvailability.js';
export { THEME, THEME_DARK, tagColors, AVATAR_TINTS, circleTint } from './v2/theme.js';
export {
  THEME_PREFS, DEFAULT_THEME_PREF, THEME_PREF_KEY,
  normalizeThemePref, resolveThemeName, createThemePrefStore, asyncStorageThemePrefIo,
} from './v2/themePref.js';
export { buildPersonaViewModel, buildMijViewModel } from './v2/personaView.js';
export { loadMijModel } from './v2/mijLoader.js';
export { migrateRosterOfferings, offeringKeyFor, OFFERINGS_MIGRATION_KEY } from './core/offeringsMigration.js';
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
// Shared locale blocks (`circle.*`, `consequence.*`, `role.*`) — both shells merge these so they can't drift.
export { sharedCircleLocale, sharedConsequenceLocale, sharedRoleLocale } from './locales/index.js';
