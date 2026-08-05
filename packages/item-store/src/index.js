/**
 * @onderling/item-store — public entry point.
 *
 * Post-Phase 5.2 (2026-05-04): the synthetic `Backend` interface +
 * `InMemoryBackend` were deleted as a duplicate of `core.DataSource`.
 * The substrate now composes any `core.DataSource` directly — see
 * `ItemStore` constructor JSDoc.
 */

export { ItemStore } from './ItemStore.js';
export { computeStatus } from './lifecycleStatus.js';
export { CircleItemStore } from './CircleItemStore.js';   // per-circle, type-indexed generic store
export {                                                  // PLAN-capabilities-tasks-roles (Option A) — task lifecycle
  claim, reassign, markComplete, submit, approve, reject, revoke,  // VERBS as functions-over-CircleItemStore
  assigneesOf, maxAssigneesOf, isAssigneesFull, isAssignee,        // co-ownership model helpers (J2): assignees[] + the `assignee` mirror
} from './taskLifecycle.js';
export {                                                  // PLAN-capabilities-tasks-roles step 1 — task CRUD + queries
  addTasks, listOpen, listClosed, getById, update, removeItems,   // CRUD/query surface as functions-over-CircleItemStore
} from './taskCrud.js';
export { createTaskStore } from './createTaskStore.js';   // PLAN-capabilities-tasks-roles step 2 — ItemStore-compatible task surface (Emitter + audit + sync) over CircleItemStore
export {                                                  // task transitions as an append-only event log — the record; the store row is its head
  TASK_LOG_KIND, TASK_EVENT, taskEntryId, taskWakeHint, taskEventName, applyTaskEntry,
  createTaskEvent, claimTaskEvent, reassignTaskEvent, completeTaskEvent,
  submitTaskEvent, approveTaskEvent, rejectTaskEvent, revokeTaskEvent, updateTaskEvent, removeTaskEvent,
} from './taskLog.js';
export {                                                  // REQUESTABLE BRIDGE (P4b · J6) — a requestable offering, invoked, becomes a TASK (not an action)
  requestableSkillHandler, offeringsToSkillDefinitions, REQUEST_TASK_KIND, REQUEST_SOURCE_KIND,
} from './requestableBridge.js';
export { createGenericAtomHandlers } from './genericAtomHandlers.js';  // B · Layer 1 §1b — generic CRUD-by-atom over any noun
export { memoryDataSource } from './memoryDataSource.js'; // Map-backed DataSource (no-pod / tests)
export { createCircleStores } from './circleStores.js';  // per-circle store registry (web≡mobile)
export {                                                 // containment (ref + back-ref) over a store
  contain, uncontain, listChildren, childIdsOf, parentsOf, deleteContainer, listLoose,
} from './containment.js';
export {                                                 // composable ops engine + surfacing
  addChildTo, resolveContainerAdd, buildAcceptsPolicy, resolveAddInContainer,
} from './containerOps.js';
export { projectContainer } from './projectContainer.js';   // recursive child-render projector
export { wireStoreMirror } from './mirrorSync.js';          // attach a peer mirror to a store (no-pod sync publish)
export { wireCircleStoreInbound } from './circleStoreInbound.js';  // ingest peer envelopes into a store (inbound)
export { causalWinner, causalRank } from './causalMerge.js';       // Objective L — origin-ts + writer-id causal LWW for inbound merge
export { recoverCircleFromCaches, writeRecoveredInto } from './podRecovery.js';  // Objective S — pod-recovery: causal merge of device caches
export { shareIntoAudience, resolveSharedRef, listShared } from './shareIntoAudience.js';  // cross-circle share
export { shareContainerTree, collectSubtree } from './shareContainerTree.js';  // journey J5 — SENDABLE LISTS: fan the single-item share over a container subtree
export {                                                 // injectable ACP/seal enforcement on the cross-circle read
  makeSharedRefPolicy, makePosturePolicy, makeShareGrantHook, makeCircleShareEnforcement,
  makeCanonicalShareHook,                                 // objective L — canonical share/revoke grant hook (createCanonicalShare-composed)
  SHARE_POSTURES, isCanonicalPosture,                     // objective L — revocable `canonical` posture (share-as-grant, no copy)
  unsealItem, sealItem, SEAL_RESERVED_KEYS,               // share-policy — write-side content re-seal (symmetric to unsealItem)
} from './sharedRefPolicy.js';
export {
  ItemNotFoundError,
  PermissionDeniedError,
  ClaimRaceError,
  InvalidLifecycleError,
  MissingArgumentError,
  DependenciesOpenError,
} from './errors.js';
export { ulid } from './ulid.js';

// DAG helpers (lifted from apps/tasks-v0/src/dag.js in Phase 52.6.2).
// `computeStatus(item)` above is the substrate's LIFECYCLE status;
// `computeDagStatus` here is the DAG-aware status (ready/waiting/blocked).
export {
  computeDagStatus,
  effectiveStatus,
  unmetDeps,
  detectCycle,
} from './dag.js';

// Cross-app embeds traversal (Phase 52.6.1) + the cross-pod-ref
// resolver (Phase 3.3c — decentralised circle read path).
export { treeOf, createCrossPodRefResolver } from './embeds.js';

// V0a (2026-05-21) — audience field bridge.
// `audienceFromItem(item)` resolves the effective audience by
// checking item.audience → item.visibility → 'household' default.
// Item-store stores audience verbatim; resolution to member sets
// happens in `@onderling/circles`'s `resolveAudience`.
//
// `audienceMatches(itemAudience, filterAudience)` is the
// predicate behind `ListFilter.audience`: exact structural equality
// plus membership for `union`/`set` container audiences.
//
// `audienceMatchesAny(itemAudience, filterAudiences)` is the
// cross-circle sibling behind `ListFilter.audiences`: an item matches
// when its audience satisfies ANY audience in the set (one query spans
// multiple circles).
export { audienceFromItem, audienceMatches, audienceMatchesAny } from './audience.js';

// Connectivity Phase 2 — the ONE canonical kring chat Envelope + its declared
// projections (fromItem / toItem-render / toWire). Collapses the three
// hand-maintained chat shapes so a change lands once. See `chatEnvelope.js`.
export {
  KRING_CHAT_KIND,
  chatEnvelopeFromStoreItem,
  toEventLogItem,
  fromEventLogItem,
  toWireEnvelope,
  toWireRefEnvelope,
  fromWireRefEnvelope,
  isRefEnvelope,
} from './chatEnvelope.js';

// Connectivity Phase 2 (§5 / C3) — the ONE addressed send: `deliver(envelope,
// { to })` folds the two 1:1 DM paths (ephemeral contactThreadChannel + the
// persisted wireChat chat.send) into one send-to-a-peer-AND-persist-the-turn
// primitive, on the canonical Envelope. Transport-agnostic (send + wire
// projection injected); item-store owns only the durable persistence + dedup
// half (lifted from wireChat). Fixes G18: the contact/bot DM becomes durable.
// See `addressedDeliver.js`.
export {
  createAddressedDeliver,
  chatTurnsFromItems,
  DM_ITEM_TYPE,
} from './addressedDeliver.js';

// ── Entry kinds (C15 / one-log) ──────────────────────────────────────────────
// The ONE table saying how a logged entry behaves — lane, wake, retention, auditability. Lives here rather
// than in an app because stoop and basis each need it and stoop cannot import basis (invariant 5); before
// this the wake rule existed twice and was held together by a fitness test.
export {
  ENTRY_KINDS, LANE, RETAIN, UNKNOWN_KIND, RETENTION_WINDOW,
  entryKind, isSystemKind, isAuditKind, retentionOf, retentionWindowFor,
  conversationKinds, kindWakes, governanceWakes,
} from './entryKinds.js';
