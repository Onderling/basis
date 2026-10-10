/**
 * basis — portable real-Agent factory.
 *
 * Lifted from `src/web/realAgent.js` in so both the web entry
 * (`src/web/realAgent.js` → thin re-export) and the basis-mobile
 * bundle (`@onderling-app/basis/core-realAgent`) share one source.
 *
 * Topology (composes four real app agents on a shared InternalBus):
 *   - hostAgent   — household skills + calendar
 *   - chatAgent   — user-facing surface (via @onderling/secure-agent)
 *   - tasksCircle   — real tasks-v0 Circle agent
 *   - stoopAgent  — real Stoop NeighbourhoodAgent
 *   - folioAgent  — real Folio browser agent (web-only handlers today)
 *
 * Portability rules (per Project Files/conventions/node-portability):
 *   - NO direct browser DOM globals (window / location / document)
 *   - Browser-globals consumed via `typeof globalThis.X !== 'undefined'`
 *     guards so Node + RN runtimes degrade cleanly
 *   - `nknLib` is INJECTED by the caller (web injects the browser
 *     nkn-sdk; RN injects the RN-compatible build)
 *
 * Web-specific wiring (OIDC, window/location, DOM mounts) lives in
 * the wrapper at `src/web/realAgent.js` + `web/main.js`.
 */

import {
  Agent, AgentIdentity, Bootstrap, InternalBus, InternalTransport, DataPart, Parts, TokenRegistry,
  PolicyEngine, anyRevoked, TrustRegistry, deriveCircleAddress, circleAddressSigner, signCircleLinkFromSeed,
  circleIdentity, signDeviceDelegation, deviceDelegationPubKey, deriveDeviceSeed, wireDeviceId,
  signDeviceRevocation, signDeviceStatement, STATEMENT_DOMAINS,
  deriveVaultAtRestKeyFrom, ownCircleAddressAnnouncement,
  deriveCircleSeed, ceremonyCommitment, authorityPubKeyB64Of, ownerRootFingerprint, signCeremonyReveal, signCeremonyCommitmentFromSeed, b64encode, derivePersonKeySeed, derivePersonLinkKeySeed, personKeyPubKeyB64, loadPersonKey, storePersonKey, PERSON_KEY_KIND, personKeyFacts, signWithPersonKey, firstDeviceIdFor, signPersonKeyLink, sealToPersonKey, openFromPersonKey } from '@onderling/core';
import { readKeyChain, foldKeyEvents, rotateKeyEvent } from '@onderling/pod-client';   // the replace ceremony re-reads and re-keys the group-key chain
import { keyEventsFromRail, KEY_STATEMENT_BROADCAST } from '../../v2/keyRail.js';
import { replyLine } from '../../v2/replyLine.js';
import { parseCompanionClaim } from '../../v2/companionClaim.js';
import { deviceSharedCopyOpener } from '../../v2/sharedCopyOpener.js';
import {
  useCircleSigningIdentity, installCircleSigningIdentities,
} from '../../v2/circleSigningIdentity.js';
import { createCircleSenderAuthorization, SENDER_REASON } from '../../v2/circleSenderAuthorization.js';
import { createRosterReadCache, isRosterRead } from '../../v2/rosterReadCache.js';
import { shareableAddress, SHARE_NKN_ADDRESS_PARAM_KEY } from '../../v2/addressSharing.js';
import { contactRelayScope } from '../../v2/connectionPoints.js';
import { createParamsService, basisParamRegistry } from '../../v2/paramsService.js';   // #36 — settable params surface
import { settingsSealStrategyForIdentity, sealStrategyForRecipients } from '../../v2/sharedCopyOpener.js'; // seal-to-self for settings + recipient-widened seal for view lanes
import { contentSealStrategy } from '../../v2/contentAtRest.js';   // the device's content-at-rest key — a person's own words on their own disk
import { createSealingBackend } from '@onderling/pseudo-pod';            // the seal above a blind local store
import { setShellContentSeal } from '../../v2/localStoreSeal.js';        // hand the content key to the shell's own stores
import { wireEventLogPersistence } from '../../v2/eventLogPersistence.js';   // the device log hydrates HERE, where the key is
import {
  createHistoryMirror, hydrateHistory, exportHistoryArchive,
  HISTORY_MIRROR_PARAM_KEY, HISTORY_RECENCY_DAYS_KEY, HISTORY_RECENCY_MAX_KEY,
} from '../../v2/historyMirror.js'; // the personal history store: sealed follower sink + instant-restore hydrate + archive export
import {
  probeSettingsMediumDetailed, isProbeSafeToAttach,
  computeSettingsConflicts, SETTINGS_SHARED_PROBE_PATH,
} from '../../v2/settingsRestoreGate.js'; // #36/#44 — probe-before-flush (no cross-key clobber) + the restore choices
import { makeMembershipRail, makeMembershipEmitter, MEMBERSHIP_CATCHUP_SUBTYPES, MEMBERSHIP_BROADCAST } from '../../v2/membershipRail.js'; // the membership rider — statements ride the device log
import { makeTaskRail, makeTaskEmitter, routeTaskMirror, TASK_CATCHUP_SUBTYPES, OWN_TASK_CATCHUP_SUBTYPES, TASK_BROADCAST } from '../../v2/taskRail.js';
import { makeFrontierReplay } from '../../v2/frontierReplay.js'; // the content re-root — item snapshots ride the device log
import { healRestoreList } from '../../v2/restoreListHeal.js'; // a circle missed on the restore list is written at the next boot
import { makeChatRail, makeChatEmitter, owedChatStatements, CHAT_CATCHUP_SUBTYPES, CHAT_STATEMENT_BROADCAST } from '../../v2/chatRail.js'; // the content re-root — chat messages ride the device log as signed render entries
import { GOV_CATCHUP_BATCH } from '../../v2/governanceCatchUp.js'; // the governance catch-up's reply subtype (the rate-limit exemption set)

/** The CATCH-UP REPLY subtypes — the legitimate reconnect bursts the rate limiter must not eat
 *  (one replay serve is up to 1000 items against a burst-30 bucket). Replies only: requests and
 *  every other envelope stay bucketed, and each exempted reply still faces its rail's full
 *  verify-on-ingest gate. */
// The tiers a door may give the people it admits, by role. Never `private`: that is the owner's own, self only.
// A door's person reaches the member's ops at every role below admin (what a coordinator or an observer may do with
// a chore is the tasks app's role rule, read at the op); the admin reaches the admin's.
const DOOR_TIER_FOR_ROLE = Object.freeze({ coordinator: 'authenticated', member: 'authenticated', observer: 'authenticated', admin: 'trusted' });

const CATCHUP_REPLY_SUBTYPES = new Set([
  GOV_CATCHUP_BATCH,
  MEMBERSHIP_CATCHUP_SUBTYPES.batch,
  GRANTS_CATCHUP_SUBTYPES.batch,
  TASK_CATCHUP_SUBTYPES.batch,
  TASK_CATCHUP_SUBTYPES.offer,
  OWN_TASK_CATCHUP_SUBTYPES.batch,
  OWN_TASK_CATCHUP_SUBTYPES.offer,
  CHAT_CATCHUP_SUBTYPES.batch,
  CHAT_CATCHUP_SUBTYPES.offer,
  KEY_CATCHUP_SUBTYPES.batch,
]);
import { createSurfaceGrants, compileReadFilter, ownGrantsAllowList } from '../../v2/surfaceGrants.js';   // pair-a-view standing grants (the surface role) + the section→lane-filter compiler
// The grants LANE (V1 closing wave row 1): grant/revoke statements ride the device log between the
// owner's own devices; the registry above is a projection of this lane.
import {
  makeGrantsRail, makeGrantsFan, makeGrantsCatchUp, makeGrantsPeerHandler,
  deviceSetBindingVerifier, siblingDevices, OWN_DEVICES_SCOPE, GRANTS_CATCHUP_SUBTYPES,
} from '../../v2/grantsRail.js';
// A direct message is addressed to a PERSON but arrives at ONE device: the contact card carries the
// profile address, which every device derives from the same seed, and a relay maps one address to one
// socket. This carries a landed turn to the person's other devices so the thread reads the same on all
// of them — the grants lane's fan, pointed at conversation instead of authority.
import { makeContactTurnFan, makeContactTurnPeerHandler, CONTACT_TURN_BROADCAST } from '../../v2/contactTurnFan.js';
import { makeSiblingCarry } from '../../v2/siblingCarry.js';
import { createPersonKeySync, PERSON_KEY_CARRY } from '../../v2/personKeySync.js';
import { createPrimaryDeviceChoice } from '../../v2/primaryDevice.js';
import { pairRouteFor } from '../../v2/pairRoster.js';
import { createPersonKeyChain } from '../../v2/personKeyChain.js';
import { createKnownPeersSync } from '../../v2/knownPeersSync.js';
import { backfillContactPersonas } from '../../v2/contactPersona.js';   // contacts from before the lens get `default`, where provable
import { bookRowsOf } from '../../v2/contactsSource.js';   // a listContacts reply's rows, whole
import { createCircleFollowSync } from '../../v2/circleFollowSync.js';
import { makeSyncSelection } from '../../v2/syncSelection.js';
import { leaveCircleLocally } from '../../v2/circleMembershipHygiene.js';
import { unregisterCircleAddressesOnRelays } from '../../v2/circleAddressRegistration.js';
import { isRosterTrailItem, emitMemberProps } from '@onderling/circles';
// The rules-update rider: a rules-doc edit fans a signed statement on the governance lane so the
// new doc + version reach every member peer-to-peer (pod-free — V1 closing wave row 2).
import { makeGovernanceRail } from '../../v2/governanceAppWiring.js';
import { makeRulesUpdateEmitter } from '../../v2/rulesUpdateLane.js';
// …and the circle POLICY, the same way: a signed statement on the governance lane, caught up by joiners.
import { makePolicyUpdateEmitter } from '../../v2/policyUpdateLane.js';
import { makeKeyRail, makeKeyEmitter, KEY_CATCHUP_SUBTYPES } from '../../v2/keyRail.js';   // the group-key lane — sealed key events as signed spine statements
// The add-a-device offer (`onderling-enroll://`): the transport bootstrap the existing device
// shows as a QR and the freshly enrolled device consumes after its ceremony (#54 tail).
import { encodeEnrollOffer } from '../../v2/enrollOffer.js';
// The roster seed (pod-less enroll S1): a sibling serves its membership trail rows, device-set
// verified, so a trail-less enrolled device can project rosters and fold statements.
import {
  ROSTER_SEED_SUBTYPES, buildRosterSeedRequest, makeRosterSeedServer, makeRosterSeedReceiver,
} from '../../v2/rosterSeed.js';
import { SURFACE_NUDGE_SUBTYPE } from '../../v2/surfaceNudge.js'; // the reading half's contentless re-pull signal
import { CONNECTION_GRANT_SUBTYPE } from '../../v2/connectionPairing.js';
import { COMPANION_GRANT_OUTCOMES } from '../../v2/companionGrant.js';   // the words a grant to a node's agent ends on   // pairing: how the grant reaches the view that asked for it
import { paramsManifest } from '../../v2/paramsManifest.js';   // #36 — the params op contract (gates the waist branch)
import { VaultMemory, VaultLocalStorage, VaultEncrypted, migrateVaultToEncrypted, resealVault, seedFromString, seedToString } from '@onderling/vault';
import { wireSkill } from '@onderling/sdk';
import { createSecureMeshAgent } from '@onderling/secure-agent';
import { createBrowserMultiCircleTasksAgent } from '@onderling-app/tasks/browser';
import { createBrowserStoopAgent } from '@onderling-app/stoop/browser';
import { STOOP_OP_ALIAS } from '../../v2/stoopOpAliases.js';
import { shouldFanNoticeboardItem, noticeboardItemCircle } from '../../v2/noticeboardFan.js';
import { toCircleStorePost } from '../../v2/noticeboardCarry.js';
import { createBrowserFolioAgent } from '@onderling-app/folio/browser';
// agents — the read-only "your agents" surface (2026-07-09). buildAgentSkills
// derives the two defineSkill-shaped handlers (listAgents / viewAgent) from
// the agents manifest via wireSkill; registerAgentBundle both registers THIS
// device in the registry resource and returns the live registry handle.
import { buildAgentSkills } from '@onderling-app/agents/wireSkills';
// Canonical Member projectors — the chat-shell `listGroupMembers` item is a
// PROJECTION of the ONE Member (kring-host), not a hand-reshape.
import { memberFrom, memberToChatItem } from '@onderling/kring-host/circleMembers';
// install — the curated-catalogue SOURCE. commons-governance G1: when a
// bootstrap endorser root is configured (opts.commonsRoot), the default source
// is the REAL endorsement-backed catalogue (createCatalogueSource over signed,
// cardHash-bound recommendations); otherwise the local stub keeps the surface
// exercisable. Both satisfy the same { list, get } contract, so wireSkills /
// installCores are unchanged. Overridable via opts.agentsCatalogue.
import { createStubCatalogue } from '@onderling-app/agents/defaultCatalogue';
import {
  registerAgentBundle,
  createAgentRegistry,
  createEndorsementResource,
  createCatalogueSource,
  createCommunitySubscriptions,
  createProfile as registryCreateProfile,
  setOwn,
  setDisclosure as setDisclosurePolicy,
  releasedValues as releaseFromPolicy,
  createDriver,
  driversFromProperties,
  setCircleMembership as registrySetCircleMembership,
  removeCircleMembership as registryRemoveCircleMembership,
  circleMembershipsOf,
  deviceDelegationOf, deviceDelegationsOf, profileHasOtherDevices, setDeviceDelegation as registrySetDeviceDelegation,
  ownedNodesOf, setOwnedNode, addPendingRevokes, clearPendingRevoke, pendingRevokesOf,
  isRequestable,
  effectiveProperties,
} from '@onderling/agent-registry';
// REQUESTABLE BRIDGE (host-wiring seam J6) — the recipient's per-circle task
// surface (`createTaskStore`) + the convergence handler (`requestableSkillHandler`)
// that mints a `request` task instead of executing an offering. Wired below onto the
// live host agent as the `requestOffering` peer-facing dispatcher op.
import { createTaskStore, requestableSkillHandler, memoryDataSource } from '@onderling/item-store';

/**
 * Pick the right vault for the runtime.  Used here only for the
 * HOST agent (in-process app skills; no cross-peer); the CHAT
 * agent's vault is selected by createSecureAgent's picker via the
 * identityVaultPrefix opt.
 */
function makeBrowserVault(prefix, { durabilityMatters = false } = {}) {
  if (typeof globalThis.localStorage !== 'undefined') {
    try { return new VaultLocalStorage({ prefix }); } catch { /* defensive */ }
  }
  // A memory vault is a fine default for something reconstructible. It is NOT fine for an identity root,
  // and the difference was silent until 2026-07-30: React Native has no `localStorage`, so the owner root
  // landed here, was regenerated on every launch, and took every per-circle address with it — plus the
  // 24-word recovery phrase, which derives from the same root and therefore recovered nothing. Say so.
  if (durabilityMatters && typeof console !== 'undefined') {
    console.warn(
      `[realAgent] no durable storage for "${prefix}" — falling back to MEMORY. Anything derived from it `
      + '(per-circle addresses, the recovery phrase) is regenerated on the next launch. A host that has '
      + 'durable storage must pass its own vault.',
    );
  }
  return new VaultMemory();
}

/**
 * v0.7.P3a — try to restore an existing identity; generate fresh if
 * the vault is empty.  Either way returns a usable AgentIdentity.
 * (Host-only helper; createSecureAgent handles this for the chat side.)
 */
async function restoreOrGenerate(vault) {
  try {
    if (await vault.has('agent-privkey')) {
      return await AgentIdentity.restore(vault);
    }
  } catch { /* fall through to generate */ }
  return AgentIdentity.generate(vault);
}

import { restoreOwnerRoot, newDeviceId, DEVICE_DELEGATION_VAULT_KEY, RESTORE_PENDING_KEY } from './ownerRootRestore.js';
import { createPersonaRuntime } from './personaRuntime.js';
import { circleIdsFrom } from '../../v2/enrolForgets.js';
import { createRegistryCarrier, registryPodName, sealRecoveryFile, openRecoveryFile } from '../../v2/registryCarrier.js'; // the registry survives the device
import { rosterSnapshot, bodyWithRosters, rostersOf, bootstrapOfferFromRosters } from '../../v2/recoveryBootstrap.js';
import { stashEnrollOffer } from '../../v2/enrollOffer.js';
import { parsePairUri } from '../qrSchemes.js';   // the pairing code's one reader (the declared pairCirclePeer op)
import { bindCircleAddressKeysFor } from '../../v2/householdRosterPairing.js';
import { sealingPublicKeyFromNetworkKey, sealingKeyPairFromNetworkKey } from '@onderling/pod-client';
import { ensureOwnerRoot, pickRootKeyStore, readCustodyMode, cutoverToDelegation } from './ownerRootCustody.js';
import { makeAgentTrailEntry, EventLog } from '../../eventLog.js';
import { parseDateInput as parseCalendarDate } from '@onderling-app/calendar';
// Imported by RELATIVE path (not the `@onderling-app/household` package name)
// because basis doesn't carry household as a workspace dep yet (the
// dissolve is in progress).  Mirrors basis-mobile/composeManifests.js,
// which relative-imports the sibling app sources for the same reason.
//
// L3 — basis no longer depends on the legacy household skill registry
// (`skillRegistry.js` → `HOUSEHOLD_SKILL_REGISTRY`) or the legacy `HouseholdAgent`.
// Household ops route through the dissolved pure cores (`v2/householdApp.js`) on a
// dedicated in-process agent via `wireSkill` (see below). We import ONLY the store +
// the no-pod cross-device sync substrate from their submodules — NOT `index.js`, which
// re-exports the retired `HOUSEHOLD_SKILL_REGISTRY` / `HouseholdAgent`. The `InMemoryStore`
// (`HouseholdStore`) survives here solely as the no-pod sync mirror's substrate backing;
// the live item data lives in the per-circle `CircleItemStore` (householdService).
import { InMemoryStore as HouseholdStore } from '../../../../household/src/storage/InMemoryStore.js';
import { buildHouseholdSubstrateStack }    from '../../../../household/src/lib/substrateStack.js';
import { wireHouseholdSubstrateMirror }    from '../../../../household/src/substrateMirror.js';
import { buildHouseholdDataSource }        from '../../../../household/src/storage/persist.js';
import { householdManifest }               from '../../../../household/manifest.js';
import { basisManifest }                   from '../../../manifest.js';                  // basis's own op contract — the gate on the waist branch below
import { createLocalBuiltins }             from '../localBuiltins.js';                   // basis's own handlers: the table every shell has been dispatching around
import { mergeManifests }                  from '../../manifestMerge.js';                // the catalogue `/help` prints from
import { listsManifest }                   from '../../../../lists/manifest.js';         // the composable lists' contract — the default table below serves it
import { makeListsOps }                    from '../../v2/listsOps.js';
import { makeTasksOps, TASKS_IN_CIRCLE_OPS } from '../../v2/tasksOps.js';   // the bot's chores over the circle's store
import { linkOfferMessage, encodeLinkOffer, linkedBotsOf, LINK_OPS, LINKED_COMPANION_OP, IDENTITY_LINK_REVOKE_SUBTYPE } from '../../v2/identityLink.js';   // the identity link's offer, turns and revokes
import { createIdentityLinks }        from '../../v2/identityLinkView.js';   // the bot's statement → a contact row
import { makeCircleCalendarOps }           from '../../v2/circleCalendarOps.js';
import { createOwnDevicesStore }           from '../../v2/ownDevicesStore.js';                   // a person's own appointments, when the shell hands no store
import { makeCircleLists }                 from '@onderling/kring-host/circleLists';             // a person's own Agenda in their own store
import { calendarManifest }                from '../../../../calendar/manifest.js';                  // a household bot's calendar, over the circle's store
import { matchEntry, choicesOf }           from '../../v2/entryRef.js';
import { refuse, firstRefusal, refusalText } from '../../v2/refusal.js';                   // the one refusal shape, the one order
import { botDoorChecks } from '../../v2/botRungs.js';                                            // the bot door's checks, declared once
import { assignAllowed, assignPolicyFrom, mayNamePeople, isSelfWord, ASSIGN_POLICY_KEY, NAMES_KEY, PASSED_KEY, PASSED_DAYS_KEY, passedPolicyFrom, passedDaysFrom, CANCEL_KEY, cancelPolicyFrom, ROLES_KEY, rolesPresetFrom } from '../../v2/botSettings.js';   // who may give a chore to whom, who sees names
import { buildStandardRolePolicy } from '@onderling-app/tasks';                              // the one role rule for chores                           // an entry by its id or a person's words
import { createSecureMeshEnvelopeAdapter } from '../sync/secureMeshEnvelopeAdapter.js';
import { isGenericOpId, decodeGenericOpId, isPeopleWritten } from '@onderling/app-manifest';
import { makeSharedCirclePeerScope }        from '../../v2/sharedCirclePeerScope.js';

// Deterministic seed for the real household store.  Three open items across
// list types so `/list shopping` + the brief demo are non-empty out of the
// box.  Added oldest-first (the store preserves insertion order).
const SEED_HOUSEHOLD_ITEMS = [
  { type: 'shopping', text: 'Milk'                },
  { type: 'errand',   text: 'Post a parcel'       },
  { type: 'task',     text: 'Vacuum living room'  },
];

/**
 * Boot two in-process Agents on a shared InternalBus:
 *   - `host` owns the household skills
 *   - `chat` is basis's invoking identity
 *
 * Returns the same shape as `createMockHouseholdAgent`:
 *   { manifest, callSkill, reset, state }
 *
 * @returns {Promise<{
 *   manifest: object,
 *   callSkill: (appOrigin: string, opId: string, args: object) => Promise<*>,
 *   reset: () => void,
 *   state: () => Array<object>,
 *   meta: { hostAddress: string, chatAddress: string, transport: 'internal' },
 * }>}
 */
export async function createRealHouseholdAgent(opts = {}) {
  // The agent's own words go through the shell's translator — resolved ONCE here (every shell hands `opts.t`; a bare
  // composition without one gets the keys, never English).
  const agentT = typeof opts.t === 'function' ? opts.t : (k) => k;
  /** The user's address-fallback setting, read LIVE (the host hands a getter) — every send asks, and so
   *  does the re-drive of messages that were held under the previous answer. */
  const addressFallbackOn = () => (typeof opts.allowAddressFallback === 'function'
    ? opts.allowAddressFallback() !== false
    : opts.allowAddressFallback !== false);
  // Part G household — REAL `apps/household` store.  `chores`-as-an-array is
  // gone; all household state now lives in this `ItemStore`-backed store
  // (shopping/errand/repair/schedule items + tasks + contacts).
  //
  // OBJ-2 S1e — restart-survival: when the shell passes `householdPersistDb`
  // (web → `{ dbName: 'cc-household-state' }` IndexedDB; mobile →
  // `{ dbName, asyncStorage }` AsyncStorage; node → `{ path }`), back the
  // store with a persistent `CachingDataSource` so items survive a reload.
  // Default (undefined) → in-memory `MemorySource`, unchanged.  The actual
  // shell threading of `householdPersistDb` is a follow-up; realAgent just
  // accepts + wires it here.
  // (BUILT BELOW, once the content-at-rest key exists — see `contentSeal`. It has to be sealed from its
  // first write, and the key lives behind the identity vault, which this point in the boot is too early
  // for. `getCircleScope` below closes over it and only runs at op time, long after.)
  let householdDataSource;
  // Per-circle store registry (no-pod scoping). One shared DataSource; each circle gets an ItemStore
  // rooted at mem://household/circles/<id>/ so its list is its OWN. The legacy bucket ('household' /
  // no active circle) keeps the bare root, so the pre-partition pile stays reachable as a default.
  const householdStores = new Map();   // circleId → HouseholdStore
  function getCircleScope(circleId) {
    const id = (typeof circleId === 'string' && circleId) ? circleId : 'household';
    let store = householdStores.get(id);
    if (!store) {
      const rootContainer = id === 'household' ? 'mem://household/' : `mem://household/circles/${id}/`;
      store = new HouseholdStore({ dataSource: householdDataSource, rootContainer });
      householdStores.set(id, store);
    }
    return store;
  }
  // The active circle (shell-supplied) scopes a household call when the chat args don't carry one
  // (read verbs like listOpen aren't auto-scoped by the dispatch). circleId in args still wins.
  const getActiveHouseholdCircleId = typeof opts.getActiveCircleId === 'function' ? opts.getActiveCircleId : () => null;
  // The circle a call means when it names none: a household bot's own circle (its id is derived from the bot's key once
  // the identity is up, below), else the legacy bucket.
  let homeCircleId = 'household';
  function resolveCircleId(args) {
    return (args?.circleId ?? args?.circleId ?? args?.groupId ?? getActiveHouseholdCircleId()) || homeCircleId;
  }
  // cluster L · L3 — household is now the UNIFORM wired path by DEFAULT (the legacy agent is retired).
  // Household ops route to the dissolved pure cores (`v2/householdApp.js`) over the per-circle
  // CircleItemStore, via `wireSkill` on a dedicated in-process household agent (built below). Same
  // DataSource (persistent if a persistDb was passed; in-memory no-pod otherwise). `opts.householdViaCircleStore`
  // is accepted but no longer gates anything — the wired path is unconditional (there is no legacy fallback).
  const householdApp = await import('../../v2/householdApp.js');   // pure cores for the wireSkill registration below
  const { wireStoreMirror, wireCircleStoreInbound } = await import('@onderling/item-store');
  let householdAgent = null;           // B1 — dedicated in-process agent hosting the wireSkill-wrapped pure cores
  const circleSyncWired = new Set();   // circleIds whose store↔mirror sync (publish + inbound) is wired (once each)
  // Cache-mode mirroring: a pod-backed circle's store runs over a per-circle cache-mode MEDIUM (write-through
  // to the pod). The platform provisions it (`opts.provisionCircleMedium`, web-woven) at circle-open, keyed
  // here; `dataSourceFor` hands it to the store at build time. Absent injection → the shared local backing.
  const circleMedia = new Map();          // circleId → cache-mode PseudoPod medium (DataSource-shaped)
  let householdService;   // built with `householdDataSource` below, for the same reason
  // The task lane (the content re-root) — ASSIGNED where the device log is handed over, further down; declared
  // here because `ensureCircleSync` (whose eager boot call runs first) closes over them for the per-type valve.
  let taskRail = null;
  let taskEmit = null;
  let ownStoreSync = null;   // the own scope's catch-up between the person's devices (built with the task lane)
  // The personal history mirror's state — assigned at the end of boot (the sync block); declared
  // here so the params dispatch (a live switch flip) can kick the reconciler.
  let historyMirror = null;
  let historyMirrorOp = Promise.resolve();
  let historyMirrorSync = null;
  /** viewPubKey → { mirror, readsKey } — the per-view "edition" lanes (remote surface reads). */
  const viewLaneMirrors = new Map();
  let viewLanesSync = null;   // late-bound; surfaceGrants' change hook calls it before it exists
  // The chat lane (same handover point).
  let chatRail = null;
  let chatEmit = null;
  // The wired household ops (dissolved cores on `householdAgent`). Everything else on the 'household'
  // app-origin (calendar_* passthrough, addMember, getChoreSnapshot, resolveContact, help, registerName)
  // routes to `hostAgent`; `household_briefSummary` is derived from the wired store (see callSkill).
  const HOUSEHOLD_WIRED_OPS = new Set([
    'addItem', 'addTask', 'markComplete', 'removeItem', 'claim', 'reassign', 'listOpen', 'listTasks',
  ]);
  // v0.7.7 — optional event publisher.  When supplied, mutation
  // skills publish item-changed events via this callback so the
  // chat-shell EventRouter routes them to matching threads.
  // Unblocks J8's "household alerts" real-event demo.
  const publishEvent = typeof opts.publishEvent === 'function'
    ? opts.publishEvent
    : () => {};

  // Opt-in demo scaffolding. OFF by default: a freshly created REAL circle must
  // show only real members (the creator + actual joiners) and no phantom tasks.
  // When explicitly enabled (demo deploy / journey fixtures), the factory seeds
  // the three named demo members (Anne/Karl/Maria) into the default tasks + stoop
  // circles, the matching demo contacts, and the starter demo tasks/posts. Nothing
  // here fabricates peers into the `_sync` hint — that reads real state regardless.
  const seedDemoData = opts.seedDemoData === true;

  const bus = new InternalBus();

  // claim-router hook holder. Hosts call agent.setAfterClaimHook(fn)
  // post-construction (the hook typically needs agent.callSkill itself, so it
  // can't be passed in opts).  Default to a no-op.
  const claimRouterRef = { hook: typeof opts.afterClaimHook === 'function' ? opts.afterClaimHook : null };

  // Owner root — the one recovery secret for this account (step 1; other
  // sub-agents still generate independent random seeds until step 2 migrates
  // them onto the root). The default profile (= the chat identity below, which
  // the feedback no-login pseudonym uses) derives from it.
  // Custody: the SEED lives behind the platform key door; the phrase is never
  // persisted. The old vault survives only as the legacy migration source —
  // an install from before the cutover has its cleartext phrase adopted (and
  // removed) on the first boot through here. See ownerRootCustody.js.
  const ownerRootVault = opts.ownerRootVault ?? makeBrowserVault('cc-owner-root:', { durabilityMatters: true });
  const rootKeyStore   = opts.rootKeyStore ?? pickRootKeyStore({ fallbackVault: ownerRootVault });
  // THE CUSTODY FORK (the non-resident root): a CUT-OVER device's key door holds its DELEGATION
  // seed and `ownerRoot` is NULL for the whole boot — the root exists only inside ceremonies,
  // reconstructed from the typed phrase. A pre-cutover install keeps today's root custody until
  // its next ceremony migrates it (the self-enroll migration).
  const custody = await readCustodyMode(ownerRootVault);
  // A phrase ceremony ran on this device and has not been finished (the restore-finish flow). Read once
  // at boot; the flow's first step clears it, so the shell asks exactly once.
  let restorePendingAtBoot = false;
  try { restorePendingAtBoot = !!(await ownerRootVault.get(RESTORE_PENDING_KEY)); } catch { restorePendingAtBoot = false; }
  let ownerRoot = null;
  let custodySeed = null;            // delegation mode: the key door's (delegation) seed
  if (custody.mode === 'delegation') {
    custodySeed = await rootKeyStore.getSeed();
    if (!(custodySeed instanceof Uint8Array) || custodySeed.length !== 32) {
      // A marker without a seed is a broken install — surface it, never mint a fresh identity
      // over it (that is how a person's circles silently become someone else's).
      throw new Error('delegation custody marked but the key door holds no seed — restore with the recovery phrase');
    }
  } else {
    ownerRoot = await ensureOwnerRoot({ rootKeyStore, legacyVault: ownerRootVault });
  }

  // Vault-at-rest: every vault holding KEY MATERIAL or capability tokens reads and writes
  // SEALED under a key derived from the owner root (never persisted — re-derived each boot).
  // The one-time migration seals a pre-cutover install's plaintext in place; the sentinel is
  // bound to this root's fingerprint, so restoring a DIFFERENT phrase starts those vaults
  // clean rather than leaving the previous person's sealed entries around undecryptable.
  // Non-secret vaults (trust levels, audit log) deliberately stay plain — sealing them buys
  // no secrecy and widens the failure surface of an unlock problem.
  const atRestKey = ownerRoot ? ownerRoot.deriveVaultAtRestKey() : deriveVaultAtRestKeyFrom(custodySeed);
  const rootFingerprint = ownerRoot ? ownerRoot.fingerprint() : (custody.fingerprint ?? 'delegation');
  // Every sealed backing is RECORDED: the self-enroll migration (a root-custody device's ceremony
  // cutting over to delegation custody) must reseal them ALL old-key→new-key — missing one would
  // strand its entries under a key the next boot no longer derives.
  const sealedBackings = [];
  const sealedVault = async (backing) => {
    await migrateVaultToEncrypted({ backing, key: atRestKey, fingerprint: rootFingerprint });
    sealedBackings.push(backing);
    return new VaultEncrypted({ backing, key: atRestKey });
  };

  // The settings-restore CONTEXT — retained past the boot block so the restore-settings FLOW's ops
  // (restore-probe / restore-merge / restore-resolve-mismatch) can act post-boot on the same medium
  // the gate probed. `conflicts` holds the probe's captured per-param diff WITH the pod values
  // (capture-then-flush: they survive the local-wins attach so "use theirs" stays honorable).
  const settingsRestoreCtx = { medium: null, attached: false, conflicts: [] };

  // Host agent — in-process app skills (household, tasks-v0, stoop,
  // folio, calendar).  No cross-peer; vault picks the standard browser
  // localStorage path.  Built manually because it's a pure backend.
  const hostVault = await sealedVault(opts.hostVault ?? makeBrowserVault('cc-host-id:'));
  const hostId    = await restoreOrGenerate(hostVault);
  const hostTransport = new InternalTransport(bus, hostId.pubKey);
  const hostAgent = new Agent({ identity: hostId, transport: hostTransport });

  // Chat agent — the user-facing surface.  Built via @onderling/secure-agent
  // factory so every safety primitive (identity persistence, SecurityLayer,
  // mute/block, helloGate, signed WebID claim, audit log, …) is wired
  // by default rather than re-assembled per app.
  //
  // - bus: shared with hostAgent so chatAgent.invoke(hostAgent.address)
  //        works in-process via InternalBus
  // - vault: opt.chatVault wins (tests inject VaultMemory); otherwise
  //   picker chooses VaultLocalStorage by prefix 'cc-chat-id:'
  // - auditLog: persistent under 'cc-audit'; autoLogs identity.rotate /
  //   mute / claim.sign / caps.issue / peer.connect
  // - muteListVaultKey: persistent peer mute across reloads
  // - nknLib: not passed here — caller (web main.js / RN bundle)
  //   wires sa.peer.connect() once its runtime nkn-sdk is available
  // - onPeerMessage: not passed here — main.js wires it when connecting
  //
  // SECURITY: any opt below this comment that is RESET / DISABLED needs
  // a `// SECURITY: opted out — <reason>` comment per
  // Project Files/conventions/architectural-layering.md.
  // Default-profile chat identity: derive from the owner root. Build the vault
  // ourselves (respecting an injected opts.chatVault) so we can pre-seed it, then
  // hand it to the factory — whose restoreOrGenerate then RESTORES this seed.
  // Only seed when no READABLE identity exists: an existing install keeps its current
  // identity on this boot (a clean cutover re-keys via a wipe + re-onboard, never
  // silently here). An entry that exists but cannot be read (a plaintext write that
  // slipped past the sealed layer) is unrecoverable either way — re-deriving from the
  // root is the one repair that keeps the person reachable at their roster addresses.
  const chatVaultBacking = opts.chatVault ?? makeBrowserVault('cc-chat-id:');
  const chatVault = await sealedVault(chatVaultBacking);

  // ── CONTENT at rest ────────────────────────────────────────────────────────────────────────────
  // Key material was already sealed here; a person's own words were not. Their lists, messages and
  // search index reached IndexedDB, AsyncStorage and disk in the clear. The content key rides INSIDE
  // the sealed chat vault: exactly as durable as the identity (lose one and the other is gone anyway),
  // and resealed by the custody ceremony along with every other sealed backing — so the key rotates
  // while not one item byte is rewritten. See `v2/contentAtRest.js` for why it is not the vault key.
  // UNCONDITIONAL. There is no opt-out and no setting: content on this device is sealed, for everyone
  // (Frits, 2026-09-10 — *"it is just encrypted for everyone"*). An earlier version of this carried a
  // per-device toggle, defaulting to sealed; it is gone, because a switch nobody should ever flip is a
  // branch that has to stay correct forever in exchange for nothing.
  const contentSeal = await contentSealStrategy(chatVault);
  // The shells build their own stores (a circle's items, the search index, the device-log snapshot) and
  // cannot reach into this boot for the key, so it is published for them here. Deliberately NOT read back
  // by this agent: a test process boots several agents, and a shared holder would hand the second one's
  // key to the first one's stores. See `v2/localStoreSeal.js`.
  setShellContentSeal(contentSeal);

  // ── THE DEVICE LOG HYDRATES HERE, and it has to be here ────────────────────────────────────────
  //
  // Both shells used to hydrate it themselves, as the first thing they did. That was correct until the
  // snapshot became sealed, and then it was silently wrong: the read happened BEFORE this key existed,
  // so the backend handed back the raw envelope, `JSON.parse` threw, and `wireEventLogPersistence`
  // caught it and started empty — which is the right thing for a corrupt snapshot and the wrong thing
  // for one that is merely locked. The WRITE, later, was sealed. Sealed on the way out, unreadable on
  // the way back: every reload came up with no history at all, behind one console warning.
  //
  // So it moves in here, to the first moment the key exists — and still before anything appends (the
  // first `deviceLog.append` is several hundred lines below). One place, both shells, by construction:
  // a shell now hands over the storage and this decides when to read it.
  if (opts.deviceLog && opts.deviceLogIo) {
    try {
      const { hydrated } = await wireEventLogPersistence({ eventLog: opts.deviceLog, io: opts.deviceLogIo });
      if (hydrated && typeof console !== 'undefined') console.info(`[device-log] hydrated ${hydrated} persisted entries`);
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[device-log] persistence wiring failed — in-memory this session:', err?.message ?? err);
    }
  }
  // Now the stores that hold content can be built, sealed from their first write.
  householdDataSource = opts.householdPersistDb
    ? await buildHouseholdDataSource(opts.householdPersistDb, { strategy: contentSeal })
    : undefined;
  householdService = householdApp.createHouseholdService({
    dataSource: householdDataSource,
    dataSourceFor: (id) => circleMedia.get(id) ?? null,
    // what a write is made for, when a planned row made it (`opts.writeOrigin`: the host's runner's ambient origin)
    ...(typeof opts.writeOrigin === 'function' ? { originOf: opts.writeOrigin } : {}),
  });
  // THE HISTORY KEYS (the replace ceremony's re-wrap, held locally): group-key versions this person is
  // entitled to that were wrapped to a RETIRED device's derivable sealing key. The ceremony unwraps them
  // with the old device's re-derived key and keeps the raw keys here, sealed at rest under this device's
  // own key, so sealed history opens on the replacement with nobody else online. Keys wrapped only to a
  // retired device's random vault key are not recoverable this way — an admin re-grant is the route.
  const historyKeysVault = await sealedVault(opts.historyKeysVault ?? makeBrowserVault('cc-history-keys:'));
  const historyKeyChainFor = async (circleId) => {
    try { const raw = await historyKeysVault.get(`chain:${circleId}`); return raw ? JSON.parse(raw) : []; }
    catch { return []; }
  };
  const absorbHistoryKeys = async (circleId, chain) => {
    if (!Array.isArray(chain) || !chain.length) return 0;
    const cur = await historyKeyChainFor(circleId);
    const byVersion = new Map(cur.map((k) => [k.version, k]));
    let added = 0;
    for (const k of chain) { if (!byVersion.has(k.version)) { byVersion.set(k.version, k); added += 1; } }
    if (added) await historyKeysVault.set(`chain:${circleId}`, JSON.stringify([...byVersion.values()].sort((a, b) => b.version - a.version)));
    return added;
  };
  // THE PERSONA RUNTIME (personaRuntime.js): the keys this device runs for the default persona — its profile seed, the
  // device seed its per-circle keys derive from, its delegation record, its per-circle identities, the authority its
  // commitments name, and its person key's starting point. Named once there; the agent reads it. Only 'default' runs.
  const personas = new Map([['default', await createPersonaRuntime({ profileId: 'default', ownerRoot, custody, custodySeed, chatVault })]]);
  const persona = personas.get('default');
  let personKey = persona.initialPersonKey;
  /** The current person key as a circle learns it: `{ version, pubKey }`, or null. */
  const currentPersonKey = () => (personKey ? { version: personKey.version, pubKey: personKeyPubKeyB64(personKey.seed) } : null);
  /** The same, with the link key's public half — what a CARD and a chain reply carry, so a contact can pin it and verify rotations. */
  const personKeyForContacts = () => (personKey ? { ...currentPersonKey(), ...(personKey.linkKeyPub ? { linkKeyPub: personKey.linkKeyPub } : {}) } : null);
  // THE PERSON KEY ON THE WIRE (binding-levels §10.5 step 4): an identity the secure agent can sign envelopes with
  // (`sendAs`), registered as OURS at the security layer and as an address on the relays. It is what a device
  // speaks as when nothing else of it is known to the other end — the enrolling device's first requests to its
  // sibling, the sibling's parcel back — and what the sender authorizer admits live as our own current key. The
  // static profile key stops being spoken and stops being admitted; a rotation swaps this identity out.
  let personIdentity = personKey ? await AgentIdentity.fromSeed(personKey.seed, new VaultMemory()) : null;
  const personAddress = () => personIdentity?.pubKey ?? null;
  /** The relay proof for the person address: the same challenge-signing contract as a per-circle alias. */
  const personAddressSigner = () => (personKey ? (message) => signWithPersonKey(personKey.seed, new TextEncoder().encode(message)) : null);
  /** `[{ address, sign }]` — what a shell hands its relay alias registration beside the per-circle addresses. */
  const ownAddressBindings = () => (personAddress() ? [{ address: personAddress(), sign: personAddressSigner() }] : []);
  const secureAgentRef = { current: null };   // late-bound: the secure agent is created further down this scope
  const registerPersonIdentity = () => {
    const sa2 = secureAgentRef.current;
    if (!sa2 || !personIdentity) return;
    try { sa2.registerSelfIdentity?.(personIdentity.pubKey, personIdentity); } catch { /* the send path falls back to canonical and says so */ }
  };
  const registerPersonAddressOnRelays = async () => {
    const sa2 = secureAgentRef.current;
    const sign = personAddressSigner();
    if (!sa2 || !sign) return;
    let list = [];
    try { list = sa2.relays?.list?.() ?? []; } catch { list = []; }
    const primary = primaryDeviceRef.current?.isMine() === true;
    for (const rl of list) {
      try { await rl.port?.addAddress?.(personAddress(), { sign, primary }); } catch (err) { console.warn(`[person-key] relay did not take the person address: ${err?.message ?? err}`); }
    }
  };
  /** A new version arrived (a ceremony here, or a hand-over): keep it, and speak as it from now on. */
  const adoptPersonKey = async (k) => {
    const old = personAddress();
    personKey = k;
    personIdentity = await AgentIdentity.fromSeed(k.seed, new VaultMemory());
    if (old && old !== personIdentity.pubKey) { try { secureAgentRef.current?.forgetSelfIdentity?.(old); } catch { /* best-effort */ } }
    registerPersonIdentity();
    await registerPersonAddressOnRelays();
  };

  const {
    deviceDerivationSeed, enrolledDevice, circleIdentityFor, circleAddressFor, circleSealingKeyPairFor,
    authorityPubKeyB64, ceremonyCommitmentFor, signCeremonyCommitment,
  } = persona;

  // A caller's own `policyEngine` opts, pulled out BEFORE the spread so its `isRevoked` can be
  // unioned into this factory's rather than replacing it (see the composition below). `false` is
  // honoured as "no gate at all"; `true` carries no options to merge.
  const callerPolicyEngine = opts.secureAgentOpts?.policyEngine;
  const callerPolicyEngineOpts = callerPolicyEngine === false
    ? false
    : ((callerPolicyEngine && typeof callerPolicyEngine === 'object') ? callerPolicyEngine : null);
  const callerIsRevoked = (callerPolicyEngineOpts && callerPolicyEngineOpts.isRevoked) || null;

  // THE PRIMARY DEVICE (sync-policy §12, the DM half): read lazily — the choice store is composed further down.
  const primaryDeviceRef = { current: null };
  const sa = await createSecureMeshAgent({
    bus,
    // Other agents' kernel task requests over the relay (a connected screen calling the door's ops): only where the
    // composition asks — a household bot. A person's agent takes none until its door allows only lane-active tokens.
    ...(opts.acceptPeerSkillCalls ? { acceptPeerSkillCalls: opts.acceptPeerSkillCalls } : {}),
    vault:               chatVault,
    primaryDevice:       () => primaryDeviceRef.current?.isMine() === true,
    identityVaultPrefix: 'cc-chat-id:',   // no effect when `vault` is supplied; documents the prefix
    muteListVaultKey:    'cc-mute',
    auditLog:            { vaultKey: 'cc-audit' },
    // T5.3b — the unified secure-mesh factory is now the single entry for the
    // chat agent (web + mobile). With no `transports`, it is behaviourally
    // identical to createSecureAgent; the value is the shared seam: the RN
    // bundle injects platform transports here (mdns/ble) so the unified router
    // ranks them alongside nkn/relay/rendezvous. Web injects none.
    transports:          opts.meshTransports,      // RN passes { mdns, ble }; web omits
    onTransportError:    opts.onTransportError,     // optional per-transport inject hook
    // The outbox (held messages + the dead-address verdict) on a DEVICE-LOCAL store, so neither resets
    // on every launch. Same builder as the settings store; never the pod — a held message is this
    // device's promise to try again, not the person's data.
    holdStore:    opts.outboxPersistDb ? await buildHouseholdDataSource(opts.outboxPersistDb, { strategy: contentSeal }) : undefined,
    holdStoreUri: 'mem://basis/outbox.json',
    // onPeerMessage + nknLib supplied later via setPeerWiring().
    // Pass-through for extra factory opts (tests + future ops):
    // identityResolver, capabilityIssuer, policyEngine, groupManager,
    // a2aTls, rateLimit, usePerfectFwdSec, webidClaim, helloGate, …
    //
    // (`rateLimit` IS enabled — see the block further down, where it is configured with the catch-up
    // exemption that made turning it on safe. A comment here used to say the opposite, kept from the
    // period when it was off; it outlived the change by three weeks and put a finished item back on a
    // go-live brief, which is a good argument for deleting a stale comment rather than leaving it.)
    //
    // Flooding is defended in a second place too, at the layer that can afford to be strict: the nearby
    // room's per-author ask budget (`createAskBudget`, nearbyRoom.js), which protects the expensive half —
    // matching, which can call a language model.
    //
    // The INBOUND GATE on the externally reachable agent (2026-08-19). This agent is the one peers can
    // actually reach; the host agent that holds the skill registry runs on an InternalTransport and no
    // external peer can address it. Until now this agent had no PolicyEngine at all, so it was safe only
    // because it registers no skills — safe by emptiness, not by policy. Anything that later exposes an op
    // here would have been reachable with no verification, so the gate is composed FIRST and separately
    // from exposing anything through it.
    //
    // `trustRegistry` is required by the substrate for a policy engine (unknown peers resolve to the
    // lowest tier, which is what fail-closed means here). `isRevoked` is a late-bound thunk because the
    // issuer-side token registry is built further down this same factory — the thunk only runs at
    // inbound-verify time, long after boot (the same late-binding shape the surface preference uses).
    // Peer tiers get their OWN vault, not the chat vault. Sharing it entangles them with custody: a
    // device-revocation ceremony rotates that vault's secret, and every previously written trust entry
    // becomes undecryptable — safe (an unreadable tier falls closed to the lowest) but lossy, and it
    // surfaced as a decryption error the moment a walk did a ceremony and a grant in one account.
    // Mirrors the host gate, which already keeps `cc-host-trust:` separate.
    trustRegistry: { vault: opts.peerTrustVault ?? makeBrowserVault('cc-peer-trust:') },
    // RATE LIMIT ON (the R1 go-live line, 2026-08-21) — the flood defence at the receive boundary,
    // WITH the catch-up exemption that made turning it on safe: a reconnect replay legitimately
    // serves up to 1000 items in one burst, which the chat-pace buckets would silently discard
    // (the reason this sat OFF since 2026-07-30). The exemption passes exactly the DEDICATED
    // catch-up REPLY subtypes — signed statements that still face their rails' full verify gates —
    // while requests and ordinary traffic stay bucketed. Named residuals, on purpose: the
    // noticeboard replay re-sends plain 'circle-post' envelopes (NOT exempt — a long backlog may
    // throttle, and the hi-water design re-pulls on the next reconnect), and an exempt-subtype
    // flood degrades to a verify-CPU cost instead of a bucket drop. Tests override via
    // secureAgentOpts (spread below wins).
    rateLimit: {
      // Tuned ABOVE chat pace on purpose: the other legitimate burst — a hold-forward FLUSH of
      // envelopes held while this device was offline — carries ordinary subtypes and cannot be
      // subtype-exempted, so the buckets must absorb it. 120/20 per peer rides out a realistic
      // flush; the global cap holds several peers reconnecting at once without letting a botnet
      // of quiet senders flood in aggregate.
      perPeer: { burst: 120, refillPerSec: 20 },
      global:  { burst: 600, refillPerSec: 100 },
      exempt: (env) => CATCHUP_REPLY_SUBTYPES.has(env?.payload?.subtype),
    },
    // THE SENDER OUTBOX is a PROJECTION, not a second store. basis deliberately passes NO `holdStore`:
    // the content a held envelope carries is ALREADY on the device log (the optimistic local append
    // happens before the fan holds anything), so persisting the queue here would write a duplicate copy
    // beside the one record — the drift this repo keeps undoing. What survives a restart instead:
    // received `stored` receipts ride the log as silent entries, and at circle open the still-owed
    // statements (own, recent, unreceipted) re-fan over the signed lane — receiver-side dedup makes
    // that idempotent. The `holdStore` port itself stays in the substrate for consumers that have no
    // log (a companion node, a headless agent).
    ...(opts.secureAgentOpts ?? {}),
    // THE revocation gate for the externally reachable agent — composed LAST, after the caller
    // spread, because it must not be overridable. THREE lists, all of them consulted:
    // `agentsTokenRegistry` holds the ops-side grants; `surfaceGrants` holds the CONNECTION grants
    // (revoking a connection marks it only there); a caller may add its own. While a bespoke door
    // consulted surfaceGrants directly that was fine; once acting moved to A2A this engine became
    // the only thing standing between a revoked connection and the waist — and it was consulting
    // the wrong list. Caught by the revocation-durability walk during the migration, which is what
    // that walk is for.
    //
    // This used to be TWO half-answers that fought: an `isRevoked` here (which any caller passing
    // `secureAgentOpts.policyEngine` replaced wholesale) and a second, wider union pushed in
    // afterwards. The push-in silently clobbered the constructor's check the day this agent gained
    // an engine, and unpairing left the connection working over A2A. The engine now takes one
    // resolver, once, and this is the only site that composes it.
    //
    // All three are late-bound thunks: every source is built further down this same factory, and
    // the check only runs at inbound-verify time. `surfaceGrants.isRevoked` is ASYNC (it awaits the
    // grants lane's fold — fail-closed until the first fold lands), so it must be AWAITED:
    // Boolean(promise) is true for every token. A source that throws denies (deny-wins).
    ...(callerPolicyEngineOpts === false ? { policyEngine: false } : {
      policyEngine: {
        ...(callerPolicyEngineOpts ?? {}),
        isRevoked: anyRevoked([
          async (tokenId) => Boolean(await agentsTokenRegistry?.isRevoked(tokenId)),
          async (tokenId) => Boolean(await surfaceGrants?.isRevoked(tokenId)),
          async (tokenId) => (typeof callerIsRevoked === 'function' ? Boolean(await callerIsRevoked(tokenId)) : false),
        ]),
        // A token issued by THIS agent's own key is honoured only while its id is ACTIVE on the grants lane, for the
        // same subject — statements count there only from this person's enrolled, unrevoked devices — so a token
        // signed off the record with this key (a revoked device keeps it) is refused, whatever it says it is. Before
        // the agent's own key is set, nothing is allowed (the gate cannot tell).
        isAllowed: ownGrantsAllowList(() => secureAgentRef.current?.agent?.identity?.pubKey ?? null, () => surfaceGrants),
      },
    }),
  });
  secureAgentRef.current = sa;
  registerPersonIdentity();   // the person key speaks on the wire from here (relays take its address when they connect)
  const chatAgent = sa.agent;
  const chatId    = chatAgent.identity;
  // A household bot's circle id is its own, derived from its key (`tasksCircleId` is then a function of it). Its rows
  // from before (under the bare `household` id) move there ONCE, beneath the store: item ids unchanged, nothing fanned;
  // a second boot finds the circle holding rows and moves nothing.
  const botHouseholdId = typeof opts.tasksCircleId === 'function' ? opts.tasksCircleId(chatId.pubKey) : null;
  let householdCircleMove = null;
  if (botHouseholdId) {
    homeCircleId = botHouseholdId;
    const rows = await householdService.stores.rename('household', botHouseholdId);
    // rows still under `household` once the circle holds rows (an older version wrote there again): never merged
    // over the circle's own; counted, so the box says so
    const leftover = rows ? 0 : await householdService.stores.count('household');
    if (rows || leftover) householdCircleMove = { from: 'household', to: botHouseholdId, rows, ...(leftover ? { leftover } : {}) };
  }
  // A token this agent mints (a screen's grant) is checked at its own door, which wants the issuer at `trusted` in
  // this registry — the kernel's documented enablement step. On every agent now that the door ALLOWS only surface
  // tokens active on the grants lane (`isAllowed` below): a token signed off the record with this key — a revoked
  // device keeps it — is refused there. A composition can still opt out (`trustOwnGrants: false`).
  if (opts.trustOwnGrants !== false) {
    try { await sa.trust?.setTier?.(chatId.pubKey, 'trusted'); } catch (err) { console.warn(`[realAgent] own issuer tier not set: ${err?.message ?? err}`); }
  }

  // The agent-activity trail — the record of an AGENT acting on this device (one-log step E).
  // The kernel's dispatch membrane (`runGatedSkill`) reports every gate-passed skill exercise
  // through the `trailSink` port with a whitelisted shape (who · which op · what authority ·
  // outcome — never args or content); here the app decides what that means: the OWNER's own
  // surfaces are NOT an agent acting (every GUI/chat op arrives in-process as the chat or host
  // identity, and a bot-audit surface must not become self-surveillance), so those callers are
  // skipped and everything else lands on the device log as an `agent-action` entry. Read back
  // with `agentTrailRows({actor})` — the agent-detail activity card.
  if (opts.deviceLog) {
    const ownIds = new Set([chatId?.pubKey, hostId?.pubKey].filter(Boolean));
    const trailSink = ({ actor, op, via, outcome }) => {
      if (!actor || ownIds.has(actor)) return;
      const entry = makeAgentTrailEntry({ actor, op, via, outcome });
      if (entry) opts.deviceLog.append(entry);
    };
    hostAgent.trailSink = trailSink;
    chatAgent.trailSink = trailSink;
  }

  // Parameter register (#36) — the settable params surface, reached through the waist (the `params`
  // app-origin branch in callSkill below). Device/agent params persist to this agent's local settings homes
  // (`householdDataSource` keyed by the real per-install `deviceId`); circle scope is wired when a circle
  // param lands (degrades safely until then). Hydrate the synced values at boot; boot-safe if none exist yet.
  // A DEDICATED settings store for the register (per cross-app-settings, settings ≠ item data). PERSISTENT via
  // `opts.settingsPersistDb` (the shell passes an IndexedDB/AsyncStorage descriptor → a `CachingDataSource`
  // that survives across sessions, the same persist path the household store uses); or inject a ready
  // `opts.settingsDataSource` (a pod-backed store, or a SHARED one across a user's devices in a journey);
  // else in-memory (tests / transient).
  const settingsDataSource = opts.settingsDataSource
    ?? (opts.settingsPersistDb ? await buildHouseholdDataSource(opts.settingsPersistDb, { strategy: contentSeal }) : memoryDataSource());
  // Pod-sync the settings store. The settings `CachingDataSource` starts LOCAL; when the shell can reach the
  // signed-in pod it hands a pod-backed inner (a self-sealed pod DataSource over the settings container) via
  // `opts.provisionSettingsMedium` — EXACT mirror of `opts.provisionCircleMedium` for circle stores. `attachInner`
  // swaps it in and auto-flushes the pre-attach local writes (Phase-34), so agent/circle params ride the same
  // pod the rest of a user's data does — settings stop being a device-local island. Attached BEFORE hydrate so
  // the boot read falls through to the pod (settings paths are deterministic → read-through needs no catch-up).
  // Absent/no-pod/failure → stays local (honest degrade), never a broken boot.
  if (typeof opts.provisionSettingsMedium === 'function' && typeof settingsDataSource?.attachInner === 'function') {
    try {
      // The seal-to-self strategy is derived from THIS agent's identity (owner-root → deriveAgentSeed), so it
      // is identical on every device of the user → agent-scoped settings sealed here open on the user's other
      // devices. The shell supplies the pod (fetch/podRoot); realAgent supplies the key. No key material
      // escapes — only the `{seal, open}` closures. Null strategy (no identity) → no pod sync, stays local.
      const strategy = settingsSealStrategyForIdentity(chatId);
      const medium   = strategy ? await opts.provisionSettingsMedium(strategy) : null;
      settingsRestoreCtx.medium = medium;
      if (medium) {
        // RESTORATION GATE (finding 3): attachInner BULK-FLUSHES local settings to the pod, so a device whose
        // key cannot OPEN the pod's owner-sealed blobs (a fresh install signed in WITHOUT the recovery phrase)
        // would silently overwrite them. Probe read-only first; only attach+flush when we own the key
        // (openable) or the pod is fresh (missing). Gate the write on being able to open — never a silent write.
        const { status: probe, value: podBlob } = await probeSettingsMediumDetailed(medium);
        if (isProbeSafeToAttach(probe)) {
          // CAPTURE-THEN-FLUSH (the per-param merge list, #44): the attach's flush is local-wins,
          // so the pod's values from the user's OTHER device would silently lose. The probe already
          // opened the pod blob — diff it against this device's copy FIRST; the captured `theirs`
          // values survive the flush in memory, so "keep theirs" stays honorable after it.
          let conflicts = [];
          try {
            const localBlob = await settingsDataSource.read(SETTINGS_SHARED_PROBE_PATH);
            conflicts = computeSettingsConflicts(localBlob, podBlob);
          } catch { /* no local blob → no conflicts */ }
          await settingsDataSource.attachInner(medium);
          settingsRestoreCtx.attached = true;
          settingsRestoreCtx.conflicts = conflicts;
          if (conflicts.length) {
            // keepTheirs routes through the ONE kind-gated write (`set-param`), so the adopted value
            // flushes to the pod like any other settings change. Invoked from the shell after boot.
            const keepTheirs = (key) => {
              const c = conflicts.find((x) => x.key === key);
              return c ? callSkill('params', 'set-param', { key, value: c.theirs }) : Promise.resolve({ ok: false, error: 'unknown-key' });
            };
            try { opts.onSettingsConflicts?.({ conflicts, keepTheirs }); } catch { /* a shell hook must not break boot */ }
          }
        } else if (probe === 'undecryptable') {
          // The pod's settings are sealed under a DIFFERENT key — HOLD: stay local, overwrite nothing. Surface
          // the coarse choice to the shell (#44): recover with the phrase (the existing restore wizard; the
          // reboot re-probes with the right key) / stay local (default — do nothing) / OVERWRITE, the one
          // explicit destructive act, handed over as an action so a shell cannot reimplement the flush.
          const overwrite = async () => { await settingsDataSource.attachInner(medium); return { ok: true }; };
          try { opts.onSettingsKeyMismatch?.({ overwrite }); } catch { /* a shell hook must not break boot */ }
          if (typeof console !== 'undefined') console.warn('[settings-medium] pod settings are sealed under a different key — staying local; recover with your phrase to sync (nothing overwritten).');
        } else {
          // transport — could not reach the pod to verify. Stay local THIS session WITHOUT declaring a key
          // mismatch (never accuse on a network hiccup); the next sign-in retries the probe.
          if (typeof console !== 'undefined') console.warn('[settings-medium] could not verify pod settings (transport) — staying local this session.');
        }
      }
    } catch (err) { if (typeof console !== 'undefined') console.warn('[settings-medium] provision failed — local only', err?.message ?? err); }
  }
  const paramsService = createParamsService({
    register:   basisParamRegistry(),
    dataSource: settingsDataSource,
    deviceId:   chatId?.deviceId ?? null,
  });
  try { await paramsService.hydrate(); } catch { /* settings absent → registered defaults stand */ }

  /* ─── Decision 1 step 3 — the roster authorize, installed here for BOTH shells ────────────────
   * The kernel verifies an inbound envelope against the key it carries and then asks this whether
   * that key may speak at the address the envelope was sent to. Installed at agent construction
   * rather than by a shell, so `web ≡ mobile` holds by construction: a shell cannot forget it,
   * because a shell never touches it. The snapshot it answers from is fed by
   * `bindCircleAddressKeysFor`, which is the one place the app already learns a circle's roster.
   *
   * Both diagnostics below are deliberately loud. "Nobody vouched for this key" and "I have never
   * seen this circle's roster" are the two ways this check can be weaker than it looks, and neither
   * announces itself any other way.
   */
  const circleSenders = createCircleSenderAuthorization({
    ownKeysLive: () => [personAddress()].filter(Boolean),
    onUnknownRoster: ({ ownAddress }) => console.warn(
      `[realAgent] no roster recorded for own circle address ${String(ownAddress).slice(0, 12)}… — `
      + 'traffic to it is ACCEPTED unchecked until this circle\'s membership has been read once.',
    ),
    // …naming the address it came FROM and the one it was sent TO: a refusal that names only the key sent a
    // diagnosis the wrong way twice (2026-09-19).
    onRefused: ({ circleId, senderKey, from, ownAddress, pattern, answering, reason }) => console.warn(
      (reason === SENDER_REASON.CANONICAL_REFUSED
        ? `[realAgent] refused a validly-signed envelope in ${circleId ?? 'a circle'}: the key `
          + `${String(senderKey).slice(0, 12)}… is a MEMBER's canonical identity, and that member has `
          + 'proved a per-circle address — inside a circle only the per-circle key may speak.'
        : `[realAgent] refused a validly-signed envelope in ${circleId ?? 'a circle'}: the key `
          + `${String(senderKey).slice(0, 12)}… is not on its roster.`)
      + ` (${pattern ?? 'a message'}${answering ? ' answering ours' : ''} from ${String(from ?? '?').slice(0, 12)}… to ${String(ownAddress ?? '?').slice(0, 12)}…)`,
    ),
    // The transition, said out loud (B6). These members are still accepted on their canonical key
    // because refusing them would make them undeliverable rather than pseudonymous — a shrinking
    // set, not an open door, and the only way to know which it is in practice is to print it.
    onCanonicalOnlyMembers: ({ circleId, count, of }) => console.warn(
      `[realAgent] ${count} of ${of} member(s) of ${circleId ?? 'a circle'} have no PROVEN per-circle `
      + 'address, so their canonical identity key is still accepted there — linkable across circles. '
      + 'They leave this set on their own, the first time their device announces an address.',
    ),
  });
  sa.setSenderAuthorizer?.(circleSenders.authorizeSender);
  // Say the wire-facing fact out loud, once, on both shells: the in-process app agents each print a
  // "NO ROSTER AUTHORIZER" warning (they face no wire), and without this line a reader cannot tell
  // whether the one agent that DOES face the wire is guarded. It is — and this is the line that proves
  // it on a device, not only in a fitness test.
  console.info(`[security] roster authorizer on the peer agent ${String(chatId?.pubKey ?? '').slice(0, 12)}…: ${sa.senderAuthorizerInstalled === true ? 'INSTALLED' : 'MISSING'}`);

  /* ─── OBJ-2 (S1a/S1c) — household no-pod peer item-sync ─────────────────────
   * Wire the in-process household store into the substrate mirror over the REAL
   * cross-peer wire (the secure-mesh chat agent), so an item added on one device
   * fans out to the circle's other devices with NO pod. The mirror is
   * transport-agnostic; we hand it the secure-mesh envelope adapter (publish →
   * sa.peer.sendTo; receive → handleInbound, registered in the inbound router by
   * connectPeerTransport below). Peers are app-owned (the chat agent keeps no
   * core PeerGraph) — the shell feeds the roster via `addCirclePeer` as the
   * circle's members become known (publish early-returns while the roster is
   * empty, so this is inert until peers are added). Publish-on-write hooks in the
   * skills (S1d) + persistence (S1e) follow; the mirror is exposed on `ctx` now
   * so S1d only needs to add the publish calls.
   */
  const householdCircleId = opts.householdCircleId ?? 'household';
  const householdEnvelopeAdapter = createSecureMeshEnvelopeAdapter({
    // Durable circle content (tasks, noticeboard/noticeboard items — every item-sync
    // envelope this mirror fans) rides with the hold-forward delivery guarantee:
    // a member who is briefly offline has the envelope HELD locally and delivered
    // on their next presence signal, instead of silently lost. One well-placed
    // default here covers every durable item fan (publishEnvelope is the single
    // choke), rather than opting in per write. The online path is unchanged
    // (a reachable peer is delivered immediately, held:false); receivers already
    // de-dupe by etag/_v so a late-flushed copy is idempotent.
    sendPeerMessage: (to, payload) => sa.peer.sendTo(to, payload, { guarantee: 'hold-forward' }),
    selfAddress:     chatId.pubKey,
  });
  // inbound peer messages the router refuses, by reason (`inboundRefusals()`)
  const inboundRefused = {};
  /** Is every one of these addresses a member of that circle (its folded roster) or one of my own devices? */
  async function pairRequestAllowed(circleId, addrs) {
    const want = addrs.filter((a) => typeof a === 'string' && a);
    if (!want.length) return false;
    const mine = new Set(await ownAddresses().catch(() => []));
    const rows = (await callSkill('stoop', 'listGroupMembers', { groupId: circleId }).catch(() => null))?.members ?? [];
    const members = new Set(rows.flatMap((m) => [m?.webid, m?.addr, m?.address, m?.peerAddr]).filter(Boolean));
    return want.every((a) => mine.has(a) || members.has(a));
  }
  const circleSubstrate = buildHouseholdSubstrateStack({
    transport: householdEnvelopeAdapter,
    deviceId:  chatId.pubKey,
  });
  const householdVault = sa.identity?.vault ?? sa.vault ?? null;
  const circlePeersKey = (circleId) => `cc-household-peers:${circleId || 'household'}`;

  // Per-circle MIRROR factory (OBJ-2 Phase 6). Each circle's store gets its OWN mirror — scopeId =
  // circleId, uriPrefix /household/circles/<id>/items/ — sharing the one transport-level substrate
  // (notifyEnvelope/pseudoPod). A write to circle A's store fans out under A's scope; an inbound
  // A-envelope routes to A's store; a device only in B never receives it. Lazy (first use) + its peer
  // roster restored from the vault per circle. S1d publish-on-write hook is wired here, per store.
  const circleMirrors = new Map();   // circleId → mirror
  async function ensureCircleMirror(circleId) {
    const id = (typeof circleId === 'string' && circleId) ? circleId : 'household';
    let mirror = circleMirrors.get(id);
    if (!mirror) {
      const store = getCircleScope(id);
      mirror = await wireHouseholdSubstrateMirror({
        itemStore:      store.substrate,
        notifyEnvelope: circleSubstrate.notifyEnvelope,
        pseudoPod:      circleSubstrate.pseudoPod,
        circleId:       id,
        selfPubKey:     chatId.pubKey,
      });
      circleMirrors.set(id, mirror);
      // Restore this circle's persisted manual pairings (best-effort).
      try {
        const raw   = await householdVault?.get?.(circlePeersKey(id));
        const saved = raw ? JSON.parse(raw) : [];
        for (const p of (Array.isArray(saved) ? saved : [])) {
          if (typeof p === 'string' && p && p !== chatId.pubKey) await mirror.addPeer(p);
        }
      } catch { /* no saved peers / unreadable — start empty */ }
    }
    return mirror;
  }
  // Bridge a circle's ONE CircleItemStore (the live wired data — tasks + all its other items, since
  // one-store-per-circle collapsed them, G-C1) to its peer mirror, BIDIRECTIONALLY, ONCE per circle
  // (guard with the Set; inbound `subscribe` accumulates):
  //   PUBLISH — local writes fan out to the circle's other devices (`wireStoreMirror` → publish-on-write).
  //   INBOUND — peer envelopes ingest back into THIS circle store (`wireCircleStoreInbound`, id-preserving,
  //             no echo). Best-effort (the op still runs locally). This is the SINGLE fan-out path for the
  //   circle: tasks ride it too now (tasks-v0's own substrate mirror is skipped when the store is injected).
  async function ensureCircleSync(circleId) {
    const id = (typeof circleId === 'string' && circleId) ? circleId : 'household';
    if (circleSyncWired.has(id)) return;
    // Provision the pod-cache MEDIUM FIRST — BEFORE the getStore below builds+caches this circle's store, so a
    // pod-backed circle's store runs over the cache-mode medium (write-through to the pod). Idempotent; a
    // no-pod circle (or a failure) → null → the shared local backing (honest degrade), never a broken op.
    if (!circleMedia.has(id) && typeof opts.provisionCircleMedium === 'function') {
      try { const m = await opts.provisionCircleMedium(id); if (m) circleMedia.set(id, m); }
      catch (err) { if (typeof console !== 'undefined') console.warn(`[cache-medium] ${id}: provision failed — local only`, err?.message ?? err); }
    }
    // Catch up on pod items this device has never seen — a fresh device DISCOVERS the circle's pod contents
    // (read-through alone only opens items whose ids it already knows). Best-effort, once per circle at open.
    const _cacheMedium = circleMedia.get(id);
    if (_cacheMedium && typeof _cacheMedium.catchUp === 'function') {
      try { await _cacheMedium.catchUp(); } catch { /* best-effort — reads still fall through per-key */ }
    }
    // Restore-robustness: a pod-backed medium tags itself with WHERE its group-key resource lives
    // (`keyRef` = pod-URI pointer + posture). Record that pointer into this device's membership registry, so
    // a wiped device re-attaches by an explicit reference (survives a routing/scheme change), not only by
    // re-deriving the URI. Best-effort merge onto the existing record; a no-record circle is a no-op.
    if (_cacheMedium?.keyRef) {
      try { await upsertCircleKeyRef(id, _cacheMedium.keyRef); }
      catch { /* the pointer is optional restore-data — never block circle-open */ }
    }
    try {
      // getStore builds+caches this circle's store (over the cache medium if pod-backed) — do it either way.
      const circleStore = householdService.stores.getStore(id);
      // THE HEAD THIS CIRCLE ALREADY OWES ITSELF. `storeFor` peeks and never builds, so a task
      // statement that arrived before this circle was opened PARKED on the log — that is deliberate
      // (a store built without its pod medium would be worse). What was missing is the other half:
      // the store is a PROJECTION, so opening one must rebuild it from the lane rather than start
      // empty beside a log that already holds the answer.
      //
      // Without this a task created in the moments after someone joined was lost to them for good:
      // verified, chained, stored on their rail, and never applied — and catch-up could not heal it,
      // because catch-up fetches what the rail LACKS and the rail had it (F-016, deterministic).
      // Idempotent by construction: a re-applied snapshot re-merges to the same result.
      if (taskRail?.rebuildHead) {
        try { await taskRail.rebuildHead(id); } catch { /* best-effort — never block opening a circle */ }
      }
      // Compose the peer seam BY POSTURE — avoid the double-carry. A POD-BACKED circle (a cache medium was
      // provisioned) carries content THROUGH THE POD (write-through on send + catch-up on open), so it must
      // NOT also full-body peer-fan the same items. A no-pod circle has the peer mirror as its ONLY carry, so
      // it wires as before. (A reactive pod-signal REF-fan for the store — immediate delivery without waiting
      // for the next catch-up — is a later refinement; today a pod-backed circle converges on open.)
      if (_cacheMedium) {
        circleSyncWired.add(id);
        if (typeof console !== 'undefined') console.info(`[circle-sync] ${id}: pod-carried (peer mirror skipped — no double-carry)`);
        reFanOwedChat(id);   // chat statements ride the peer fan whatever the store's pod posture
      } else {
        await ensureCircleMirror(id);   // the peer ROSTER object (list/persist/clear + the legacy inbound door) — no publish carry
        // The publish valve: every circle-content write rides the SIGNED lane (the content re-root); the
        // unsigned mirror carry is deleted. The valve is built per publish call so it sees the task
        // emitter even though this wiring can run at boot, before the rails are handed the device log;
        // on a device-log composition a pre-emitter write REFUSES loudly instead of silently not-fanning.
        // …and the composition hears what this node wrote (`opts.onCircleWrite(circleId, item | null, removedId?)`:
        // the box's change feed — its event rows, its screens' nudge)
        const wrote = (item, removedId) => { try { opts.onCircleWrite?.(id, item ?? null, removedId); } catch { /* a listener never breaks a write */ } };
        wireStoreMirror(circleStore, {
          publishItem:        (item)          => { const r = routeTaskMirror({ circleId: id, emitter: taskEmit, requireSigned: !!opts.deviceLog }).publishItem(item); wrote(item); return r; },
          publishItemRemoved: (rid, removed)  => { const r = routeTaskMirror({ circleId: id, emitter: taskEmit, requireSigned: !!opts.deviceLog }).publishItemRemoved(rid, removed); wrote(null, rid); return r; },
        });
        reFanOwedChat(id);   // what a restart still owes this circle goes out again (idempotent)
        // The UNSIGNED inbound door only exists for the mirror-carry composition (no device log — the
        // legacy shape). A device-log composition publishes every type as a SIGNED lane statement and
        // receives through the rail's verify gate, so leaving this door open there would re-admit
        // unsigned writes beside the gate the lanes enforce.
        if (!opts.deviceLog) {
          wireCircleStoreInbound({
            notifyEnvelope: circleSubstrate.notifyEnvelope,
            store:          circleStore,
            prefix:         `/household/circles/${id}/items/`,
          });
        }
        circleSyncWired.add(id);
        if (typeof console !== 'undefined') {
          console.info(`[circle-sync] ${id}: ${opts.deviceLog ? 'lane-carried (signed; unsigned inbound door closed)' : 'store<->mirror wired'}`);
        }
      }
    } catch (err) {
      // Best-effort by design — the op must still run locally — but silence here means "items never
      // sync" and looked identical to "items sync fine" (2026-08-03). Say which one it was.
      if (typeof console !== 'undefined') {
        console.warn(`[circle-sync] ${id}: store<->mirror NOT wired — items will not fan out`, err?.message ?? err);
      }
    }
  }
  // Legacy bucket's mirror (back-compat default for un-scoped peer ops + the seed/demo path).
  const circleMirror = await ensureCircleMirror('household');
  // Wire the default 'household' circle's store↔mirror sync eagerly at boot so an inbound peer envelope
  // that arrives BEFORE the first local household op still ingests into the wired store.
  await ensureCircleSync('household');

  async function persistCirclePeers(circleId) {
    const m = circleMirrors.get(circleId || 'household');
    try { await householdVault?.set?.(circlePeersKey(circleId), JSON.stringify(m?.listPeers?.() ?? [])); }
    catch { /* best-effort — pairing still works in-memory this session */ }
  }
  // OBJ-2 hygiene — forget a circle's sync peers when you LEAVE it: drop its persisted roster + clear the
  // live mirror's peers, so a left/dead circle stops HI-pinging offline peers on every boot (the stale-peer
  // noise). Best-effort; the local items stay (leave keeps your data, just stops the peer fan-out).
  async function clearCirclePeers(circleId) {
    const id = (typeof circleId === 'string' && circleId) ? circleId : null;
    if (!id) return;
    try { await householdVault?.set?.(circlePeersKey(id), '[]'); } catch { /* */ }
    const m = circleMirrors.get(id);
    if (m) { try { for (const p of (m.listPeers?.() ?? [])) m.removePeer(p); } catch { /* */ } }
  }
  // OBJ-2 catch-up — the mirror fans out NEW writes only, so a freshly-paired peer never sees the
  // EXISTING list. When a GENUINELY new peer is added we re-publish that circle's current open items
  // (etag-deduped by the receiver), so both sides converge. Per-circle.
  async function republishCircleItemsToNewPeer(circleId) {
    const id = circleId || 'household';
    let items = [];
    try { items = await householdApp.listOpen(householdService.stores.getStore(id), {}); } catch { return; }
    // A catch-up republish rides the SIGNED lane only (the unsigned mirror carry is deleted). Without an
    // emitter there is nothing safe to republish over: on a device-log composition that is a loud skip
    // (the emitter is handed over after boot; the catch-up recurs on the next pairing), and on a
    // composition without a device log there is simply no peer carry. The check is hoisted ABOVE the
    // loop deliberately: the per-item `try` swallows errors (best-effort), so a throw inside it would
    // be silent.
    if (!taskEmit) {
      if (opts.deviceLog) {
        console.warn(
          `[circle-sync] ${id}: skipping catch-up republish — a signed lane is required and no emitter `
          + 'is wired yet.',
        );
      }
      return;
    }
    for (const it of (Array.isArray(items) ? items : [])) {
      // Every head republishes as a signed lane snapshot (the receiver's rail verifies + causally
      // merges — idempotent) — except a roster row, which travels by its own proof-keeping carriers
      // and would otherwise overwrite the peer's proven addresses with this device's view of them.
      if (isRosterTrailItem(it)) continue;
      try { if (it) taskEmit.snapshot(id, it); } catch { /* best-effort */ }
    }
  }
  // The owed RE-FAN — the durable outbox as a projection (no second store): at the first open of a
  // circle each boot, re-fan my own recent chat statements that have no logged receipt. A restart
  // therefore cannot silently break the hold promise: what was still owed goes out again, receivers'
  // rails dedup what they already have, and receipt-keyed removal stops the copies that arrive.
  const reFannedCircles = new Set();
  function reFanOwedChat(circleId) {
    if (!opts.deviceLog || !chatRail || reFannedCircles.has(circleId)) return;
    reFannedCircles.add(circleId);
    try {
      for (const owed of owedChatStatements({ eventLog: opts.deviceLog, circleId, myRef: chatId.pubKey })) {
        callSkill('stoop', 'broadcastCircleChatStatement', {
          groupId: circleId, event: owed.statement, msgId: owed.msgId, ts: owed.ts,
        }).catch(() => { /* best-effort — the next boot, or the member's own catch-up, retries */ });
      }
    } catch { /* the projection is best-effort; live sends are unaffected */ }
  }

  function isNewCirclePeer(circleId, pubKey) {
    if (!pubKey) return false;
    try { return !(circleMirrors.get(circleId || 'household')?.listPeers?.() ?? []).includes(pubKey); } catch { return true; }
  }

  // `_sync` reply hint — REAL connectivity state, never a fabricated demo roster.
  // Reads this device's live household no-pod peer roster (the mirror the shell
  // feeds as a circle's members become known). Empty until real peers pair, so the
  // renderer shows the honest "saved locally; awaiting peer sync" (formatSyncHints'
  // 0-peer branch) instead of inventing offline peers. Shape stays the
  // `decentralized` SyncHints envelope the renderer + calendar already consume.
  // (Kept named `simulateSync` — the param registerCalendarSkills + the callSkill
  // adapters expect — but the value is now real, not simulated.)
  function simulateSync() {
    let peers = [];
    try { peers = circleMirror?.listPeers?.() ?? []; } catch { peers = []; }
    return { style: 'decentralized', peers, pending: [], unreachable: [] };
  }

  /* ─────────── L3 — household via the uniform route + wireSkill (the DEFAULT, legacy retired) ───────────
   * The dissolved-onto-CircleItemStore cores in `v2/householdApp.js` are registered on a DEDICATED
   * in-process household agent via `wireSkill(core, householdOp, { storeFor })` — the same
   * manifest-op-derives-the-handler mechanism B2 (tasks-v0) uses — and the `'household'` branch of
   * callSkill routes through `chatAgent.invoke(householdAgent.address, opId, parts)` so household ops
   * take the merged S1 InternalTransport fast-path AND pass the callSkill security gate.
   *
   *   • storeFor — the per-circle CircleItemStore: `householdService.stores.getStore(circleId)`.
   *     circleId is injected into the DataPart args at invoke time (below), so it resolves identically here.
   *   • `by` — the acting member.  The cores read `ctx.by`; the invoke context carries the caller as
   *     `ctx.from` (= chatId.pubKey in-process), so `withBy` threads it through.
   *   • listOpen/listTasks cores return a BARE ARRAY of items; `listWrap` boxes them in `{ items }` so
   *     invoke always yields a clean DataPart (an array would be mis-read as a Part[]).
   *   • listOpen's manifest `type` param is REQUIRED, but the dissolved app (like the legacy one) supports
   *     listOpen WITHOUT a type = "all open items across every list-type". We wire that op with a `type`-
   *     optional CLONE of the manifest op so `wireSkill`'s validation permits the no-type call; the core
   *     (householdApp.listOpen) reads the whole store when `type` is absent.  The shared manifest is
   *     untouched (addItem's `type` stays required; the standalone household app is unaffected). */
  {
    const householdId    = await restoreOrGenerate(await sealedVault(makeBrowserVault('cc-household-agent-id:')));
    householdAgent       = new Agent({ identity: householdId, transport: new InternalTransport(bus, householdId.pubKey) });
    const hhOp = (id) => {
      const found = householdManifest.operations.find((o) => o.id === id);
      if (!found) throw new Error(`realAgent L3: no household manifest op "${id}"`);
      return found;
    };
    // listOpen supports the no-type ("all open") call the legacy path allowed — clone the op with the
    // `type` param made OPTIONAL so wireSkill's required-param validation doesn't reject it.
    const typeOptional = (op) => ({
      ...op,
      params: (op.params ?? []).map((p) => (p.name === 'type' ? { ...p, required: false } : p)),
    });
    const storeFor = (ctx) =>
      householdService.stores.getStore(resolveCircleId(ctx.parts?.[0]?.data ?? {}));
    // Thread the acting member (`by`) from the invoke context into the pure core's ctx.
    const withBy   = (coreFn) => (store, a, ctx) => coreFn(store, a, { ...ctx, by: ctx.from ?? chatId?.pubKey });
    // Box the bare-array list cores so invoke returns a DataPart, not an array-mistaken-for-Parts.
    const listWrap = (coreFn) => async (store, a, ctx) => ({ items: await coreFn(store, a, ctx) });
    const wire     = (id, coreFn, op = hhOp(id)) => householdAgent.register(id, wireSkill(coreFn, op, { storeFor }));

    wire('addItem',      withBy(householdApp.addItem));
    wire('addTask',      withBy(householdApp.addTask));
    wire('markComplete', withBy(householdApp.markComplete));
    wire('claim',        withBy(householdApp.claim));
    wire('reassign',     withBy(householdApp.reassign));
    wire('removeItem',   withBy(householdApp.removeItem));  // removal is gated + attributed like the other writes
    wire('listOpen',     listWrap(householdApp.listOpen), typeOptional(hhOp('listOpen')));
    wire('listTasks',    listWrap(householdApp.listTasks));
  }

  /* ─────────── agents — the read-only "your agents" surface (2026-07-09) ───────────
   * The `apps/agents` manifest (listAgents /agents + viewAgent detail) reads the canonical
   * `@onderling/agent-registry` pod resource.  The registry is anchored on THE USER'S OWN
   * pseudo-pod: the shared substrate stack already built above for household
   * (`circleSubstrate.pseudoPod`), whose URI authority is the CHAT identity's pubKey —
   * i.e. this user's device pod, not a per-circle pod.  Mirrors the sibling bring-up
   * pattern (stoop-mobile bootstrapBundle / tasks-v0 Circle.js): `registerAgentBundle`
   * registers THIS device (the chat agent) in the resource — so the roster is non-empty
   * out of the box — and returns the live registry handle the read skills query.
   * Best-effort: a register failure falls back to a bare `createAgentRegistry` over the
   * same pod (empty roster) so the skills always register and boot never breaks.
   * The wireSkill-derived handlers live on `hostAgent` (same home as the other in-process
   * host skills); the 'agents' branch of callSkill routes through `chatAgent.invoke`. */
  let agentsTokenRegistry = null;   // issuer-side revocation list (exposed on the handle; null = degraded)
  // The READ side of the circle-membership registry, exposed OUT of the block below (where agentsRegistry
  // is scoped) so the restore-and-open boot loop can enumerate this device's circles. Default → none, so a
  // degraded/bare registry simply re-opens nothing rather than throwing at boot.
  let readSelfCircleMemberships = async () => ({});
  // Siblings follow a circle (composed below, once the sibling set is known): the registry setter — the one seam
  // every "I am in this circle now" passes (the join wizard, the create hook, the enrol consume) — fans a NEW
  // membership to the person's other devices through it.
  let circleFollowSync = null;
  // The registry handle, bridged OUT of the agents block for the host-skill ceremonies
  // (revokeDevice's tombstone write) — same outer-let idiom as its neighbours.
  let agentsRegistryRef = null;
  // Patch the wrapped-key POINTER into an EXISTING circle-membership record. Set inside the block; a
  // no-op until then. Returns false when there is no record to attach to (the key facet needs a prior
  // {handle,address} join write) — so it is safe to call at every circle-open, best-effort.
  let upsertCircleKeyRef = async () => false;
  // THE CARRIER: the registry rides its OWN pseudo-pod — a persistent local backend the shell
  // passes (`opts.registryBackend`; memory when absent, as before), and when signed in a cache-mode
  // mirror to the owner's pod, sealed to self under an opaque name (`opts.provisionRegistryMedium`, the
  // settings medium's sibling). `attach()` runs the probe gate BEFORE the self-registration below, which
  // is a write: a fresh install must never overwrite the owner's pod copy with a one-device list.
  let registryCarrierStatus = () => ({ mode: 'local', probe: null });
  const registryPseudoPod = await (async () => {
    try {
      const strategy = typeof opts.provisionRegistryMedium === 'function' ? settingsSealStrategyForIdentity(chatId) : null;
      const medium   = strategy ? await opts.provisionRegistryMedium(strategy) : null;
      const carrier  = createRegistryCarrier({
        // Sealed at rest: the registry holds who this device belongs to — the person's curated
        // properties, their circle memberships, their device names — and it held all of it in the clear.
        // The pod MIRROR was already sealed (`provisionRegistryMedium`); the LOCAL copy was not, so the
        // copy on the disk in the room was the readable one. Same content key as every other local store.
        backend: opts.registryBackend
          ? createSealingBackend({ backend: opts.registryBackend, getStrategy: () => contentSeal })
          : null,
        deviceId: chatId.pubKey,
        medium, name: medium ? registryPodName(chatId) : null,
        onKeyMismatch: () => opts.onRegistryKeyMismatch?.(),
        warn: (m) => { if (typeof console !== 'undefined') console.warn(m); },
      });
      await carrier.attach();
      registryCarrierStatus = carrier.status;
      return carrier.pseudoPod;
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[registry-carrier] unavailable — registry stays on the local substrate', err?.message ?? err);
      return circleSubstrate.pseudoPod;
    }
  })();
  {
    const agentsRegistry =
      (await registerAgentBundle({
        pseudoPod:   registryPseudoPod,
        podDeviceId: chatId.pubKey,
        agent:       chatAgent,
        opts: { capabilities: ['basis'], name: opts.agentsSelfName ?? 'basis (this device)' },
      }))
      ?? createAgentRegistry({ pseudoPod: registryPseudoPod, deviceId: chatId.pubKey });

    // Expose the default profile's circle-membership map outward (see the outer `let`): the restore-and-open
    // boot loop reads it to re-open the circles this device belongs to. Own map of the default profile —
    // that is where write-on-join records {handle,address} (id:'default').
    readSelfCircleMemberships = async () => circleMembershipsOf((await agentsRegistry.lookup('default')) ?? {});
    agentsRegistryRef = agentsRegistry;


    // Patch the wrapped-key POINTER into the default profile's membership record for a circle — a
    // FACET MERGE (the pure setter keeps handle/address). No-op if there is no record yet (nothing to
    // attach to) or the ref is absent. Only touches the OWN record; never carries a secret — `keyRef` is a
    // pod-URI pointer + posture, and every key still re-derives from the recovery phrase.
    upsertCircleKeyRef = async (circleId, keyRef) => {
      if (!circleId || !keyRef?.ref) return false;
      const cur = await agentsRegistry.lookup('default');
      if (!cur || !circleMembershipsOf(cur)[circleId]) return false;
      await agentsRegistry.register({ ...cur, properties: registrySetCircleMembership(cur.properties ?? {}, circleId, { key: keyRef }) });
      return true;
    };

    /* control ops — LIVE token binding (2026-07-09). hostAgent (the skills' home)
     * is the ISSUER: `issueCapabilityToken` signs with its identity and needs no other
     * machinery.  Neither agent composes a TOKEN REGISTRY in this factory (hostAgent is
     * built bare at the top; the chat agent gets a gate but no issuer-side list), so
     * the issuer-side revocation list is built HERE: a real vault-backed `TokenRegistry`
     * (BotAgentRegistry precedent — issue → store; revoke flips `isRevoked`, the truth
     * any enforcement gate consults).  It reaches the chat agent's PolicyEngine by being
     * PUBLISHED as `agentsTokenRegistry`, which that engine's constructed resolver reads —
     * this block does not (and cannot) push a check into an engine.  Best-effort: any
     * failure falls back to registry-only (`tokenBacked: false`, the pre-binding
     * behaviour) — never breaks boot. */
    let agentsTokens = null;
    try {
      const tokenVault = await sealedVault(opts.agentsTokenVault ?? makeBrowserVault('cc-agent-tokens:'));
      const tokenRegistry = new TokenRegistry(tokenVault);
      agentsTokens = {
        issue: async ({ subject, skill, expiresIn, constraints }) => {
          const token = await hostAgent.issueCapabilityToken({ subject, skill, expiresIn, constraints });
          await tokenRegistry.store(token);
          // Registry mirror expects an ISO string (resource.js nulls non-strings);
          // token.expiresAt is unix-ms.
          return { id: token.id, expiresAt: new Date(token.expiresAt).toISOString() };
        },
        revoke: (tokenId) => tokenRegistry.revoke(tokenId),
      };
      // `agentsTokenRegistry` IS this registry, and the chat agent's engine was already constructed
      // with a resolver that reads it (together with `surfaceGrants` and any caller-supplied list).
      // Publishing it here is therefore the whole wiring: there is no second place that pushes a
      // revocation check into an engine, and there can't be — the engine has no setter.
      agentsTokenRegistry = tokenRegistry;
    } catch { agentsTokens = null; agentsTokenRegistry = null; }

    // recovery: the platform's circle-version-store resolver (web:
    // circleVersioning.getCircleVersionStore; mobile: its RN twin) rides in
    // via opts — the recovery cores stay platform-blind (doorgeefluik).
    // Absent → listDataVersions/restoreDataVersion answer the honest
    // `no-version-store` miss.
    const versionStoreFor = typeof opts.versionStoreFor === 'function' ? opts.versionStoreFor : null;
    // install: the curated-catalogue SOURCE. A caller may inject a source via
    // opts.agentsCatalogue (wins). Otherwise, commons-governance: when curator
    // root pubKey(s) are configured, the default source is the REAL
    // endorsement-backed catalogue. G2 makes it a WEB OF TRUST — opts.commonsRoots
    // is an ARRAY of curator roots; the source WALKS the endorsement graph
    // (transitive, bounded depth) from all of them, verifies each signed
    // recommend (Ed25519 + cardHash-binding), and returns a list ranked by
    // trust-path proximity. opts.commonsRoot (single pubKey) stays a valid alias
    // → the G1 single-root special case. opts.agentsCardResolver resolves an
    // endorsed agent's Agent Card by pubKey (default injected/hermetic; the real
    // A2A well-known fetch is createWellKnownCardResolver, wired once its
    // subject→URL discovery is pinned). With no roots configured the local stub
    // keeps the install surface exercisable; the power-user override (install a
    // pasted card) works regardless of the source.
    const commonsRoots = Array.isArray(opts.commonsRoots)
      ? opts.commonsRoots.filter((r) => typeof r === 'string' && r.length > 0)
      : (typeof opts.commonsRoot === 'string' && opts.commonsRoot.length > 0 ? [opts.commonsRoot] : []);
    // commons-governance G3 — FEDERATION: the user's subscribed COMMUNITIES
    // (circles) contribute their admins as extra curator roots. `opts.communities`
    // maps a subscribed circleId → { admins, list } (the circle's admin pubKeys +
    // its admin-gated community catalogue's endorsement list); joining a community =
    // trusting its curation. Subscriptions union with the pinned `commonsRoots`
    // above; the walk (G2) still applies within each community's admin roots. The
    // community catalogue resource itself is an ordinary pod resource that CAN be
    // hosted on the community's companion node (R1-R3) — a deployment choice, not
    // wired here. With no communities configured this is inert (commonsRoots-only).
    const communitySubs = (opts.communities && typeof opts.communities === 'object')
      ? createCommunitySubscriptions({
          resolveCommunity: (id) => opts.communities[id] ?? null,
          resolveEndorsements: opts.communityCuratorEndorsements,   // optional transitive-WoT fallback
          initial: Array.isArray(opts.subscribedCommunities) ? opts.subscribedCommunities : Object.keys(opts.communities),
        })
      : null;
    let agentsCatalogue;
    if (opts.agentsCatalogue) {
      agentsCatalogue = opts.agentsCatalogue;
    } else if (communitySubs) {
      // Subscribed-community roots (live thunk) unioned with any pinned
      // commonsRoots; per-endorser records come from the subscriptions (their
      // community catalogues) plus the same shared endorsement resource pool.
      const endorsements = createEndorsementResource({ pseudoPod: circleSubstrate.pseudoPod, deviceId: chatId.pubKey });
      agentsCatalogue = createCatalogueSource({
        roots: async () => [...new Set([...commonsRoots, ...(await communitySubs.roots())])],
        resolveEndorsements: async (pk) => {
          const fromCommunities = await communitySubs.resolveEndorsements(pk);
          const pool = await endorsements.list();
          return [...fromCommunities, ...pool.filter((e) => e && e.endorser === pk)];
        },
        resolveCard: opts.agentsCardResolver ?? null,
        maxDepth:    opts.commonsMaxDepth,
      });
    } else if (commonsRoots.length > 0) {
      // Back-compat single-pool seam: each root's endorsements are read from the
      // shared-readable endorsement resource. (The general per-curator seam is
      // resolveEndorsements(pubKey); wired here as the pool the walk groups by
      // endorser so G1's single resource keeps working.)
      const endorsements = createEndorsementResource({
        pseudoPod: circleSubstrate.pseudoPod,
        deviceId:  chatId.pubKey,
      });
      agentsCatalogue = createCatalogueSource({
        endorsementResource: endorsements,
        roots:               commonsRoots,
        resolveCard:         opts.agentsCardResolver ?? null,
        maxDepth:            opts.commonsMaxDepth,
      });
    } else {
      agentsCatalogue = createStubCatalogue();
    }
    // 2.4b — owner-only CONTROL ops require 'trusted' (only the seeded in-process chat identity
    // clears it); reads (list/view) stay 'authenticated'. Chat-scoped: the shared wireSkills.js
    // `visibilityFor` + the standalone agents app are untouched.
    const TRUSTED_AGENT_OPS = new Set(['createProfile', 'grantAgent', 'revokeAgent', 'revokeGrant', 'purgeAgent', 'installAgent', 'restoreDataVersion']);
    // identity step 4 — the createProfile collaborator: derive a new profile from THIS user's owner
    // root + register it. Owner-root-backed (kept out of the dependency-free cores).
    const agentsProfiles = {
      // Creating a NAMED profile derives its key from the root — under delegation custody that is
      // a CEREMONY act (the phrase must be typed), so the door refuses honestly instead of a raw
      // "ownerRoot required" throw. The ceremony-side profile creation lands with the profiles arc.
      create: ({ profileId, name, properties }) => (ownerRoot
        ? registryCreateProfile({ registry: agentsRegistry, ownerRoot, profileId, name, properties })
        : Promise.resolve({ ok: false, reason: 'ceremony-required' })),
      // Property layer — set/read a coarse property on a profile (curate once, reuse across apps). setProperty
      // merges (setOwn) then re-registers the FULL existing entry (register replaces), preserving key/role/grants.
      setProperty: async ({ profileId, key, value }) => {
        const cur = await agentsRegistry.lookup(profileId);
        if (!cur) throw new Error(`setProperty: no such profile ${profileId}`);
        await agentsRegistry.register({ ...cur, properties: setOwn(cur.properties ?? {}, key, value) });
        return { ok: true };
      },
      getProperties: async ({ profileId }) => (await agentsRegistry.lookup(profileId))?.properties ?? {},
      // Drivers (#3) — set an OWN personal driver property: build+validate the { kind, text, tags[] } value
      // (createDriver throws on an empty driver → the core reports invalid-driver), then store it like any
      // property (setOwn merge + re-register the full entry). getDrivers filters the map to driver values.
      setDriver: async ({ profileId, key, kind, text, tags, categoryId }) => {
        const cur = await agentsRegistry.lookup(profileId);
        if (!cur) throw new Error(`setDriver: no such profile ${profileId}`);
        const driver = createDriver({ kind, text, tags, categoryId });
        await agentsRegistry.register({ ...cur, properties: setOwn(cur.properties ?? {}, key, driver) });
        return { ok: true };
      },
      // Drivers are stored like every property — mode-wrapped (`{ mode: 'own', value }`, or an inherit
      // pointer) — and `driversFromProperties` reads VALUES. Handing it the raw map returned `{}` for every
      // profile that had drivers (the walk's "written and cannot be read back by its own owner"). Resolve
      // the effective values first, which also honours a named profile inheriting from the default one.
      getDrivers: async ({ profileId }) => {
        const entries = await agentsRegistry.list();
        const byId = new Map();
        for (const e of entries ?? []) { for (const k of [e?.agentId, e?.pubKey, e?.webid]) if (k) byId.set(k, e); }
        const self = byId.get(profileId) ?? null;
        if (!self) return {};
        const getProfile = (id) => byId.get(id) ?? null;
        return driversFromProperties(effectiveProperties(getProfile, self.agentId, { defaultProfileId: 'default' }));
      },
      // Circle membership (registry restore-data) — carry a per-circle { handle, address, … } record on the
      // profile so a restored device knows its circles + the handle it used. Merge via the pure setter (keeps
      // the other circles' records), then re-register the FULL entry (preserves key/role/grants/disclosure).
      setCircleMembership: async ({ profileId, circleId, handle, address, proof, relays, key, sight }) => {
        const cur = await agentsRegistry.lookup(profileId);
        if (!cur) throw new Error(`setCircleMembership: no such profile ${profileId}`);
        const wasIn = !!circleMembershipsOf(cur)[circleId];
        const record = { handle, address };
        if (proof != null) record.proof = proof;
        if (Array.isArray(relays)) record.relays = relays;
        if (key != null) record.key = key;
        if (sight != null) record.sight = sight;   // the circle PUT AWAY (opbergen) — a field picked here, or it is dropped
        await agentsRegistry.register({ ...cur, properties: registrySetCircleMembership(cur.properties ?? {}, circleId, record) });
        // A circle this device was not in a moment ago: its siblings hear it now (L109 — every device of the person
        // is in every circle of the person). After the write, so the carry reads the record it just made; best-effort.
        if (!wasIn && profileId === 'default') circleFollowSync?.fanJoined(circleId).catch(() => { /* the sibling asks on connect */ });
        return { ok: true };
      },
      // A circle LEFT comes off the profile (2026-09-22): with the record still there a restored device re-opened a
      // circle the person had left, and the boot's reopen re-opened its store on every device.
      removeCircleMembership: async ({ profileId, circleId }) => {
        const cur = await agentsRegistry.lookup(profileId);
        if (!cur) return { ok: true, removed: false };
        if (!circleMembershipsOf(cur)[circleId]) return { ok: true, removed: false };
        await agentsRegistry.register({ ...cur, properties: registryRemoveCircleMembership(cur.properties ?? {}, circleId) });
        return { ok: true, removed: true };
      },
      // Personas — the PERSISTED per-context disclosure policy ("what this persona shares in circle X").
      // Merge via the pure disclosure setter, then re-register the FULL entry (preserves properties/key/grants).
      setDisclosure: async ({ profileId, contextId, key, enabled, rung, matchable, requestable }) => {
        const cur = await agentsRegistry.lookup(profileId);
        if (!cur) throw new Error(`setDisclosure: no such profile ${profileId}`);
        // Forward only the axes actually supplied (three independent axes);
        // the pure setter merges per-axis so one doesn't clobber the others.
        const patch = {};
        if (enabled !== undefined) patch.enabled = enabled;
        if (rung !== undefined) patch.rung = rung;
        if (matchable !== undefined) patch.matchable = matchable;
        if (requestable !== undefined) patch.requestable = requestable;
        await agentsRegistry.register({ ...cur, disclosure: setDisclosurePolicy(cur.disclosure ?? { perContext: {} }, contextId, key, patch) });
        return { ok: true };
      },
      getDisclosure: async ({ profileId }) => (await agentsRegistry.lookup(profileId))?.disclosure ?? { perContext: {} },
      // Personas — what a persona actually RELEASES in a context: its disclosure policy over its effective
      // (own + inherited-from-default) properties. Pre-loads self + default so releasedValues' SYNC getProfile
      // works; returns the coarse {key:value} that would be shared when joining/acting as this persona there.
      releaseFor: async ({ profileId, contextId, keys = [], defaultProfileId = 'default' }) => {
        const [self, dflt] = await Promise.all([agentsRegistry.lookup(profileId), agentsRegistry.lookup(defaultProfileId)]);
        const byId = { [profileId]: self, [defaultProfileId]: dflt };
        // Absent/empty keys means "release everything I disclosed HERE" — the documented persona-release
        // semantics (see getPersonaRelease's doc). Default to the keys this persona has a disclosure entry
        // for in THIS context; `releasedValues` still re-checks `enabled` per key + fail-closed-coarsens, so
        // this leaks nothing extra. Without it, the no-keys callers — the reveal-at-join carry
        // (`joinGroupState.js`) and the "About me" roster push (`personaPropsUpdate.js`) — released {} and a
        // user's picked reveal never reached the roster (#24).
        const named = (Array.isArray(keys) ? keys : []).filter(Boolean);
        const requested = named.length ? named : Object.keys(self?.disclosure?.perContext?.[contextId] ?? {});
        const request = { items: requested.map((k) => ({ key: k })) };
        return releaseFromPolicy({ getProfile: (id) => byId[id] ?? null, profileId, defaultProfileId }, request, self?.disclosure ?? { perContext: {} }, contextId);
      },
    };
    for (const { id, handler, visibility } of buildAgentSkills({ registry: agentsRegistry, tokens: agentsTokens, versionStoreFor, catalogue: agentsCatalogue, profiles: agentsProfiles })) {
      hostAgent.register(id, handler, { visibility: TRUSTED_AGENT_OPS.has(id) ? 'trusted' : visibility });
    }
    // Property layer — REGISTER the default profile (the pseudonym) ONCE so a coarse property curated at consent
    // (setProfileProperty) has a profile to land on → cross-app reuse works for the no-login participant too.
    // Guarded on lookup so a later boot never re-registers (which would wipe accumulated properties). Best-effort.
    try {
      if (!(await agentsRegistry.lookup('default'))) {
        if (ownerRoot) {
          await agentsProfiles.create({ profileId: 'default', name: 'default' });
        } else {
          // Delegation custody: no resident root to derive from — but the default profile's
          // pubKey IS the persisted chat identity, so the entry registers directly (same shape
          // createProfile produces; ownerFingerprint from the custody marker's captured tag).
          await agentsRegistry.register({
            agentId: 'default', pubKey: chatId.pubKey, agentUri: 'profile:default',
            role: 'profile', name: 'default',
            ...(custody.fingerprint ? { ownerFingerprint: custody.fingerprint } : {}),
            properties: {},
          });
        }
      }
    } catch { /* degraded (no registry) — the on-consent persist simply stays best-effort */ }

    // The enrollment's REGISTRY RECORD self-heals at boot (idempotent, AFTER the default profile is
    // ensured): an enrolled device whose delegation is not yet on the owner's registry mints +
    // root-signs it now — the root is resident under current custody, so the ceremony itself never
    // had to write a registry it could not yet see (pre-reload it was still the old install's).
    // Best-effort: a failed write retries on the next boot; circles never DEPEND on the record
    // (every address still proves itself at the roster).
    if (enrolledDevice) {
      try {
        const cur = await agentsRegistry.lookup('default');
        if (cur && !deviceDelegationOf(cur, enrolledDevice.deviceId)) {
          // The ceremony PRE-SIGNED the record into the blob (the one moment the root existed);
          // a root-custody install without one (the pre-cutover interim) mints it here instead.
          let record = enrolledDevice.record ?? null;
          if (!record && ownerRoot) {
            record = signDeviceDelegation(ownerRoot.deriveProfileAuthority('default'), {
              profileId: 'default',
              deviceId:  enrolledDevice.deviceId,
              pubKey:    deviceDelegationPubKey(deviceDerivationSeed),
            });
            if (enrolledDevice.label) record = { ...record, label: enrolledDevice.label };
          }
          if (record) {
            await agentsRegistry.register({
              ...cur,
              properties: registrySetDeviceDelegation(cur.properties ?? {}, enrolledDevice.deviceId, record),
            });
          }
        }
      } catch (err) { console.warn('[enroll] delegation registry record deferred:', err?.message ?? err); }
    }

    /* ─── REQUESTABLE BRIDGE — the HOST-WIRING seam #1 (NOTE-skills-vs-capabilities
     * volleys 2–4 · journey J6) ─────────────────────────────────────────────────
     * A peer (A) invokes a local member's REQUESTABLE offering (a skill-kind driver
     * marked `requestable` in a circle's disclosure policy). The invocation does NOT
     * execute the offering — it MINTS a `request` task in that circle ("A asks: …")
     * that the recipient (B) then handles through the ordinary task lifecycle. That
     * is the convergence: "a request to a human IS a task."
     *
     * Wired as a PEER-FACING dispatcher op — same direct-register pattern as
     * `addMember`/`resolveContact`; `from` is the A2A caller (requester A). It is NOT
     * on `manifest.js` (this is an agent-to-agent op, not a local chat/web surface —
     * exactly like addMember), so it carries NO coverage-snapshot entry.
     *
     * ARCHITECTURAL CHOICE — resolve the circle context at INVOCATION time inside the
     * handler, NOT by pre-projecting one skill per offering onto the AgentCard. A
     * member is in N circles with DIFFERENT requestable policies AND a different task
     * store per circle, and invariant #6 is one-agent — so the single dispatcher takes
     * `{ contextId, key }` and resolves the right policy + per-circle store per call.
     * Pre-projecting N per-offering handlers would fan the one agent out per circle.
     *
     * DISCOVERY/ADVERTISEMENT stays a SEPARATE seam: `offeringsToSkillDefinitions`
     * (@onderling/item-store) is the offering→AgentCard projector (NOTE volley 3) —
     * deliberately NOT built in this pass. */
    hostAgent.register('requestOffering', async ({ parts, from }) => {
      try {
        const args      = parts?.[0]?.data ?? {};
        const contextId = String(args.contextId ?? '').trim();
        const key       = String(args.key ?? '').trim();
        if (!contextId || !key) return [DataPart({ ok: false, error: 'contextId-and-key-required' })];

        // Persona for this context. No explicit persona↔circle binding exists in this
        // factory yet, so default to the 'default' profile (the no-login pseudonym) —
        // the same profile the rest of this block treats as this device's identity.
        const profileId = 'default';
        const self      = await agentsRegistry.lookup(profileId);

        // THE GUARD — a non-requestable offering mints NOTHING.
        if (!isRequestable(self?.disclosure ?? { perContext: {} }, contextId, key)) {
          return [DataPart({ ok: false, error: 'not-requestable' })];
        }

        // Find the offering — a skill-kind driver on the persona. Registry `properties`
        // are stored in the own/inherit envelope ({ mode, value }); resolve to EFFECTIVE
        // (unwrapped) values before `driversFromProperties` reads the driver shapes.
        const props  = effectiveProperties((id) => (id === profileId ? self : null), profileId, { defaultProfileId: 'default' });
        const driver = driversFromProperties(props)[key];
        if (!driver) return [DataPart({ ok: false, error: 'no-such-offering' })];
        const offering = { key, ...driver };   // stamp the key for source-provenance legibility

        // The recipient's task surface for THAT circle — the per-circle CircleItemStore
        // (the established accessor, as the household wired path uses). `recipient` is this
        // device's local household member webid — the same local webid the addMember / seed
        // / calendar host ops use, so the minted task's `forMember` is legible alongside them.
        const recipient = 'webid:local-demo-user';
        const taskStore = createTaskStore(householdService.stores.getStore(contextId), {});

        const res = await requestableSkillHandler({ taskStore, offering, recipient, contextId })({
          from,
          requestText: typeof args.requestText === 'string' ? args.requestText : undefined,
        });
        return [DataPart(res)];   // { created:true, taskId, status:'pending', task }
      } catch (e) {
        return [DataPart({ ok: false, error: e?.message ?? 'request-failed' })];
      }
    }, { visibility: 'authenticated' });
  }

  // v0.4 — household membership demo.  The real manifest declares
  // `registerName` (writes a `contact` item); the legacy `/addmember`
  // membership demo + the cross-app follow-up chain (followUps.js) still
  // reference an `addMember` op, so keep a thin shim that records the member
  // as a real contact item AND returns the `{memberName}` shape the demo +
  // membership-redemption path expect.  (registerName is also wired above via
  // the registry, reachable through the manifest's /register surface.)
  hostAgent.register('addMember', async ({ parts, from }) => {
    const args = parts?.[0]?.data ?? {};
    const name = String(args.name ?? '').trim();
    if (!name) {
      return [DataPart({ ok: false, error: 'name required' })];
    }
    try {
      await householdService.stores.getStore(homeCircleId).put(
        { type: 'contact', text: name, addedBy: from ?? 'webid:local-demo-user' },
        { by: from ?? 'webid:local-demo-user' },
      );
    } catch { /* defensive — the member reply doesn't depend on the write */ }
    return [DataPart({
      ok:         true,
      message:    `✓ Added member: ${name}`,
      memberName: name,
    })];
  });

  // v0.5 — snapshot factory for the J7 embed primitive. Consumed by
  // basis's /embed built-in.  Reads a real household item by id (or
  // id-prefix / keyword) from the store and shapes it as an ItemSnapshot.
  hostAgent.register('getChoreSnapshot', async ({ parts }) => {
    const id = String(parts?.[0]?.data?.choreId ?? '').trim();
    const open = await householdApp.listOpen(householdService.stores.getStore(homeCircleId), {});
    const target = open.find((it) => it.id === id)
      ?? (id.length >= 4 ? open.find((it) => it.id.startsWith(id.toUpperCase())) : null)
      ?? open.find((it) => it.text.toLowerCase().includes(id.toLowerCase()));
    if (!target) {
      return [DataPart({ ok: false, error: `No item with id "${id}".` })];
    }
    return [DataPart({
      id:    target.id,
      type:  target.type,
      state: 'open',
      title: target.text,
      fields: {
        state:       'open',
        assigned_to: target.claimedBy ?? target.assignee ?? 'unassigned',
      },
    })];
  });

  // v0.7.6 — resolveContact convention.  Returns webid + display
  // name when the query matches a known household member.
  hostAgent.register('resolveContact', async ({ parts }) => {
    const query = String(parts?.[0]?.data?.query ?? '').toLowerCase();
    // Demo-only contact directory (Anne/Karl/Maria). Empty in a real install so
    // resolveContact answers an honest "no contact matches" until real members
    // exist; the named contacts return only under the opt-in seedDemoData flag.
    const members = seedDemoData ? [
      { displayName: 'Anne',  webid: 'webid:anne',  handle: 'anne'  },
      { displayName: 'Karl',  webid: 'webid:karl',  handle: 'karl'  },
      { displayName: 'Maria', webid: 'webid:maria', handle: 'maria' },
    ] : [];
    const exact = members.find((m) => m.handle === query || m.displayName.toLowerCase() === query);
    if (exact) return [DataPart({ ...exact, confidence: 'exact' })];
    const fuzzy = members.find((m) => m.displayName.toLowerCase().includes(query) && query.length >= 2);
    if (fuzzy) return [DataPart({ ...fuzzy, confidence: 'fuzzy' })];
    return [DataPart({ ok: false, error: `No contact matches "${query}"` })];
  });

  /* ─── Identity: owner-root reveal + restore (step 1b) ────────────────────────
   * The ONE recovery phrase that re-derives every profile — including the feedback
   * no-login pseudonym (the default-profile chat identity). Host skills so they can
   * close over the owner root (created above); reached via callSkill('household', …).
   * Deliberately NOT the stoop `getMnemonicOnce` (that reveals the unrelated stoop
   * sub-agent seed) and NOT the shared `restoreFromMnemonic` (legacy direct-seed).
   */
  hostAgent.register('revealOwnerPhrase', async () => {
    // Re-revealable under ROOT custody. A cut-over device does not hold the phrase's seed —
    // that is the point: a stolen unlocked device cannot exfiltrate it.
    if (!ownerRoot) return [DataPart({ ok: false, error: 'phrase-not-stored' })];
    try { return [DataPart({ shown: false, mnemonic: ownerRoot.toMnemonic() })]; }
    catch (e) { return [DataPart({ ok: false, error: e?.message ?? 'reveal-failed' })]; }
  }, { visibility: 'private' });   // 2.4b — the master recovery phrase: owner-only

  /* ─── Remote surfaces: pair-a-view grants ─────────────────────────────────
   * A paired view (a browser tab, a companion node's client) holds a standing SURFACE role —
   * one capability token per op the owner picked, issued by the PROFILE's canonical identity
   * (every device derives the same one, so the token verifies at every device's door).
   * Acting arrives over A2A — `agent.invoke(owner, 'app.opId', …)` presenting the token, gated by
   * `PolicyEngine.checkInbound` and dispatched to the op `renderA2A` registered. A bespoke door used
   * to sit here doing the same verification a second time; it is gone (2026-08-19). Reading rides
   * the sealed history mirror, not these skills.
   *
   * A connection is a property of the PERSON (decided 2026-08-19): every grant/revoke is a signed
   * statement on the device log's GRANTS LANE, the registry is a fold of that lane, and statements
   * fan live to the owner's other devices — so revoking here kills every token the view still
   * holds, on THIS device by the fold and on the siblings by the fan (catch-up as the floor).
   * Durability is the log's own (no snapshot file); a composition without a device log runs the
   * lane over an ephemeral in-process log — the honest memory-only degrade, one code path.
   */
  // The lane's signer: the device-derivation identity — the delegation key on an enrolled device
  // (per-device, revocable), the profile key itself on an unenrolled first device (the floor).
  const grantsSignerPromise = (async () => {
    // The device delegation key, always: minted at enrolment or at first boot. There is no profile-key
    // fallback any more (the floor, 2026-09-16) — a device without a delegation signs nothing on this lane.
    try {
      if (enrolledDevice && deviceDerivationSeed) {
        const id = await AgentIdentity.fromSeed(deviceDerivationSeed, new VaultMemory());
        return { identity: id, ref: chatId.pubKey };
      }
    } catch { /* falls through to the refusal below */ }
    console.warn('[realAgent] no device delegation — the grants lane has no signer on this device');
    return { identity: null, ref: chatId.pubKey };
  })();
  // ONE device-set verifier instance — the trust base shared by every "my own devices" consumer
  // (the grants lane, and the roster seed below). A second instance would be a second place for
  // the rule to drift.
  const deviceSetVerifier = deviceSetBindingVerifier({
    selfPubKey: chatId.pubKey,
    // siblings bind by the AUTHORITY that signed their records — the root's fingerprint stays on this device (it seals
    // the vaults) and never meets a record
    authorityFingerprint: authorityPubKeyB64 ? ownerRootFingerprint(authorityPubKeyB64) : null,
    // The registry supplies the deny-wins tombstone + the no-record fallback. Late-bound via the
    // outer ref (null until the agents block runs) and best-effort: a degraded registry means the
    // carried record alone binds.
    lookupDelegations: async () => deviceDelegationsOf(await agentsRegistryRef?.lookup('default')),
    // The grants-floor marker (L30's closer): the first device-revoke ceremony closes the shared
    // profile-key floor — from then on only delegation-signed statements count on this lane.
    // A sibling that proved a root-signed delegation this registry does not hold is written down —
    // the row My data lists, and the one the revoke door acts on. Not a trust decision (the record
    // bound above on its own signature); the registry is just where this device keeps what it knows
    // of the person's devices.
    learnDelegation: async (rec) => {
      const cur = await agentsRegistryRef?.lookup?.('default');
      if (!cur || deviceDelegationOf(cur, rec.deviceId)) return;
      await agentsRegistryRef.register({ ...cur, properties: registrySetDeviceDelegation(cur.properties ?? {}, rec.deviceId, rec) });
    },
  });
  const grantsRail = makeGrantsRail({
    eventLog: opts.deviceLog ?? new EventLog({ initial: [], muted: [] }),
    signerFor: () => grantsSignerPromise,
    verifyBinding: deviceSetVerifier,
  });
  // MY OTHER DEVICES, resolved once and shared by everything that speaks to them — the grants lane
  // and the contact-thread fan today. Two lookups would be two places for "who am I, elsewhere" to
  // drift apart, and they must answer the same set or a revoke and a message would disagree about
  // which devices are mine.
  const ownDeviceSiblingRows = () => siblingDevices({
    callSkill: (...a) => callSkill(...a),   // lazy — the waist is composed later in this scope
    selfPubKey: chatId.pubKey,
    circleAddressFor,
    // Both sources of "my circles", as the enrol offer reads them: the registry's memberships (what a
    // restore brings back) and the item store's (what a join or a create wrote here).
    circleIds: async () => {
      const ids = new Set(Object.keys(await readSelfCircleMemberships().catch(() => ({}))));
      try {
        for (const c of ((await callSkill('stoop', 'listMyCircles', {}))?.circles ?? [])) {
          const id = typeof c === 'string' ? c : (c?.groupId ?? c?.id);
          if (typeof id === 'string' && id) ids.add(id);
        }
      } catch { /* the registry's list alone still serves */ }
      return [...ids].filter((id) => id && id !== 'household' && id !== tasksPrimaryCircleId);
    },
  });
  const ownDeviceSiblings = async () => (await ownDeviceSiblingRows()).map((d) => d.address);
  // EVERY ADDRESS THIS PERSON'S DEVICES SPEAK AS — the person-key address (shared by all my devices), the static
  // profile key, this device's per-circle addresses, my siblings' per-circle addresses. What a roster reads to
  // keep me out of my own Contacten: each of these reaches the peer graph as "someone greeted/reached", and none
  // resolves to a roster member (2026-09-19: the maker's own person address was a nameless row on their laptop).
  const ownAddresses = async () => {
    const out = new Set([personAddress(), chatId.pubKey].filter(Boolean));
    let rows = [];
    try { rows = await ownDeviceSiblingRows(); } catch { rows = []; }
    for (const d of rows) { if (d?.address) out.add(d.address); if (d?.circleId) { const mine = circleAddressFor(d.circleId); if (mine) out.add(mine); } }
    try {
      for (const c of ((await callSkill('stoop', 'listMyCircles', {}))?.circles ?? [])) {
        const id = typeof c === 'string' ? c : (c?.groupId ?? c?.id);
        const mine = id ? circleAddressFor(id) : null;
        if (mine) out.add(mine);
      }
    } catch { /* the person and sibling addresses alone still serve */ }
    return [...out];
  };
  // A DEVICE SPEAKS TO ITS SIBLING IN THE CIRCLE THEY SHARE — as this device's own address there, to
  // the sibling's. Never as the profile key: every device of the person holds it, a revoked one too,
  // and on a relay the profile address is whichever device registered it last, so a greeting answered
  // to it can land on the wrong device while the send waits out its timeout and is held (both found by
  // the revoke walk, 2026-09-14). The circle comes from the sibling table; a caller that knows it
  // already — a seed reply to a device not yet on any roster — names it in the payload.
  const sendToSibling = async (to, payload, o = {}) => {
    let circleId = typeof payload?.circleId === 'string' && payload.circleId !== OWN_DEVICES_SCOPE ? payload.circleId : null;
    if (!circleId) circleId = (await ownDeviceSiblingRows()).find((d) => d.address === to)?.circleId ?? null;
    if (!circleId) throw new Error(`not a device of mine on any circle: ${String(to).slice(0, 12)}…`);
    const { circleId: _ignored, ...rest } = o;   // eslint-disable-line no-unused-vars
    return sendCircleScoped(to, payload, { ...rest, circleId });
  };
  const grantsFan = makeGrantsFan({
    siblings: ownDeviceSiblings,
    sendToPeer: (to, payload, o) => sendToSibling(to, payload, o),
  });
  const surfaceGrants = createSurfaceGrants({
    identity: chatId,
    agentId: chatId.pubKey,
    // A read-grant change (grant with sections / re-grant / revoke — local or arrived from a
    // sibling device) reconciles the view lanes.
    onReadGrantChange: () => { viewLanesSync?.(); },
    rail: grantsRail,
    fan: grantsFan,
    // Carried on every statement so a sibling verifies the chain without the owner's registry.
    delegationRecord: enrolledDevice?.record ?? null,
  });
  // The fan's receive half, ready-made (the shells register it under GRANTS_BROADCAST): a landed
  // statement refolds the projection, so a sibling's revoke binds at THIS door live.
  const grantsPeerHandler = makeGrantsPeerHandler({
    rail: grantsRail,
    onChange: () => surfaceGrants.recompute(),
  });
  // The catch-up pair (shells register its handlers + kick requestFromSiblings on connect); a
  // landed batch refolds the projection, which is what makes an offline revoke bind before serving.
  const grantsCatchUp = makeGrantsCatchUp({
    rail: grantsRail,
    sendToPeer: (to, payload, o) => sendToSibling(to, payload, o),
    siblings: ownDeviceSiblings,
    selfPubKey: chatId.pubKey,
    onChange: () => surfaceGrants.recompute(),
  });
  // Kick the first fold; the door refuses until it lands (`isRevoked` fails closed), so a boot
  // cannot race it.
  const surfaceGrantsReady = surfaceGrants.hydrate().catch(() => false);
  // THE CONTACT-THREAD FAN: the same sibling set, carrying conversation. `contactTurnFan` is what a
  // shell hands to `createContactThreadChannel`, so every turn in either direction is offered to the
  // person's other devices at the one place all of them pass. `contactTurnHandler(applyTurn)` is the
  // receive half: the shell says what to do with a landed turn, this side says who may send one.
  const contactTurnFan = makeContactTurnFan({
    siblings: ownDeviceSiblings,
    sendToPeer: (to, payload, o) => sendToSibling(to, payload, o),
  });
  // THE ONE SIBLING CARRY (L100): my other devices as a standing peer of every circle lane. The chat and task
  // emitters hand it every statement this device WRITES (after the member fan); the lane table hands it every
  // statement that LANDS here from a member. Same sibling set, same send, as the two fans above.
  const siblingCarry = makeSiblingCarry({
    siblings: ownDeviceSiblings,
    sendToPeer: (to, payload, o) => sendToSibling(to, payload, o),
  });
  // THE PERSON'S OWN STORE (the own-devices scope): ONE per node — what the shell hands in (sealed on its medium),
  // else in memory — read by the calendar's own appointments and a host's planned work. It rides the task lane
  // between the person's OWN devices only: signed by this device's delegation key, verified by the device-set
  // binding, sealed in flight to the person's seal-to-self key (the one every enrolled device derives — the at-rest
  // key is per device and would not open on a sibling). A device that cannot sign (not enrolled) keeps it local.
  // It holds only rows of the person (or the host itself); rows a host keeps FOR OTHERS belong in a scope that never
  // fans — a household bot has no siblings, so today its one store is harmless.
  let ownStoreNow = null;
  let ownStoreMade = null;
  let ownLaneWired = false;
  const ownSeal = settingsSealStrategyForIdentity(chatId);
  function wireOwnLane() {
    if (ownLaneWired || !ownStoreNow || !taskEmit) return;
    ownLaneWired = true;
    const valve = routeTaskMirror({ circleId: OWN_DEVICES_SCOPE, emitter: taskEmit });
    // …and the composition hears what this node wrote there, as it hears a circle's writes (`opts.onCircleWrite`)
    const wrote = (item, removedId) => { try { opts.onCircleWrite?.(OWN_DEVICES_SCOPE, item ?? null, removedId); } catch { /* a listener never breaks a write */ } };
    wireStoreMirror(ownStoreNow, {
      publishItem:        (item)         => { const r = valve.publishItem(item); wrote(item); return r; },
      publishItemRemoved: (rid, removed) => { const r = valve.publishItemRemoved(rid, removed); wrote(null, rid); return r; },
    });
    // what landed for it before it was open (parked on the log) is applied now
    Promise.resolve(taskRail?.rebuildHead?.(OWN_DEVICES_SCOPE)).catch(() => {});
  }
  const getOwnStore = () => (ownStoreMade ??= (async () => {
    ownStoreNow = await (typeof opts.ownStore === 'function' ? opts.ownStore() : createOwnDevicesStore());
    wireOwnLane();
    return ownStoreNow;
  })());
  // THE PERSON KEY between my devices: the rotation ceremony hands the new version to the survivors over the
  // same sibling set and send; a landed one is stored monotonically and takes effect at once.
  // WHICH DEVICE OTHERS' DIRECT MESSAGES LAND ON (sync-policy §12): the choice, kept sealed and carried to the
  // siblings; when "is it me" flips, every relay socket re-registers the profile and person addresses with the flag.
  const primaryDevice = createPrimaryDeviceChoice({
    vault: chatVault,
    myDeviceId: enrolledDevice?.deviceId ?? custody.deviceId ?? null,
    siblings: ownDeviceSiblings,
    sendToPeer: (to, payload, o) => sendToSibling(to, payload, o),
    onChanged: (mine) => {
      Promise.resolve(secureAgentRef.current?.relays?.setPrimaryDevice?.(mine)).catch(() => {});
      registerPersonAddressOnRelays().catch(() => {});
      console.info(`[primary-device] this device is ${mine ? 'now' : 'no longer'} the primary contact address`);
    },
  });
  primaryDeviceRef.current = primaryDevice;
  await primaryDevice.load();
  const personKeySync = createPersonKeySync({
    siblings: ownDeviceSiblings,
    sendToPeer: (to, payload, o) => sendToSibling(to, payload, o),
    current: () => personKey,
    store: async (k) => {
      const landed = await storePersonKey(chatVault, k);
      if (landed) await adoptPersonKey((await loadPersonKey(chatVault)) ?? k);   // the merged entry: chain + older seeds
      return landed;
    },
    selfPubKey: chatId.pubKey,
    // My own commitment per circle, from the root's PUBLIC key every device of mine holds — no roster read.
    ownCommitmentFor: (circleId) => (authorityPubKeyB64 ? ceremonyCommitment(authorityPubKeyB64, circleId) : null),
    onLanded: ({ version }) => console.info(`[person-key] version ${version} arrived from one of my devices`),
    onRefused: (reason, from) => console.warn(`[person-key] refused a hand-over from ${String(from).slice(0, 12)}… (${reason})`),
  });
  /** My chain, for a contact's pull: the current key and the links that vouch for it from any earlier version. */
  const personKeyChainOf = () => (personKey ? { current: personKeyForContacts(), links: Array.isArray(personKey.links) ? personKey.links : [] } : null);
  /** My seed for a version — the current one, or one I rotated away from (a message sealed before the rotation). */
  const personSeedFor = (version) => (personKey?.version === version ? personKey.seed : (personKey?.previous ?? []).find((p) => p.version === version)?.seed ?? null);
  const contactRecords = async () => {
    try { return bookRowsOf(await callSkill('stoop', 'listContacts', {})); } catch { return []; }
  };
  /**
   * The PERSON an address names: an address this device has bound to an identity (a per-circle or mesh alias) resolves
   * through the same read the roster uses; a mesh address that only the contact record knows resolves through it;
   * anything else is taken as the webid itself. A direct message may go to any of these, and the seal is to the person.
   */
  const webidFor = async (addr) => {
    if (typeof addr !== 'string' || !addr) return addr;
    try { const id = sa.resolver?.pubKeyForAddr?.(addr); if (id && id !== addr) return id; } catch { /* below */ }
    return (await contactRecords()).find((c) => c?.peerAddr === addr)?.webid ?? addr;
  };
  /** A contact's row in the contact book, by their webid or by an address of theirs. */
  const contactRecordOf = async (addr) => {
    const webid = await webidFor(addr);
    return (await contactRecords()).find((c) => c?.webid === webid) ?? null;
  };
  /**
   * A CONTACT's current person key: from a circle we share (their row's root-revealed key — a close contact is a
   * two-member circle, and any shared circle serves), else from the contact book (the card, or a pulled chain).
   * Asked by any address of theirs; answered for the person.
   */
  const contactPersonKeyOf = async (addr) => {
    const webid = await webidFor(addr);
    let best = null;
    for (const circleId of (opts.circlesForPeer?.(webid) ?? [])) {
      try {
        const row = ((await callSkill('stoop', 'listGroupMembers', { groupId: circleId }))?.members ?? []).find((m) => m?.webid === webid);
        if (row?.personKey && (!best || row.personKey.version > best.version)) best = { version: row.personKey.version, pubKey: row.personKey.pubKey };
      } catch { /* next circle */ }
    }
    if (best) return best;
    const rec = await contactRecordOf(webid);
    return rec?.personKey && Number.isInteger(rec.personKey.version) ? { version: rec.personKey.version, pubKey: rec.personKey.pubKey } : null;
  };
  const personKeyChain = createPersonKeyChain({
    chain: personKeyChainOf,
    isContact: async (addr) => !!(await contactRecordOf(addr)) || (opts.circlesForPeer?.(await webidFor(addr)) ?? []).length > 0,
    known: contactPersonKeyOf,
    adopt: async (addr, current, links) => (await callSkill('stoop', 'setContactPersonKey', { webid: await webidFor(addr), personKey: current, links }))?.personKey ?? null,
    sendToPeer: (to, payload, o) => sendCircleScoped(to, payload, { guarantee: 'hold-forward', ...o }),
    onRefused: ({ reason, from }) => console.info(`[person-key-chain] refused ${reason} from ${String(from).slice(0, 12)}…`),
  });
  const sealedWarned = new Set();
  /** The direct-message seal: to the contact's current person key, from mine — or null (unsealed, as before) when either is unknown. */
  /** The one resolution the seal uses: the contact's current key, when I hold a person key of my own to seal from. */
  const sealTargetFor = async (peerAddr) => (personKey ? await contactPersonKeyOf(peerAddr) : null);
  const contactSeal = {
    /** What a direct message to this contact is sealed to — what the thread header says. */
    statusFor: async (peerAddr) => {
      const to = await sealTargetFor(peerAddr);
      return to ? { sealed: 'person', to } : { sealed: 'device' };
    },
    sealFor: async (peerAddr, content) => {
      const to = await sealTargetFor(peerAddr);
      if (!to) {
        if (personKey && !sealedWarned.has(peerAddr)) { sealedWarned.add(peerAddr); console.info(`[contact-seal] no person key on record for ${String(peerAddr).slice(0, 12)}… — this thread stays sealed to the device only until their card or a shared circle brings one`); }
        return null;
      }
      const { sealed, nonce } = await sealToPersonKey(personKey.seed, to.pubKey, content);
      return { to, from: currentPersonKey(), sealed, nonce };
    },
    openFor: async (s, fromAddr) => {
      const seed = personSeedFor(s?.to?.version);
      if (!seed) { console.warn(`[contact-seal] a message sealed to person-key version ${s?.to?.version} — this device holds no such version`); return null; }
      const content = await openFromPersonKey(seed, s?.from?.pubKey, s);
      if (content && fromAddr && Number.isInteger(s?.from?.version)) {
        // sealed FROM a version newer than the one on record: pull their chain, so the next message seals to it
        const known = await contactPersonKeyOf(fromAddr);
        if (known && s.from.version > known.version) personKeyChain.requestFrom(fromAddr, known.version).catch(() => {});
      }
      return content;
    },
  };
  const contactTurnHandler = (applyTurn, onRefused = null) => makeContactTurnPeerHandler({
    siblings: ownDeviceSiblings,
    selfPubKey: chatId.pubKey,
    applyTurn,
    onRefused,
  });
  // WHO I KNOW, on every device of mine: the security layer's bindings and the contact book ride the
  // same sibling set. A greeting binds a key on the ONE device it landed on, and a card scanned on the
  // phone is a contact on the phone — this carries both to the person's other devices, live, to a
  // newly announced sibling in full, and on request. The contact book is read and written RAW here
  // (the stoop agent directly, not the waist), because the waist's add is what fans a row out and a
  // landed row must not fan back.
  const stoopAgentRef = { current: null };   // late-bound: the stoop agent is created further down this scope
  const rawStoop = async (opId, args = {}) => {
    const result = await chatAgent.invoke(stoopAgentRef.current.address, opId, [DataPart(args)]);
    return (Array.isArray(result) ? result[0] : null)?.data ?? null;
  };
  const rawContacts = async () => (await rawStoop('listContacts', {}))?.contacts ?? [];
  // WHO GREETED THIS DEVICE survives a reload. The security layer's bindings — "this key is Bea",
  // established by her greeting — lived in memory only, so a reload (every web session) or a restart
  // (every deploy of a box) forgot every contact, and their next message was refused as a stranger's,
  // silently: a sender greets once per session of ITS own, so nothing on their side sends the greeting
  // again. Walked 2026-09-14 (the revoke story: the reloaded web app refused the person who had been
  // writing to it all along). The snapshot is public keys, kept in the sealed chat vault like every
  // other fact about who this device knows; restored establish-never-replace, so a proof-verified
  // roster row is still the last word on any address it covers.
  const PEER_BINDINGS_VAULT_KEY = 'peer-bindings';
  let peerBindingsSaveTimer = null;
  // Frozen once this session's vaults have been resealed under the key the NEXT boot will hold (the
  // revoke ceremony's self-enrolment): this wrapper still writes under the old key, and a write after
  // the reseal would replace the carried-over snapshot with one the next boot cannot open. The ceremony
  // writes the snapshot once, just before it reseals; nothing learned in the minutes before the reload
  // is worth that. (CI, 2026-09-14: the person's binding arrived late, was saved late, and was gone.)
  let peerBindingsFrozen = false;
  const writePeerBindings = async () => {
    try { await chatVault.set(PEER_BINDINGS_VAULT_KEY, JSON.stringify(sa.agent.security?.peerBindings?.() ?? [])); }
    catch (err) { if (typeof console !== 'undefined') console.warn('[security] could not keep the peer bindings:', err?.message ?? err); }
  };
  const savePeerBindings = () => {
    if (peerBindingsSaveTimer || peerBindingsFrozen) return;
    peerBindingsSaveTimer = setTimeout(async () => {
      peerBindingsSaveTimer = null;
      if (!peerBindingsFrozen) await writePeerBindings();
    }, 250);
  };
  const freezePeerBindings = async () => {
    if (peerBindingsSaveTimer) { clearTimeout(peerBindingsSaveTimer); peerBindingsSaveTimer = null; }
    await writePeerBindings();
    peerBindingsFrozen = true;
  };
  try {
    const raw = await chatVault.get(PEER_BINDINGS_VAULT_KEY);
    const kept = raw ? JSON.parse(typeof raw === 'string' ? raw : String(raw)) : [];
    for (const b of Array.isArray(kept) ? kept : []) {
      if (typeof b?.address === 'string' && typeof b?.pubKey === 'string') sa.agent.security?.learnPeerKey?.(b.address, b.pubKey);
    }
  } catch { /* nothing kept, or unreadable — greetings establish afresh */ }
  // WHAT I SAY ABOUT MYSELF — the one `member-props` writer (the note `NOTE-member-props-on-the-membership-lane.md`):
  // one statement per circle named, only what differs from what the fold already holds for me there (`row.said`),
  // a failing circle named and retried on the next save. `sayOnRosters` is the shells' seam too (About me's "share
  // to this circle" says the persona release through it, step two 2026-09-22); `tellMyRostersWhatISay` is the
  // after-write hook's call for the name fields, over every circle I am in (pair circles included).
  const sayOnRosters = ({ circleIds = [], props = {} } = {}) => {
    if (typeof membershipEmit !== 'function') return Promise.resolve({ error: 'no-membership-rail', emitted: [], unchanged: [], failed: [] });
    return emitMemberProps(
      { emitSpine: membershipEmit, myRowIn: async (cid) => (await rawStoop('listGroupMembers', { groupId: cid }))?.members ?? [] },   // the FOLDED row: my previous member-props counts
      { from: chatId.pubKey, circleIds, props },
    );
  };
  async function tellMyRostersWhatISay() {
    if (typeof membershipEmit !== 'function') return { error: 'no-membership-rail' };
    const me = (await rawStoop('getMyProfile', {}))?.entry ?? {};
    const circles = ((await rawStoop('listMyCircles', {}))?.circles ?? [])
      .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter(Boolean);
    // Names only. The PICTURE does not ride here: it is the persona's `profilePicture` attribute and travels
    // in the per-circle RELEASE (`shareDisclosureToCircle` → `personaProperties`), re-sealed for each circle.
    // Putting it here too would be a second road for one thing — which is what happened on 2026-09-23 and was
    // taken out again.
    return sayOnRosters({ circleIds: circles, props: { handle: me.handle, displayName: me.displayName } });
  }
  const knownPeersSync = createKnownPeersSync({
    siblings: ownDeviceSiblings,
    selfPubKey: chatId.pubKey,
    sendToPeer: (to, payload, o) => sendToSibling(to, payload, o),
    snapshot: async () => ({
      peers: sa.agent.security?.peerBindings?.() ?? [],
      contacts: await rawContacts(),
    }),
    learnPeerKey: (address, pubKey) => sa.agent.security.learnPeerKey(address, pubKey),
    contacts: {
      has: async (webid) => (await rawContacts()).some((c) => c?.webid === webid),
      add: (contact) => rawStoop('addContact', contact),
      get: async (webid) => (await rawContacts()).find((c) => c?.webid === webid) ?? null,
      // a sibling's newer hidden mark lands with ITS time, so every device orders the changes the same way
      setHidden: (webid, hidden, hiddenAt, { deletedAt } = {}) => rawStoop('setContactHidden', { webid, hidden, hiddenAt, ...(Number.isFinite(deletedAt) ? { deletedAt } : {}) }),
      // …and a newer change of what the contact sees of the person (L125), by the same rule
      setPersona: (webid, persona, { revealPreset = null, personaAt } = {}) => rawStoop('setContactPersona', {
        webid, persona, ...(revealPreset ? { revealPreset } : {}), personaAt,
      }),
      // …and a newer identity link to a household bot (or its undoing), by the same rule
      setLinked: (webid, linkedRow, linkedAt) => rawStoop('addContact', { webid, linkedRow, linkedAt }),
    },
    onLanded: () => savePeerBindings(),
  });
  // THE CIRCLES THIS DEVICE IS IN, each as the entry a sibling joins from — the enrol offer's circle shape
  // (`{id, handle, address, relays}`, the address THIS device's per-circle one). Built once, for the add-a-device
  // offer and for the follow carry alike: the registry's records first, then whatever the substrate holds
  // beyond them (a pair circle made a moment ago); the same exclusions the boot's reopen makes.
  async function myCircleEntries() {
    const memberships = await readSelfCircleMemberships().catch(() => ({}));
    const ids = Object.keys(memberships);
    try {
      const r = await rawStoop('listMyCircles', {});
      for (const c of (Array.isArray(r?.circles) ? r.circles : [])) {
        const id = typeof c === 'string' ? c : (c?.groupId ?? c?.id);
        if (typeof id === 'string' && id && !ids.includes(id)) ids.push(id);
      }
    } catch { /* the registry set alone still serves */ }
    const onRelays = (() => { try { return (sa.relays?.list?.() ?? []).map((r) => r?.url).filter((u) => typeof u === 'string' && u); } catch { return []; } })();
    const out = [];
    for (const id of ids) {
      if (!id || id === 'household' || id === tasksPrimaryCircleId) continue;   // same exclusions as reopen
      const address = circleAddressFor(id);
      if (!address) continue;
      const rec = memberships[id] ?? null;
      out.push({
        id, handle: rec?.handle ?? null, address, relays: Array.isArray(rec?.relays) && rec.relays.length ? [...rec.relays] : onRelays,
        // the circle PUT AWAY (opbergen): the person's mark rides the entry, so a sibling takes the newer one
        ...(rec?.sight ? { sight: { putAway: rec.sight.putAway, at: rec.sight.at } } : {}),
      });
    }
    return out;
  }
  // SIBLINGS FOLLOW A CIRCLE (L109 option A): a circle founded or joined on any device of the person reaches the
  // others as a carry, and each joins itself by the enrol consume's per-circle step — the shells hand that step in
  // (`setConsume`, composed beside their `bootstrapFromStashedOffer`), the lane table spreads the handlers, the
  // connect kick asks the siblings what this device lacks. A kring the person switched off here is not joined.
  let circleFollowConsume = null;
  const followSelection = makeSyncSelection({ getParamValue: (key) => paramsService.register.valueOf(key) });
  // THE LEAVE FOLLOWS (2026-09-22): a sibling's `device-circle-left` lands → this device's own local leave — the exit
  // marker (no statement: the sibling's already folded the person out), the members' keys unbound, the authorize
  // snapshot dropped, the per-circle address off every relay, the registry record off. Composed here, not in the
  // shells: every part of it is the agent's (the relays included), so web ≡ mobile ≡ box by construction.
  const leaveFollowed = async (circleId) => {
    const r = await leaveCircleLocally({
      // the two hooks the hygiene needs, from the closure (the handle below exposes the same two)
      agent: { forgetPeerAddress: (address) => sa.forgetPeerAddress?.(address) ?? false, forgetCircleSenders: (cid) => circleSenders.forgetCircleSenders(cid) },
      callSkill: (app, op, args) => callSkill(app, op, args), circleId, followed: true,
      unregister: () => unregisterCircleAddressesOnRelays({
        relays: sa.relays?.list?.() ?? [], circleIds: [circleId], circleAddressFor: (cid) => circleAddressFor(cid),
      }),
    });
    return { ok: r?.ok === true, ...r };
  };
  circleFollowSync = createCircleFollowSync({
    siblings: ownDeviceSiblings,
    sendToPeer: (to, payload, o) => sendToSibling(to, payload, o),
    myEntries: myCircleEntries,
    myLeft: async () => { try { return (await rawStoop('listMyCircles', {}))?.left ?? []; } catch { return []; } },
    isIn: async (circleId) => (await myCircleEntries()).some((e) => e.id === circleId),
    kringOn: (circleId) => followSelection.kringOn(circleId),
    consume: (entry) => (typeof circleFollowConsume === 'function'
      ? circleFollowConsume(entry)
      : Promise.resolve({ circleId: entry.id, ok: false, steps: [], error: 'no-consume' })),   // a composition without the step joins nothing
    leave: leaveFollowed,
    // PUT AWAY (opbergen): the mark lives on the circle's registry record (restore carries it); a sibling's newer lands
    sightOf: async (circleId) => (await readSelfCircleMemberships().catch(() => ({})))?.[circleId]?.sight ?? null,
    setSight: (circleId, sight) => callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId, sight }),
    onLanded: (r) => console.info(`[circle-follow] ${r.steps.includes('left') ? (r.ok ? 'left' : 'could not leave') : (r.ok ? 'joined' : 'could not join')} ${String(r.circleId).slice(0, 12)}… after a sibling (${r.steps.join(' ')})`),
  });
  circleFollowSync.setConsume = (fn) => { circleFollowConsume = typeof fn === 'function' ? fn : null; };
  // LIVE, the key half: a greeting that passed the hello gate just bound a key here. The core agent
  // says so (`peer`) for the initial HI and for the ack alike, so both directions of first contact
  // reach the siblings — and the vault.
  sa.agent.on?.('peer', ({ address }) => {
    const pubKey = sa.agent.security?.getPeerKey?.(address);
    if (typeof address === 'string' && address && pubKey) knownPeersSync.fanPeer({ address, pubKey }).catch(() => {});
    savePeerBindings();
  });
  // A REFUSED envelope says so, once per sender and reason. The security layer refuses silently
  // toward the sender by design (an attacker learns nothing), and until now silently toward US too:
  // the wire transports re-emit their `security-error` on the agent and nothing listened, so a
  // person whose greeting reached one device and whose message reached another simply saw nothing
  // arrive. Counted per reason, so a diagnostic can read it; warned once per pair, so a log stays
  // readable under a storm.
  const refusedInbound = new Map();
  const refusedInboundWarned = new Set();
  sa.agent.on?.('security-error', (err, raw) => {
    const code = err?.code ?? 'SECURITY_ERROR';
    refusedInbound.set(code, (refusedInbound.get(code) ?? 0) + 1);
    const from = typeof raw?._from === 'string' ? raw._from : '?';
    const key = `${code}:${from}`;
    if (refusedInboundWarned.has(key)) return;
    refusedInboundWarned.add(key);
    if (typeof console !== 'undefined') {
      console.warn(`[security] refused an inbound envelope from ${from.slice(0, 12)}… (${code}) — ${String(err?.message ?? err).slice(0, 160)}`);
    }
  });


  // THE ROSTER SEED (pod-less enroll S1): a freshly enrolled sibling asks THIS device for a
  // circle's membership-redemption trail rows — the head its roster projection folds statements
  // onto. Both halves verify through the ONE device-set verifier above; the shells register the
  // two subtypes and `consumeEnrollOffer` sends the request.
  const rosterSeed = {
    subtypes: ROSTER_SEED_SUBTYPES,
    buildRequest: (circleId, replyTo) => buildRosterSeedRequest({
      signer: grantsSignerPromise,
      delegationRecord: enrolledDevice?.record ?? null,
      circleId, replyTo,
    }),
    onRequest: makeRosterSeedServer({
      callSkill: (...a) => callSkill(...a),   // lazy — the waist is composed later in this scope
      signerPromise: grantsSignerPromise,
      delegationRecord: enrolledDevice?.record ?? null,
      verifyDeviceSet: deviceSetVerifier,
      selfPubKey: chatId.pubKey,
      // The ONE own-device message that speaks as the person: the requester has no roster yet, so its
      // sender gate admits nothing but the person's own keys until this parcel lands — and the parcel is
      // what it verifies by, root-signed delegation and all. "As the person" is the current PERSON KEY
      // (2026-09-16), never the static profile key. Everything after it speaks per-circle.
      sendToPeer: async (to, payload) => {
        if (personAddress()) await registerPersonAddressOnRelays();   // the relay must hold the person address before it speaks
        return sa.peer.sendTo(to, payload, { guarantee: 'hold-forward', ...(personAddress() ? { sendAs: personAddress() } : {}) });
      },
      // The introduce-back (see the serve): the fresh sibling can only bind statements THIS
      // device signs once it holds this device's per-circle address as a proven fact.
      ownAnnouncement: (cid) => ownCircleAddressAnnouncement({
        circleId: cid,
        memberWebid: chatId.pubKey,
        circleAddressFor,
        signCircleAddress: (cid2, address) => signCircleLinkFromSeed(deviceDerivationSeed, cid2, cid2, address),
        ceremonyCommitmentFor, signCeremonyCommitment,
      }),
    }),
    onBatch: makeRosterSeedReceiver({
      callSkill: (...a) => callSkill(...a),
      verifyDeviceSet: deviceSetVerifier,
      selfPubKey: chatId.pubKey,
      // `api` is this agent's surface, composed further down this scope; the handler only runs once it is.
      refreshBindings: (cid) => bindCircleAddressKeysFor({ agent: api, circleId: cid }),
    }),
  };

  hostAgent.register('grantSurface', async ({ parts }) => {
    const d = parts?.[0]?.data ?? {};
    const viewPubKey = typeof d.viewPubKey === 'string' ? d.viewPubKey.trim() : '';
    const ops = Array.isArray(d.ops) ? d.ops.filter((o) => typeof o === 'string' && o.length > 0) : [];
    if (!viewPubKey || ops.length === 0) {
      return [DataPart({ ok: false, error: 'viewPubKey-and-ops-required' })];
    }
    try {
      const expiresIn = (typeof d.expiresInDays === 'number' && d.expiresInDays > 0)
        ? d.expiresInDays * 24 * 60 * 60 * 1000 : undefined;
      const r = await surfaceGrants.grant({
        viewPubKey, ops,
        // `reads` — the sections this view may SEE ({circles, kinds, device}); compiles to its
        // own sealed mirror lane (the "edition"). Omitted → acting only, no lane.
        reads: d.reads ?? null,
        label: typeof d.label === 'string' && d.label.trim() ? d.label.trim() : null,
        ...(expiresIn ? { expiresIn } : {}),
        // the person the screen acts as, when this agent answers for several (a household bot); else its own
        ...(typeof d.actingAs === 'string' && d.actingAs ? { actingAs: d.actingAs } : {}),
      });
      // The lane reconciler runs on the grant hook; surface its honest state: a read grant with
      // the mirror OFF (or no backend) yields no lane until the mirror runs.
      const laneActive = !!r.reads && paramsService.register.valueOf(HISTORY_MIRROR_PARAM_KEY) === true
        && typeof opts.provisionHistoryMirror === 'function' && !!opts.deviceLog;

      // PAIRING: when the grant answers an offer (`nonce`), deliver it to the view — which is
      // reachable at its own pubkey, because that is the address it registered when it made the
      // offer. Best-effort and non-fatal: the grant EXISTS either way (it is in the registry and
      // the door will honour it), so a delivery failure must not read as "pairing failed" when
      // what actually happened is "the tokens have not arrived yet".
      // The delivery STATE, not a boolean. `sendTo` with hold-forward does NOT throw for an
      // unreachable peer — it HOLDS and answers `{held:true}` — so treating "did not throw" as
      // "delivered" reports success for a message the view has never seen. A probe caught exactly
      // that: the owner said delivered:true while the view received nothing. This reads the send's
      // own answer instead, and uses the delivery vocabulary the app already has rather than
      // inventing a second one (`deliveryState.js`: `sent` is the weakest claim there is).
      let delivery = null;
      if (typeof d.nonce === 'string' && d.nonce) {
        try {
          const res = await (opts.deliverConnectionGrant
            ?? ((to, payload) => sa.peer.sendTo(to, payload, { guarantee: 'hold-forward' })))(
            viewPubKey,
            { subtype: CONNECTION_GRANT_SUBTYPE, nonce: d.nonce, tokens: r.tokens, label: r.label },
          );
          // An injected channel (tests, a shell) that answers nothing has still HANDED IT OVER —
          // which is `sent`, the honest weakest claim, never `delivered`.
          delivery = res?.held === true ? 'held'
            : res?.delivered === true ? 'sent'
              : res === undefined ? 'sent' : (res?.reason ?? 'sent');
        } catch { delivery = 'failed'; }
      }
      // `delivered` is kept as a convenience for the shells, and it is TRUE only for the state that
      // means the view can actually have it — a held grant is not a delivered one.
      return [DataPart({
        ok: true, ...r, laneActive,
        ...(delivery === null ? {} : { delivery, delivered: delivery === 'sent' }),
      })];
    } catch (e) { return [DataPart({ ok: false, error: e?.message ?? 'grant-failed' })]; }
  }, { visibility: 'private' });   // hands out standing acting authority: owner-only

  hostAgent.register('revokeSurface', async ({ parts }) => {
    const viewPubKey = String(parts?.[0]?.data?.viewPubKey ?? '').trim();
    if (!viewPubKey) return [DataPart({ ok: false, error: 'viewPubKey-required' })];
    return [DataPart({ ok: true, revoked: await surfaceGrants.revoke(viewPubKey) })];
  }, { visibility: 'private' });

  hostAgent.register('listSurfaceGrants', async () =>
    [DataPart({ ok: true, surfaces: surfaceGrants.list() })],
  { visibility: 'private' });

  hostAgent.register('buildEnrollOffer', async ({ parts }) => {
    // The add-a-device OFFER (`onderling-enroll://`) this EXISTING device shows: relay hint +
    // per-circle {id, handle, this device's own per-circle address} — the transport bootstrap the
    // freshly enrolled device consumes after its phrase ceremony. Public by design: no secret and
    // no phrase ride here; holding the offer lets you ask nothing (enrolling IS the phrase).
    const relayUrl = typeof parts?.[0]?.data?.relayUrl === 'string' && parts[0].data.relayUrl ? parts[0].data.relayUrl : null;
    try {
      const circles = (await myCircleEntries()).map(({ id, handle, address }) => ({ id, handle, address }));
      if (circles.length === 0) return [DataPart({ ok: false, error: 'no-circles' })];
      const uri = encodeEnrollOffer({ relays: relayUrl ? [relayUrl] : [], circles });
      return [DataPart({ ok: true, uri, circles: circles.length })];
    } catch (e) { return [DataPart({ ok: false, error: e?.message ?? 'offer-failed' })]; }
  }, { visibility: 'private' });   // enumerates the person's circles: owner-only

  // A ceremony that hands this install a NEW identity (enrolling as someone's device, restoring a phrase)
  // leaves the identity it ran under behind at the reload — but that identity's own row in the member map
  // persists with the cache, and the circle fan's no-trail path reads the map. Measured on the first
  // personal box (2026-09-18): the runner had booted once unenrolled, as a throwaway profile, and after
  // the enrolment kept greeting that former self in every circle — three failed deliveries a boot, an
  // address nobody holds. The row is retired here, at the moment the ceremony succeeds and the running
  // identity is known to be the one going away. Best-effort: the map is a display cache, not a record.
  const retireCurrentSelfRow = async () => {
    const bundle = stoopAgentRef.current?.bundle;
    const members = bundle?.members;
    if (!members || typeof members.removeMember !== 'function') return;
    try {
      await members.removeMember(chatId.pubKey);
      // Both ceremonies end in a reload or a process exit; the cache's debounced save would not make it.
      await bundle.flushLocal?.();
    } catch { /* a stale row is noise, not a failure of the ceremony */ }
  };

  hostAgent.register('enrollDevice', async ({ parts }) => {
    // The ENROLLMENT CEREMONY (add-a-device): the phrase is typed on THIS — the NEW — device,
    // never on one that already has authority. Restore the owner root (the same one
    // implementation both restore doors use) AND write this install's delegation blob, sealed to
    // the restored root. After the reload, boot does the rest by existing machinery: the
    // derivation cutover (per-circle keys from the delegation seed), the registry record
    // self-heal, reopenMemberCircles, and the per-circle boot re-announce that lands this
    // device's addresses in every roster's set. The phrase itself is never persisted.
    const mnemonic = String(parts?.[0]?.data?.mnemonic ?? '').trim();
    const label = typeof parts?.[0]?.data?.label === 'string' ? parts[0].data.label.trim() : '';
    try {
      // The THROWAWAY self's circle ids, read while its registry is still this device's. The clear that
      // follows on the next boot is named after them, and by then there is no agent to ask.
      let throwawayCircleIds = [];
      try { throwawayCircleIds = circleIdsFrom(await rawStoop('listMyCircles', {})); }
      catch { /* a registry that cannot be read leaves the named stores to the list's own constants */ }
      const r = await restoreOwnerRoot({
        mnemonic, rootKeyStore, chatVault: chatVaultBacking, markerVault: ownerRootVault,
        enrollDevice: { ...(label ? { label } : {}) }, throwawayCircleIds,
      });
      if (!r.ok) {
        const outcome = (r.code === 'invalid' || r.code === 'empty') ? 'invalid-phrase' : 'error';
        return [DataPart({ ok: false, outcome, error: r.detail ?? r.code })];
      }
      await retireCurrentSelfRow();
      // …and the shell clears what the THROWAWAY self wrote before it reloads. This install was nobody's until
      // now — it booted unenrolled, with an identity and content of its own — and the ceremony has just replaced
      // the content key those bytes were sealed under. The box has swept them since 2026-09-14; `clearContent`
      // is how web and mobile are told to do the same, on the success path only. The list is
      // `src/v2/enrolForgets.js`; each shell hands only its own storage adapter.
      // No `clearContent` flag: the ceremony has left a `forget-pending` note in the vault and every shell
      // reads it as the first awaited act of its next boot. A flag on this return was reachable only by a
      // caller that paints the flow — the walk, and any direct caller of this op, went straight past it.
      return [DataPart({ ok: true, reloadRequired: true, deviceId: r.deviceId })];
    } catch (e) { return [DataPart({ ok: false, outcome: 'error', error: e?.message ?? 'enroll-failed' })]; }
  }, { visibility: 'private' });   // overwrites the owner root + enrolls: owner-only

  /* ─── The ceremony primitives shared by revokeDevice and replaceDevice ───────────────────────
   * `verifyOwnerPhrase` — the typed phrase is THIS owner's (root custody compares fingerprints; delegation
   * custody re-derives this device's delegation seed). `retireAddresses` — per circle, the self-subject
   * `address-revoke` with the ROOT REVEAL (core ceremonyCommitment.js), fanned to every member, plus the
   * producer-side key rotation when this device holds the circle's producer. `tombstoneDevice` — the
   * registry record flipped (or minted already revoked) and the grants floor closed. */
  let selfEnrolledThisSession = false;   // the revoke ceremony migrated this root-custody device; a reload is pending
  const verifyOwnerPhrase = (mnemonic) => {
    let root;
    try { root = Bootstrap.fromMnemonic(String(mnemonic ?? '').trim()); }
    catch { return { ok: false, outcome: 'invalid-phrase' }; }
    if (ownerRoot) {
      if (root.fingerprint() !== ownerRoot.fingerprint()) return { ok: false, outcome: 'wrong-phrase' };
    } else {
      const rederived = deriveDeviceSeed(root.deriveAgentSeed('default'), custody.deviceId);
      const held = custodySeed;
      const same = held instanceof Uint8Array && rederived.length === held.length && rederived.every((v, i) => v === held[i]);
      if (!same) return { ok: false, outcome: 'wrong-phrase' };
    }
    return { ok: true, root };
  };
  const retireAddresses = async ({ root, addressFor, circleIds, includeOwn = false }) => {
    const revokedIn = [];
    for (const circleId of circleIds) {
      if (typeof membershipEmit !== 'function') break;
      const address = addressFor(circleId);
      // Never retire the address this device presents — except at the one moment it is leaving it
      // (the self-enrol migration, which has already introduced the address it moves to).
      if (!address || (!includeOwn && address === circleAddressFor(circleId))) continue;
      const reveal = signCeremonyReveal(root.deriveProfileAuthority('default'), { circleId, kind: 'address-revoke', subject: address, authorRef: chatId.pubKey });
      const stmt = await membershipEmit({
        kind: 'address-revoke', circleId, subject: address,
        payload: { by: chatId.pubKey, reveal }, actor: chatId.pubKey,
      }).catch(() => null);
      if (stmt) revokedIn.push({ circleId, address });
      try {
        await opts.stoopControlAgent?.revokeRecipient?.({ groupId: circleId, publicKey: sealingPublicKeyFromNetworkKey(address), policy: 'ban' });
      } catch { /* sealing degrades gracefully — the statement above is the transport island-ing */ }
    }
    return revokedIn;
  };
  const bounded = (p, ms = 3000) => Promise.race([p, new Promise((res) => { setTimeout(res, ms); })]);
  const tombstoneDevices = async ({ root, deviceIds }) => {
    const known = {};
    try {
      const cur = await bounded(agentsRegistryRef?.lookup?.('default'));
      if (!cur) return known;
      let props = cur.properties ?? {};
      for (const deviceId of deviceIds) {
        const rec = deviceDelegationOf(cur, deviceId);
        known[deviceId] = !!rec;
        if (!rec) {
          const revokedSeed = deriveDeviceSeed(root.deriveAgentSeed('default'), deviceId);
          const minted = signDeviceDelegation(root.deriveProfileAuthority('default'), { profileId: 'default', deviceId, pubKey: deviceDelegationPubKey(revokedSeed) });
          props = registrySetDeviceDelegation(props, deviceId, { ...minted, revoked: true });
        } else if (rec.revoked !== true) {
          props = registrySetDeviceDelegation(props, deviceId, { revoked: true });
        }
      }
      if (props !== (cur.properties ?? {})) await bounded(agentsRegistryRef.register({ ...cur, properties: props }));
    } catch { /* tombstones are best-effort bookkeeping — the statements are the enforcement */ }
    return known;
  };

  hostAgent.register('replaceDevice', async ({ parts }) => {
    // THE REPLACE CEREMONY (one ceremony for both restore intents): this — the NEW — device, restored
    // with the phrase and holding the registry again, retires every other device the registry lists,
    // plus the first device (its id derives from the root, so it needs no record), in every circle it belongs to. Before
    // each retirement it unwraps the group-key chain with the retired device's re-derived sealing key and
    // keeps the raw keys in the history sidecar, so sealed history opens here with nobody else online.
    // Where this device is an admin, the circle's group key is then rotated to the survivors (this device
    // included) through the key lane, so a walked-away phone cannot read what comes next. The wizard's
    // question (broken or stolen) decides what the screen says, never what this ceremony does.
    const check = verifyOwnerPhrase(parts?.[0]?.data?.mnemonic);
    if (!check.ok) return [DataPart({ ok: false, outcome: check.outcome, error: check.outcome })];
    const { root } = check;
    const profileSeed = root.deriveAgentSeed('default');
    const myDeviceId = enrolledDevice?.deviceId ?? custody.deviceId ?? null;
    try {
      // The retired derivation roots: every other device on the registry, and the profile seed itself when
      // this device does not derive from it (the unenrolled first device's addresses).
      const retired = [];
      try {
        const cur = await bounded(agentsRegistryRef?.lookup?.('default'));
        for (const [deviceId, rec] of Object.entries(deviceDelegationsOf(cur))) {
          if (deviceId === myDeviceId || rec?.revoked === true) continue;
          retired.push({ deviceId, seed: deriveDeviceSeed(profileSeed, deviceId) });
        }
      } catch { /* no registry → only the profile address can be retired */ }
      // The FIRST device (its id derives from the root — identity/deviceDelegation.js): retired by derivation even
      // when this device never saw its registry record, exactly as its profile-derived address used to be.
      // its WIRE id: the first device shows (and derives its seed from) the persona-keyed id of its root-derived one
      const firstId = wireDeviceId(profileSeed, firstDeviceIdFor(root));
      if (myDeviceId !== firstId && !retired.some((r) => r.deviceId === firstId)) {
        retired.push({ deviceId: firstId, seed: deriveDeviceSeed(profileSeed, firstId) });
      }

      const circleIds = Object.keys(await readSelfCircleMemberships().catch(() => ({})))
        .concat(Array.isArray(parts?.[0]?.data?.circleIds) ? parts[0].data.circleIds : []);
      const circles = [...new Set(circleIds)];
      let historyKeys = 0;
      // 1. absorb: what the retired devices could open with a DERIVABLE key, this device now holds. Two
      //    key families derive from the phrase: a device's per-circle address key, and the profile's chat
      //    identity (one per person). A group key wrapped only to an old device's random per-circle vault
      //    key is not derivable — that one needs an admin's re-grant.
      for (const { seed } of retired) {
        for (const circleId of circles) {
          try {
            const events = await keyEventsFromRail(keyRail, circleId);
            if (!events.length) continue;
            const openers = [];
            try { openers.push((await circleIdentity(seed, circleId, new VaultMemory())).sharedCopyOpener(deviceSharedCopyOpener)); } catch { /* no address key */ }
            try { openers.push((await AgentIdentity.fromSeed(profileSeed, new VaultMemory())).sharedCopyOpener(deviceSharedCopyOpener)); } catch { /* no profile key */ }
            for (const opener of openers) {
              historyKeys += await absorbHistoryKeys(circleId, readKeyChain(events, { groupId: circleId, opener }));
            }
          } catch { /* a circle with no chain, or a key this seed never held — nothing to absorb */ }
        }
      }
      // 2. rotate where this device is an admin — BEFORE the retirement: a statement's binding is re-read
      //    against the roster, so the chain the old address established must be folded while that address
      //    still binds. The next version goes to the survivors, this device included, never to a retired key.
      const rotated = [];
      const retiredSealingFor = (circleId) => new Set(retired.map(({ seed }) => sealingPublicKeyFromNetworkKey(deriveCircleAddress(seed, circleId))));
      for (const circleId of circles) {
        try {
          const roster = await callSkill('stoop', 'listGroupMembers', { groupId: circleId });
          const me = (Array.isArray(roster?.members) ? roster.members : []).find((m) => (m.webid ?? m.addr ?? m.ref) === chatId.pubKey);
          if (me?.role !== 'admin' || typeof keyEmit !== 'function') continue;
          const events = await keyEventsFromRail(keyRail, circleId);
          const fold = foldKeyEvents(events, { groupId: circleId });
          if (!fold?.recipients?.length) continue;
          const gone = retiredSealingFor(circleId);
          // ALREADY DONE? Another admin may have rotated this circle between our read and now. If the current
          // fold no longer names any retired address, the work exists and minting a second version off the same
          // parent would only create the honest concurrency the fold has to resolve afterwards. This decides
          // nothing — two admins who genuinely race still both land, and `collapseKeyEvents` keeps both keys —
          // it just makes the race rare instead of routine.
          if (!fold.recipients.some((r) => gone.has(r))) continue;
          const mine = sealingPublicKeyFromNetworkKey(circleAddressFor(circleId));
          const recipients = fold.recipients.filter((r) => !gone.has(r));
          if (!recipients.includes(mine)) recipients.push(mine);
          const { event, groupKey } = rotateKeyEvent({ groupId: circleId, priorEvents: events, recipients });
          const statement = await keyEmit(circleId, event);
          if (!statement) continue;
          await absorbHistoryKeys(circleId, [{ version: event.version, groupKey }]);
          await callSkill('stoop', 'broadcastCircleKeyStatement', {
            groupId: circleId, event: statement, msgId: `key:${statement?.body?.hash ?? statement?.body?.subject}`, ts: Date.now(),
          }).catch(() => {});
          rotated.push({ circleId, version: event.version });
        } catch { /* rotation is best-effort per circle — the retirement statements are the enforcement */ }
      }
      // 3. retire: the root-revealed address-revoke, per circle, per retired root
      const retiredAddresses = [];
      for (const { seed } of retired) {
        retiredAddresses.push(...await retireAddresses({ root, circleIds: circles, addressFor: (cid) => deriveCircleAddress(seed, cid) }));
      }
      // 4. tombstone the registry records
      const known = await tombstoneDevices({ root, deviceIds: retired.map((r) => r.deviceId).filter(Boolean) });
      return [DataPart({
        ok: true, outcome: 'ok',
        retiredDevices: retired.map((r) => r.deviceId).filter(Boolean),
        firstDeviceRetired: retired.some((r) => r.deviceId === firstId),
        retiredIn: retiredAddresses, circles: retiredAddresses.length, historyKeys, rotated, known,
      })];
    } catch (e) { return [DataPart({ ok: false, outcome: 'error', error: e?.message ?? 'replace-failed' })]; }
  }, { visibility: 'private' });   // retires every other device of this person: owner-only, phrase-proven

  hostAgent.register('revokeDevice', async ({ parts }) => {
    // The DEVICE-REVOCATION CEREMONY ("evict my device" — the eviction machinery pointed inward):
    // runs on a SURVIVING device with the phrase as the extra proof (the loss-takeover rule). Three
    // acts: (1) verify the phrase IS this owner's (a valid phrase for someone else refuses);
    // (2) tombstone the device's delegation on the registry ({revoked:true} — the durable subject);
    // (3) per circle, emit + fan the self-subject `address-revoke` statement for the device's
    // deterministically re-derived per-circle address — the fold then retires it on every member's
    // device: sender authorization refuses it, delivery stops trying it, statement bindings stop
    // accepting it. The revoked device becomes an island; enforcement lives at the OTHER ends.
    // Group-key rotation & per-device sealing ride the custody refinement (a recorded open call).
    const mnemonic = String(parts?.[0]?.data?.mnemonic ?? '').trim();
    const deviceId = String(parts?.[0]?.data?.deviceId ?? '').trim();
    if (!deviceId) return [DataPart({ ok: false, outcome: 'error', error: 'deviceId-required' })];
    let root;
    try { root = Bootstrap.fromMnemonic(mnemonic); }
    catch { return [DataPart({ ok: false, outcome: 'invalid-phrase', error: 'invalid-phrase' })]; }
    if (ownerRoot) {
      if (root.fingerprint() !== ownerRoot.fingerprint()) {
        return [DataPart({ ok: false, outcome: 'wrong-phrase', error: 'wrong-phrase' })];
      }
    } else {
      // Delegation custody: no resident root to compare — the typed phrase must REPRODUCE this
      // very device's delegation seed (deterministic derivation), which only the owner's phrase can.
      const rederived = deriveDeviceSeed(root.deriveAgentSeed('default'), custody.deviceId);
      const held = custodySeed;
      const same = held instanceof Uint8Array && rederived.length === held.length
        && rederived.every((v, i) => v === held[i]);
      if (!same) return [DataPart({ ok: false, outcome: 'wrong-phrase', error: 'wrong-phrase' })];
    }
    try {
      // The ceremony is DERIVATION-BASED — the registry record is bookkeeping, never a
      // prerequisite (this device may simply not have seen the enrollment's record: registries
      // are local until a pod syncs them, and the loss-takeover case is exactly a device that
      // wasn't there). Present → flip the tombstone; absent → mint the full root-signed record
      // already revoked, so the registry ends self-contained either way. `known` tells the shell
      // which case it was (the typo-feedback the UI wants), without blocking the act.
      const revokedSeed = deriveDeviceSeed(root.deriveAgentSeed('default'), deviceId);
      let known = false;
      // Best-effort bookkeeping behind a hard timeout: the STATEMENTS below are the enforcement,
      // and a registry whose sync stalls must never stall the ceremony with it.
      const bounded = (p, ms = 3000) => Promise.race([p, new Promise((res) => { setTimeout(res, ms); })]);
      try {
        const cur = await bounded(agentsRegistryRef?.lookup?.('default'));
        if (cur) {
          const rec = deviceDelegationOf(cur, deviceId);
          known = !!rec;
          let props = cur.properties ?? {};
          if (!rec) {
            const minted = signDeviceDelegation(root.deriveProfileAuthority('default'), {
              profileId: 'default', deviceId, pubKey: deviceDelegationPubKey(revokedSeed),
            });
            props = registrySetDeviceDelegation(props, deviceId, { ...minted, revoked: true });
          } else if (rec.revoked !== true) {
            props = registrySetDeviceDelegation(props, deviceId, { revoked: true });
          }
          // THE FLOOR CLOSES with the first revoke ceremony (Frits' v1 ruling — L30's closer):
          // the ceremony proved the phrase and (below) self-enrolls this device into delegation
          // custody, so every legitimate device now signs with a revocable delegation key — the
          // shared profile-key signature, the one thing the stolen device still holds, stops
          // counting on the grants lane from here on. Closed is forever.
          if (props !== (cur.properties ?? {})) {
            await bounded(agentsRegistryRef.register({ ...cur, properties: props }));
          }
        }
      } catch { /* tombstone is best-effort bookkeeping — the statements below are the enforcement */ }
      const circleIds = new Set([
        ...Object.keys(await readSelfCircleMemberships().catch(() => ({}))),
        ...(Array.isArray(parts?.[0]?.data?.circleIds) ? parts[0].data.circleIds : []),
      ]);
      // THE PERSON KEY ROTATES (binding-levels §10.5): the revoked device holds the CURRENT person key, so the
      // ceremony — the one moment the root is in hand — derives the next version, keeps it, announces it to every
      // circle ROOT-REVEALED (the only way a person-key statement binds; a device cannot mint one), and hands the
      // seed to the surviving devices over the sibling carry. BEFORE any address is retired: a survivor's gate
      // admits the hand-over only from a sibling address it still holds, and this device's own address may be
      // retired by the self-enrol migration below in the same breath (found 2026-09-16: the hand-over arrived
      // after the retire and was refused as "not a sibling"). The revoked device is kept out EXPLICITLY instead —
      // its addresses derive deterministically from the seed the ceremony is revoking.
      let personKeyVersion = null;
      try {
        const nextVersion = (personKey?.version ?? 0) + 1;
        const profileSeedNow = root.deriveAgentSeed('default');
        const nextSeed = derivePersonKeySeed(profileSeedNow, nextVersion);
        const pubKey = personKeyPubKeyB64(nextSeed);
        // The link key: derived here, used once, dropped — its public half is what every device of mine keeps.
        const linkSeed = derivePersonLinkKeySeed(profileSeedNow);
        const linkKeyPub = personKeyPubKeyB64(linkSeed);
        // The hand-over's reveals, one per circle: the root's word that THIS seed is version n of THIS person —
        // what a survivor verifies against its own commitment (personKeySync.js). Kept beside the key so a
        // sibling that asks later gets the same proof.
        const reveals = {};
        for (const circleId of circleIds) {
          reveals[circleId] = signCeremonyReveal(root.deriveProfileAuthority('default'), {
            circleId, kind: PERSON_KEY_CARRY, subject: chatId.pubKey, authorRef: chatId.pubKey,
            facts: personKeyFacts({ version: nextVersion, pubKey }),
          });
        }
        // The chain link: the LINK KEY vouches that n+1 follows n — what a contact who knew n verifies to learn n+1
        // without the root. Never signed with the seed being retired: the revoked device holds that seed and would
        // vouch for a key of its own (the hole of 2026-09-16). Older seeds are kept, so a message sealed to n still opens.
        const link = personKey ? signPersonKeyLink(linkSeed, { version: nextVersion, pubKey, prevVersion: personKey.version }) : null;
        // The seed being retired rides along explicitly: a root-custody device derived v1 at boot and never stored it.
        const previous = personKey ? [...(personKey.previous ?? []), { version: personKey.version, seed: personKey.seed }] : [];
        if (await storePersonKey(chatVault, { version: nextVersion, seed: nextSeed, reveals, links: link ? [link] : [], previous, linkKeyPub })) {
          await adoptPersonKey((await loadPersonKey(chatVault)) ?? { version: nextVersion, seed: nextSeed, reveals, linkKeyPub });
        }
        personKeyVersion = nextVersion;
        if (typeof membershipEmit === 'function') {
          for (const circleId of circleIds) {
            try {
              const reveal = signCeremonyReveal(root.deriveProfileAuthority('default'), {
                circleId, kind: PERSON_KEY_KIND, subject: chatId.pubKey, authorRef: chatId.pubKey,
                facts: personKeyFacts({ version: nextVersion, pubKey }),
              });
              await membershipEmit({ kind: PERSON_KEY_KIND, circleId, subject: chatId.pubKey, payload: { version: nextVersion, pubKey, reveal }, actor: chatId.pubKey });
            } catch (err) { console.warn(`[ceremony] person key v${nextVersion} not announced in ${circleId}: ${err?.message ?? err}`); }
          }
        }
        // The hand-over to the survivors — the revoked device's addresses excluded by derivation (see above).
        await personKeySync.carryCurrent({ exclude: [...circleIds].map((cid) => deriveCircleAddress(revokedSeed, cid)) });
      } catch (err) { console.warn(`[ceremony] the person key did not rotate: ${err?.message ?? err}`); }
      const revokedIn = await retireAddresses({ root, circleIds: [...circleIds], addressFor: (cid) => deriveCircleAddress(revokedSeed, cid) });
      // THE SELF-ENROLL MIGRATION (the per-ceremony custody cutover): a ROOT-custody device that
      // just proved the phrase migrates itself — reseal EVERY sealed vault from the root-derived
      // key to its own delegation-derived one, write the delegation blob (pre-signed record
      // included), and flip the key door + marker. The running agent still holds the old key in
      // its wrappers, so the reply asks for a reload; the next boot is a delegation boot.
      let migrated = false;
      const introduced = [];
      // Once per session: the migration leaves this running agent waiting for its reload (the vaults
      // are resealed, the addresses introduced and retired); a second ceremony before that reload
      // must not migrate it again onto yet another device id.
      if (ownerRoot && !selfEnrolledThisSession) {
        try {
          // a fresh device id is a CSPRNG internal id shown as its persona-keyed wire id (never Math.random: two
          // devices with one id would derive one key set)
          const selfDeviceId = enrolledDevice?.deviceId ?? wireDeviceId(root.deriveAgentSeed('default'), newDeviceId());
          const selfSeed = enrolledDevice
            ? deviceDerivationSeed
            : deriveDeviceSeed(root.deriveAgentSeed('default'), selfDeviceId);
          const newKey = deriveVaultAtRestKeyFrom(selfSeed);
          // The last snapshot of who this device knows, written under the key the reseal below will
          // carry over — and no write after it (see `freezePeerBindings`).
          await freezePeerBindings();
          for (const backing of sealedBackings) {
            await resealVault({ backing, oldKey: atRestKey, newKey });
          }
          const selfRecord = signDeviceDelegation(root.deriveProfileAuthority('default'), {
            profileId: 'default', deviceId: selfDeviceId, pubKey: deviceDelegationPubKey(selfSeed),
          });
          await new VaultEncrypted({ backing: chatVaultBacking, key: newKey }).set(
            DEVICE_DELEGATION_VAULT_KEY,
            JSON.stringify({ seed: seedToString(selfSeed), deviceId: selfDeviceId, record: selfRecord }),
          );
          migrated = await cutoverToDelegation({
            rootKeyStore, markerVault: ownerRootVault,
            delegationSeed: selfSeed, deviceId: selfDeviceId, fingerprint: ownerRoot.fingerprint(),
          });
          // INTRODUCE THE ADDRESSES THIS DEVICE WILL HAVE — now, while it still speaks as the ones it
          // has. A migrated device presents a fresh address per circle, and the next boot's re-announce
          // arrives signed by a key no member's roster holds: authorized nowhere, refused everywhere,
          // and the first device is a stranger in its own circles from the reload on (walked
          // 2026-09-14). So the ceremony fans each new address, with its own proof, from the address
          // every roster still authorizes — the same introduction a sibling makes for a device that
          // enrols — and records it here so the next boot finds its row current. Then the address
          // this device is leaving behind is retired, with the root it holds this once: nothing will
          // hold that key after the cutover, and a row that keeps naming it is a fan held for nobody.
          if (migrated && !enrolledDevice) {
            const rowsBefore = {};
            for (const cid of circleIds) {
              try {
                const ann = ownCircleAddressAnnouncement({
                  circleId: cid, memberWebid: chatId.pubKey,
                  circleAddressFor: (c) => deriveCircleAddress(selfSeed, c),
                  signCircleAddress: (c, address) => signCircleLinkFromSeed(selfSeed, c, c, address),
                  ceremonyCommitmentFor,
                  signCeremonyCommitment: (c, address, commitment) =>
                    signCeremonyCommitmentFromSeed(deriveCircleSeed(selfSeed, c), { circleId: c, circleAddress: address, commitment }),
                });
                if (!ann) continue;
                await callSkill('stoop', 'broadcastCircleAddresses', { groupId: cid, announcements: [ann] });
                await callSkill('stoop', 'recordCircleAddressAnnouncement', {
                  groupId: cid, memberWebid: ann.memberWebid, circleAddress: ann.circleAddress, circleAddressProof: ann.circleAddressProof,
                  ...(ann.ceremonyCommitment ? { ceremonyCommitment: ann.ceremonyCommitment, ceremonyCommitmentProof: ann.ceremonyCommitmentProof } : {}),
                });
                rowsBefore[cid] = circleAddressFor(cid);
                introduced.push({ circleId: cid, address: ann.circleAddress });
              } catch (err) { console.warn(`[custody] could not introduce this device's new address for ${cid}:`, err?.message ?? err); }
            }
            const leaving = Object.entries(rowsBefore);
            if (leaving.length) {
              const retired = await retireAddresses({
                root, circleIds: leaving.map(([cid]) => cid),
                addressFor: (cid) => rowsBefore[cid] ?? null,
                // The address this device presents is exactly the one being retired here.
                includeOwn: true,
              });
              revokedIn.push(...retired.map((r) => ({ ...r, migrating: true })));
            }
          }
          if (migrated) selfEnrolledThisSession = true;
        } catch (err) { console.warn('[custody] self-enroll migration deferred:', err?.message ?? err); }
      }
      // Every node the person owns (a companion) hears of it too — the root's own tombstone, so the revoked device
      // stops managing it; the person revokes once. Best-effort per node: one that is away hears it next time.
      const nodesTold = await tellOwnedNodesRevoked(root, deviceId);
      // …and every household bot the person's identity is linked to (the same tombstone): from then on that device's
      // turns there are a stranger's. Sent held-forward: a bot that is away hears it when it is back.
      const botsTold = await tellLinkedBotsRevoked(root, deviceId);
      return [DataPart({
        ok: true, deviceId, known, revokedIn, circles: revokedIn.length, nodesTold, botsTold,
        ...(personKeyVersion ? { personKeyVersion } : {}),
        ...(migrated ? { migrated: true, reloadRequired: true, introduced } : {}),
      })];
    } catch (e) { return [DataPart({ ok: false, outcome: 'error', error: e?.message ?? 'revoke-failed' })]; }
  }, { visibility: 'private' });   // retires a device's keys everywhere: owner-only, phrase-proven

  /* ─── The nodes a person OWNS (a companion): claimed with the code the node printed ─────────────────
   * A node is managed by a statement signed with a DEVICE's delegation key, its root-signed delegation alongside
   * (`signDeviceStatement`): the node checks the chain to the owner root it recorded at the claim, so every device of
   * the person manages it and a revoked one does not. The profile key, which every device holds, is not used. */
  const invokeNode = async (node, op, data) => {
    const peer = secureAgentRef.current?.peer;
    if (typeof peer?.invoke !== 'function') return null;
    try {
      const res = await Promise.race([
        peer.invoke(node, op, [DataPart(data)]),
        new Promise((r) => { setTimeout(() => r(null), 15_000); }),
      ]);
      // a node that answers is THERE: whatever it is still owed (a revoke that did not reach it) goes now
      if (res && op !== 'grants.revoke') queueMicrotask(() => { retryPendingRevokes(node).catch(() => {}); });
      return res ? (Parts.data(res) ?? null) : null;
    } catch { return null; }
  };
  /** A statement by THIS DEVICE for a party outside the person's devices (its delegation key; the delegation beside it). */
  const deviceStatementFor = async (domain, node, op, args = {}) => {
    const signer = await grantsSignerPromise;
    const delegation = enrolledDevice?.record ?? null;
    if (!signer?.identity || !delegation) return null;
    return signDeviceStatement({ domain, node, op, args, delegation, sign: (m) => signer.identity.sign(m) });
  };
  /** A management call to a node this person owns, signed by this device. Null when this device cannot sign. */
  const signedForNode = async (node, op, args = {}) => {
    const auth = await deviceStatementFor(STATEMENT_DOMAINS.COMPANION_MANAGE, node, op, args);
    return auth ? { ...args, auth } : null;
  };
  /** Is this address a household bot the person's identity is linked to (`/koppel`) — a contact row marked so? */
  /** Typing `/start <code>` to a bot: the admission by its card's code. */
  const ADMISSION_TURN = /^\/start(?:@\S+)?\s+\S+$/;
  /** Whether a contact's card says it is a bot (display only — the admission still has to be the person's own act). */
  const claimsBot = async (address) => {
    if (typeof address !== 'string' || !address) return false;
    try { return (await rawContacts()).some((c) => c?.bot === true && (c.webid === address || c.peerAddr === address) && !c.hidden); } catch { return false; }
  };
  const isLinkedBot = async (address) => {
    if (typeof address !== 'string' || !address) return false;
    try { return linkedBotsOf(await rawContacts()).includes(address); } catch { return false; }
  };
  /**
   * A household bot's identity-link offer, made by THIS DEVICE (`/koppel`): a statement by its delegation key for that bot
   * (op `link`, the chat identity as its argument; the root-signed delegation beside it), and the chat key's signature
   * over the same nonce — ONLY that message (domain-separated by `linkOfferMessage`, built here, never handed in). The
   * bot records the ROOT the delegation chains to. Null when this device has no delegation to sign with.
   */
  const signLinkOffer = async ({ botAddress } = {}) => {
    if (typeof botAddress !== 'string' || !botAddress) return null;
    const statement = await deviceStatementFor(STATEMENT_DOMAINS.IDENTITY_LINK, botAddress, LINK_OPS.LINK, { w: chatId.pubKey });
    if (!statement) return null;
    const webidSig = b64encode(chatId.sign(linkOfferMessage({ k: chatId.pubKey, b: botAddress, n: statement.nonce })));
    return encodeLinkOffer({ statement, webid: chatId.pubKey, webidSig });
  };
  // The bot's statement becomes a contact row, through the waist (so it carries to the person's other devices).
  const identityLinks = createIdentityLinks({
    signOffer: signLinkOffer,
    selfRoot: () => enrolledDevice?.record?.by ?? null,
    callSkill: (app, op, args) => callSkill(app, op, args),
  });
  /** Every linked bot hears a device's revocation — the root's own tombstone, which the bot verifies itself. */
  async function tellLinkedBotsRevoked(root, deviceId) {
    let bots = [];
    try { bots = linkedBotsOf(await rawContacts()); } catch { bots = []; }
    if (!bots.length) return 0;
    const revocation = signDeviceRevocation(root.deriveProfileAuthority('default'), { profileId: 'default', deviceId });
    const sent = await Promise.all(bots.map((bot) => Promise.resolve()
      .then(() => secureAgentRef.current?.peer?.sendTo(bot, { subtype: IDENTITY_LINK_REVOKE_SUBTYPE, revocation }, { guarantee: 'hold-forward' }))
      .then(() => true, () => false)));
    return sent.filter(Boolean).length;
  }
  async function tellOwnedNodesRevoked(root, deviceId) {
    let nodes = [];
    try { nodes = Object.keys(ownedNodesOf(await agentsRegistryRef?.lookup?.('default'))); } catch { nodes = []; }
    if (!nodes.length) return 0;
    const revocation = signDeviceRevocation(root.deriveProfileAuthority('default'), { profileId: 'default', deviceId });
    const told = await Promise.all(nodes.map((node) => invokeNode(node, 'manage.revokeDevice', { revocation })));
    return told.filter((r) => r?.ok === true).length;
  }
  // The enroll-device flow's first step: an add-device offer handed in (Me → Scan, a link, a paste) is kept on this
  // device for the ceremony that follows. No offer → 'no-offer' (the phrase-only path), an unreadable one → 'bad-offer'.
  // OBJ-2 mutual pairing — add the peer AND ask it to add us back (a __pairReq carrying our address + the circle), so
  // a single scan makes the no-pod sync bidirectional. No echo → no loop. ONE body: the bundle's `pairWithPeer` and the
  // declared `pairCirclePeer` op (Me → Scan read a pairing code; the circle picked from `listMyCircles`) both run it.
  async function pairCirclePeer(circleId, pubKey) {
    if (pubKey === undefined) { pubKey = circleId; circleId = resolveCircleId({}); }
    const id = (typeof circleId === 'string' && circleId) ? circleId : 'household';
    const mirror = await ensureCircleMirror(id);
    const fresh = isNewCirclePeer(id, pubKey);
    await mirror.addPeer(pubKey); await persistCirclePeers(id);
    try { await sa.peer.sendTo(pubKey, { __pairReq: { addr: chatId.pubKey, circleId: id } }); } catch { /* best-effort */ }
    if (fresh) republishCircleItemsToNewPeer(id).catch(() => {});
    return mirror.listPeers?.() ?? [];
  }
  hostAgent.register('pairCirclePeer', async ({ parts }) => {
    const d = parts?.[0]?.data ?? {};
    const addr = parsePairUri(String(d.addr ?? '').trim())?.addr ?? null;
    if (!addr || typeof d.circle !== 'string' || !d.circle) return [DataPart({ ok: false, outcome: 'bad-code' })];
    try { await pairCirclePeer(d.circle, addr); return [DataPart({ ok: true, outcome: 'paired', circle: d.circle })]; }
    catch (err) { return [DataPart({ ok: false, outcome: 'failed', error: err?.message ?? String(err) })]; }
  });

  hostAgent.register('stashEnrollOffer', async ({ parts }) => {
    const offer = parts?.[0]?.data?.offer;
    if (typeof offer !== 'string' || !offer.trim()) return [DataPart({ ok: true, outcome: 'no-offer' })];
    if (!opts.enrollOfferStorage) return [DataPart({ ok: false, outcome: 'bad-offer', error: 'no-storage' })];
    try {
      const r = await stashEnrollOffer(opts.enrollOfferStorage, offer.trim());
      return [DataPart(r?.ok ? { ok: true, outcome: 'stashed' } : { ok: false, outcome: 'bad-offer' })];
    } catch (err) { return [DataPart({ ok: false, outcome: 'bad-offer', error: err?.message ?? String(err) })]; }
  });

  hostAgent.register('claimCompanion', async ({ parts }) => {
    const claim = parseCompanionClaim(parts?.[0]?.data?.claim);
    if (!claim) return [DataPart({ ok: false, outcome: 'bad-claim' })];
    const data = await signedForNode(claim.node, 'manage.claimOwner', { code: claim.code });
    if (!data) return [DataPart({ ok: false, outcome: 'no-device-key' })];
    const res = await invokeNode(claim.node, 'manage.claimOwner', data);
    if (!res) return [DataPart({ ok: false, outcome: 'unreachable' })];
    if (res.ok !== true) {
      const outcome = ['already-owned', 'invalid-code', 'stale', 'unsigned'].includes(res.error) ? res.error : 'unsigned';
      return [DataPart({ ok: false, outcome })];
    }
    // the person's own list of the nodes they own: every device manages them, and each hears of a revoked device
    try {
      const cur = await agentsRegistryRef?.lookup?.('default');
      if (cur) {
        await agentsRegistryRef.register({
          ...cur, properties: setOwnedNode(cur.properties ?? {}, { address: claim.node, claimedAt: new Date().toISOString() }),
        });
      }
    } catch (err) { console.warn('[claimCompanion] the node is yours, but this device could not write it down:', err?.message ?? err); }
    return [DataPart({ ok: true, outcome: 'ok', node: claim.node })];
  }, { visibility: 'private' });   // makes this person a node's owner: owner-only

  /* ─── What a node the person owns lets ANOTHER agent do there (a household bot putting agenda files) ──────────────
   * Granted by FAMILY, never by op: the node names its families and maps each to its ops itself; it mints one token per
   * op to the agent's key and delivers them over the relay. Both ops sign a statement with THIS device's delegation key
   * — only for a node the person's own list says they own — and are never delegable (renderA2A's withhold list). */
  const ownedNode = async (node) => {
    if (typeof node !== 'string' || !node) return false;
    try { return Object.prototype.hasOwnProperty.call(ownedNodesOf(await agentsRegistryRef?.lookup?.('default')), node); } catch { return false; }
  };
  /** Ask a node the person owns `op`, signed by this device: `{res}` or `{outcome}` naming why it was not asked/answered. */
  const askOwnedNode = async (node, op, args) => {
    if (!(await ownedNode(node))) return { outcome: 'not-owned' };
    const data = await signedForNode(node, op, args);
    if (!data) return { outcome: 'no-device-key' };
    const res = await invokeNode(node, op, data);
    return res ? { res } : { outcome: 'unreachable' };
  };
  hostAgent.register('companionGrantChoices', async ({ parts }) => {
    const { node } = parts?.[0]?.data ?? {};
    const { res, outcome } = await askOwnedNode(node, 'grants.families', {});
    if (!res) return [DataPart({ ok: false, outcome })];
    if (res.ok !== true || !Array.isArray(res.families)) return [DataPart({ ok: false, outcome: res.error === 'stale' ? 'stale' : 'forbidden' })];
    return [DataPart({ ok: true, outcome: 'ok', families: res.families.filter((f) => typeof f === 'string') })];
  }, { visibility: 'private' });   // signs for the person's node: owner-only
  hostAgent.register('grantCompanion', async ({ parts }) => {
    const { node, to, families } = parts?.[0]?.data ?? {};
    if (typeof to !== 'string' || !to || !Array.isArray(families) || families.length === 0) return [DataPart({ ok: false, outcome: 'bad-args' })];
    // A household bot the person's identity is linked to is handed the companion FIRST, in the same act: the node's own
    // card, through the bot's one linked-app call, with this device's statement over exactly that card. The bot takes it
    // only from the person linked as its ADMIN (its door's gate decides, as for a typed line), and keeps a grant only from
    // a companion it holds as a contact — so the card goes before the tokens, and a refusal stops here.
    if (await isLinkedBot(to)) {
      const { res: asked, outcome: away } = await askOwnedNode(node, 'node.card', {});
      if (!asked) return [DataPart({ ok: false, outcome: away })];
      if (asked.ok !== true || typeof asked.card !== 'string') return [DataPart({ ok: false, outcome: asked.error === 'stale' ? 'stale' : 'forbidden' })];
      const auth = await deviceStatementFor(STATEMENT_DOMAINS.IDENTITY_LINK, to, LINK_OPS.COMPANION, { card: asked.card });
      if (!auth) return [DataPart({ ok: false, outcome: 'no-device-key' })];
      const handed = await invokeNode(to, LINKED_COMPANION_OP, { card: asked.card, auth });
      if (!handed) return [DataPart({ ok: false, outcome: 'bot-unreachable' })];
      if (handed.ok !== true) {
        const why = { 'not-admin': 'not-bot-admin', stale: 'stale' }[handed.error] ?? 'bot-refused';
        return [DataPart({ ok: false, outcome: why })];
      }
    }
    const { res, outcome } = await askOwnedNode(node, 'grants.mint', { to, families });
    if (!res) return [DataPart({ ok: false, outcome })];
    if (res.ok !== true) {
      return [DataPart({ ok: false, outcome: COMPANION_GRANT_OUTCOMES.includes(res.error) ? res.error : 'forbidden' })];
    }
    return [DataPart({ ok: true, outcome: 'ok', ops: res.ops ?? [], delivery: res.delivery ?? null })];
  }, { visibility: 'private' });   // hands another agent standing authority on the person's node: owner-only
  hostAgent.register('companionGrantList', async ({ parts }) => {
    const { node } = parts?.[0]?.data ?? {};
    const { res, outcome } = await askOwnedNode(node, 'grants.list', {});
    if (!res) return [DataPart({ ok: false, outcome })];
    if (res.ok !== true || !Array.isArray(res.grants)) return [DataPart({ ok: false, outcome: COMPANION_GRANT_OUTCOMES.includes(res.error) ? res.error : 'forbidden' })];
    const grants = res.grants.filter((g) => typeof g?.to === 'string').map((g) => ({ to: g.to, families: Array.isArray(g.families) ? g.families.filter((f) => typeof f === 'string') : [] }));
    return [DataPart({ ok: true, outcome: 'ok', grants })];
  }, { visibility: 'private' });   // signs for the person's node: owner-only
  /* Revokes OWED to a node (a contact deleted while the node was away): kept on the node's record in the person's own
   * registry (sealed, carried, restored with it), told at the next connect and whenever the node answers again. */
  const ownProfile = async () => { try { return await agentsRegistryRef?.lookup?.('default'); } catch { return null; } };
  const writeOwnProperties = async (fn) => {
    const cur = await ownProfile();
    if (!cur || !agentsRegistryRef?.register) return false;
    await agentsRegistryRef.register({ ...cur, properties: fn(cur.properties ?? {}) });
    return true;
  };
  let retrying = null;
  /** Tell the nodes what they are owed (one node, or all); a node that answers clears its debt. */
  function retryPendingRevokes(onlyNode = null) {
    if (retrying) return retrying.then(() => (onlyNode ? null : retryPendingRevokes()));
    retrying = (async () => {
      const owed = pendingRevokesOf(await ownProfile()).filter((p) => !onlyNode || p.node === onlyNode);
      for (const { node, key } of owed) {
        const { res } = await askOwnedNode(node, 'grants.revoke', { to: key });
        // told (or nothing to tell: a key the node does not take) — no longer owed; away, a clock off: kept
        if (res?.ok === true || res?.error === 'bad-target') await writeOwnProperties((p) => clearPendingRevoke(p, node, key));
      }
    })().finally(() => { retrying = null; });
    return retrying;
  }
  hostAgent.register('revokeCompanionGrant', async ({ parts }) => {
    const { node, to } = parts?.[0]?.data ?? {};
    if (typeof to !== 'string' || !to) return [DataPart({ ok: false, outcome: 'bad-args' })];
    if (node == null) {
      // every node the person owns (a contact deleted): OWED first, on the person's record, then told in the
      // background — the delete never waits on a node, and one that is away is told when it is back
      const nodes = Object.keys(ownedNodesOf(await ownProfile()));
      if (nodes.length) await writeOwnProperties((p) => addPendingRevokes(p, [to]));
      if (nodes.length) retryPendingRevokes().catch(() => {});
      return [DataPart({ ok: true, outcome: 'pending', pending: nodes.length })];
    }
    // one node, from its row on My data: the person is looking at it, so the answer is waited for
    const { res, outcome } = await askOwnedNode(node, 'grants.revoke', { to });
    if (!res) return [DataPart({ ok: false, outcome })];
    if (res.ok !== true) return [DataPart({ ok: false, outcome: COMPANION_GRANT_OUTCOMES.includes(res.error) ? res.error : 'forbidden' })];
    return [DataPart({ ok: true, outcome: 'ok', revoked: Number(res.revoked) || 0, dropped: Number(res.dropped) || 0 })];
  }, { visibility: 'private' });   // ends another agent's authority on the person's node: owner-only

  /* ─── The RECOVERY FILE: the pod-less carrier of the circle list ─────────────────────
   * Export seals the registry exactly as the pod mirror does (seal-to-self, the profile-derived key),
   * so the phrase is the only secret; import opens it with this device's key and upserts every entry
   * through the registry handle, then runs the boot re-open loop. A file sealed by someone else's
   * phrase refuses as `not-your-file`; anything that is not a recovery file as `unreadable-file`. */
  hostAgent.register('exportRecoveryFile', async ({ parts }) => {
    try {
      const strategy = settingsSealStrategyForIdentity(chatId);
      if (!strategy) return [DataPart({ ok: false, error: 'no-identity' })];
      if (!agentsRegistryRef?.reload) return [DataPart({ ok: false, error: 'no-registry' })];
      const { body } = await agentsRegistryRef.reload();
      const circleIds = Object.keys(circleMembershipsOf(body.agents.find((a) => a.agentId === 'default') ?? {}));
      // THE MEMBER LIST, per circle (Frits, 2026-09-13: "why not back up the roster itself?"): the file
      // carries each ticked circle's roster — the trail rows and the member rows, the same a sibling
      // would serve as a seed — for every circle the person ticked; all of them unless the caller says
      // otherwise (`rosters`: the ticked circle ids). Without it a restored device gets the circle's
      // name and nobody to reach (`recoveryBootstrap.js`). The device's own registry is not changed —
      // the choice belongs to the file being written.
      const ticked = Array.isArray(parts?.[0]?.data?.rosters) ? new Set(parts[0].data.rosters) : null;
      const rosters = {};
      const carried = {};
      for (const circleId of circleIds) {
        if (ticked && !ticked.has(circleId)) { carried[circleId] = null; continue; }
        let rows = [];
        let members = [];
        try {
          const all = await callSkill('stoop', 'listOpen', { type: 'membership-redemption' });
          const items = Array.isArray(all?.items) ? all.items : (Array.isArray(all) ? all : []);
          rows = items.filter((it) => it?.source?.groupId === circleId);
        } catch { rows = []; }
        try { members = (await callSkill('stoop', 'listGroupMembers', { groupId: circleId }))?.members ?? []; } catch { members = []; }
        const snap = rosterSnapshot({
          rows, members,
          // This device's proven address in the circle — the same announcement the seed serve introduces
          // itself back with (`rosterSeed`), minted while this device still holds the key.
          ownAnnouncement: ownCircleAddressAnnouncement({
            circleId, memberWebid: chatId.pubKey, circleAddressFor,
            signCircleAddress: (cid2, address) => signCircleLinkFromSeed(deviceDerivationSeed, cid2, cid2, address),
            ceremonyCommitmentFor, signCeremonyCommitment,
          }),
        });
        rosters[circleId] = snap;
        carried[circleId] = snap ? snap.members.filter((m) => m.webid !== chatId.pubKey).length : null;
      }
      const file = sealRecoveryFile({ strategy, body: bodyWithRosters({ body, rosters }) });
      return [DataPart({ ok: true, file, circles: circleIds.length, rosters: carried })];
    } catch (e) { return [DataPart({ ok: false, error: e?.message ?? 'export-failed' })]; }
  }, { visibility: 'private' });   // the sealed circle list: owner-only

  /** The circles a recovery file would carry — what the export door lists with its per-circle choice. */
  hostAgent.register('listRecoveryCircles', async () => {
    try {
      const memberships = await readSelfCircleMemberships().catch(() => ({}));
      let rows = [];
      try { rows = (await callSkill('stoop', 'listMyCircles', {}))?.circles ?? []; } catch { rows = []; }
      const nameOf = new Map(rows.map((c) => [typeof c === 'string' ? c : (c?.groupId ?? c?.id), typeof c === 'string' ? null : (c?.name ?? null)]));
      const circles = Object.keys(memberships)
        .filter((id) => id && id !== tasksPrimaryCircleId && id !== 'household')
        .map((id) => ({ id, name: nameOf.get(id) ?? null }));
      return [DataPart({ ok: true, circles })];
    } catch (e) { return [DataPart({ ok: false, error: e?.message ?? 'list-failed' })]; }
  }, { visibility: 'private' });

  const importRecoveryFileText = async (file) => {
    if (!String(file ?? '').trim()) return { ok: false, error: 'unreadable-file' };
    const strategy = settingsSealStrategyForIdentity(chatId);
    if (!strategy) return { ok: false, error: 'no-identity' };
    if (!agentsRegistryRef?.register) return { ok: false, error: 'no-registry' };
    let body;
    try { body = openRecoveryFile({ strategy, file: String(file) }); }
    catch (e) { return { ok: false, error: e?.code ?? 'unreadable-file' }; }
    try {
      let agents = 0;
      for (const entry of (Array.isArray(body?.agents) ? body.agents : [])) {
        if (!entry?.agentId) continue;
        await agentsRegistryRef.register(entry);
        agents += 1;
      }
      const { reopened } = await reopenMemberCircles();
      // THE ROSTERS the file carried land through the seed's own ingest (id-preserved, first-write-wins),
      // so the circles have members before anything is asked of anyone.
      let landed = 0;
      for (const [circleId, snap] of Object.entries(rostersOf(body))) {
        try {
          const r = await callSkill('stoop', 'recordRosterSeed', { groupId: circleId, rows: snap.rows, members: snap.members });
          if (r && !r.error) landed += 1;
          // The owner's own proven address from before the wipe — through the announce's receive door,
          // proof re-verified, so what the owner said with it binds on this device too.
          if (snap.own) {
            await callSkill('stoop', 'recordCircleAddressAnnouncement', {
              groupId: circleId, memberWebid: snap.own.memberWebid, circleAddress: snap.own.circleAddress,
              circleAddressProof: snap.own.circleAddressProof,
              ...(snap.own.ceremonyCommitment ? { ceremonyCommitment: snap.own.ceremonyCommitment, ceremonyCommitmentProof: snap.own.ceremonyCommitmentProof } : {}),
            });
          }
        } catch (err) { if (typeof console !== 'undefined') console.warn(`[restore] ${String(circleId).slice(0, 12)}…: the file's roster did not land: ${err?.message ?? err}`); }
      }
      // THE BOOTSTRAP: the members the file named become an enrol offer — the same artefact the
      // add-a-device path consumes (announce this device's fresh address to every member, pull every
      // lane from them; the roster itself is already here, so no seed is asked). Stashed where the
      // shell's boot-time consume looks, when the shell handed that storage in, so it also retries on
      // the next launch; returned as well, so the shell can consume it NOW rather than after a relaunch.
      let bootstrap = null;
      try {
        const entry = body.agents.find((a) => a?.agentId === 'default') ?? null;
        const made = bootstrapOfferFromRosters({ body, selfPubKey: chatId.pubKey, memberships: circleMembershipsOf(entry ?? {}) });
        if (made) {
          let stashed = false;
          if (opts.enrollOfferStorage) {
            try { stashed = (await stashEnrollOffer(opts.enrollOfferStorage, made.offer)).ok === true; } catch { stashed = false; }
          }
          bootstrap = { ...made, rosters: landed, stashed };
          // Consume it NOW, through the shell's own consume (it attaches `bootstrapFromStashedOffer`
          // at connect, with its presence registration and content pulls): a restored device should
          // hear its circles again on this launch, not the next. After the reply, so the door paints
          // the circles that came back while the announce and the pulls go out.
          if (stashed) setTimeout(() => { try { selfAgent?.bootstrapFromStashedOffer?.(); } catch { /* retried at the next boot from the stash */ } }, 0);
        }
      } catch { bootstrap = null; }
      return { ok: true, agents, circles: reopened, bootstrap };
    } catch (e) { return { ok: false, error: e?.message ?? 'import-failed' }; }
  };
  hostAgent.register('importRecoveryFile', async ({ parts }) => [DataPart(await importRecoveryFileText(parts?.[0]?.data?.file))],
    { visibility: 'private' });   // writes the registry: owner-only

  /* ─── The RESTORE-FINISH flow's ops: what came back, where from, and what the person wants ──────
   * Declared as the `restore-finish` flow on the household manifest; the shells paint its pauses. */
  hostAgent.register('restoreStatus', async () => {
    // Asked once: clear the note the ceremony left, whatever happens next (My data has the doors).
    try { await ownerRootVault.delete?.(RESTORE_PENDING_KEY); } catch { /* best-effort */ }
    restorePendingAtBoot = false;
    const memberships = await readSelfCircleMemberships().catch(() => ({}));
    const circles = Object.keys(memberships).filter((id) => id && id !== tasksPrimaryCircleId && id !== 'household');
    const myDeviceId = enrolledDevice?.deviceId ?? custody.deviceId ?? null;
    let otherDevices = [];
    try {
      const cur = await agentsRegistryRef?.lookup?.('default');
      otherDevices = Object.entries(deviceDelegationsOf(cur))
        .filter(([id, rec]) => id !== myDeviceId && rec?.revoked !== true)
        .map(([id, rec]) => ({ deviceId: id, label: rec?.label ?? null }));
    } catch { otherDevices = []; }
    const carrier = registryCarrierStatus();
    return [DataPart({
      ok: true, outcome: circles.length ? 'ready' : 'empty',
      circles: circles.length, circleIds: circles, otherDevices, otherDeviceCount: otherDevices.length,
      carrier: carrier?.mode === 'cache' ? 'pod' : 'local', probe: carrier?.probe ?? null,
    })];
  }, { visibility: 'private' });

  hostAgent.register('restoreSource', async ({ parts }) => {
    const source = String(parts?.[0]?.data?.source ?? '');
    if (source === 'later') return [DataPart({ ok: true, outcome: 'later', source })];
    if (source !== 'file') return [DataPart({ ok: false, outcome: 'error', error: 'source-required' })];
    const r = await importRecoveryFileText(parts?.[0]?.data?.file);
    if (!r.ok) return [DataPart({ ok: false, outcome: r.error, error: r.error, source })];
    return [DataPart({ ok: true, outcome: 'ok', source, agents: r.agents, circles: r.circles.length, circleIds: r.circles })];
  }, { visibility: 'private' });

  hostAgent.register('restoreIntent', async ({ parts }) => {
    // The question: could anyone else still use the old device? Recorded on the plain marker vault so the
    // done-screen (and a later look) can say which answer was given; it decides copy, never custody.
    const intent = String(parts?.[0]?.data?.intent ?? '');
    if (!['broken', 'lost', 'adding'].includes(intent)) return [DataPart({ ok: false, outcome: 'error', error: 'intent-required' })];
    try { await ownerRootVault.set('restore-intent', JSON.stringify({ intent, at: new Date().toISOString() })); } catch { /* best-effort */ }
    return [DataPart({ ok: true, outcome: intent, intent })];
  }, { visibility: 'private' });

  hostAgent.register('restoreOwnerPhrase', async ({ parts }) => {
    const mnemonic = String(parts?.[0]?.data?.mnemonic ?? '').trim();
    let root;
    try { root = Bootstrap.fromMnemonic(mnemonic); }
    catch { return [DataPart({ ok: false, error: 'invalid-phrase' })]; }
    try {
      // ONE implementation, shared with the first-run door (`ownerRootRestore.js`) — which used to have
      // its own, and restored nothing. The live chatAgent keeps its current identity until an app RELOAD
      // re-boots realAgent, which then finds this seed + owner root.
      const r = await restoreOwnerRoot({ mnemonic: root.toMnemonic(), rootKeyStore, chatVault: chatVaultBacking, markerVault: ownerRootVault });
      if (!r.ok) return [DataPart({ ok: false, error: r.detail ?? r.code })];
      await retireCurrentSelfRow();
      return [DataPart({ ok: true, reloadRequired: true })];
    } catch (e) { return [DataPart({ ok: false, error: e?.message ?? 'restore-failed' })]; }
  }, { visibility: 'private' });   // 2.4b — overwrites the owner root: owner-only


  /* folio's web-only handlers used to live here (~125 lines of mock-
   * real handlers registered on hostAgent). of the
   * integration-plan-2026-05-23 moved them into a dedicated browser
   * agent — see the `createBrowserFolioAgent` boot block below the
   * tasks/stoop blocks, and the 'folio' branch in `callSkill`.
   *
   * shareFolder now issues a REAL PodCapabilityToken via
   * autoShare.mintShareToken; the other skills retained their
   * placeholder reply shapes (real bytes/pod-IO is deferred to slice
   * 5 + the mobile pivot).
   */

  // The host gate's trust registry — the door sets the tier of the people it admits here (setDoorCaller).
  let hostTrustRegistry = null;
  /* Identity step 2.4a/2.4b — attach a PolicyEngine to hostAgent so scoped access is ENFORCED
   * (the gate was structurally absent: hostAgent.policyEngine was null, so taskExchange/A2ATransport
   * skipped it for host traffic). The owner-only CONTROL + secret-material skills (the phrase, the root,
   * enrolment, device retirement, recovery, surface grants) are 'private': SELF only, never granted — a
   * household bot's admin at 'trusted' reaches none of them. hostAgent is IN-PROCESS ONLY (InternalTransport;
   * no external peer can reach it), so the sole caller is the chat agent — the owner — named SELF below.
   * Reads stay 'authenticated'. Revocation feeds from the issuer-side agentsTokenRegistry. Best-effort:
   * a failure leaves the gate absent (prior behaviour) — never breaks boot. */
  try {
    // Vault-backed TrustRegistry: unknown peers → 'authenticated'; the owner's chat identity → 'private' (self).
    hostTrustRegistry = new TrustRegistry(opts.hostTrustVault ?? makeBrowserVault('cc-host-trust:'));
    hostAgent.policyEngine = new PolicyEngine({
      trustRegistry: hostTrustRegistry,
      skillRegistry: hostAgent.skills,
      agentPubKey:   hostId.pubKey,
      // the owner's chat agent IS self here (two keys, one person): the only identity besides the host's own that
      // may reach a 'private' skill. Fixed at construction — nothing can be added to self later.
      selfIds:       [chatId.pubKey],
      isRevoked:     async (tokenId) => Boolean(await agentsTokenRegistry?.isRevoked(tokenId)),
    });
    // The in-process chat caller is the owner's device — it is self, so it clears the 'private' host ops.
    await hostTrustRegistry.setTier(chatId.pubKey, 'private');
  } catch (e) { console.warn('[realAgent] hostAgent PolicyEngine attach skipped:', e?.message ?? e); }

  await Promise.all([
    hostAgent.start(),
    chatAgent.start(),
    ...(householdAgent ? [householdAgent.start()] : []),   // B1 — the wireSkill household agent (flag-on)
  ]);

  // hello-exchange so each agent knows the other.  InternalBus
  // delivers synchronously enough that one hello is sufficient.
  await chatAgent.hello(hostAgent.address);
  // B1 — seed chatAgent's SecurityLayer with the household agent's key so
  // `chatAgent.invoke(householdAgent.address, …)` takes the S1 fast-path.
  if (householdAgent) await chatAgent.hello(householdAgent.address);

  // Seed a few household items so `/list shopping` + `/brief` are non-empty
  // out of the box.  Deterministic order (added oldest-first); skip via
  // opts.seedHousehold:false (clean-slate fixtures).
  if (opts.seedHousehold !== false) {
    const seedStore = householdService.stores.getStore(homeCircleId);
    for (const seed of SEED_HOUSEHOLD_ITEMS) {
      try {
        await householdApp.addItem(seedStore, { type: seed.type, text: seed.text }, { by: 'webid:local-demo-user' });
      } catch (err) {
        if (typeof console !== 'undefined') {
          console.warn('[realAgent] seed household item failed:', err?.message ?? err);
        }
      }
    }
  }

  /* ─── tasks-v0 real circle agent (— integration plan
   *     2026-05-23) ─────────────────────────────────────────────
   *
   * Replaces the previous mock-task handlers (~210 lines) with
   * the actual tasks-v0 Circle agent composed in-process.  Boots
   * 110 real skills (addTask, claimTask, completeTask, submitTask,
   * approveTask, rejectTask, listMyInbox, listOpen, listMine,
   * getTaskSnapshot, provisionMyCircle, …).
   *
   * Separate identity vault prefix so circle identity is isolated
   * from chat identity (per integration-plan decision #2).
   */
  const tasksIdentityVault = await sealedVault(opts.tasksIdentityVault
    ?? makeBrowserVault('cc-tasks-id:'));
  // Register the chatAgent's pubKey as the local member ("admin")
  // AND keep the legacy webid:* members for demo cross-actor tests.
  // Real tasks-v0 skills use `from` (caller) to look up the actor's
  // role; without the chatAgent's pubKey in the member list, every
  // call from basis would be treated as a stranger + denied
  // by RolePolicy.
  // WHICH CIRCLE the tasks engine runs in when the shell names none. An engine is verbs over the circle's ONE store,
  // not a store of its own: on the bot (`tasksCircleId`, the box) its tasks are the household circle's, so a task
  // on a list (Klusjes) is the engine's to list, claim and complete. The painting shells keep their own default.
  const tasksDefaultCircleId = botHouseholdId ?? ((typeof opts.tasksCircleId === 'string' && opts.tasksCircleId) ? opts.tasksCircleId : 'cc-default');
  const tasksCircle = await createBrowserMultiCircleTasksAgent({
    bus,
    // the host that may vouch for a door's person (`actor`): its caller here is the owner's chat agent
    hostKey: chatId.pubKey,
    identityVault: tasksIdentityVault,
    // THE ONE MEMBERSHIP ANSWER for the tasks app's authority gates: this circle's folded roster,
    // read through the waist. The tasks bundle composes its own member list locally (with this
    // device as admin of its primary circle), so a gate reading that list let any member grant
    // themselves a task-scoped authority. Asking the host instead means the answer is the circle's,
    // not the device's.
    circleRoleOf: async (circleId, webid) => {
      if (!circleId || !webid) return null;
      try {
        const r = await callSkill('stoop', 'listGroupMembers', { groupId: circleId });
        const rows = Array.isArray(r?.members) ? r.members : [];
        return rows.find((m) => (m?.webid ?? m?.pubKey) === webid)?.role ?? null;
      } catch { return null; }
    },
    primaryCircleConfig: opts.tasksCircleConfig ?? {
      circleId:  tasksDefaultCircleId,
      name:    'Onderling tasks',
      kind:    'household',
      members: [
        // chatAgent's pubKey is what tasks-v0 sees as `from`; bind
        // it to the local-demo-user webid + admin role. This is the
        // only real member of a fresh circle — the creator.
        { webid: chatId.pubKey, role: 'admin' },
        // Demo-only aliases (Anne/Karl/Maria) — gated behind the opt-in
        // seedDemoData flag (OFF by default) so a fresh REAL circle's roster
        // holds only real members. With the flag on they let the demo +
        // journey fixtures that mention these webids resolve to circle members.
        ...(seedDemoData ? [
          { webid: 'webid:anne',  displayName: 'Anne',  role: 'coordinator' },
          { webid: 'webid:karl',  displayName: 'Karl',  role: 'member'      },
          { webid: 'webid:maria', displayName: 'Maria', role: 'member'      },
        ] : []),
      ],
    },
    // Mirrors `opts.stoopPersistDb` below.  Browser passes
    // `{dbName:'cc-tasks-state', storeName:'items'}` (IDB); mobile
    // gets `{dbName:'cc-tasks-cache', asyncStorage}` (AsyncStorage)
    // synthesised by basis-mobile/agentBundle.js.  Without it,
    // the tasks cache stays Map-only and every reload re-seeds the
    // 4 demo tasks (the data-loss bug behind the
    // `cc.firstBootSeeded.v1` workaround in App.js).
    persistDb: opts.tasksPersistDb,
    contentSeal,                       // its list is content too — sealed on the way to disk
    label: 'TasksCircle(cc)',
    // One-store-per-circle (G-C1) — hand every tasks circle its household
    // CircleItemStore instead of tasks-v0 constructing a second one. Tasks then
    // live in the ONE per-circle store and sync over the ONE household mirror
    // (ensureCircleSync); tasks-v0 skips its own substrate mirror.
    circleStoreFor: (id) => householdService.stores.getStore(id),
    // Cross-device task-grant revocation, composed HERE because this is where both halves meet:
    // every revoke's token ids become a signed statement on the GRANTS LANE (fanned between the
    // owner's devices, surviving restart + restore), and the tasks engine ALSO consults the
    // lane's fold — so completing a task on this device kills its grants at the other devices'
    // doors too, not only at this one.
    onTaskGrantsRevoked: async ({ taskId, tokens }) => {
      const ok = await surfaceGrants.revokeTokens((tokens ?? []).map((t) => t?.id), { reason: 'task-grant' })
        .catch(() => false);
      if (!ok) console.warn(`[realAgent] task ${taskId}: grant revoke did not reach the grants lane — it binds on this device; siblings learn it at catch-up/TTL`);
    },
    isRevokedAlso: async (tokenId) => Boolean(await surfaceGrants.isRevoked(tokenId)),
    // Unbinding a bot is the same story: its token id goes onto the lane too.
    onBotTokenRevoked: async ({ chatId, tokens }) => {
      const ok = await surfaceGrants.revokeTokens((tokens ?? []).map((t) => t?.id), { reason: 'bot-token' })
        .catch(() => false);
      if (!ok) console.warn(`[realAgent] bot ${chatId}: token revoke did not reach the grants lane — it binds on this device; siblings learn it at catch-up/TTL`);
    },
  });
  await chatAgent.hello(tasksCircle.address);

  // The primary tasks circle's single store needs its store<->mirror sync wired
  // so unscoped task ops (which don't carry a circleId, so the per-op wiring at
  // dispatch is skipped) still fan out. Idempotent with the dispatch-time wire.
  const tasksPrimaryCircleId = opts.tasksCircleConfig?.circleId ?? tasksDefaultCircleId;
  await ensureCircleSync(tasksPrimaryCircleId);

  // Registry restore-and-open — the READ side of the circle-membership registry, the consumer that
  // was missing (the writer records {handle,address} per circle on the default profile at join, but
  // NOTHING read it back, so circles only opened on a user action). Every boot — crucially the
  // post-restore reload, where the recovery phrase re-derived IDENTITY but left the circle side inert
  // ("the phrase brought back who I am, but every circle was gone") — enumerate the circles this device
  // belongs to and re-open each: ensureCircleSync wires the store + provisions the pod cache medium
  // (which re-derives the seal strategy and catches the pod up, so a wiped device DECRYPTS pre-wipe
  // content it can re-fetch from the pod), and the per-circle SIGNING identity is re-installed so this
  // device can open what was sent to its per-circle address. Nothing here carries a secret: the registry
  // holds only pointers (handle/address), and every key re-derives from the recovery phrase. Best-effort
  // per circle and idempotent — a circle whose pod is unreachable degrades locally, never blocking boot
  // or the other circles. (The already-eager 'household' and tasks-primary circles are skipped.)
  async function reopenMemberCircles() {
    const reopened = [];
    let memberCircleIds = [];
    try {
      memberCircleIds = Object.keys(await readSelfCircleMemberships())
        .filter((id) => id && id !== tasksPrimaryCircleId && id !== 'household');
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[restore-open] membership enumeration failed — no circles auto-reopened', err?.message ?? err);
      return { reopened };
    }
    for (const id of memberCircleIds) {
      try { await ensureCircleSync(id); reopened.push(id); }
      catch (err) {
        if (typeof console !== 'undefined') console.warn(`[restore-open] ${id}: re-open failed — circle stays dark until re-navigated`, err?.message ?? err);
      }
    }
    if (memberCircleIds.length) {
      // Re-install the per-circle signing identities in one derive-only call (memoised) — the same wire
      // the shells drive via the exposed installCircleIdentities, run here for the restored set. Done for
      // the whole enumerated set (derive-only, cheap) even if a circle's store re-open degraded.
      try {
        installCircleSigningIdentities({
          circleIds: memberCircleIds,
          circleAddressFor,
          circleIdentityFor,
          registerSelfIdentity: (address, identity) => sa.registerSelfIdentity(address, identity),
          onFailed: (cid) => console.warn(`[restore-open] no per-circle signing identity for ${cid} — messages `
            + 'sealed to its per-circle address cannot be opened until it derives.'),
        });
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[restore-open] signing-identity install failed', err?.message ?? err);
      }
    }
    return { reopened };
  }
  await reopenMemberCircles();
  // Every circle this device is in belongs on the restore list. A create writes its record after answering; one
  // that did not land (an agents store that was down) is written here, at the next boot. Not awaited: boot does
  // not wait on it, and each write is bounded.
  healRestoreList({
    circleIds: async () => circleIdsFrom(await rawStoop('listMyCircles', {}))
      .filter((id) => id && id !== 'household' && id !== tasksPrimaryCircleId),
    memberships: () => readSelfCircleMemberships(),
    addressFor: circleAddressFor,
    write: (circleId, address) => callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId, address }),
    log: (msg) => { if (typeof console !== 'undefined') console.warn(msg); },
  }).catch(() => { /* the next boot tries again */ });

  // Pre-seed the demo circle with 4 starter tasks — the demo + journey
  // fixtures expect /mytasks to show these out of the box.  DEMO-ONLY: a real
  // circle gets no phantom tasks, so this is gated behind the opt-in
  // seedDemoData flag (OFF by default).  seedTasks:false is still honoured as
  // an independent clean-slate opt-out (e.g. persistence tests).
  //
  // Perf #1 (2026-05-30): also skip seeding when the circle already
  // has tasks (warm-boot after persisted storage).  One cheap listOpen
  // probe avoids 4 sequential addTask round-trips that were blocking
  // every boot on mobile.  Fail-open: if the probe errors, seed anyway.
  if (seedDemoData && opts.seedTasks !== false) {
    let alreadySeeded = false;
    try {
      const probe  = await chatAgent.invoke(tasksCircle.address, 'listOpen', [DataPart({})]);
      const data   = Array.isArray(probe) ? probe[0]?.data : null;
      const items  = Array.isArray(data?.items) ? data.items : [];
      alreadySeeded = items.length > 0;
    } catch { /* fall through — seed anyway */ }
    if (!alreadySeeded) {
      const SEED_TASKS = [
        { text: "Set up Anne's bedroom", requiredSkill: 'household' },
        { text: 'Fix the leaky tap',     requiredSkill: 'plumbing'  },
        { text: 'Order groceries',       assignee: 'webid:anne'     },
        { text: 'Take out the bins',     assignee: 'webid:karl'     },
      ];
      for (const seed of SEED_TASKS) {
        try {
          await chatAgent.invoke(tasksCircle.address, 'addTask', [DataPart(seed)]);
        } catch (err) {
          if (typeof console !== 'undefined') {
            console.warn('[realAgent] seed task failed:', err.message ?? err);
          }
        }
      }
    }
  }

  // 2026-05-24 — track circles provisioned via /circle-new at runtime.
  // The tasks-v0 agent runs in single-circle topology (one CircleState
  // wired at boot); provisionMyCircle persists a config to the
  // dataSource but doesn't instantiate a CircleState the dashboard
  // can see.  Until multi-circle topology lands as a separate slice
  // (ish), the /circles adapter appends these "pending"
  // entries so the user gets visible feedback on /circle-new.
  const provisionedCircles = new Map();   // circleId → {name, kind, provisionedAt}

  /* ─── stoop real agent (integration plan 2026-05-23) ──
   *
   * Replaces the previous mock-stoop handlers (~85 lines: listFeed,
   * postRequest, searchPosts, stoop_briefSummary, getStoopProfile,
   * revealPeer) with the actual Stoop NeighbourhoodAgent composed
   * in-process.  Boots 110 real stoop skills; ~6 surface via chat
   * ops today, the rest reachable via agent.callSkill('stoop', …).
   *
   * Separate identity vault prefix (`cc-stoop-id:`) so stoop's per-
   * circle identity is isolated from chat + tasks (decision #2).
   * IndexedDBPersist via opts.persistDb keeps the local cache alive
   * across page reloads.
   */
  const stoopIdentityVault = await sealedVault(opts.stoopIdentityVault
    ?? makeBrowserVault('cc-stoop-id:'));
  // THE MEMBERSHIP RIDER: when the shell hands the DEVICE LOG (`opts.deviceLog`), membership statements
  // ride its membership lane — signed with the per-circle key, fanned via broadcastCircleMembership,
  // verified on ingest, pull-all caught-up — and the roster folds the rail's VERIFIED bodies
  // authoritatively. Absent → the store-based spine path stands (legacy compositions/tests).
  let membershipRail = null;
  let membershipEmit;
  let membershipRead;
  if (opts.deviceLog) {
    membershipRail = makeMembershipRail({
      eventLog: opts.deviceLog,
      circleIdentityFor,
      myRef: chatId.pubKey,
      callSkill: (...a) => callSkill(...a),   // lazy — the waist is composed later in this scope
    });
    // A membership statement that LANDS (fan or catch-up) changes the roster without a write through the
    // waist — clear that circle's roster-read window so the next read sees it (rosterReadCache.js).
    // …and one this device APPENDS (a join, a revoke) is a roster change too, before any fan.
    for (const fn of ['ingest', 'append', 'appendOne']) {
      if (!membershipRail || typeof membershipRail[fn] !== 'function') continue;
      const raw = membershipRail[fn].bind(membershipRail);
      membershipRail[fn] = async (...a) => {
        const cid = typeof a[0] === 'string' ? a[0] : (a[0]?.circleId ?? null);   // (circleId, …) on all three
        // a departure landing here: the admins as they were BEFORE it (did it empty them? — see retellDeparture)
        const adminsBefore = fn === 'ingest' && cid && isDeparture(a[1]) ? await adminsOf(cid).catch(() => null) : null;
        const r = await raw(...a);
        if (cid) rosterReads.invalidate(cid); else rosterReads.invalidateAll();
        if (fn === 'ingest' && r?.ok && !r.existed) retellDeparture(cid, a[1], adminsBefore);
        return r;
      };
    }
    // A DEPARTURE IS TOLD ONCE BY THE ONE WHO LEAVES — and a copy to one member can be lost (a hold that never meets
    // the recipient's presence, a send into a reconnect): that member then keeps the departed on their roster, and keeps
    // fanning to them, for good (L128, seen on CI). So an ADMIN who lands someone else's leave or evict tells the circle
    // again: the same signed statement, the same message id (every rail dedupes it), the fold untouched. Once per
    // statement — on its first landing here — and only by admins, so a circle hears it at most once more per admin.
    // One case the admins cannot cover: the LAST admin leaving. The fold then appoints a caretaker, but only where the
    // leave landed — a caretaker whose copy was lost never learns it is admin, and the members who landed it are not
    // admins. So ANY member who lands a departure that EMPTIED the admin set (every admin before it is gone after) tells
    // it again too: a local, exact condition, for a rare event, bounded by the circle's size and deduped by the id.
    function isDeparture(statement) {
      const kind = statement?.body?.kind;
      const author = statement?.body?.payload?.authorRef ?? null;
      return (kind === 'leave' || kind === 'evict') && Boolean(author) && author !== chatId.pubKey;
    }
    async function adminsOf(circleId) {
      const rows = (await callSkill('stoop', 'listGroupMembers', { groupId: circleId }))?.members ?? [];
      return rows.filter((m) => m?.role === 'admin' && m?.webid).map((m) => m.webid);
    }
    function retellDeparture(circleId, statement, adminsBefore = null) {
      if (!circleId || !isDeparture(statement) || !membershipEmit) return;
      const kind = statement.body.kind;
      (async () => {
        const rows = (await callSkill('stoop', 'listGroupMembers', { groupId: circleId }))?.members ?? [];
        const amAdmin = rows.find((m) => m?.webid === chatId.pubKey)?.role === 'admin';
        const present = new Set(rows.map((m) => m?.webid));
        const emptied = Array.isArray(adminsBefore) && adminsBefore.length > 0 && adminsBefore.every((a) => !present.has(a));
        if (!amAdmin && !emptied) return;
        const r = await callSkill('stoop', 'broadcastCircleMembership', {
          groupId: circleId, event: statement, msgId: `mem:${statement.body.hash}`, ts: Date.now(),
        });
        console.info(`[membership-fan] retold a ${kind} in ${String(circleId).slice(0, 8)} ${amAdmin ? 'as its admin' : 'as the departure emptied its admins'}: sent ${r?.sent ?? 0}/${r?.attempted ?? 0}`);
      })().catch(() => { /* best-effort: the departed's own copy and catch-up remain */ });
    }
    membershipEmit = makeMembershipEmitter({
      rail: membershipRail,
      myRef: chatId.pubKey,
      fan: (circleId, statement) => callSkill('stoop', 'broadcastCircleMembership', {
        groupId: circleId, event: statement, msgId: `mem:${statement.body.hash}`, ts: Date.now(),
      }).then((r) => {
        // a leave or an evict is told once, with no later chance: say whom it did not reach (a probe that names its
        // branch — a member who never learns of it is then delivery, not the fold)
        const kind = statement?.body?.kind;
        // …and, for a leave or an evict, ALWAYS where each copy went: delivered, held (counted as sent — queued for
        // the recipient's next presence, which may not come), or not at all (L128: a leave that reached the admin
        // and never the bystander, with this line silent because a hold counts as sent)
        if (kind === 'leave' || kind === 'evict') {
          const tail = (x) => String(x ?? '').slice(0, 6);
          const where = (r?.outcomes ?? []).map((o) => `${tail(o.webid)}@${tail(o.addr)}:${o.outcome}`).join(' ');
          console.info(`[membership-fan] ${kind} in ${String(circleId).slice(0, 8)}: sent ${r?.sent ?? 0}/${r?.attempted ?? 0}${r?.error ? ` (${r.error})` : ''}${where ? ` — ${where}` : ''}${(r?.errors ?? []).length ? ` — ${JSON.stringify(r.errors).slice(0, 200)}` : ''}`);
        }
        return r;
      }).catch(() => { /* fan is best-effort — catch-up reconciles */ })
        // my own write reaches my other devices by the one carry — after the member fan, never instead of it
        .finally(() => siblingCarry.carry({ subtype: MEMBERSHIP_BROADCAST, circleId, event: statement, msgId: `mem:${statement.body.hash}`, ts: Date.now() }).catch(() => {})),
    });
    membershipRead = (circleId) => membershipRail.readVerifiedBodies(circleId);
    // The fold's compaction verdict comes back the same road the statements went out on (L121): stoop hands
    // `rosterFold.superseded` to this and the rail drops those entries. A property on the reader, so nothing
    // between here and the fold has to learn a new name.
    membershipRead.compact = async (circleId, hashes) => { try { return membershipRail.compact(circleId, hashes); } catch { return 0; } };
    // THE CONTENT RE-ROOT (tasks first): each task write ALSO rides the device log's task lane as a signed
    // full-item snapshot, fanned via broadcastCircleTask; receivers verify at their rail and causally merge
    // the head. The store's publish hook routes task types here instead of the legacy mirror (the per-type
    // valve in ensureCircleSync below). `storeFor` peeks — it never BUILDS a store, so an inbound statement
    // for a circle this device hasn't opened parks on the log instead of caching a store without its
    // pod medium; the head converges when the circle opens and catch-up runs.
    taskRail = makeTaskRail({
      eventLog: opts.deviceLog,
      circleIdentityFor,
      myRef: chatId.pubKey,
      callSkill: (...a) => callSkill(...a),
      storeFor: (circleId) => (circleId === OWN_DEVICES_SCOPE ? ownStoreNow : (householdService.stores.has(circleId) ? householdService.stores.getStore(circleId) : null)),
      // the person's own scope: between their own devices only (see the own store above)
      own: {
        scope: OWN_DEVICES_SCOPE,
        signer: () => grantsSignerPromise,
        verifyBinding: deviceSetVerifier,
        seal: () => ownSeal,
        delegation: () => enrolledDevice?.record ?? null,
      },
      // A landed snapshot that is a noticeboard post goes to the shell's bridge (stoop's index + notification).
      // ONE seam for what landed: the noticeboard's index, and the composition's change feed (`opts.onItemLanded`)
      onItemApplied: async (circleId, item) => {
        try { await opts.onItemLanded?.(circleId, item); } catch { /* a listener never fails the merge */ }
        return typeof _noticeboardLanded === 'function' ? _noticeboardLanded(circleId, item) : undefined;
      },
    });
    taskEmit = makeTaskEmitter({
      rail: taskRail,
      // Best-effort, but REPORTING: the fan's own contract is {sent, attempted, errors} and swallowing
      // it made a lost statement invisible (a claim fanned right after its task never reached the peer,
      // and nothing said so — 2026-08-20). Under-delivery and rejection both warn; catch-up reconciles
      // either way, but now the log says WHEN it will have to.
      // the person's own scope has no members to fan to: it reaches their other devices by the one carry, only
      fan: (circleId, statement) => (circleId === OWN_DEVICES_SCOPE
        ? siblingCarry.carry({ subtype: TASK_BROADCAST, circleId, event: statement, msgId: `task:${statement.body.hash}`, ts: Date.now() }).catch(() => {})
        : callSkill('stoop', 'broadcastCircleTask', {
        groupId: circleId, event: statement, msgId: `task:${statement.body.hash}`, ts: Date.now(),
      }).then((r) => {
        // my own write reaches my other devices by the one carry — after the member fan, never instead of it
        siblingCarry.carry({ subtype: TASK_BROADCAST, circleId, event: statement, msgId: `task:${statement.body.hash}`, ts: Date.now() }).catch(() => {});
        if (r?.error || (r?.errors?.length ?? 0) > 0 || (r?.sent ?? 0) < (r?.attempted ?? 0)) {
          console.warn(`[task-lane] fan under-delivered for ${circleId} ${statement.body.kind}`
            + ` hash=${statement.body.hash.slice(0, 8)}: sent=${r?.sent ?? 0}/${r?.attempted ?? 0}`
            + (r?.error ? ` error=${r.error}` : '')
            + ((r?.errors?.length ?? 0) > 0 ? ` errors=${JSON.stringify(r.errors).slice(0, 200)}` : ''));
        }
        return r;
      }, (err) => {
        console.warn(`[task-lane] fan REJECTED for ${circleId} ${statement.body.kind}`
          + ` hash=${statement.body.hash.slice(0, 8)}:`, err?.message ?? err);
      })),
    });
    wireOwnLane();   // an own store opened before the lane existed joins it now
    // THE OWN SCOPE'S CATCH-UP: what a sibling wrote while this device was off, asked of the person's own devices and
    // served to them only (a stranger asking gets nothing, sealed or not). The shells kick it on connect.
    {
      const replay = makeFrontierReplay({
        rail: taskRail,
        sendToPeer: (to, payload, o) => sendToSibling(to, payload, o),
        subtypes: OWN_TASK_CATCHUP_SUBTYPES,
        statementsFor: (circleId) => taskRail.catchUpStatements(circleId),
        mayServe: async (fromPeerAddr, circleId) => circleId === OWN_DEVICES_SCOPE && (await ownDeviceSiblings()).includes(fromPeerAddr),
      });
      ownStoreSync = {
        ...replay,
        async requestFromSiblings() {
          let requested = 0;
          for (const addr of await ownDeviceSiblings().catch(() => [])) {
            try { await replay.requestFrom(addr, OWN_DEVICES_SCOPE); requested += 1; } catch { /* the next connect asks again */ }
          }
          return { requested };
        },
      };
    }
    // The chat lane: each sent message appends its SIGNED render entry to the device log (non-silent —
    // the entry IS the bubble) and fans the statement; receivers verify at their rail, where the roster
    // binding doubles as the eviction gate. The shells' send sites call chatEmit instead of the
    // append-then-fan pair; msgId stays the join key inside the signed payload.
    chatRail = makeChatRail({
      eventLog: opts.deviceLog,
      circleIdentityFor,
      myRef: chatId.pubKey,
      callSkill: (...a) => callSkill(...a),
    });
    chatEmit = makeChatEmitter({
      rail: chatRail,
      fan: (circleId, statement) => callSkill('stoop', 'broadcastCircleChatStatement', {
        groupId: circleId, event: statement, msgId: statement.body.subject, ts: Date.now(),
      }).catch(() => { /* fan is best-effort — catch-up reconciles */ })
        // my own write reaches my other devices by the one carry — after the member fan, never instead of it
        .finally(() => siblingCarry.carry({ subtype: CHAT_STATEMENT_BROADCAST, circleId, event: statement, msgId: statement.body.subject, ts: Date.now() }).catch(() => {})),
    });
  }
  // THE KEY LANE (the recorded spine route for key rotations, implemented 2026-08-22): the
  // control agent's key-event sink hands every establish/rotation to `keyEmit`, which signs it
  // with the circle key, chains it per author, and appends it to the device log; the SINK then
  // fans the statement to the event's recipients. Receivers verify signature + chain + the
  // rotateKey authority (L4 decision-class, default any-admin) at their own key rail before
  // anything reaches their fold — and a forked rotator's statements are DISCOUNTED (L3). Without
  // a device log the append lands on an ephemeral log — same honest degrade as the riders below.
  const keyRail = makeKeyRail({
    eventLog: opts.deviceLog ?? new EventLog({ initial: [], muted: [] }),
    circleIdentityFor,
    myRef: chatId.pubKey,
    callSkill: (...a) => callSkill(...a),   // lazy — the waist is composed later in this scope
  });
  // Every key statement this device writes — the shells' sinks and the revoke ceremony all emit through
  // here — also reaches its other devices by the one carry, whichever caller fans it to the members.
  const keyEmitBare = makeKeyEmitter({ rail: keyRail });
  const keyEmit = keyEmitBare ? async (circleId, event) => {
    const statement = await keyEmitBare(circleId, event);
    if (statement) siblingCarry.carry({ subtype: KEY_STATEMENT_BROADCAST, circleId, event: statement, msgId: `key:${statement?.body?.hash ?? statement?.body?.subject}`, ts: Date.now() }).catch(() => {});
    return statement;
  } : null;
  // THE RULES-UPDATE RIDER: `editGroupRules` also fans the new doc + version as a signed statement
  // on the governance lane (this rail instance shares the device log with the shells' receive-side
  // rail — same lane, same declaration, the multi-instance shape governance already has). Without
  // a device log the append lands on an ephemeral log — the live fan still carries the statement
  // (receivers verify at their OWN rail); only local restart durability degrades, like the other
  // riders.
  const rulesUpdateEmit = makeRulesUpdateEmitter({
    rail: makeGovernanceRail({
      eventLog: opts.deviceLog ?? new EventLog({ initial: [], muted: [] }),
      circleIdentityFor,
      myRef: chatId.pubKey,
      callSkill: (...a) => callSkill(...a),   // lazy — the waist is composed later in this scope
    }),
    fan: (circleId, statement) => callSkill('stoop', 'broadcastCircleGovernance', {
      groupId: circleId, event: statement, msgId: `rules:${statement.body.hash}`, ts: Date.now(),
    }).catch(() => { /* fan is best-effort — catch-up reconciles */ })
      .finally(() => siblingCarry.carry({ subtype: 'circle-governance-broadcast', circleId, event: statement, msgId: `rules:${statement.body.hash}`, ts: Date.now() }).catch(() => {})),
  });
  // THE POLICY-UPDATE RIDER — the same rail and fan as the rules one, a different kind. The shells call it (as
  // `emitPolicyUpdate`) when an admin saves the circle's policy and when the create wizard writes the first one.
  const policyUpdateEmit = makePolicyUpdateEmitter({
    rail: makeGovernanceRail({
      eventLog: opts.deviceLog ?? new EventLog({ initial: [], muted: [] }),
      circleIdentityFor,
      myRef: chatId.pubKey,
      callSkill: (...a) => callSkill(...a),
    }),
    fan: (circleId, statement) => callSkill('stoop', 'broadcastCircleGovernance', {
      groupId: circleId, event: statement, msgId: `policy:${statement.body.hash}`, ts: Date.now(),
    }).catch(() => { /* fan is best-effort — catch-up reconciles */ })
      .finally(() => siblingCarry.carry({ subtype: 'circle-governance-broadcast', circleId, event: statement, msgId: `policy:${statement.body.hash}`, ts: Date.now() }).catch(() => {})),
  });
  /**
   * THE circle-scoped send — every piece of circle traffic leaves through it: the chat/noticeboard fan
   * (stoop's `reliableSend`) AND the shells' `sendPeerMessage` (delivery receipts, replies). With a
   * `circleId` the envelope is signed as the circle identity and routed over the circle's own points;
   * without one it is an ordinary hold-forward send. A second sender that did not know about circles
   * is how the receipt left as the canonical identity and was refused on arrival (2026-08-29).
   */
  /**
   * The relays a contact is reachable on, or null (the decision itself lives in `contactRelayScope`).
   *
   * `requireAliasCapable` is deliberately NOT set: this addresses a PERSON by their own address, not a
   * per-circle alias, so the unlinkability the circle path protects is not in play — and leaving it off
   * keeps NKN eligible, which is what an unscoped send could always use.
   */
  const contactScope = (to, contactPoints = []) => contactRelayScope({
    to,
    circlesForPeer:  (addr) => opts.circlesForPeer?.(addr) ?? [],
    circlePointsFor: (cid) => opts.circlePointsFor?.(cid) ?? [],
    contactPoints,
  });
  /** The points the person's own card named, kept on their contact — by any address of theirs. */
  const contactPointsFor = async (to) => {
    try {
      const c = (await rawContacts()).find((x) => x && (x.webid === to || x.pubKey === to || x.peerAddr === to));
      return Array.isArray(c?.points) ? c.points : [];
    } catch { return []; }
  };

  async function sendCircleScoped(to, envelope, sendOpts = {}) {
    // Circle-scoped routing (2026-07-29): map the circle to its CONNECTION POINTS and hand those down.
    // The app owns points; the transport layer owns transports; neither learns the other's vocabulary.
    // `requireAliasCapable` is the user's address-fallback setting inverted — with the fallback OFF we
    // would rather be undeliverable than route a circle over a transport that cannot carry per-circle
    // addressing, because that silently strips member-level unlinkability. With it ON, an NKN circle
    // works on terms the user accepted. → plans/NOTE-circle-scoped-routing.md
    const { circleId, ...rest } = sendOpts;
    if (circleId == null) {
      // No circle — a direct message, a receipt, a redeem. Until 2026-09-08 that meant "whatever relay this
      // device happens to be on", which was fine when there was only one. With several, a DM to someone I
      // know from a kring on ANOTHER relay went out over mine, where they are not registered.
      //
      // What I do know is which kringen I share with them, and a kring names its relays. They are in those
      // kringen, so their device dialled those relays — so that is where they are. An explicit scope from
      // the caller always wins (the join's redeem names the relay its invite carried), and when we share no
      // kring with a recorded relay there is nothing to narrow to and the send stays exactly as it was.
      const scope = rest.scope ?? contactScope(to, await contactPointsFor(to));
      // "Contact reveals, so contact is minimised": the fewest points that reach them. A relay this
      // device is already on wins; only when it is on NONE of the person's points does it come beside
      // the first one the card named — dialling a relay registers this device there, which is the
      // one disclosure a card the person handed out asks for.
      if (scope?.points?.length) {
        const on = (() => { try { return sa.relays.list().map((r) => r.url); } catch { return []; } })();
        if (!scope.points.some((u) => on.includes(u))) {
          try { await sa.relays.add(scope.points[0], { awaitReady: true }); }
          catch (err) { if (typeof console !== 'undefined') console.warn(`[realAgent] could not come beside ${scope.points[0]} for a contact: ${err?.message ?? err}`); }
        }
      }
      return sa.peer.sendTo(to, envelope, { guarantee: 'hold-forward', ...rest, ...(scope ? { scope } : {}) });
    }
    const points = opts.circlePointsFor?.(circleId) ?? [];
    const fallbackOn = addressFallbackOn();
    // Decision 4 — sign this circle's traffic as this circle's identity, not as the person.
    // `sendAs` is an ADDRESS of ours; the key behind it never leaves the SecurityLayer, and the
    // transport layer below never learns that a circle was involved. Installing here as well as at
    // boot is deliberate: the send path must not depend on a boot step having happened first.
    const sendAs = await useCircleSigningIdentity({
      circleId, circleAddressFor, circleIdentityFor,
      registerSelfIdentity: (address, id) => sa.registerSelfIdentity(address, id),
    });
    return sa.peer.sendTo(to, envelope, {
      guarantee: 'hold-forward',
      ...rest,
      scope: { points, requireAliasCapable: !fallbackOn },
      ...(sendAs ? { sendAs } : {}),
    });
  }
  const stoopAgent = await createBrowserStoopAgent({
    bus,
    identityVault: stoopIdentityVault,
    // Circle-scoped spine signing (principle 5): each membership statement is signed with the PER-CIRCLE
    // identity (derived from the profile seed — same on every device of the user, never persisted), and
    // carries the member's ref (webid == the chat pubKey in the basis binding) as the signed authorRef the
    // roster projection verifies. One global key across circles would re-link memberships; this doesn't.
    circleSignerFor: async (circleId) => ({ identity: await circleIdentityFor(circleId), ref: chatId.pubKey }),
    membershipEmit,
    membershipRead,
    // The person key this device announces on a join or create (`{ version, pubKey }`, or null).
    currentPersonKey,
    rulesUpdateEmit,
    // One block set for the whole device. Blocking is a decision about a PERSON, so it cannot live
    // per-app: the boundary refuses their envelopes, and this app's ingest filter reads the same set
    // so anything that arrived by another road is dropped too. Keys line up because in basis' binding
    // a member's actor/webid IS their chat pubKey — the address the set is keyed on.
    mutedSet: sa.mute,
    // Bind chatAgent's pubKey as the local actor so real stoop
    // skills' `from` lookups resolve back to 'me' (admin role).
    localActor: chatId.pubKey,
    group:      opts.stoopGroup ?? 'cc-default-circle',
    members:    opts.stoopMembers ?? [
      { webid: chatId.pubKey,     role: 'admin'       },
      // Demo-only phantom members — gated behind seedDemoData (OFF by default)
      // so a fresh REAL circle's roster shows only the creator + actual joiners.
      ...(seedDemoData ? [
        { webid: 'webid:anne',      displayName: 'Anne',  role: 'coordinator' },
        { webid: 'webid:karl',      displayName: 'Karl',  role: 'member'      },
        { webid: 'webid:maria',     displayName: 'Maria', role: 'member'      },
      ] : []),
    ],
    persistDb:  opts.stoopPersistDb,   // browser IDB; opt-in via caller
    contentSeal,                       // its posts are content too — sealed on the way to disk
    // S4 — per-circle control-agent router: redeem→addMember / leave→removeMember route
    // to the joined circle's sealed-pod producer (multi-member sealing). Opt-in; absent
    // → membership hooks no-op (the pre-S4 behaviour).
    controlAgent: opts.stoopControlAgent,
    // Route circle chat fan-out through the SAME reliable choke durable circle content uses:
    // `sa.peer.sendTo(..., {guarantee:'hold-forward'})`. This is what gives a circle chat
    // failover (`_sendWithFailover`) + offline hold-forward — the reliability the bus-local
    // `chat.send` transport (stoop's own in-process agent) never had. The stoop skill builds a
    // conforming `circle-chat-message` envelope and calls this per recipient; a briefly-offline
    // member has the message HELD and flushed on reconnect, exactly like a task/noticeboard fan.
    reliableSend: (to, envelope, sendOpts = {}) => sendCircleScoped(to, envelope, sendOpts),
    // Connectivity Phase 3 — LIVE shared-pod key-custody seams (host-injected by circleApp over each
    // circle's per-circle StorageBackend + its live group-key {seal,open}). All keyed by circleId so the
    // ONE stoop agent resolves each circle's member-side custody per call (invariant #6):
    //   • circleDataMove(circleId)          → the send-path data-move branch (policy.pod).
    //   • podWrite(circleId, envelope)      → seal+write a chat statement row, return its opaque pod ref
    //     (the pod-signal fan / pod-only carry). The READ side lives with the shells now (the pod chat
    //     catch-up range-reads + verifies at the rail) — stoop no longer reads the chat pod.
    // Absent (opt not supplied) → fan-out-full, unchanged.
    circleDataMove: opts.stoopCircleDataMove,
    podWrite:       opts.stoopPodWrite,
    // The per-user address-fallback setting reaches the FAN too, not only `reliableSend` below.
    // The two enforce different halves of the same choice: the fan decides WHICH address a member
    // is reached at, `reliableSend` decides which transports may carry it. Until now only the
    // second was wired, so "fallback off" narrowed the transport while the fan still chose the
    // member's one global key — the setting was half-applied, in the half that leaks. Absent →
    // undefined → the skills' own `true` default, i.e. no behaviour change for a host that
    // passes nothing.
    allowAddressFallback: opts.allowAddressFallback,
    label:      'StoopAgent(cc)',
  });
  stoopAgentRef.current = stoopAgent;   // the raw contact-book reads above may run from here on
  // Every noticeboard item the stoop store ACCEPTS fans to its circle — a request, an offer, an
  // announcement, and the next kind — through the one `circle-post` door (`noticeboardFan.js` decides from
  // the item; a received item never echoes). Installed on the store event, so no op has to remember.
  try { stoopAgent.bundle?.itemStore?.on?.('item-added', (item) => { fanNoticeboardItem(item); }); }
  catch (err) { if (typeof console !== 'undefined') console.warn('[realAgent] noticeboard fan not installed:', err?.message ?? err); }
  await chatAgent.hello(stoopAgent.address);

  // Contacts made before the persona field existed record NONE. Write `default` onto them once — only where the
  // pair circle id PROVES it (`backfillContactPersonas`): a row whose pair circle is not the default identity's is
  // reported and left alone. `personaAt: 0`, so any real choice made on any device outranks it; RAW, so a
  // backfilled row does not fan (every device backfills its own, from the same proof). Best-effort, after boot.
  backfillContactPersonas({
    rows: await rawContacts().catch(() => []),
    selfWebid: chatId.pubKey,
    setPersona: (webid, persona) => rawStoop('setContactPersona', { webid, persona, personaAt: 0 }),
  }).then((r) => { if (r.mismatched && typeof console !== 'undefined') console.warn(`[contact-persona] ${r.mismatched} contact row(s) not provably the default persona's — left unrecorded`); })
    .catch(() => {});

  // Pre-seed the local actor's stoop handle + displayName so
  // /stoop-profile has something to show (real getMyProfile returns
  // {entry: null} until the user first sets these).  Opts out with
  // seedStoopProfile:false.
  if (opts.seedStoopProfile !== false) {
    try {
      if (opts.stoopHandle) {
        await chatAgent.invoke(stoopAgent.address, 'setMyHandle', [DataPart({ handle: opts.stoopHandle })]);
      }
      if (opts.stoopDisplayName) {
        await chatAgent.invoke(stoopAgent.address, 'setMyDisplayName', [DataPart({ displayName: opts.stoopDisplayName })]);
      }
    } catch (err) {
      if (typeof console !== 'undefined') {
        console.warn('[realAgent] seed stoop profile failed:', err.message ?? err);
      }
    }
  }

  // Pre-seed 3 demo posts so /feed has content out of the box.  DEMO-ONLY
  // (the posts name the demo members) — a real circle starts with an empty
  // feed, so this is gated behind the opt-in seedDemoData flag (OFF by
  // default).  seedStoopPosts:false remains an independent opt-out.
  //
  // Perf #1 (2026-05-30): skip when stoop already has open posts
  // (warm-boot after persisted storage).  One listOpen probe avoids 3
  // sequential postRequest round-trips that were blocking every boot.
  if (seedDemoData && opts.seedStoopPosts !== false) {
    let alreadySeeded = false;
    try {
      const probe = await chatAgent.invoke(stoopAgent.address, 'listOpen', [DataPart({})]);
      const data  = Array.isArray(probe) ? probe[0]?.data : null;
      const items = Array.isArray(data?.items) ? data.items : [];
      alreadySeeded = items.length > 0;
    } catch { /* fall through — seed anyway */ }
    if (!alreadySeeded) {
      const SEED_POSTS = [
        { kind: 'ask',   text: 'Anne needs help moving a couch' },
        { kind: 'offer', text: 'Karl offers tomato seedlings'   },
        { kind: 'ask',   text: 'Maria looking for a bike pump'  },
      ];
      for (const seed of SEED_POSTS) {
        try {
          await chatAgent.invoke(stoopAgent.address, 'postRequest', [DataPart(seed)]);
        } catch (err) {
          if (typeof console !== 'undefined') {
            console.warn('[realAgent] seed stoop post failed:', err.message ?? err);
          }
        }
      }
    }
  }

  /* ─── folio web-only agent (integration plan 2026-05-23) ──
   *
   * Replaces the previous in-host folio handlers (~125 lines: readNote
   * / shareFolder / listFiles / searchFiles / getFileSnapshot /
   * verifyPodState / deleteFromPod / downloadFile / saveToMyPod /
   * folio_briefSummary / folioStatus) with a dedicated folio agent
   * composed in-process.  shareFolder now issues a REAL
   * PodCapabilityToken via autoShare.mintShareToken; the other skills
   * preserve their mock-era reply shapes (real pod-IO + Blob bytes
   * stay deferred per the slice-4 scope reduction).
   *
   * Separate identity vault prefix (`cc-folio-id:`) so folio's web
   * identity is isolated from chat / tasks / stoop (decision #2).
   * podRoot is reserved — when basis lands real pod-attached
   * folio writes (mobile), pass `opts.folioPodRoot` so
   * shareFolder tokens carry the real pod URI.
   */
  const folioIdentityVault = await sealedVault(opts.folioIdentityVault
    ?? makeBrowserVault('cc-folio-id:'));
  const folioAgent = await createBrowserFolioAgent({
    bus,
    identityVault: folioIdentityVault,
    podRoot:       opts.folioPodRoot,
    seedFiles:     opts.folioSeedFiles,   // pass [] for clean-slate fixtures
    label:         'FolioAgent(cc)',
    // 52.25 — the `/zoek` semantic embedder. Absent ⇒ lexical-only (the
    // default; llmTool:'off' / no Ollama). The circle shell wires the
    // policy-resolved embedder post-boot via `setFolioNoteEmbedder`, so no
    // embed call is ever made unless the circle's embed policy permits.
    noteEmbedder:  opts.folioNoteEmbedder,
  });
  await chatAgent.hello(folioAgent.address);

  /**
   * basis's CallSkill shape: `(appOrigin, opId, args) → payload`.
   *
   * Routing targets:
   *   - 'household'  → hostAgent (chores, members, calendar skills)
   *   - 'tasks'      → tasksCircle.address (the REAL tasks circle agent
   *                    via slice-1 integration; 110 skills).  Part G
   *                    (2026-06-17): the app-origin is now `'tasks'`
   *                    (was `'tasks-v0'`) — the merged manifest's
   *                    `.app` is `'tasks'`, and the catalogue keys ops
   *                    by `m.app`.  The directory / npm package
   *                    (`@onderling-app/tasks`) keep their names.
   *   - 'stoop'      → stoopAgent.address (slice-2b NeighbourhoodAgent)
   *   - 'folio'      → folioAgent.address (slice-4 web-only agent)
   *
   * Some opIds are renamed across the boundary (the chat surface
   * uses `myInbox` historically; the real tasks circle exposes
   * `listMyInbox`).  These SEMANTIC aliases are product decisions
   * (NOT drift); adapt here so the chat-shell renderer stays stable.
   */
  const TASKS_OP_ALIAS = {
    myInbox:  'listMyInbox',                  // basis → real tasks circle
    // listMine on real tasks-v0 filters by t.assignee === from (only
    // tasks ALREADY assigned to me).  The chat-shell semantic of
    // /mytasks is broader — "everything actionable in my circle".  Map
    // to listOpen so the chat user sees what they expect.
    listMine: 'listOpen',
    // F1 circle content (5.3) — `loadCircleItems` reads a circle's
    // tasks via the unique source op `getMyTasks` (no app defines it,
    // so `makeResolvingCallSkill` probes past stoop/household and lands
    // here).  Map to listOpen scoped to the resolved circle (= circle).
    getMyTasks: 'listOpen',
    // briefSummary / searchTasks: tasks-v0 doesn't expose these as
    // own skills today; basis derives them from listOpen below.
  };

  /**
   * Map real tasks-v0 status → chat-shell `state` field.
   *
   * Real status values (from item-store dag.js effectiveStatus):
   *   ready / blocked / claimed / submitted / rejected / complete
   * Chat-shell expects (mock-era):
   *   open / claimed / done
   *
   * 'rejected' goes back to 'claimed' (assignee can retry).
   * 'blocked' surfaces as 'open' for the chat-shell (UI gates the
   * action by openDeps.length).
   */
  function _statusToChatState(status, task) {
    if (task?.completedAt || status === 'complete') return 'done';
    if (status === 'submitted') return 'submitted';
    if (status === 'rejected')  return 'claimed';
    if (status === 'claimed' || task?.assignee) return 'claimed';
    return 'open';   // ready / blocked / undefined
  }

  /**
   * Stoop opId aliases — chat-shell vocabulary → real skill name.
   *   /feed       → listOpen     (no `listFeed` in real stoop)
   *   /stoop-profile → getMyProfile
   *
   * Part G dissolve (2026-06-17) — the `revealPeer → setPeerReveal`
   * alias was DROPPED: the `revealPeer` op no longer exists (the
   * `/reveal` collision was resolved by keeping ONE op, `setPeerReveal`,
   * in the merged manifest).  `setPeerReveal` dispatches directly; the
   * `peer→peerWebid` + `action→reveal` value transforms below STAY.
   *
   * F1 circle content (5.3d) — `loadCircleItems` reads a circle's
   * stoop posts via the source ops `getBulletin` / `getFeed`.  Stoop
   * has neither as a real skill; both are aspirational names in
   * `circleContent.DEFAULT_SOURCES`.  `makeResolvingCallSkill` probes
   * stoop first (`DEFAULT_CIRCLE_ORIGINS`), so aliasing `getBulletin`
   * here lands the call on the real `listOpen` per-circle reader.
   * `getFeed` stays un-aliased so the resolver falls through every
   * origin → null → no duplicate items (otherwise both source ops
   * would resolve to the same store and each post would appear
   * twice).  Same alias pattern tasks-v0 uses for
   * `getMyTasks → listOpen` above.
   */
  // The alias table lives in `stoopOpAliases.js` — the circle scope reads the same one.

  // 2026-05-24 — retry-on-HI-race now lives in secure-agent's
  // sendToPeer (task). sa.peer.sendTo handles it transparently.
  // Wrapper alias kept for the existing fan-out callsite so the diff
  // stays small; new code can call sa.peer.sendTo directly.
  // The one caller is the circle-post/request fan-out (durable circle content), so it
  // rides with the hold-forward delivery guarantee: a member offline at fan time has
  // the post HELD and delivered on reconnect rather than dropped. Online delivery is
  // unchanged (reachable peer delivered immediately).
  const _saSendWithRetry = (sa, addr, payload) => sa.peer.sendTo(addr, payload, { guarantee: 'hold-forward' });

  /**
   * 2026-05-24 — list the circles this user has peer-confirmed
   * memberships in (their own `membership-redemption` items).
   * Used by the cross-instance /post fan-out to decide WHICH
   * rosters to address when the caller didn't pin an explicit
   * group.  Dedupes + skips empty.
   */
  // ── G7: live presence, scoped to what a caller already knows ────────────────
  //
  // `reachable-peers` answers "which peers can this device reach directly?" with a SIGNED list — which is a
  // contact graph, not neutral routing metadata. The skill is `authenticated`, so before it is enabled the
  // host must say what each CALLER may learn; `registerReachablePeersSkill` discloses nothing without a
  // scope (deny-by-default, see packages/core/src/skills/reachablePeers.js).
  //
  // basis's answer: **you learn only about peers you already share a circle with.** A co-member already
  // holds that roster, so telling them "I can reach Bram" adds a reachability fact rather than an identity.
  // Everyone else learns nothing, and a withheld peer is ABSENT rather than marked, so a stranger cannot
  // tell whether this device has peers at all.
  //
  // Enabled AFTER the roster seams below exist, and idempotent — `enableReachabilityOracle` returns early
  // if the skill is already registered.
  function _enableReachabilityOracle() {
    try {
      chatAgent.enableReachabilityOracle({
        peerScope: makeSharedCirclePeerScope({
          myCircleIds: () => _listMyKnownCircles(),
          rosterOf: async (circleId) => {
            const reply = await chatAgent.invoke(
              stoopAgent.address, 'listGroupRoster', [DataPart({ groupId: circleId })],
            );
            return reply?.[0]?.data?.members ?? [];
          },
        }),
      });
    } catch (err) {
      // Presence is an enhancement, never a boot dependency: a device that cannot answer "who can I reach"
      // still sends and receives. Log rather than fail the agent.
      console.info('[realAgent] reachability oracle not enabled:', err?.message ?? err);
    }
  }

  /**
   * A noticeboard item stoop just accepted goes into the CIRCLE's store — and the store's own mirror carries
   * it (a signed task-lane snapshot, fanned + catch-up served). This retired the second sync
   * implementation (a `circle-post` envelope fanned by hand, 2026-08-30 — option B). Which items qualify is
   * `noticeboardFan.js`'s decision; the canonical shape the store's registry needs is `noticeboardCarry.js`'s.
   */
  async function fanNoticeboardItem(item) {
    if (!shouldFanNoticeboardItem(item)) return;
    try {
      const explicit = noticeboardItemCircle(item);
      const circleIds = explicit ? [explicit] : await _listMyKnownCircles();
      if (circleIds.length === 0) {
        if (typeof console !== 'undefined') console.warn('[realAgent] noticeboard: the item names no circle and none is known — it stays local');
        return;
      }
      for (const circleId of circleIds) {
        try {
          await ensureCircleSync(circleId);   // the publish valve is wired at open; a post may come first
          const store = householdService.stores.getStore(circleId);
          await store.put(toCircleStorePost(item, { from: chatId.pubKey }), { by: chatId.pubKey });
          if (typeof console !== 'undefined') console.info(`[realAgent] noticeboard ${item.type} ${item.id} → circle store ${circleId} (the lane carries it)`);
        } catch (err) {
          if (typeof console !== 'undefined') console.warn(`[realAgent] noticeboard → circle store ${circleId} failed:`, err?.message ?? err);
        }
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[realAgent] noticeboard carry failed', err);
    }
  }
  /** The shell's bridge for a post that LANDED in a circle store from another member (see noticeboardCarry.js). */
  let _noticeboardLanded = null;

  async function _listMyKnownCircles() {
    try {
      const result = await chatAgent.invoke(
        stoopAgent.address, 'listMyCircles', [DataPart({})],
      );
      const circles = result?.[0]?.data?.circles ?? [];
      return Array.isArray(circles) ? circles : [];
    } catch {
      return [];
    }
  }

  /**
   * F1 5.3d — read the post's first `kind:'group'` target groupId
   * off the substrate item.  Stoop persists per-call targets under
   * `source.targets[]`; basis's circle-scope filter
   * (`circleScope.itemCircleId`) reads top-level `item.groupId`.
   * The listOpen-reply adapter uses this to bridge the two.
   */
  function _groupIdFromTargets(item) {
    const ts = item?.source?.targets;
    if (!Array.isArray(ts)) return undefined;
    const groupTarget = ts.find((t) => t?.kind === 'group' && typeof t.groupId === 'string');
    return groupTarget?.groupId;
  }

  /** Slugify a name → safe circleId for provisionMyCircle. */
  function _slugifyCircleId(name) {
    const slug = String(name ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'circle';
    return /^[a-z0-9]/.test(slug) ? slug : `c-${slug}`;
  }

  const rosterReads = createRosterReadCache();
  /* ─────────── basis's own ops on the waist (the `basis` appOrigin branch below) ─────────── */
  // `selfAgent` is this factory's own return value, assigned just before it is returned. The default
  // table needs the agent it runs on — `whoami` reads the identity, `transports` the relay, `muted` the
  // sender authorization — and that object does not exist until the end, so the table is built on FIRST
  // USE rather than here. A shell that mounts its own table never builds the default at all.
  let selfAgent = null;
  let mountedBasisOps = null;
  let defaultBasisOps = null;
  // Other LOCAL apps a shell mounts — a feature whose handlers hold the shell's own per-circle state
  // (its store, its seal strategy) and so cannot be an agent's skills. `lists` is the first: the
  // composable-lists service lived behind its own panel because nothing declared it.
  const mountedLocalApps = new Map();   // appOrigin → { manifest, ops }
  // …and the default for lists, on the same two levels as basis's: EVERY composition can run the lists ops its
  // catalogue offers, and a painting shell upgrades the table with the circle it has open. Without it a composition
  // that paints nothing — the box — offered `listLists` to its model and answered `unknown appOrigin "lists"`
  // (seen on the tablet, 2026-09-28). The circle a call means when it names none is the one household ops mean
  // here too (`resolveCircleId`), so a list and a shopping item made through the same door land in the same store.
  let defaultLists = null;
  const defaultLocalApp = (appOrigin) => {
    if (appOrigin !== 'lists') return null;
    return (defaultLists ??= {
      manifest: listsManifest,
      ops: makeListsOps({
        storeFor: (circleId) => householdService.stores.getStore(circleId),
        // No localisation on a bare agent: a key IS the message (the basis default table's rule).
        t: agentT,
        activeCircle: () => resolveCircleId({}),
        localActor: 'me',
        // a household bot: a chore ticked by its words is the chore's own `completeTask`, as the person (the gate)
        ...(opts.tasksCircleId ? { completeChore: ({ circleId, entry, ctx }) => callSkill('tasks', 'completeTask', { id: entry.id, circleId }, ctx) } : {}),
        // a household bot: what is done or has passed follows the household's setting
        ...(opts.tasksCircleId ? { passed: () => ({
          mode: passedPolicyFrom(paramsService.register.valueOf(PASSED_KEY)),
          days: passedDaysFrom(paramsService.register.valueOf(PASSED_DAYS_KEY)),
        }) } : {}),
      }),
    });
  };
  const basisOps = () => mountedBasisOps ?? (defaultBasisOps ??= createLocalBuiltins({
    catalogue: mergeManifests([{ manifest: basisManifest }]),
    // No localisation on a bare agent: a key IS the message, and a key is at least true. A shell that
    // mounts its own table brings the real resolver with it.
    t: agentT,
    agent: selfAgent,
  }));

  /**
   * A person at a door is a CALLER: before a door's call runs, the host gate checks their tier against the op's
   * visibility — the same check a peer meets (`checkCaller`). A host skill is judged by its own visibility (the
   * owner's own skills are `private`: self only, whatever tier anyone holds); any other op a door reaches is an
   * ordinary one (`authenticated`: an admitted member). A stranger (no record) is `public`. Fails closed: no gate,
   * no door call.
   * @param {string} opId  the op the call reaches, qualified with its app (`tasks.listOpen`); a bare id counts only
   *   when one app declares it (two: ambiguous, refused)
   * @returns {Promise<string|null>} the refusal's code, or null when the caller may go on
   */
  // The door's checks at the waist — tier · the door's map · the role — declared once (`botRungs.js`), asked in order,
  // deny-wins; each no is a refusal `{layer, code}` (`refusal.js`).
  const doorRefusal = async (opId, caller, visibility) => {
    const engine = hostAgent.policyEngine;
    if (!engine || typeof engine.checkCaller !== 'function') return refuse('tier', 'no-gate');
    const checks = botDoorChecks({
      checkCaller: (q) => engine.checkCaller(q),
      opLevel: typeof opts.doorOpLevel === 'function' ? opts.doorOpLevel : null,
      // what a role reaches follows the bot's one roles preset (`assistant.roles`), the same the menus read
      roleAllows: typeof opts.doorRoleAllows === 'function' ? (role, op) => opts.doorRoleAllows(role, op, rolesPresetFrom(paramsService.register.valueOf(ROLES_KEY))) : null,
      roleOf: (c) => doorRoles.get(c) ?? null,
    });
    return firstRefusal(checks, { opId, caller, visibility });
  };
  const doorRoles = new Map();   // callerId → the role the door gave them (setDoorCaller)

  let circleCalendar = null;   // the bot's calendar over the circle store, made on first use
  // A person's OWN appointments (of no circle): the same ops over their own-devices store, under an own Agenda — made
  // on first use (the shell hands the store; on web and mobile it is durable, so they come back after a restart).
  let ownCalendar = null;
  let ownCalendarStore = null;
  let ownCalendarReady = null;
  let circleTasks = null;      // the bot's chores over the circle store, made on first use
  /**
   * A door call's circle and actor. The circle door (`ctx.doorCircleId`, host-set) gates a circle-scoped caller id and
   * acts as the member's own ref (`ctx.doorActor`, host-set), so the chores and appointments they touch carry their ref
   * in the circle's own data; every other door acts as its caller.
   */
  const doorCircleOf = (ctx) => (typeof ctx?.doorCircleId === 'string' && ctx.doorCircleId ? ctx.doorCircleId : null);
  const actorOf = (ctx) => (doorCircleOf(ctx) && typeof ctx?.doorActor === 'string' && ctx.doorActor ? ctx.doorActor : (typeof ctx?.caller === 'string' && ctx.caller ? ctx.caller : null));
  /** A circle's people as the chore rules read them: its folded roster, by ref, with their handle and role. */
  async function circlePeople(circleId) {
    const r = await callSkill('stoop', 'listGroupMembers', { groupId: circleId }).catch(() => null);
    return (Array.isArray(r?.members) ? r.members : []).filter((m) => m?.webid).map((m) => ({ webid: m.webid, displayName: m.handle ?? m.displayName ?? null, role: m.role ?? null, channel: 'circle' }));
  }

  /** The household's book: every contact the bot keeps (its people, by the door they came in through). */
  const contactsBook = () => callSkill('stoop', 'listContacts', {}).then((r) => (Array.isArray(r) ? r : (r?.contacts ?? r?.items ?? []))).catch(() => []);

  /**
   * The people a door's person may name, and whether they may: in a circle the bot joined, its roster (whose handles are
   * every member's to see); else the household's book, under its names ceiling (`assistant.names`) — naming someone is
   * seeing them. With their roles, for the chore rules that also ask who may give a chore to whom. The ONE read every
   * "who" in a door's call is resolved through (a chore's person, an appointment's people, whose chores are asked for).
   * @param {string|null} caller  the person asking (null: the bot's owner)
   * @param {string|null} [inCircle]
   */
  async function peopleBook(caller, inCircle = null) {
    const people = inCircle ? await circlePeople(inCircle) : await contactsBook();
    const known = people.filter((c) => c && !c.hidden && c.webid && c.channel);
    const roles = Object.fromEntries(known.filter((c) => c.role).map((c) => [c.webid, c.role]));
    const policy = buildStandardRolePolicy(roles);
    const callerRole = caller ? (roles[caller] ?? null) : null;
    const roleMayAssign = caller ? policy.canReassign(caller) : true;
    const mayName = inCircle ? true : mayNamePeople({ setting: paramsService.register.valueOf(NAMES_KEY), callerId: caller, callerRole, roleMayAssign });
    return { known, roles, policy, roleMayAssign, mayName };
  }

  /**
   * One person, by the words a door's person used for them: "mij" (themself), their name, or — for someone without one —
   * the id the bot shows for them (`/users`), exactly. Who the bot knows is never listed on a miss: a directory is not
   * implied by anyone's own disclosure.
   * @returns {{ok: true, id: string|null, name: string|null, self: boolean} | {ok: false, reason: 'names-hidden'|'unknown'}}
   */
  function personIn(book, words, caller) {
    const w = String(words ?? '').trim();
    if (isSelfWord(w)) return { ok: true, id: caller ?? null, name: null, self: true };
    if (!book.mayName) return { ok: false, reason: 'names-hidden' };
    const byId = book.known.filter((c) => c.webid === w);
    const hit = byId.length ? byId : book.known.filter((c) => String(c.displayName ?? '').trim().toLowerCase() === w.toLowerCase());
    if (hit.length !== 1) return { ok: false, reason: 'unknown' };
    return { ok: true, id: hit[0].webid, name: hit[0].displayName ?? null, self: Boolean(caller) && hit[0].webid === caller };
  }

  /**
   * How a door's person sees the people of a chore or an appointment: id → `{you: true}` (themself), `{name}` (one the
   * household's names setting lets them see), or `{someone: true}` — never the id. In a circle the bot joined, the
   * household's book and its names setting are not the circle's: nobody is named but the reader — the household's
   * names never reach a circle, whoever is in both.
   */
  async function readerNamer(caller, inCircle = null) {
    const known = inCircle ? [] : (await contactsBook()).filter((c) => c && !c.hidden && c.webid);
    const roles = Object.fromEntries(known.filter((c) => c.role).map((c) => [c.webid, c.role]));
    const mayName = !inCircle && mayNamePeople({ setting: paramsService.register.valueOf(NAMES_KEY), callerId: caller, callerRole: roles[caller] ?? null, roleMayAssign: buildStandardRolePolicy(roles).canReassign(caller) });
    return (id) => {
      if (caller && id === caller) return { you: true };
      const name = mayName ? (known.find((c) => c.webid === id)?.displayName ?? null) : null;
      return name ? { name } : { someone: true };
    };
  }

  /**
   * A chores read for a door's person: each chore's holder, named when the household's names setting lets this person
   * see names ("ramen — Ann"), else only that it is taken; an open chore says nobody has it yet. The ids stay off the
   * entry the person (and their model) reads.
   */
  async function withChoreHolders(items, caller, inCircle = null) {
    if (!items.some((i) => Array.isArray(i?.holders))) return items;
    const tr = agentT;
    const nameOf = await readerNamer(caller, inCircle);
    return items.map((i) => {
      if (!Array.isArray(i?.holders)) return i;
      const { holders, ...base } = i;
      // the chore's state stays (a screen offers "I'll do it" on an open one, "Done" on a held one), and whether it is
      // the reader's own — never anyone's id
      const rest = { ...base, state: holders.length ? 'claimed' : 'open', ...(holders.includes(caller) ? { yours: true } : {}) };
      if (!holders.length) return { ...rest, label: tr('circle.lists.chore_open', { text: i.label }) };
      const names = holders.map(nameOf).filter((p) => !p.someone).map((p) => (p.you ? tr('circle.lists.chore_you') : p.name));
      return { ...rest, label: names.length ? tr('circle.lists.chore_held', { text: i.label, who: names.join(', ') }) : tr('circle.lists.chore_taken', { text: i.label }) };
    });
  }

  /** What of a chore a door's person reads: its words, its day, its state — never a person's id (`heldBy` says who). */
  const CHORE_READ_FIELDS = Object.freeze(['id', 'type', 'text', 'title', 'label', 'dueAt', 'state', 'status', 'openDeps', 'blockedBy', 'createdAt', 'containedBy']);
  const holdersOfTask = (it) => [...new Set([...(Array.isArray(it?.assignees) ? it.assignees : []), it?.assignee].filter(Boolean))];

  /** The chores' read (open · mine) for a door's person: each row with who holds it as they may see them, and whether it is theirs. */
  async function choresForReader(items, caller, inCircle = null) {
    const nameOf = await readerNamer(caller, inCircle);
    return items.map((it) => {
      const holders = holdersOfTask(it);
      const row = Object.fromEntries(CHORE_READ_FIELDS.filter((f) => it?.[f] !== undefined).map((f) => [f, it[f]]));
      return { ...row, heldBy: holders.map(nameOf), ...(caller && holders.includes(caller) ? { yours: true } : {}) };
    });
  }

  /**
   * The agenda's read for a door's person: who comes to each appointment as they may see them — the people it names and
   * whoever said they come, never one who said they do not — or, for one that names nobody, everyone (the household's
   * agenda is shared). The ids it was handed stay here.
   */
  async function eventsForReader(items, caller, inCircle = null) {
    const nameOf = await readerNamer(caller, inCircle);
    return items.map(({ attendees, rsvp, ...e }) => {
      const named = Array.isArray(attendees) ? attendees.filter((a) => typeof a === 'string' && a) : [];
      if (!named.length) return { ...e, everyone: true };
      const answered = rsvp && typeof rsvp === 'object' ? rsvp : {};
      const coming = Object.entries(answered).filter(([, r]) => r === 'accepted' || r === 'tentative').map(([who]) => who);
      return { ...e, comes: [...new Set([...named, ...coming])].filter((who) => answered[who] !== 'declined').map(nameOf) };
    });
  }

  /**
   * Words that name people ("Henk", "mij en Yvonne", "iedereen") → the household's people, under the names setting, as
   * the chore's who is read. `{ok, ids}` — no ids for "iedereen"/"everyone" — or the refusal a person reads.
   */
  async function peopleNamed(words, ctx) {
    const tr = agentT;
    const caller = actorOf(ctx);
    const parts = String(words ?? '').split(/\s*(?:,|&|\ben\b|\band\b)\s*/i).map((w) => w.trim()).filter(Boolean);
    const EVERYONE = /^(iedereen|allemaal|alle(n)?|everyone|everybody|all)$/i;
    if (!parts.length || parts.every((w) => EVERYONE.test(w))) return { ok: true, ids: [] };
    const book = await peopleBook(caller);
    const ids = [];
    for (const w of parts.filter((x) => !EVERYONE.test(x))) {
      const p = personIn(book, w, caller);
      if (p.ok && p.self) { if (caller) ids.push(caller); continue; }
      if (!p.ok && p.reason === 'names-hidden') return { ok: false, error: tr('circle.tasks.names_hidden'), refusal: refuse('door-settings', 'setting:names') };
      if (!p.ok) return { ok: false, error: tr('circle.tasks.no_such_person', { name: w }) };
      ids.push(p.id);
    }
    return { ok: true, ids: [...new Set(ids)] };
  }

  /**
   * The person a chore is GIVEN to, by the words a door's person said ("mij", "Bob", the id `/users` shows): resolved
   * through the one people read (`peopleBook` + `personIn`), then the chore rules — who may give a chore to whom, and
   * whether the one who gets it is someone their own role lets hold one (an observer looks, and holds no chore). Every
   * way a chore gets its who goes through here: an add that names a person, a chore given to someone.
   * `{ok: true, who, whoName}` — `who` the person's id, `whoName` their name — or the refusal a person reads; a word that
   * names nobody is refused, never kept as a holder.
   * `mayGive: false` — an op whose own door gate already decided who may give a chore (reassigning is the admin's, or
   * every member's under the flat roles): the add's rule of who may name whom is not asked again.
   */
  async function choreHolderFor(assignee, ctx, { mayGive = true } = {}) {
    const tr = agentT;
    const caller = actorOf(ctx);
    // in a circle: its roster is who may be named, and assigning follows the standard role table (no household setting)
    const inCircle = doorCircleOf(ctx);
    // Whether this person may SEE the others' names is the household's ceiling (`assistant.names`); naming someone
    // is seeing them, so where names are hidden a chore is given by name only by those who may see them.
    const book = await peopleBook(caller, inCircle);
    const { roles, policy, roleMayAssign } = book;
    const p = personIn(book, assignee, caller);
    if (!p.ok && p.reason === 'names-hidden') return { ok: false, error: tr('circle.tasks.names_hidden'), refusal: refuse('door-settings', 'setting:names') };
    if (!p.ok) return { ok: false, error: tr('circle.tasks.no_such_person', { name: String(assignee).trim() }) };
    const who = p.self ? (caller ?? 'me') : p.id;
    const whoName = p.self ? null : p.name;
    const allowed = !mayGive || assignAllowed({
      policy: inCircle ? 'roles' : paramsService.register.valueOf(ASSIGN_POLICY_KEY),
      roleMayAssign, callerId: caller, assigneeId: who,
    });
    if (!allowed) {
      // under `roles` the op's own rule said no (the tasks app's reassign rule); otherwise the household's setting did
      const byRole = inCircle || assignPolicyFrom(paramsService.register.valueOf(ASSIGN_POLICY_KEY)) === 'roles';
      return { ok: false, error: tr('circle.tasks.assign_refused'), refusal: byRole ? refuse('op-rule', 'cannot-reassign') : refuse('door-settings', 'setting:assign') };
    }
    if (who !== 'me' && roles[who] !== undefined && !policy.canClaim(who)) {
      return { ok: false, error: tr('circle.tasks.assignee_cannot', { name: whoName ?? String(assignee).trim() }), refusal: refuse('op-rule', 'assignee-cannot-claim') };
    }
    return { ok: true, who, whoName };
  }

  /**
   * The add of a chore with its person and its day (see the lists branch of `callSkill`) — or a line already there made
   * one (`makeChore`). A who or a when said on a line that is not a chore yet makes it one, in place: the same item.
   */
  async function addChoreFor(args, ctx, opId = 'addToList') {
    const tr = agentT;
    const { assignee, due, ...rest } = args;
    const caller = actorOf(ctx);
    let who = null;
    let whoName = null;
    if (typeof assignee === 'string' && assignee.trim()) {
      const given = await choreHolderFor(assignee, ctx);
      if (!given.ok) return given;
      ({ who, whoName } = given);
    }
    let made = await callSkill('lists', opId, rest, ctx);
    if (!made?.ok || !made.itemId) return made;
    // the add found or made a line, not a chore: the who or when makes it one (a chore already there is left as it is)
    if (made.kind !== 'task' || (made.duplicate && opId === 'addToList')) {
      const chore = await callSkill('lists', 'makeChore', { item: made.itemId, ...(rest.circleId ? { circleId: rest.circleId } : {}) }, ctx);
      if (!chore?.ok) return chore;
      if (chore.already && made.duplicate) return made;
      made = { ...made, kind: 'task', ...(opId === 'makeChore' ? { message: chore.message } : {}) };
    }
    const circleId = resolveCircleId(rest);
    if (typeof due === 'string' && due.trim()) {
      // the household's local day or time, as an appointment's `when` is read (a bare date is that day, not UTC)
      const iso = parseCalendarDate(due.trim());
      if (iso) {
        const store = householdService.stores.getStore(circleId);
        const item = await store.get(made.itemId);
        if (item) await store.put({ ...item, dueAt: iso }, { by: caller ?? 'me' });
      }
    }
    if (who) {
      // the claim path, the host vouching for the person the chore is for
      const claimed = await callSkill('tasks', 'claimTask', { id: made.itemId, actor: who, ...(rest.circleId ? { circleId: rest.circleId } : {}) });
      if (claimed?.ok === false) return claimed;
    }
    // The chore, who holds it and its day — the reply names the one who got it only where names may be seen; to
    // someone else it says it was given. One line, worded where every reply is (`replyLine`).
    const dueAt = typeof due === 'string' && due.trim() ? (parseCalendarDate(due.trim()) ?? null) : null;
    const holder = !who ? null : (who === caller || who === 'me') ? 'self' : (whoName ? 'named' : 'given');
    const chore = { title: made.entry ?? rest.text ?? null, holder, ...(holder === 'named' ? { name: whoName } : {}), ...(dueAt ? { dueAt } : {}) };
    if (!chore.title) return made;
    const done = { ...made, chore };
    return { ...done, message: replyLine(done, { opId, t: tr }) ?? made.message };
  }

  const TASK_BY_ID_OPS = new Set(['claimTask', 'completeTask', 'reassignTask', 'removeTask', 'editTask', 'unclaimTask']);
  /** The reads a door's person sees people in: the chores' open and own reads, and the agenda. */
  const READER_READS = new Set(['tasks.listOpen', 'tasks.listMine', 'calendar.listEvents']);
  const callSkill = async (appOrigin, opId, args, ctx = {}) => {
    // A door's call carries its person: check them first, and let tasks record who asked (the host vouches).
    if (typeof ctx?.caller === 'string' && ctx.caller) {
      // the op the call reaches — its app and its op: household's `listOpen` is not the chores', whatever a menu shows
      const refusal = await doorRefusal(`${appOrigin}.${opId}`, ctx.caller);
      if (refusal) return { ok: false, error: refusalText(refusal, typeof opts.t === 'function' ? opts.t : null), refusal };
      // ...and runs in the door's circle: a circle named in the args (a typed `--circleId=`, a model's pick, a
      // screen's data) is not followed — the person's role and the token do not look at the circle, so it is pinned
      // here, for every door alike. The bot's own calls (no caller) still name any circle.
      // The circle door is the one door with a circle of its own: the host composes it per joined circle and says
      // which (`ctx.doorCircleId`, never from a person's words) — its person's call lands there, never the household.
      const { circleId: _circle, groupId: _group, ...pinned } = args ?? {};
      args = typeof ctx.doorCircleId === 'string' && ctx.doorCircleId ? { ...pinned, circleId: ctx.doorCircleId } : pinned;
      if (appOrigin === 'tasks' || appOrigin === 'calendar') args = { ...args, actor: actorOf(ctx) };
    }
    // "wat moet Bob doen": someone's own chores, by the name the person asking uses — found among the people they may
    // name (naming someone is seeing them), on every shell; "mij", or no name, is their own.
    if (appOrigin === 'tasks' && opId === 'listMine' && typeof args?.who === 'string' && args.who.trim()) {
      const { who, ...rest } = args;
      const reader = actorOf(ctx);
      const inCircle = doorCircleOf(ctx);
      const p = personIn(await peopleBook(reader, inCircle), who, reader);
      const tr = agentT;
      if (!p.ok && p.reason === 'names-hidden') return { ok: false, error: tr('circle.tasks.names_hidden_read'), refusal: refuse('door-settings', 'setting:names') };
      if (!p.ok) return { ok: false, error: tr('circle.tasks.no_such_person', { name: who.trim() }) };
      if (p.self || !p.id) args = rest;
      else {
        // the read itself, as the host (the door's gate ran above), for the one named; then put through the reader's eyes
        const { caller: _caller, ...asHost } = ctx ?? {};
        const r = await callSkill('tasks', 'listMine', { ...rest, actor: p.id }, asHost);
        if (!Array.isArray(r?.items)) return r;
        const theirs = r.items.filter((it) => holdersOfTask(it).includes(p.id));
        return { ...r, items: reader ? await choresForReader(theirs, reader, inCircle) : theirs, whose: p.name ?? who.trim() };
      }
    }
    // The people reads, for a door's person: who holds a chore and who comes to an appointment, as the household's names
    // setting lets them see — `{you}` · `{name}` · `{someone}` — never anyone's id.
    if (typeof ctx?.caller === 'string' && ctx.caller && READER_READS.has(`${appOrigin}.${opId}`)) {
      const reader = actorOf(ctx);
      const inCircle = doorCircleOf(ctx);
      const { caller: _caller, ...asHost } = ctx;
      const r = await callSkill(appOrigin, opId, args, asHost);
      if (!Array.isArray(r?.items)) return r;
      return { ...r, items: appOrigin === 'calendar' ? await eventsForReader(r.items, reader, inCircle) : await choresForReader(r.items, reader, inCircle) };
    }
    // A household bot's chores are named in a person's words ("ik doe het vuilnis"): an op on ONE task takes the words
    // for its id — the task by id, else by its words (`matchEntry`) among the circle's open tasks; words that name no
    // task are said so in the household's words, not the store's.
    // A chore that says who and when (a household bot): "nieuwe taak voor Bert: X (maandag)". The add on a list whose
    // entries are chores takes an `assignee` (me, or a person the bot knows by name) and a `due` day; WHO may be named
    // is the bot's setting (`assistant.assignPolicy`), decided here — the model only passes the words on.
    // An appointment that NAMES people ("tandarts voor Henk"): the names become the household's people, as a chore's who
    // is read — so its reminder goes to them (and its maker), never everyone. "iedereen" names nobody: the shared agenda.
    if (appOrigin === 'calendar' && opId === 'addEvent' && opts.tasksCircleId && typeof args?.attendees === 'string' && args.attendees.trim()) {
      const named = await peopleNamed(args.attendees, ctx);
      if (!named.ok) return named;
      const { attendees, ...rest } = args;
      return callSkill('calendar', 'addEvent', named.ids.length ? { ...rest, attendees: named.ids } : rest, ctx);
    }
    if (appOrigin === 'lists' && (opId === 'addToList' || opId === 'makeChore') && opts.tasksCircleId && (args?.assignee || args?.due)) {
      return addChoreFor(args ?? {}, ctx, opId);
    }
    let namedTask = null;   // the task's words, when the door named it by them
    if (appOrigin === 'tasks' && opts.tasksCircleId && TASK_BY_ID_OPS.has(opId) && typeof args?.id === 'string' && args.id.trim()) {
      const store = householdService?.stores?.getStore?.(resolveCircleId(args ?? {}));
      if (store && typeof store.listByType === 'function') {
        const open = ((await store.listByType('task')) ?? []).filter((it) => !it?.completedAt);
        const words = (it) => it?.text ?? it?.title;
        // the words look first among the chores the op is about — claim: those nobody holds; complete: those the
        // person holds — so "de ramen" is one chore where the open ones hold two; nothing there: all the open ones
        const heldBy = (it) => [...(Array.isArray(it?.assignees) ? it.assignees : []), it?.assignee].filter(Boolean);
        const who = actorOf(ctx);
        const narrow = opId === 'claimTask' ? open.filter((it) => heldBy(it).length === 0)
          : (opId === 'completeTask' && who ? open.filter((it) => heldBy(it).includes(who)) : null);
        const first = narrow ? matchEntry(narrow, args.id, words) : null;
        const { entry: task, among } = (first?.entry || first?.among?.length) ? first : matchEntry(open, args.id, words);
        const tr = agentT;
        // `code: 'not-found'` when the words name nothing (a rule that may fall back to the model reads it); two that
        // match ask which, and that is an answer
        if (!task) return among.length ? { ok: false, error: tr('circle.lists.which_one', { options: choicesOf(among, words) }) } : { ok: false, code: 'not-found', error: tr('circle.tasks.no_such_task', { item: args.id }) };
        args = { ...args, id: task.id };
        namedTask = words(task) || null;
      }
    }
    // A chore given to someone by the words a person said ("geef de ramen aan Bob") goes to the person those words name,
    // read as an add's who is read — never the word itself as its holder. No one named: the chore is given up. The
    // reply says who got it as the asker may see them (`readerNamer`: themself, a name, or only that it was given).
    let givenTo = null;
    if (appOrigin === 'tasks' && opId === 'reassignTask' && opts.tasksCircleId && typeof args?.newAssignee === 'string' && args.newAssignee.trim()) {
      const given = await choreHolderFor(args.newAssignee, ctx, { mayGive: false });
      if (!given.ok) return given;
      args = { ...args, newAssignee: given.who };
      const caller = actorOf(ctx);
      const seen = (given.who === 'me' || (caller && given.who === caller)) ? { you: true } : (await readerNamer(caller, doorCircleOf(ctx)))(given.who);
      givenTo = seen.you ? { holder: 'self' } : seen.name ? { holder: 'named', name: seen.name } : { holder: 'given' };
    }
    // §1b 1d — generic-capability dispatch. A synthetic op-id (`__generic__:app:atom:noun`)
    // carries a manifest-DECLARED noun that has no bespoke op-id; decode it at the waist and
    // route to the app's capability entry ("declare a noun → get CRUD free"). ADDITIVE: a
    // normal (non-generic) opId isn't matched here and flows to the branches below unchanged.
    if (isGenericOpId(opId)) {
      const g = decodeGenericOpId(opId);
      // household is the only app with a capability entry today; `by`/`circleId` are sourced
      // exactly like the bespoke household path below (chatId.pubKey actor · resolved circle).
      if (g?.app === 'household' && householdService) {
        const capCtx = {
          circleId: resolveCircleId(args),
          // made by the PERSON at the door (as chores and appointments are, `actorOf`), never by the device: a note on a
          // household bot was "made by the bot" for everyone, and whose it was could not be judged
          by:       actorOf(ctx) ?? chatId?.pubKey,
        };
        // A noun PEOPLE write (`writtenBy: 'people'`): an item may be named by its words, and changing or removing one is
        // the maker's or an admin's — anyone else is refused, and nothing changes.
        if (isPeopleWritten(householdManifest, g.noun) && ['get', 'update', 'remove'].includes(g.atom)) {
          const listed = await householdService.callCapability('list', g.noun, {}, capCtx);
          const items = (listed?.result?.items ?? listed?.items ?? []).filter((i) => i && i.type === g.noun);
          const ref = String(args?.id ?? '').trim();
          const wordsOf = (i) => String(i.body ?? i.text ?? i.title ?? '');
          let item = items.find((i) => i.id === ref) ?? null;
          if (!item && ref) {
            const { entry, among } = matchEntry(items, ref, wordsOf);
            if (!entry && among?.length) return { ok: false, error: agentT('circle.lists.which_one', { options: choicesOf(among, wordsOf) }) };
            item = entry ?? null;
          }
          if (!item) return { ok: false, code: 'not-found', error: agentT('circle.notes.not_there', { item: ref ? ` (${ref})` : '' }) };
          if (g.atom !== 'get' && item.createdBy !== capCtx.by && doorRoles.get(actorOf(ctx)) !== 'admin') {
            return { ok: false, code: 'forbidden', error: agentT('circle.notes.not_yours', { text: wordsOf(item) }) };
          }
          args = { ...(args ?? {}), id: item.id, _words: wordsOf(item) };
        }
        const done = await householdService.callCapability(g.atom, g.noun, args ?? {}, capCtx);
        // A people-written noun answers in words a door can say: what was written or taken away, and the list as a list.
        if (isPeopleWritten(householdManifest, g.noun) && done?.ok !== false) {
          const inner = done?.result ?? done;
          const words = (i) => String(i?.body ?? i?.text ?? i?.title ?? '');
          // the generic answer stays whole (`via`, `atom`, `result`); the words ride beside it
          if (g.atom === 'add') return { ...done, itemId: inner?.item?.id ?? null, entry: words(inner?.item), message: agentT('circle.notes.added', { text: words(inner?.item) }) };
          if (g.atom === 'remove') return { ...done, entry: args?._words ?? '', message: agentT('circle.notes.removed', { text: args?._words ?? '' }) };
          if (g.atom === 'list') {
            const items = (inner?.items ?? []).filter((i) => i && i.type === g.noun && words(i).trim());
            return { ...done, title: agentT('circle.notes.title'), items: items.map((i) => ({ id: i.id, label: words(i), text: words(i), type: g.noun })) };
          }
        }
        return done;
      }
      // An app with no generic handler → a structured error, mirroring how callSkill
      // surfaces skill errors (never throw for this boundary case).
      return { ok: false, error: 'generic-capability-unavailable' };
    }
    if (appOrigin === 'params') {
      // #36 — the register's read/write surface, routed to paramsService. The `paramsManifest` is the CONTRACT
      // that gates it: only its declared ops (set-param / get-param / list-user-params) dispatch; `set-param`
      // is the ONE kind-gated write (refuses kind:internal + unknown). circleId carried for circle-scoped
      // params (persistence wired when a circle param lands).
      if (!paramsManifest.operations.some((o) => o.id === opId)) return { ok: false, error: 'unknown-op', app: 'params', op: opId };
      // ── The settings-restore ops (#44's choices as DECLARED ops — the restore-settings flow's steps). ──
      if (opId === 'restore-probe') {
        const ctx = settingsRestoreCtx;
        if (!ctx.medium) return { ok: true, outcome: 'no-medium' };
        const { status, value: podBlob } = await probeSettingsMediumDetailed(ctx.medium);
        if (status === 'undecryptable') return { ok: true, outcome: 'undecryptable' };
        if (status === 'transport') return { ok: true, outcome: 'transport' };
        // openable | missing → safe. When the boot already attached, ITS capture is the honest diff —
        // post-attach the hydrate cycle has reconciled the blob, so a recompute would read the
        // already-adopted values and claim 'clean' (the hydrate-adoption bug this flow now repairs:
        // the register holds the POD's value before the user chose, so BOTH merge choices below are
        // real writes). A fresh attach (the boot held) computes the diff first, then attaches.
        if (!ctx.attached) {
          let conflicts = [];
          try {
            let localBlob = await settingsDataSource.read(SETTINGS_SHARED_PROBE_PATH);
            if (typeof localBlob === 'string') { try { localBlob = JSON.parse(localBlob); } catch { localBlob = null; } }
            let pod = podBlob;
            if (typeof pod === 'string') { try { pod = JSON.parse(pod); } catch { pod = null; } }
            conflicts = computeSettingsConflicts(localBlob, pod);
          } catch { /* no local blob → no conflicts */ }
          await settingsDataSource.attachInner(ctx.medium);
          ctx.attached = true;
          ctx.conflicts = conflicts;
        }
        return ctx.conflicts.length
          ? { ok: true, outcome: 'conflicts', conflicts: ctx.conflicts }
          : { ok: true, outcome: 'clean' };
      }
      if (opId === 'restore-merge') {
        const choices = args?.choices && typeof args.choices === 'object' ? args.choices : null;
        if (!choices) return { ok: false, outcome: 'error', error: 'choices-required' };
        // BOTH choices are real writes (the hydrate-adoption fix): by merge time the live register
        // already holds the POD's value — hydrate adopted it before the user chose — so 'mine' must
        // write the local value BACK, not merely do nothing. Found by this migration, 2026-08-13.
        const applied = [];
        for (const [key, decision] of Object.entries(choices)) {
          const c = settingsRestoreCtx.conflicts.find((x) => x.key === key);
          if (!c) continue;
          const value = decision === 'theirs' ? c.theirs : decision === 'mine' ? c.mine : undefined;
          if (value === undefined) continue;
          const r = await paramsService.callSkill('set-param', { key, value }, { circleId: null });
          if (r?.ok !== false) applied.push(key);
        }
        settingsRestoreCtx.conflicts = settingsRestoreCtx.conflicts.filter((c) => !applied.includes(c.key));
        return { ok: true, applied };
      }
      if (opId === 'restore-resolve-mismatch') {
        const choice = args?.choice;
        if (choice === 'local') return { ok: true, choice };   // the default: stay held, write nothing
        if (choice === 'phrase') return { ok: true, choice };  // the shell routes to the recovery wizard
        if (choice === 'overwrite') {
          if (!settingsRestoreCtx.medium) return { ok: false, outcome: 'error', error: 'no-medium' };
          await settingsDataSource.attachInner(settingsRestoreCtx.medium);
          settingsRestoreCtx.attached = true;
          return { ok: true, choice };
        }
        return { ok: false, outcome: 'error', error: 'unknown-choice' };
      }
      const paramsResult = await paramsService.callSkill(opId, args ?? {}, { circleId: resolveCircleId(args) });
      // A successful set-param is a SETTINGS-CHANGE on the trail (the whitelisted shape: the param
      // KEY as the target pointer, never its value). Owner-attributed — recording is not display;
      // the card only ever shows a trail whose actor the viewer explicitly opened.
      if (opId === 'set-param' && paramsResult?.ok !== false && opts.deviceLog) {
        const entry = makeAgentTrailEntry({
          actor: chatId?.pubKey ?? 'owner', op: 'set-param', kind: 'settings-change',
          target: { kind: 'param', ref: typeof args?.key === 'string' ? args.key : null },
          via: 'owner', outcome: 'ok',
        });
        if (entry) opts.deviceLog.append(entry);
      }
      // The history-mirror switch flips LIVE: reconcile the running sink with the new value now,
      // not on the next boot (on = start following + hydrate a fresh log; off = final flush + stop).
      if (opId === 'set-param' && paramsResult?.ok !== false && args?.key === HISTORY_MIRROR_PARAM_KEY) {
        historyMirrorSync?.();
        viewLanesSync?.();   // view lanes ride the same switch: off stops them, on resumes granted ones
      }
      // The transport mode applies LIVE too — the register is the one home, this hook the one
      // application point (shells and builtins just set-param).
      if (opId === 'set-param' && paramsResult?.ok !== false && args?.key === 'transport.mode'
          && ['nkn', 'relay', 'both'].includes(args?.value)) {
        try { sa.setTransportMode?.(args.value); } catch { /* the register still holds the value */ }
      }
      return paramsResult;
    }
    if (appOrigin === 'household') {
      const circleId = resolveCircleId(args);
      // The DISSOLVED cores route through the uniform invoke to the wireSkill-wrapped pure cores on the
      // dedicated household agent (S1 InternalTransport fast-path + the callSkill security gate). circleId
      // is injected into the DataPart args so the wired `storeFor` resolves the per-circle CircleItemStore.
      if (HOUSEHOLD_WIRED_OPS.has(opId)) {
        // Wire this circle's CircleItemStore ↔ its peer mirror (publish + inbound), once per circle.
        await ensureCircleSync(circleId);
        const parts = await chatAgent.invoke(householdAgent.address, opId, [DataPart({ ...(args ?? {}), circleId })]);
        const data  = Array.isArray(parts) ? parts[0]?.data : null;
        return adaptWiredHouseholdReply(opId, data, args);
      }
      // /brief contributor — derived from the wired store (the dissolved app has no briefSummary core).
      if (opId === 'household_briefSummary') return householdBriefSummary(circleId);
      // Everything else on the 'household' app-origin (calendar_* passthrough, addMember, getChoreSnapshot,
      // resolveContact, help, registerName) is a hostAgent skill — route it there unchanged.
      const parts = [DataPart(args ?? {})];
      const result = await chatAgent.invoke(hostAgent.address, opId, parts);
      const first = Array.isArray(result) ? result[0] : null;
      return first?.data ?? null;
    }
    if (appOrigin === 'tasks') {
      // Derived ops (not in the real circle agent): build the reply
      // from listMine + a small shape adapter.
      if (opId === 'briefSummary' || opId === 'tasks_briefSummary') {
        const list = await callSkill('tasks', 'listMine', args?.actor ? { actor: args.actor } : {});
        const items = (list?.items ?? []).filter((t) => t.state === 'open');
        if (items.length === 0) return { ok: true };   // empty → /brief skips
        const tr = agentT;
        return {
          items:   items.map((t) => ({ id: t.id, label: t.text ?? t.title })),
          message: tr('circle.tasks.brief', { count: items.length }),
        };
      }
      if (opId === 'searchTasks') {
        const q = String(args?.query ?? '').toLowerCase();
        if (!q) return { items: [] };
        const list = await callSkill('tasks', 'listMine', args?.actor ? { actor: args.actor } : {});
        const hits = (list?.items ?? []).filter((t) =>
          String(t.text ?? t.title ?? '').toLowerCase().includes(q),
        );
        return {
          items: hits.map((t) => ({ id: t.id, label: t.text ?? t.title, type: 'task' })),
        };
      }
      // A household bot (`opts.tasksInCircle`): the chores are the task noun's verbs over the circle's ONE store, beside
      // the lists and the calendar — not the separate tasks agent, its op aliases and arg shims. The bot's key is the
      // authority (the door's role gate ran first); the person a call is for is who the chore records.
      if (opts.tasksInCircle && TASKS_IN_CIRCLE_OPS.includes(opId)) {
        const ops = (circleTasks ??= makeTasksOps({
          storeFor: (circleId) => householdService.stores.getStore(circleId),
          activeCircle: () => resolveCircleId({}),
          hostActor: chatId.pubKey,
          rolePolicy: buildStandardRolePolicy({ [chatId.pubKey]: 'admin' }),
        }));
        await ensureCircleSync(resolveCircleId(args ?? {}));
        const data = await ops[opId](args ?? {});
        return adaptTasksReply(opId, data, { actor: args?.actor ?? null, named: namedTask, givenTo, args: args ?? {} });
      }
      const realOpId = TASKS_OP_ALIAS[opId] ?? opId;
      // Per-op arg normalisation between the chat-shell vocabulary
      // and tasks-v0's real skill arg names.  NB the rejectTask
      // `reason→note` rewrite + the submitTask note-default were REMOVED
      // in the Part G dissolve (2026-06-17): the manifest now declares
      // the real `note` param directly, so no shell-side vocab bridge.
      let realArgs = args ?? {};
      if (realOpId === 'provisionMyCircle' && !realArgs.circleId && realArgs.name) {
        // /circle-new sends a human name; real skill demands a slug.
        realArgs = { ...realArgs, circleId: _slugifyCircleId(realArgs.name) };
      }
      // Pass through any reject note so the adapter can append it
      // to the chat-shell reply message.
      const noteHint = (realOpId === 'rejectTask') ? realArgs.note : undefined;
      if (realOpId === 'issueInvite') {
        // Chat-shell flag `ttl-hours` → real arg `ttlMs`.  Default 24h
        // when omitted.
        const hours = Number.isFinite(Number(realArgs['ttl-hours']))
          ? Number(realArgs['ttl-hours']) : 24;
        realArgs = { ...realArgs, ttlMs: hours * 60 * 60 * 1000 };
      }
      // (B3) — circle admin skills require circleId; auto-inject
      // from the configured circle so the user doesn't have to type it.
      const CIRCLE_AUTO_INJECT = new Set([
        'getCircleConfig', 'pauseCircle', 'unpauseCircle',
        'archiveCircle',   'unarchiveCircle', 'issueInvite',
        'listAwaitingApproval', 'getMyCircles',
        'suggestSchedule', 'acceptSchedule',
        'getMyAvailability', 'setMyAvailability', 'setAvailabilityOptIn',
        'getCircleAvailability', 'listCircleMembers',
      ]);
      // 2026-05-24 — listCircleMembers is a derived op (no real skill);
      // dispatch to getCircleConfig + the adapter unpacks members[].
      if (realOpId === 'listCircleMembers') {
        realArgs = { ...realArgs, _derivedFromGetCircleConfig: true };
        // Swap to the real skill name; adapter inspects opId (not
        // realOpId) so it still hits the listCircleMembers branch.
        const parts = [DataPart({ circleId: realArgs.circleId })];
        const result = await chatAgent.invoke(tasksCircle.address, 'getCircleConfig', parts);
        const first = Array.isArray(result) ? result[0] : null;
        return adaptTasksReply('listCircleMembers', first?.data ?? null);
      }
      if (CIRCLE_AUTO_INJECT.has(realOpId) && !realArgs.circleId) {
        const circleId = opts.tasksCircleConfig?.circleId ?? tasksDefaultCircleId;
        realArgs = { ...realArgs, circleId };
      }
      if (realOpId === 'archiveCircle' && realArgs.confirm !== true) {
        // two-step confirm.
        const tr = agentT;
        return { ok: false, error: tr('circle.tasks.state.archive_confirm') };
      }
      if (realOpId === 'suggestSchedule' && realArgs['lookahead-days']) {
        realArgs = {
          ...realArgs,
          lookaheadDays: Number(realArgs['lookahead-days']),
        };
      }
      if (realOpId === 'acceptSchedule' && realArgs.slotKey) {
        // decode "taskId|slotStart|slotEnd" packed into row id.
        const parts = String(realArgs.slotKey).split('|');
        if (parts.length === 3) {
          realArgs = {
            ...realArgs,
            taskId:    parts[0],
            slotStart: Number(parts[1]),
            slotEnd:   Number(parts[2]),
          };
        }
      }
      if (realOpId === 'setMyAvailability' && realArgs.cellKey) {
        // decode "week|day|half|state" packed into the cell id.
        // day: 0-6 (Mon-Sun); half: 'AM'|'PM'; state cycles
        // unknown → open → tight → unavailable → unknown.
        const parts = String(realArgs.cellKey).split('|');
        if (parts.length === 4) {
          realArgs = {
            ...realArgs,
            week:  parts[0],
            day:   Number(parts[1]),
            half:  parts[2],
            state: parts[3],
          };
        }
      }
      if (realOpId === 'setAvailabilityOptIn' && typeof realArgs.on === 'string') {
        // Chat-shell enum 'on'/'off' → real arg {optedIn: boolean}.
        realArgs = {
          ...realArgs,
          optedIn: realArgs.on.toLowerCase() === 'on',
        };
      }
      if (realOpId === 'redeemInvite' && typeof realArgs.invite === 'string') {
        // User pastes either a QR URL (`onderling-invite://<base64url>`) or
        // raw JSON.  Decode the URL form back to the invite object that
        // the real skill expects.  Pass JSON through unchanged.
        let inv = realArgs.invite.trim();
        const PREFIX = 'onderling-invite://';
        if (inv.startsWith(PREFIX)) {
          try {
            const b64 = inv.slice(PREFIX.length);
            const padded = b64.replace(/-/g, '+').replace(/_/g, '/')
                              + '=='.slice(0, (4 - b64.length % 4) % 4);
            const json = typeof globalThis.atob === 'function'
              ? globalThis.atob(padded) : padded;
            realArgs = { ...realArgs, invite: JSON.parse(json) };
          } catch (err) {
            const tr = agentT;
            return { ok: false, error: tr('circle.tasks.invite.bad_url', { error: err.message ?? String(err) }) };
          }
        } else if (inv.startsWith('{')) {
          try {
            realArgs = { ...realArgs, invite: JSON.parse(inv) };
          } catch (err) {
            const tr = agentT;
            return { ok: false, error: tr('circle.tasks.invite.bad_json', { error: err.message ?? String(err) }) };
          }
        }
      }
      // F1 multi-circle (5.3) — when the dispatch carries a circle scope
      // (circleId injected by scopeReadyDispatch, or an explicit circle),
      // make sure that circle's circle exists before routing.  Unscoped
      // calls leave circleId unset → resolver falls back to the primary
      // circle (legacy single-circle behaviour).  ensureCircle is idempotent.
      if (typeof realArgs.circleId === 'string' && realArgs.circleId) {
        // ORDER IS LOAD-BEARING: sync FIRST, then the tasks circle.
        //
        // `ensureCircleSync` provisions this circle's pod-cache MEDIUM, and the store is bound to
        // its data source AT BUILD TIME (`dataSourceFor`). `ensureCircle` builds that store through
        // the injected `circleStoreFor`. Run the other way round — as this did — and a pod-backed
        // circle whose first touch is a task op gets a store on the LOCAL backing, permanently: the
        // medium is then provisioned and used for nothing, so writes never reach the pod and the
        // peer mirror is skipped as "pod-carried". Content goes nowhere (F-007).
        //
        // One-store-per-circle (G-C1): this circle's tasks live in the SAME CircleItemStore as its
        // other items, so the household store<->mirror sync is the single fan-out path — no separate
        // tasks mirror. Both calls are idempotent per circle.
        await ensureCircleSync(realArgs.circleId);
        await tasksCircle.ensureCircle(realArgs.circleId);
      }
      const parts = [DataPart(realArgs)];
      const result = await chatAgent.invoke(tasksCircle.address, realOpId, parts);
      const first = Array.isArray(result) ? result[0] : null;
      const data  = first?.data ?? null;
      if (data && noteHint) data.noteHint = noteHint;
      const adapted = adaptTasksReply(opId, data, { actor: realArgs?.actor ?? args?.actor ?? null, named: namedTask, givenTo, args: realArgs ?? args ?? {} });
      // On a household bot "wat moet ik nog doen" is MINE: the open chores this person claimed (the chat-shell reading of
      // `listMine` — everything open — stays for the painting shells, which show every chore on their own screen).
      const mineOf = opts.tasksCircleId && opId === 'listMine' ? (args?.actor ?? null) : null;
      if (mineOf && Array.isArray(adapted?.items)) {
        const holds = (it) => [...(Array.isArray(it?.assignees) ? it.assignees : []), it?.assignee].filter(Boolean).includes(mineOf);
        return { ...adapted, items: adapted.items.filter(holds) };
      }
      return adapted;
    }
    if (appOrigin === 'stoop') {
      // Derived: briefSummary builds a summary from listOpen since
      // stoop doesn't expose its own briefSummary skill.
      if (opId === 'briefSummary' || opId === 'stoop_briefSummary') {
        const list = await callSkill('stoop', 'listFeed', {});
        const items = list?.items ?? [];
        if (items.length === 0) return { ok: true };   // empty → /brief skips
        const tr = agentT;
        return {
          items:   items.slice(0, 3).map((p) => ({ id: p.id, label: p.text ?? p.label })),
          message: tr('circle.noticeboard.brief', { count: items.length }),
        };
      }
      // Derived: searchPosts (no dedicated skill in stoop today).
      if (opId === 'searchPosts') {
        const q = String(args?.query ?? '').toLowerCase();
        if (!q) return { items: [] };
        const list = await callSkill('stoop', 'listFeed', {});
        const hits = (list?.items ?? []).filter((p) =>
          String(p.text ?? p.label ?? '').toLowerCase().includes(q),
        );
        return {
          items: hits.map((p) => ({ id: p.id, label: p.text ?? p.label, type: 'post' })),
        };
      }
      const realOpId = STOOP_OP_ALIAS[opId] ?? opId;
      // Arg normalisation between chat-shell vocabulary + real stoop.
      let realArgs = args ?? {};
      if (realOpId === 'setPeerReveal') {
        // Chat-shell sends {peer, action: 'on'/'off'}; real takes
        // {peerWebid, reveal: boolean}.
        if (realArgs.peer && !realArgs.peerWebid) {
          realArgs = { ...realArgs, peerWebid: realArgs.peer };
        }
        if (typeof realArgs.action === 'string' && realArgs.reveal === undefined) {
          realArgs = { ...realArgs, reveal: realArgs.action.toLowerCase() === 'on' };
        }
      }
      // Part G dissolve (2026-06-17) — the markReturned itemId→requestId
      // bridge was REMOVED: the merged manifest declares the real param
      // `requestId` directly (the `/lend-return` gate binds `arg:
      // 'requestId'`), so the chat-shell already sends `requestId` —
      // no shell-side rename needed.
      if (realOpId === 'setHolidayMode') {
        // Chat-shell sends {on: 'on'|'off'} (enum from /holiday-mode
        // <on|off>); real skill takes {on: boolean}.
        if (typeof realArgs.on === 'string') {
          realArgs = { ...realArgs, on: realArgs.on.toLowerCase() === 'on' };
        }
      }
      // Chat-shell trust enums use English ('known' / 'trusted');
      // stoop's underlying skill persists Dutch ('bekend' / 'vertrouwd').
      // Translate at the boundary so the chat surface stays EN-first.
      const TRUST_EN_TO_NL = { known: 'bekend', trusted: 'vertrouwd' };
      if (realOpId === 'listContacts') {
        // Chat-shell flag `min-trust` → real arg `minTrust`.
        if (realArgs['min-trust'] && !realArgs.minTrust) {
          realArgs = {
            ...realArgs,
            minTrust: TRUST_EN_TO_NL[realArgs['min-trust']] ?? realArgs['min-trust'],
          };
        }
      }
      if (realOpId === 'setContactTrust') {
        if (realArgs.level === 'none') {
          // Chat-shell uses 'none' to clear; real skill takes null.
          realArgs = { ...realArgs, level: null };
        } else if (TRUST_EN_TO_NL[realArgs.level]) {
          realArgs = { ...realArgs, level: TRUST_EN_TO_NL[realArgs.level] };
        }
      }
      if (realOpId === 'getContactShareQr' && realArgs.trust) {
        // Chat-shell flag `trust` → real arg `trustOffer` + EN→NL.
        realArgs = {
          ...realArgs,
          trustOffer: TRUST_EN_TO_NL[realArgs.trust] ?? realArgs.trust,
        };
      }
      if (realOpId === 'getContactShareQr') {
        // 2026-05-27 — inject the chat-shell's current NKN peer
        // address into the card so the scanner can DM straight back
        // (no pod lookup needed).  The stoop substrate has no NKN
        // identity of its own; only the chat-layer secure-agent does.
        // …gated by the user's publication lock: a contact card is the single most travelled copy of
        // this address, so "never share my global address" has to hold here first. Off ⇒ the card simply
        // carries no peerAddr and the scanner reaches them by the other rungs.
        // WHICHEVER address this device can actually be reached at — the RELAY's first (2026-09-18). It
        // was the mesh address first, "because it survives a change of relay"; but the card carries the
        // relay(s) below, so a change of relay is covered by that field, and the alpha's one default
        // transport is the relay: a card naming the mesh sent a tester's first message down the one road
        // that had been unreachable from the sharer's own browser all morning (`peerAddr=d9b44acc…` on
        // Frits' card, the day NKN's public network would not connect). The mesh address goes on the card
        // only when it is the only address this device has — and until 2026-09-09 a relay-only device
        // (every headless one, a browser with the mesh off) put NO address on the card at all, naming a
        // person the scanner had no way to write to. The publication lock below still governs both:
        // "never share my global address" is a decision about the address, not about the transport.
        const myPeerAddr = shareableAddress(
          sa?.relay?.address ?? sa?.peer?.address ?? null,
          // The LIVE register value (device scope) — a flip in my-data binds here immediately.
          // opts stays as a test override; no shell passes it.
          opts.shareNknAddress ?? (() => paramsService.register.valueOf(SHARE_NKN_ADDRESS_PARAM_KEY) !== false),
        );
        if (myPeerAddr) realArgs = { ...realArgs, peerAddr: myPeerAddr };
        // My current person key and its chain ride the card — the Hi between persons (2026-09-16).
        if (personKey) realArgs = { ...realArgs, personKey: personKeyForContacts(), personKeyLinks: Array.isArray(personKey.links) ? personKey.links : [] };
        // WHERE I CAN BE FOUND (Frits, 2026-09-11): the primary relay by default; every extra relay this
        // device is on only when the person named it (`extraRelays`, off by default — relay diversity is
        // an unlinkability strategy, and a card listing every relay hands its holder a linkage across
        // them). Never mDNS. An extra relay this device is NOT on is not put on the card: a card must
        // not name a place the person cannot be reached. Under the same publication lock as the address.
        if (myPeerAddr) {
          const on = (() => { try { return sa.relays.list().map((r) => r.url).filter(Boolean); } catch { return []; } })();
          const primary = sa.relay?.url ?? on[0] ?? null;
          const wanted = String(realArgs.extraRelays ?? realArgs['extra-relays'] ?? '').split(',').map((u) => u.trim()).filter(Boolean);
          const relays = [];
          if (primary) relays.push(primary);
          for (const u of wanted) if (on.includes(u) && !relays.includes(u)) relays.push(u);
          if (relays.length) realArgs = { ...realArgs, relays };
        }
        // a FUNCTION profile (a household bot) says so on its card — for display and the add-flow's words only; what a
        // person's app signs to is decided by their own admission, never by this claim
        try { if ((await agentsRegistryRef?.lookup?.('default'))?.kind === 'function') realArgs = { ...realArgs, bot: true }; } catch { /* a person's card */ }
        if (typeof console !== 'undefined') {
          console.log('[realAgent] getContactShareQr inject peerAddr=' + (myPeerAddr ? myPeerAddr.slice(0,16)+'…' : 'NONE'));
        }
      }
      // F1 5.3d — per-circle posts.  Stoop's browser bundle in
      // basis runs single-group (`cc-default-circle`); the
      // substrate's `postRequest` falls back to that bundle groupId
      // when `args.targets` is empty, so a per-call `groupId` (from
      // `scopeReadyDispatch`) would otherwise be silently dropped.
      // Pre-build `targets` here so the post lands tagged with the
      // ACTIVE circle's id, and `listOpen` / `keepForCircle` (via
      // `getBulletin` alias) can separate circle A from circle B
      // without a substrate multi-group rewrite.
      if (realOpId === 'postRequest'
          && typeof realArgs.groupId === 'string'
          && realArgs.groupId
          && !Array.isArray(realArgs.targets)) {
        realArgs = {
          ...realArgs,
          targets: [{ kind: 'group', groupId: realArgs.groupId }],
        };
      }
      // circle/group skills. Several require groupId; the
      // chat-shell knows which circle this agent is in (single-circle
      // mode), so auto-inject when missing.
      const REQUIRES_GROUP_ID = new Set([
        'getGroupRules', 'leaveGroup', 'getMyMembershipStatus',
        'editGroupRules', 'removeMember',
      ]);
      if (REQUIRES_GROUP_ID.has(realOpId) && !realArgs.groupId) {
        realArgs = {
          ...realArgs,
          groupId: opts.stoopGroup ?? 'cc-default-circle',
        };
      }
      // Identity 5B/C — present THIS device's per-circle ADDRESS
      // (deriveCircleAddress) on the direct redeem/create path so the substrate
      // records it into the roster (the roster-recording wire). ONE seam for
      // BOTH platforms (invariant #1): the join/create wizards dispatch through
      // here, so neither web nor mobile threads it. Derived from the resolved
      // groupId off the default profile seed; additive — an explicit caller value
      // wins, an op without a groupId is untouched. NOT verifyMembershipCodeForPeer:
      // there the JOINER's address is forwarded by the peer bridge, not the admin's.
      const PRESENTS_CIRCLE_ADDRESS = new Set(['redeemMembershipCode', 'createGroupV2']);
      if (PRESENTS_CIRCLE_ADDRESS.has(realOpId)
          && typeof realArgs.groupId === 'string' && realArgs.groupId
          && !realArgs.circleAddress) {
        try {
          realArgs = { ...realArgs, circleAddress: deriveCircleAddress(deviceDerivationSeed, realArgs.groupId) };
        } catch { /* address derivation is additive — never block the redeem/create */ }
      }
      if (realOpId === 'leaveGroup' && realArgs.confirm !== true) {
        // style two-step confirm. Short-circuit before invoke.
        const tr = agentT;
        return { ok: false, error: tr('circle.groups.leave_confirm') };
      }
      // Synthesize a `/groups` op locally — there's no listMyGroups
      // skill in single-circle mode; we render what we know.  After
      // invoke for member count.
      if (realOpId === 'getCurrentGroup') {
        const membersResult = await chatAgent.invoke(
          stoopAgent.address, 'listGroupMembers',
          [DataPart({ groupId: opts.stoopGroup ?? 'cc-default-circle' })],
        );
        const members = membersResult?.[0]?.data?.members ?? [];
        const tr = agentT;
        return {
          title:       tr('circle.groups.current_title'),
          groupId:     opts.stoopGroup ?? 'cc-default-circle',
          memberCount: members.length,
          mode:        tr('circle.groups.single_mode'),
          note:        tr('circle.groups.current_note'),
        };
      }
      let rawReply = null;   // the stoop reply before shaping — the own-devices fan below reads the contact row
      const runStoop = async () => {
        const parts = [DataPart(realArgs)];
        const result = await chatAgent.invoke(stoopAgent.address, realOpId, parts);
        const first  = Array.isArray(result) ? result[0] : null;
        const reply  = first?.data ?? null;
        rawReply = reply;
        // The circle fan for a noticeboard write no longer hangs off this op by name: it rides the stoop
        // store's `item-added` event (`fanNoticeboardItem` below), derived from the item that was written.
        return adaptStoopReply(opId, reply, realArgs);
      };
      // The three roster reads share one answer per circle for a short window (every lane asks at boot,
      // the verifier per statement — see rosterReadCache.js); any other stoop op may have changed a
      // roster and clears it.
      if (isRosterRead(realOpId)) return rosterReads.read(realOpId, realArgs, runStoop);
      const out = await runStoop();
      rosterReads.afterWrite(realOpId);
      // A contact added HERE — by scan, by the assistant, by any interface: every one passes this seam —
      // is a contact on the person's other devices too. Best-effort and after success.
      if ((realOpId === 'addContact' || realOpId === 'addContactFromQr') && rawReply?.contact) {
        knownPeersSync.fanContact(rawReply.contact).catch(() => {});
      }
      // Hidden HERE is hidden on every device of the person (Frits, 2026-09-19) — carried at the tap, not at the
      // next catch-up. The landing side keeps the newer mark, so a hide and a show that cross resolve the same
      // way everywhere.
      // …and what a contact sees of the person (L125), by the same carry: changed here, changed on every device.
      if ((realOpId === 'setContactHidden' || realOpId === 'setContactPersona') && rawReply?.contact) {
        knownPeersSync.fanContact(rawReply.contact).catch(() => {});
      }
      // WHAT I SAY ABOUT MYSELF goes to every roster I am on (2026-09-21): a handle or display name set under Mij
      // is a `member-props` statement on the membership lane of every circle — pair circles included, which is how
      // a contact learns it — one per circle, only where the row differs (the diff gate), a failing circle retried
      // on the next save. The one road; the admin-mediated persona-props wire and the card-on-a-message update
      // road are retired by it. Best-effort and after success; the local row is already written.
      if ((realOpId === 'setMyHandle' || realOpId === 'setMyDisplayName') && !rawReply?.error) {
        tellMyRostersWhatISay()
          .then((r) => console.info(`[member-props] ${r?.error ? r.error : `told ${r.emitted.length} circle(s)${r.unchanged.length ? `, ${r.unchanged.length} unchanged` : ''}${r.failed.length ? `, FAILED in ${r.failed.map((c) => String(c).slice(0, 12)).join(' ')}` : ''}`}`))
          .catch((err) => console.warn(`[member-props] not every roster was told: ${err?.message ?? err}`));
      }
      // LEAVING a circle takes it off the profile (a restore must not re-open it) and tells the person's other devices
      // (2026-09-22): each still in it leaves too. A leave that FOLLOWS a sibling's tells nobody — the sibling did.
      if (realOpId === 'leaveGroup' && !out?.error && typeof realArgs.groupId === 'string' && realArgs.groupId) {
        const circleId = realArgs.groupId;
        try { await callSkill('agents', 'removeProfileCircleMembership', { id: 'default', circleId }); }
        catch (err) { if (typeof console !== 'undefined') console.warn(`[restore-data] the left circle ${String(circleId).slice(0, 12)}… is still on the restore list: ${err?.message ?? err}`); }
        if (realArgs.followed !== true) circleFollowSync?.fanLeft(circleId).catch(() => { /* the sibling asks on connect */ });
      }
      // MAKING a circle puts you in it, so it belongs in the list a restore reads back.
      //
      // Joining wrote this record (the join wizard, after the redeem) and creating never did, so the
      // person who STARTED a circle was the one person who could not get it back: their recovery file
      // carried nothing, their pod registry carried nothing, and a restored device re-opened nothing —
      // measured 2026-09-10, creator 0 circles, joiner 1, from the same paired circle. That is the
      // first thing anyone does with this product, and the site promises the opposite in the present
      // tense.
      //
      // Written HERE rather than in the create wizard because this is the one seam every creation
      // passes — both shells, the quick-create, and the help circle — and the address the record needs
      // was derived a few lines above for exactly this op. Best-effort and AFTER success: a failure
      // costs the restore list, never the circle that was just made.
      if (realOpId === 'createGroupV2' && !out?.error) {
        const circleId = out?.groupId ?? realArgs.groupId;
        const address = realArgs.circleAddress ?? null;
        if (circleId && address) {
          // No handle: a founder has none yet (they never redeemed an invite), and restore does not
          // need one — the circle id and this device's address are what re-open a circle. A handle
          // the person chooses later merges into the same record through the ordinary setter.
          //
          // NOT awaited: the create answers first. Inside the create's wait, an agents store that did not
          // answer held "Creating circle…" for minutes over a circle that already existed (walk, 2026-10-09).
          // A write that fails here is not lost — `healRestoreList` puts the circle on the list at the next boot.
          Promise.resolve().then(() => callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId, address }))
            .catch((err) => {
              if (typeof console !== 'undefined') console.warn(`[restore-data] the created circle ${String(circleId).slice(0, 12)}… is not in the restore list yet (the next boot retries): ${err?.message ?? err}`);
            });
        }
      }
      return out;
    }
    if (appOrigin === 'folio') {
      // Folio's web-only skills already return chat-shell-shaped
      // replies (no adapter layer needed today).  The one alias is
      // briefSummary → folio_briefSummary so the chat-shell's generic
      // /brief op reaches folio's named briefSummary skill.
      const realOpId = (opId === 'briefSummary') ? 'folio_briefSummary' : opId;
      const parts = [DataPart(args ?? {})];
      const result = await chatAgent.invoke(folioAgent.address, realOpId, parts);
      const first  = Array.isArray(result) ? result[0] : null;
      return first?.data ?? null;
    }
    // A household bot (`opts.calendarInCircle`): the calendar's verbs over the circle's ONE store — events are the
    // Agenda's children — not the per-agent in-memory CalendarStore below, which a person's node keeps.
    // A household bot's appointment is cancelled by the one who added it, or the admin — unless the admin keeps that
    // to themselves (`assistant.cancelPolicy`). The op's rule and the door's setting refuse in the one shape.
    if (appOrigin === 'calendar' && opId === 'cancelEvent' && opts.calendarInCircle && typeof ctx?.caller === 'string' && ctx.caller
        && doorRoles.get(ctx.caller) !== 'admin'
        // under the `flat` roles preset, members and coordinators cancel anyone's appointment, as the admin does
        && !(rolesPresetFrom(paramsService.register.valueOf(ROLES_KEY)) === 'flat' && ['member', 'coordinator'].includes(doorRoles.get(ctx.caller)))) {
      const tr = agentT;
      // (in a circle the standard rule only: the one who added it, or the circle's admin — no household setting)
      if (!doorCircleOf(ctx) && cancelPolicyFrom(paramsService.register.valueOf(CANCEL_KEY)) === 'admin') {
        return { ok: false, error: tr('circle.calendar.cancel_admin_only'), refusal: refuse('door-settings', 'setting:cancel') };
      }
      const snap = await callSkill('calendar', 'getEventSnapshot', { id: args?.id, ...(args?.circleId ? { circleId: args.circleId } : {}) });
      if (snap?.ok && snap.event && snap.event.createdBy !== actorOf(ctx)) {
        return { ok: false, error: tr('circle.calendar.not_yours', { title: snap.event.title ?? '' }), refusal: refuse('op-rule', 'not-yours') };
      }
    }
    // A person's node (`opts.personalCalendar`, web and mobile): a call without a circle is their OWN appointment — an
    // item in their own-devices store, under an own Agenda, served by the same ops as a circle's.
    // A composition with neither option (a test, a tool) is a person's node with an in-memory own store.
    const personNode = opts.personalCalendar || !opts.calendarInCircle;
    if (appOrigin === 'calendar' && personNode && !args?.circleId) {
      ownCalendarReady ??= (async () => {
        ownCalendarStore = await getOwnStore();
        const tr = agentT;
        const lists = makeCircleLists({ storeFor: () => ownCalendarStore, manifests: [calendarManifest] });
        const containers = await lists.listContainers(OWN_DEVICES_SCOPE);
        if (!containers.some((c) => c.defaultChild === 'calendar-event')) {
          await lists.createList(OWN_DEVICES_SCOPE, tr('circle.lists.template.schedule'), 'me', { defaultChild: 'calendar-event' });
        }
      })();
      await ownCalendarReady;
      const ops = (ownCalendar ??= makeCircleCalendarOps({
        storeFor: () => ownCalendarStore,
        activeCircle: () => OWN_DEVICES_SCOPE,
        t: agentT,
        localActor: 'me',
      }));
      const handler = ops[opId];
      if (!handler) return { ok: false, error: 'unknown-op', app: 'calendar', op: opId };
      const res = await handler(args ?? {});
      // where it was saved, as every write's reply says it: on this device, no peer to wait for (the own store
      // reaches the person's other devices, never a circle's members) — the renderer's "saved locally"
      const writes = ['addEvent', 'cancelEvent', 'rsvpAccept', 'rsvpDecline', 'rsvpTentative'];
      return res?.ok && writes.includes(opId) && !res._sync ? { ...res, _sync: { style: 'decentralized', peers: [], pending: [], unreachable: [] } } : res;
    }
    // A person's node (`opts.personalCalendar`, web and mobile): a call naming a circle reads and writes that circle's
    // store; a call without one (and no own store handed in) stays on the person's own calendar below.
    if (appOrigin === 'calendar') {
      const ops = (circleCalendar ??= makeCircleCalendarOps({
        storeFor: (circleId) => householdService.stores.getStore(circleId),
        activeCircle: () => resolveCircleId({}),
        t: agentT,
        localActor: 'me',
      }));
      const handler = ops[opId];
      return handler ? handler(args ?? {}) : { ok: false, error: 'unknown-op', app: 'calendar', op: opId };
    }
    if (appOrigin === 'agents') {
      // The read-only "your agents" skills live on hostAgent (wireSkill-wrapped
      // pure cores over the user's own agent-registry — see the registration
      // block above).  Routing lives HERE in the shared agent (invariant #1) so
      // web + mobile both reach it through the bare `agent.callSkill`.  The
      // thin reply adapter below is presentation-only (same licence as the
      // stoop adapter): the cores return the registry vocabulary
      // ({agents:[…]} / {agent}), the chat-shell renderer expects
      // {items:[{id,label,…}]} for shape:'list' and a flat record payload for
      // shape:'record'.
      const parts  = await chatAgent.invoke(hostAgent.address, opId, [DataPart(args ?? {})]);
      const data   = Array.isArray(parts) ? parts[0]?.data : null;
      if (opId === 'listAgents') {
        const agents = Array.isArray(data?.agents) ? data.agents : [];
        return { items: agents.map((a) => ({ ...a, id: a.agentId, label: a.name ?? a.agentId })) };
      }
      if (opId === 'viewAgent') {
        // A miss surfaces as a soft failure (message, not a false record).
        const tr = agentT;
        return data?.agent ?? { ok: false, error: tr('circle.op.no_agent', { agent: String(args?.agentId ?? '') }) };
      }
      return data;
    }
    if (appOrigin === 'basis') {
      // basis's OWN ops on the waist, which is where every surface has always assumed they were.
      //
      // They are not agent skills and cannot be: they end in a file picker, a camera, a side panel, a
      // pod login — the device's own affordances, which no peer may invoke and no headless agent has.
      // So they lived in a `createLocalBuiltins` table that each shell mounted for itself, and the
      // shells that did not mount one simply could not reach them. The Advanced drawer dispatches a
      // tapped row with `callSkill(row.app, row.op)` on both platforms; for all 23 basis rows that
      // call landed here and threw `unknown appOrigin "basis"`, while the form said "✓ Submitted".
      //
      // Two levels, so the promise holds everywhere and is honest where a seam is missing:
      //   · EVERY composition gets the default table below — the handlers whose only dependency is
      //     this agent (whoami · muted · transports · security-status · debug-dump · audit-tail …).
      //   · a shell UPGRADES it with `mountAppOps('basis', table)`, passing the seams only it has (its
      //     file picker, its scanner, its panels, its localisation). Same ops, richer seams.
      // An op whose seam is absent answers "not available" in its own words — the handlers were
      // written to degrade that way — rather than throwing at the boundary.
      if (!basisManifest.operations.some((o) => o.id === opId)) {
        return { ok: false, error: 'unknown-op', app: 'basis', op: opId };
      }
      const handler = basisOps()[opId];
      if (typeof handler !== 'function') {
        // Declared, and no handler on this composition. A structured refusal, never a throw: the
        // caller is a surface painting a row, and a throw there is an app that looks broken.
        return { ok: false, error: 'not-mounted', app: 'basis', op: opId };
      }
      return handler(args ?? {});
    }
    // A local app a shell mounted (see `mountAppOps`), else its default table (lists). Same contract as the `basis` branch above: the
    // app's own manifest gates which ops exist, an absent handler is a structured refusal, never a throw.
    const local = mountedLocalApps.get(appOrigin) ?? defaultLocalApp(appOrigin);
    if (local) {
      if (!local.manifest?.operations?.some((o) => o.id === opId)) {
        return { ok: false, error: 'unknown-op', app: appOrigin, op: opId };
      }
      const handler = local.ops?.[opId];
      if (typeof handler !== 'function') return { ok: false, error: 'not-mounted', app: appOrigin, op: opId };
      // An op that acts IN a circle gets that circle's sync wired first — the same line the household and
      // tasks branches run, for the same reason: the publish valve is wired at open, and a write to a
      // store whose valve was never wired stays local with nothing saying so. Until now this depended on
      // some OTHER op having opened the circle first, which is true in a running shell and false in a
      // journey, and "true by accident of ordering" is how a fan-out path quietly stops being one.
      const inCircle = typeof args?.circleId === 'string' && args.circleId ? args.circleId : null;
      if (inCircle) await ensureCircleSync(inCircle);
      // the person asking rides along (a handler that acts as them — a chore's tick — passes it on)
      const result = await handler(args ?? {}, ctx);
      // A door's read of a chores list says who holds each chore — as far as the names setting lets the asker see names
      if (appOrigin === 'lists' && opId === 'listEntries' && typeof ctx?.caller === 'string' && ctx.caller && Array.isArray(result?.items)) {
        return { ...result, items: await withChoreHolders(result.items, actorOf(ctx), doorCircleOf(ctx)) };
      }
      return result;
    }
    throw new Error(`realAgent: unknown appOrigin "${appOrigin}"`);
  };

  /* ─────────── L3 household — wired-core → chat-shell reply adapter ─────────── */
  // The dissolved cores (`v2/householdApp.js`) return thin values: list ops → `{items:[…]}`
  // (bare store items); addItem/addTask → the stored item; markComplete/claim/reassign →
  // `{ok, item}` (or `{ok:false, error}`); removeItem → `{ok, removed}`. basis's renderer
  // expects the chat-shell shapes the legacy path produced:
  //   - LIST   → { items: [{id, label, text, type, state}], _sync }
  //   - ACTION → { ok, message, text, itemId, _sync }  (or {ok:false, error})
  // This adapter re-shapes the wired-core outputs so /add · /list · /done · /task · /claim
  // round-trip through the existing chat-shell renderer exactly as before.

  /** Adapt a wired household-core reply (list OR mutation) to the chat-shell shape. */
  function adaptWiredHouseholdReply(opId, data, args) {
    if (opId === 'listOpen' || opId === 'listTasks') {
      const items = Array.isArray(data?.items) ? data.items : [];
      // v0.6 — annotate every-other row with a synthetic `_lastSync` so the per-row
      // 'stale Xh ago' badge has something to render (demo parity).
      const now = Date.now();
      return {
        items: items.map((it, i) => ({
          id:    it.id,
          label: it.text,
          text:  it.text,
          type:  it.type,
          state: 'open',
          ...(it.assignee ? { claimedBy: it.assignee } : {}),
          ...(i % 2 === 0 ? { _lastSync: now - 3 * 3_600_000 } : {}),   // 3h ago
        })),
        _sync: simulateSync(),
      };
    }
    return adaptWiredHouseholdAction(opId, data, args);
  }

  /** Adapt a wired mutation-core reply → `{ ok, message, text, itemId, _sync }` (or `{ ok:false, error }`). */
  function adaptWiredHouseholdAction(opId, data, args) {
    const publish = (itemId, message) => {
      if (!itemId) return;
      publishEvent({
        app:     'household',
        type:    'item-changed',
        actor:   'webid:local-demo-user',
        itemRef: { app: 'household', id: itemId },
        payload: { message },
      });
    };

    // Resolving ops (find-by-match): a miss surfaces as a soft failure so the user sees a message,
    // not a false "✓".  On MORE THAN ONE open match the core returns `{ambiguous:[…]}` and acts on none
    // — reproduce the legacy chat-shell disambiguation prompt (identical text/shape) so the user picks by
    // id-prefix rather than the tool silently completing the wrong item.
    const tr = agentT;
    if (opId === 'markComplete' || opId === 'removeItem' || opId === 'claim' || opId === 'reassign') {
      const match = String(args?.match ?? '');
      if (Array.isArray(data?.ambiguous)) {
        const lines = data.ambiguous.map((it) => `- [${String(it.id ?? '').slice(0, 8)}] ${it.text}`);
        return { ok: false, error: tr('circle.household.ambiguous', { match, options: lines.join('\n') }) };
      }
      if (!data || data.ok === false) {
        const key = (opId === 'claim' || opId === 'reassign') ? 'circle.household.not_found_task' : 'circle.household.not_found_item';
        return { ok: false, error: tr(key, { match }) };
      }
      const item   = data.item ?? null;
      const text   = item?.text ?? '';
      const itemId = item?.id ?? data.removed ?? undefined;
      let message;
      switch (opId) {
        case 'markComplete': message = tr('circle.household.completed', { text }); break;
        case 'removeItem':   message = tr('circle.household.removed', { text }); break;
        case 'claim':        message = tr('circle.household.claimed', { text }); break;
        default:             message = tr('circle.household.reassigned', { text, who: String(args?.assignee ?? '').trim() }); break;
      }
      publish(itemId, message);
      return { ok: true, message, ...(text ? { text } : {}), ...(itemId ? { itemId } : {}), _sync: simulateSync() };
    }

    // addItem / addTask — `data` is the stored item.
    const item    = data ?? {};
    const text    = item.text ?? '';
    const message = opId === 'addTask' ? tr('circle.household.added_task', { text }) : tr('circle.household.added_to', { list: item.type, text });
    publish(item.id, message);
    return { ok: true, message, ...(text ? { text } : {}), ...(item.id ? { itemId: item.id } : {}), _sync: simulateSync() };
  }

  /** /brief contributor — derive household's slot from the wired store's open items. */
  async function householdBriefSummary(circleId) {
    let open = [];
    try { open = await householdApp.listOpen(householdService.stores.getStore(circleId), {}); }
    catch { open = []; }
    if (!open.length) return { ok: true };   // empty → /brief skips the section
    const items = open.slice(0, 5).map((it) => ({ id: it.id, label: it.text }));
    const tr = agentT;
    return { items, message: tr('circle.household.brief', { count: open.length }) };
  }

  /**
   * Bridge real tasks-v0 reply shapes → basis's chat-shell
   * expectations.  Real skills return rich shapes
   * (e.g. `{task: {id, text, ...}}`); basis's renderer expects
   * the mock-era shapes (`{ok, message, itemId, _sync}`).
   *
   * Adapters keep the chat-shell stable while we run with real
   * tasks-v0 underneath.  Eventually the chat-shell renderer
   * absorbs the richer shape natively + these adapters fall away.
   */
  /**
   * @param {string} opId
   * @param {object|null} data  the tasks skill's answer
   * @param {{actor?: string|null, named?: string|null}} [who]  the person the call was for, and the task's words when
   *        the door named it by its words (the reply names the task FOUND, never the words it was asked by)
   */
  /** The chore actions whose bare `{ok}` the door words itself (see `adaptTasksReply`). */
  const WORDED_BY_DOOR = Object.freeze({ reassignTask: 'reassigned', removeTask: 'removed', editTask: 'edited' });
  function adaptTasksReply(opId, data, { actor = null, named = null, givenTo = null, args = {} } = {}) {
    if (data == null) return null;
    // In the person's words: every shell hands the agent its translator.
    const tr = agentT;
    // (B8) — DAG hard-dep blocking surface. Real skill returns
    // {error: 'has-open-dependencies', openDeps: [...]} when the user
    // tries to complete a task whose subtasks aren't done.  Translate
    // to a clear chat-shell message + structured payload the UI can
    // render the dep IDs from.
    if ((opId === 'completeTask' || opId === 'approveTask')
        && data?.error === 'has-open-dependencies') {
      const deps = Array.isArray(data.openDeps) ? data.openDeps : [];
      return {
        ok:    false,
        error: tr('circle.tasks.blocked', { count: deps.length, deps: `${deps.slice(0, 3).join(', ')}${deps.length > 3 ? '…' : ''}` }),
        openDeps: deps,
      };
    }
    // Skill returned an error envelope — pass through unchanged.
    if (data.ok === false) return data;

    // Real task skills variously return {task: ...} (addTask /
    // submitTask) OR {result: ...} (claimTask / completeTask) — the
    // field name differs by skill.  Normalise to a task variable.
    const task = data.task ?? data.result ?? null;
    // A claim that LOST comes back as its result (`{error: 'already-claimed', current}`) — never a "✓": someone else has
    // the task, or this person had it already.
    if (task && typeof task.error === 'string' && task.error) {
      const cur = task.current ?? {};
      const title = cur.text || cur.title || named || '';
      if (task.error === 'already-claimed') {
        const holders = [...(Array.isArray(cur.assignees) ? cur.assignees : []), cur.assignee].filter(Boolean);
        const yours = Boolean(actor && holders.includes(actor));
        // In the person's words: every shell hands the agent its translator; a bare agent (a test) keeps the English.
        if (typeof opts.t !== 'function') return { ok: false, error: yours ? `You had already claimed: ${title}` : `Already claimed: ${title}` };
        return { ok: false, error: tr(yours ? 'circle.tasks.already_yours' : 'circle.tasks.already_claimed', { title }) };
      }
      return { ok: false, error: task.error };
    }

    // addTask: {task} → {ok, message, itemId, _sync}
    if (opId === 'addTask' && task) {
      return {
        ok:      true,
        message: tr('circle.tasks.reply.added', { title: task.text ?? task.title ?? task.id }),
        itemId:  task.id,
        // S6.A — carry the mock-era `state` + `type` the manifest's appliesTo gates
        // on (the real circle uses `status`), so inline buttons compute on the reply.
        task:    { ...task, type: 'task', state: _statusToChatState(task.status, task) },
        _sync:   simulateSync(),
      };
    }
    // claimTask / completeTask / submitTask / approveTask / rejectTask:
    // shape adapter — emit the chat-shell ok/message envelope.
    const verbMap = {
      claimTask:   'Claimed',
      completeTask:'Completed',
      submitTask:  'Submitted',
      approveTask: 'Approved',
      rejectTask:  'Rejected',
      // editTask returns {task}; chat-shell needs
      // the ok/message envelope to render the confirmation bubble.
      editTask:    'Edited',
    };
    // Moving, removing or editing a chore can come back as a bare `{ok}` — and a bare ok is painted as "✓", which tells a
    // person neither what happened nor to what. Say it, with the chore's words the door read before the call (an edit:
    // the new words).
    // an edit sent as it stood changes nothing: said, with the chore's words — not an error, and never a bare "✓"
    if (opId === 'editTask' && data?.error === 'no fields to update') {
      const title = named || args?.id || '';
      const message = typeof opts.t === 'function' ? opts.t('circle.tasks.reply.unchanged', { title, note: '' }) : `Nothing changed: ${title}`;
      return { ok: true, unchanged: true, message, ...(args?.id ? { itemId: args.id } : {}), _sync: simulateSync() };
    }
    if (WORDED_BY_DOOR[opId] && !(verbMap[opId] && task) && data && !data.error && data.ok !== false) {
      const title = (opId === 'editTask' && (args?.text || args?.title)) || task?.text || task?.title || named || args?.id || '';
      const key = WORDED_BY_DOOR[opId];
      const message = typeof opts.t === 'function' ? opts.t(`circle.tasks.reply.${key}`, { title, note: '' }) : `✓ ${key}: ${title}`;
      // the chore's words, and who it went to: the door words the line (`replyLine`). A household bot read the person
      // from the words (`givenTo`: as the asker may see them); elsewhere the words as they were said.
      const to = opId !== 'reassignTask' ? {}
        : givenTo ? { chore: { title, ...givenTo, ...(task?.dueAt ? { dueAt: task.dueAt } : {}) } }
          : (typeof args?.newAssignee === 'string' && args.newAssignee.trim() ? { to: args.newAssignee.trim() } : {});
      return { ok: true, message, title, ...to, ...(task ? { task: { ...task, type: 'task', state: _statusToChatState(task.status, task) } } : {}), ...(args?.id ? { itemId: args.id } : {}), _sync: simulateSync() };
    }
    if (verbMap[opId] && task) {
      const title = task.text || task.title || named || task.id;
      // Reject path: surface the audit-log note in the message so
      // the chat-shell + user see WHY the task was rejected.
      const noteSuffix = (opId === 'rejectTask' && data.noteHint)
        ? ` — ${data.noteHint}` : '';
      // claim router: when the override has
      // flowThrough.tasksToPersonal, mirror the claimed task into the
      // personal circle so it shows up in "Mijn dingen".  Fire-and-forget;
      // the chat-shell envelope returns immediately.  Default hook is a
      // no-op so existing tests keep their behaviour.
      if (opId === 'claimTask' && typeof claimRouterRef.hook === 'function') {
        // the call's own args (handed in: this adapter is not inside the call's scope)
        const circleId = args?.circleId ?? args?.groupId ?? null;
        if (circleId) {
          Promise.resolve(claimRouterRef.hook({ task, circleId, args }))
            .catch((err) => publishEvent?.({
              app: 'basis', type: 'claim-router-error',
              payload: { circleId, taskId: task.id, error: err?.message ?? String(err) },
            }));
        }
      }
      // In the person's words: every shell hands the agent its translator; a bare agent (a test) keeps the English.
      const message = typeof opts.t === 'function'
        ? opts.t(`circle.tasks.reply.${verbMap[opId].toLowerCase()}`, { title, note: noteSuffix })
        : `✓ ${verbMap[opId]}: ${title}${noteSuffix}`;
      return {
        ok:      true,
        message,
        itemId:  task.id,
        // S6.A — enrich with mock-era state/type so the post-action reply also
        // carries the right inline buttons (e.g. a claimed task → Mark complete).
        task:    { ...task, type: 'task', state: _statusToChatState(task.status, task) },
        _sync:   simulateSync(),
      };
    }
    // Task-less base — a circle with no tasks circle yet.  bundleResolver
    // returns null, so the read-only list skills answer {error:'circleId
    // required'}.  For a LIST op that's not a failure: there's simply
    // nothing to list.  Normalise to an empty result so loadCircleItems /
    // /mytasks render "no tasks" instead of an error bubble.  (Write ops
    // like addTask keep the error — you can't add to a circle that isn't there.)
    if ((opId === 'listMine' || opId === 'listOpen' || opId === 'listMyInbox'
         || opId === 'myInbox' || opId === 'getMyTasks' || opId === 'listClaimable')
        && data?.error === 'circleId required') {
      return { items: [], _sync: simulateSync() };
    }
    // listMine / listOpen: real returns {items: [...]} of task records.
    // Real items carry `status` (ready/claimed/submitted/rejected/
    // complete/blocked) but the chat-shell renderer + most tests
    // expect a mock-era `state` field (open/claimed/done).  Add the
    // mapped `state` alongside the original status. (B8): also
    // surface a `blockedBy` label when the task has openDeps so the
    // user sees the gate without clicking [Mark complete] first.
    if ((opId === 'listMine' || opId === 'listOpen' || opId === 'listMyInbox'
         || opId === 'myInbox' || opId === 'getMyTasks')
        && Array.isArray(data.items)) {
      return {
        ...data,
        items: data.items.map((t) => {
          const openDeps = Array.isArray(t.openDeps) ? t.openDeps : [];
          const baseRow = { ...t, state: _statusToChatState(t.status, t) };
          if (openDeps.length > 0) {
            baseRow.blockedBy = openDeps;
            baseRow.label = tr('circle.tasks.blocked_label', { title: t.text ?? t.title ?? t.id, count: openDeps.length });
          }
          return baseRow;
        }),
        _sync: simulateSync(),
      };
    }
    // getTaskSnapshot: real returns {task: {...}} → flatten to embed-card shape
    if (opId === 'getTaskSnapshot' && data.task) {
      const t = data.task;
      return {
        id:    t.id,
        type:  'task',
        state: t.state ?? 'open',
        title: t.text ?? t.title ?? t.id,
        fields: { state: t.state ?? 'open', assignee: t.assignee ?? 'unassigned' },
      };
    }
    // issueInvite: real returns {invite: {...JWT-shaped token...}} →
    // record-shape reply with a `qr` URI the chat-shell renders as
    // an actual scannable QR canvas (see classifyFieldKind + the
    // 'qr' branch in domAdapter.renderRecordPanel).  Inviter can
    // [Copy] the URL fallback or have the invitee scan the QR.
    if (opId === 'issueInvite' && data.invite) {
      const inv = data.invite;
      const json = typeof inv === 'string' ? inv : JSON.stringify(inv);
      // Browser-safe base64url encode (no Buffer dep).
      const b64url = typeof globalThis.btoa === 'function'
        ? globalThis.btoa(json)
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        : json;
      const qrUri = `onderling-invite://${b64url}`;
      const expires = inv?.expiresAt
        ? new Date(inv.expiresAt).toISOString()
        : tr('circle.tasks.invite.no_expiry');
      return {
        title:    tr('circle.tasks.invite.title'),
        role:     inv?.role ?? 'member',
        expires,
        invite:   qrUri,   // classified as kind:'qr' by classifyFieldKind
        message:  tr('circle.tasks.invite.minted'),
      };
    }
    // redeemInvite: real returns {groupProof, members, ...} → friendly text.
    if (opId === 'redeemInvite' && (data.groupProof || data.members)) {
      const memberCount = Array.isArray(data.members) ? data.members.length : '?';
      return {
        ok: true,
        message: tr('circle.tasks.invite.joined', { members: memberCount }),
        circle:   data,
        _sync:  simulateSync(),
      };
    }
    // (B7) — getMyAvailability: {enabled, optedIn, week,
    //   grid: {0: {AM, PM}, 1: {AM, PM}, ...}} → record reply with a
    // 'grid' field the chat-shell renders as a 7×2 clickable table.
    if (opId === 'getMyAvailability') {
      if (data.enabled === false) {
        return {
          title:   tr('circle.availability.title'),
          status:  'disabled-for-circle',
          message: tr('circle.tasks.availability.disabled'),
        };
      }
      const week = data.week ?? tr('circle.tasks.availability.this_week');
      // 2026-05-24 — pad with a default blank 7×2 grid so the renderer
      // always has a structural grid to draw.  Real cells overlay
      // 'unknown' defaults; empty `data.grid` no longer renders as
      // the unreadable JSON `{}`.
      const blankGrid = {};
      for (let d = 0; d < 7; d++) {
        blankGrid[d] = { AM: 'unknown', PM: 'unknown' };
      }
      const merged = { ...blankGrid };
      for (const [day, halves] of Object.entries(data.grid ?? {})) {
        merged[day] = { ...blankGrid[day], ...halves };
      }
      return {
        title:   tr('circle.tasks.availability.title_week', { week }),
        optedIn: !!data.optedIn,
        week,
        // classifyFieldKind detects {0-6: {AM, PM}} shape as 'grid' →
        // renderGridField in domAdapter draws clickable cells.
        grid:    merged,
        message: data.optedIn
          ? tr('circle.tasks.availability.cycle_hint')
          : tr('circle.tasks.availability.not_opted_in'),
      };
    }
    // setMyAvailability: {ok, week, day, half, state} → text.
    if (opId === 'setMyAvailability' && data.ok) {
      const STATE_GLYPH = { open: '🟢', tight: '🟡', unavailable: '🔴', unknown: '⚪' };
      const dayName = Number.isInteger(data.day) && data.day >= 0 && data.day <= 6 ? tr(`circle.tasks.availability.day.${data.day}`) : '?';
      const half = data.half === 'AM' || data.half === 'PM' ? tr(`circle.tasks.availability.half.${data.half}`) : data.half;
      const state = STATE_GLYPH[data.state] ? tr(`circle.tasks.availability.state.${data.state}`) : data.state;
      return {
        ok: true,
        message: `${STATE_GLYPH[data.state] ?? '⚪'} ${dayName} ${half}: ${state}`,
        _sync: simulateSync(),
      };
    }
    // setAvailabilityOptIn: {ok, optedIn} → friendly text.
    if (opId === 'setAvailabilityOptIn' && data.ok) {
      return {
        ok: true,
        message: data.optedIn
          ? tr('circle.tasks.availability.opted_in')
          : tr('circle.tasks.availability.opted_out'),
        _sync: simulateSync(),
      };
    }
    // (B6) — suggestSchedule: {lookaheadDays, suggestions: [
    //   {taskId, slots: [{start, end, reasons: [...]}], ...}
    // ]} → chat-shell list with each row = ONE clickable slot
    // (top 3 per task).  Row label inlines date/time + reason chips.
    // slotKey packs (taskId|start|end) into the row id so the [Pick]
    // button dispatches all three to acceptSchedule.
    if (opId === 'suggestSchedule' && Array.isArray(data.suggestions)) {
      if (data.suggestions.length === 0) {
        return {
          items:   [],
          message: tr('circle.tasks.schedule.none'),
        };
      }
      const items = [];
      for (const s of data.suggestions) {
        const slots = Array.isArray(s.slots) ? s.slots.slice(0, 3) : [];
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          const start = new Date(slot.start);
          const end   = new Date(slot.end);
          const fmt   = (d) => `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
          const reasonChips = (slot.reasons ?? []).map((r) => `[${r}]`).join(' ');
          const taskLabel = s.taskText ?? s.title ?? s.taskId;
          items.push({
            id:        `${s.taskId}|${slot.start}|${slot.end}`,
            type:      'schedule-slot',
            label:     `#${i + 1} ${taskLabel}: ${fmt(start)} – ${fmt(end).split(' ')[1]} ${reasonChips}`,
            taskId:    s.taskId,
            slotStart: slot.start,
            slotEnd:   slot.end,
            reasons:   slot.reasons ?? [],
          });
        }
      }
      return {
        items,
        message: tr('circle.tasks.schedule.found', { count: data.suggestions.length, days: data.lookaheadDays }),
        _sync:   simulateSync(),
      };
    }
    // acceptSchedule: {ok, task} → friendly text.
    if (opId === 'acceptSchedule' && data?.task) {
      const t = data.task;
      const when = Number.isFinite(t.scheduledAt)
        ? new Date(t.scheduledAt).toLocaleString()
        : tr('circle.tasks.schedule.no_time');
      return {
        ok:      true,
        message: tr('circle.tasks.schedule.scheduled', { title: t.text ?? t.title ?? t.id, when }),
        task:    t,
        _sync:   simulateSync(),
      };
    }
    // (B5) — getMyCircles: {circles: [{circleId, name, kind, counts}]}
    // → chat-shell list with circle-shape rows.  Each row's label
    // surfaces counters inline so the user sees the dashboard at a
    // glance without expanding rows.
    if (opId === 'getMyCircles' && Array.isArray(data.circles)) {
      // 2026-05-24 — fold in provisionedCircles (pending entries from
      // /circle-new since boot) so the user sees feedback even though
      // the dashboard's circlesProvider doesn't auto-pick them up.
      const knownIds = new Set(data.circles.map((c) => c.circleId));
      const pendingItems = [];
      for (const [circleId, info] of provisionedCircles.entries()) {
        if (knownIds.has(circleId)) continue;   // active now (after reload)
        pendingItems.push({
          id:    circleId,
          type:  'circle',
          label: tr('circle.tasks.circles.pending_row', { name: info.name, kind: info.kind }),
          circleId,
          name:  info.name,
          kind:  info.kind,
          pending: true,
          counts: { open: 0, overdue: 0, mine: 0, awaitingApproval: 0 },
        });
      }
      if (data.circles.length === 0 && pendingItems.length === 0) {
        return {
          items:   [],
          message: tr('circle.tasks.circles.none'),
        };
      }
      let totalOpen = 0, totalOverdue = 0, totalMine = 0, totalApproval = 0;
      const items = data.circles.map((c) => {
        const cnt = c.counts ?? {};
        totalOpen     += cnt.open ?? 0;
        totalOverdue  += cnt.overdue ?? 0;
        totalMine     += cnt.mine ?? 0;
        totalApproval += cnt.awaitingApproval ?? 0;
        const stats = [
          tr('circle.tasks.circles.stat_open', { n: cnt.open ?? 0 }),
          cnt.overdue ? tr('circle.tasks.circles.stat_overdue', { n: cnt.overdue }) : null,
          cnt.mine    ? tr('circle.tasks.circles.stat_mine', { n: cnt.mine }) : null,
          cnt.awaitingApproval ? tr('circle.tasks.circles.stat_awaiting', { n: cnt.awaitingApproval }) : null,
        ].filter(Boolean).join(' · ');
        return {
          id:    c.circleId,
          type:  'circle',
          label: `${c.name} (${c.kind}) — ${stats}`,
          circleId: c.circleId,
          name:   c.name,
          kind:   c.kind,
          counts: cnt,
        };
      });
      const allItems = [...items, ...pendingItems];
      const pendingSuffix = pendingItems.length > 0
        ? ` + ${tr('circle.tasks.circles.pending', { n: pendingItems.length })}` : '';
      return {
        items: allItems,
        message: tr('circle.tasks.circles.summary', {
          n: data.circles.length, pending: pendingSuffix,
          open: totalOpen, overdue: totalOverdue, mine: totalMine, awaiting: totalApproval,
        }),
        _sync: simulateSync(),
      };
    }
    // (B3) — getCircleConfig: {circle: {...}} or {circle: null} →
    // record reply with members + paused/archived state.
    if (opId === 'getCircleConfig') {
      const circle = data.circle;
      if (!circle) {
        return {
          title:   tr('circle.tasks.config.title'),
          status:  'not-found',
          message: tr('circle.tasks.config.not_found'),
        };
      }
      // 2026-05-24 — DON'T inline members[] here.  The record renderer
      // JSON-stringifies arrays of objects (unreadable).  Use the
      // separate /circle-members list reply (see listCircleMembers below).
      return {
        title:       tr('circle.tasks.config.title'),
        circleId:      circle.circleId,
        name:        circle.name ?? circle.circleId,
        kind:        circle.kind ?? 'household',
        memberCount: Array.isArray(circle.members) ? circle.members.length : 0,
        paused:      !!circle.paused,
        archived:    !!circle.archived,
        hint:        tr('circle.tasks.config.members_hint'),
      };
    }
    // 2026-05-24 — listCircleMembers (derived from getCircleConfig): list
    // reply with one row per member, role surfaced inline.
    if (opId === 'listCircleMembers') {
      const circle = data?.circle;
      if (!circle || !Array.isArray(circle.members)) {
        return { items: [], message: tr('circle.tasks.config.members_none') };
      }
      return {
        items: circle.members.map((m) => ({
          id:    m.webid,
          type:  'member',
          webid: m.webid,
          label: `${m.displayName ?? m.webid.slice(0, 12)} (${m.role ?? 'member'})`,
          role:  m.role ?? 'member',
        })),
        message: tr('circle.tasks.config.members_count', { count: circle.members.length, circle: circle.name ?? circle.circleId }),
        _sync: simulateSync(),
      };
    }
    // pauseCircle / unpauseCircle / archiveCircle / unarchiveCircle:
    // real returns {ok, paused?, archived?} → friendly text reply.
    if (opId === 'pauseCircle' && data.ok) {
      return {
        ok: true,
        message: data.paused
          ? tr('circle.tasks.state.paused')
          : tr('circle.tasks.state.not_paused'),
        _sync: simulateSync(),
      };
    }
    if (opId === 'unpauseCircle' && data.ok) {
      return {
        ok: true,
        message: data.paused
          ? tr('circle.tasks.state.still_paused')
          : tr('circle.tasks.state.resumed'),
        _sync: simulateSync(),
      };
    }
    if (opId === 'archiveCircle' && data.ok) {
      return {
        ok: true,
        message: data.archived
          ? tr('circle.tasks.state.archived')
          : tr('circle.tasks.state.not_archived'),
        _sync: simulateSync(),
      };
    }
    if (opId === 'unarchiveCircle' && data.ok) {
      return {
        ok: true,
        message: data.archived
          ? tr('circle.tasks.state.still_archived')
          : tr('circle.tasks.state.unarchived'),
        _sync: simulateSync(),
      };
    }
    // provisionMyCircle: real returns {circle: {...}} (or similar) →
    // adapt to mock-era {ok, message, circleId}.  2026-05-24: also
    // track newly-provisioned circles in provisionedCircles so /circles
    // shows them as pending entries (substrate doesn't auto-bind
    // a CircleState; needs reload + multi-circle topology).
    if (opId === 'provisionMyCircle') {
      const circleId = data.circleId ?? data.circle?.circleId ?? data.id ?? null;
      if (circleId && !provisionedCircles.has(circleId)) {
        provisionedCircles.set(circleId, {
          name: data.circle?.name ?? data.name ?? circleId,
          kind: data.circle?.kind ?? data.kind ?? 'household',
          provisionedAt: Date.now(),
        });
      }
      return {
        ok:      true,
        message: tr('circle.tasks.state.provisioned', { circle: circleId ?? '?' }),
        circleId,
        circle:    data.circle ?? data,
        _sync:   simulateSync(),
      };
    }
    // Default: pass through.
    return data;
  }

  /**
   * Bridge real stoop reply shapes → basis's chat-shell
   * expectations.  Mock-era shapes the chat renderer was built
   * against:
   *   postRequest     → {ok, message, itemId, _sync}
   *   listFeed/Open   → {items: [{id, label, state, ...}], _sync}
   *   getMyProfile    → {title, handle, displayName, circle, ...}
   *   setPeerReveal   → {ok, message, peer, action}
   */
  function adaptStoopReply(opId, data, args) {
    if (data == null) return null;
    // In the person's words: every shell hands the agent its translator.
    const tr = agentT;
    if (data.ok === false || data.error)  {
      // Pass through error envelopes; basis dispatch handles them.
      return data.ok === false ? data : { ok: false, error: data.error };
    }

    // postRequest: {requestId, claims} → {ok, message, itemId, _sync}
    if (opId === 'postRequest' && data.requestId) {
      const text = args?.text ?? tr('circle.noticeboard.untitled');
      return {
        ok:      true,
        message: tr('circle.noticeboard.posted_text', { text }),
        itemId:  data.requestId,
        request: data,                       // preserve full shape
        _sync:   simulateSync(),
      };
    }
    // listFeed / listOpen / listMyRequests / getBulletin: items[] of
    // {id, text, ...} → add a `label` alias on each row + add _sync
    // envelope so the chat shell's renderer picks up the standard
    // chat shapes.
    if ((opId === 'listFeed' || opId === 'listOpen' || opId === 'listMyRequests'
         || opId === 'getBulletin')
        && Array.isArray(data.items)) {
      return {
        ...data,
        items: data.items.map((p) => ({
          ...p,
          label: p.text ?? p.label ?? p.id,
          // chat-shell appliesTo gate matches on
          // `item.type`.  Stoop posts are 'post' in the chat-shell
          // vocabulary (mockManifests respondToItem + markReturned
          // both gate `type: 'post'`).  Substrate item.type carries
          // the canonical 'request'|'offer'|'report' taxonomy, so we
          // map them all to chat-shell 'post' here.
          type:  'post',
          // Chat-shell convention: `state: open|done`.  Stoop posts
          // are "open" while addedBy is set + not closed; "done"
          // when there's a `closedAt`.
          state: p.closedAt ? 'done' : 'open',
          // F1 5.3d — surface the post's target groupId at the top
          // level so `circleScope.itemCircleId` (which reads
          // `item.groupId`, not `item.source.targets[]`) can match
          // the active circle.  Posts created in basis carry
          // `source.targets: [{kind:'group', groupId: '<circleId>'}]`
          // (set in the postRequest adapter above when a circle is
          // active).  Pre-existing posts without targets keep
          // `groupId: undefined`, which `keepForCircle` treats as
          // "no hint, trust upstream" — so unscoped reads still see
          // them.
          groupId: p.groupId ?? _groupIdFromTargets(p),
        })),
        _sync: simulateSync(),
      };
    }
    // getMyProfile: real returns {entry: {handle, displayName, ...}|null}
    // → adapt to {title, handle, displayName, circle}.
    if (opId === 'getStoopProfile') {
      const e = data.entry ?? {};
      return {
        title:       tr('circle.noticeboard.profile_title'),
        handle:      e.handle ?? null,
        displayName: e.displayName ?? null,
        circle:       opts.stoopGroup ?? 'cc-default-circle',
      };
    }
    // setPeerReveal: real returns {} on success → adapt to chat shape.
    // Part G dissolve (2026-06-17) — keyed on `setPeerReveal` (was
    // `revealPeer`, the dropped alias op).  args still carry the
    // chat-shell `peer`/`action` vocab; the peer→peerWebid +
    // action→reveal transforms happen before invoke.
    if (opId === 'setPeerReveal') {
      const peer   = args?.peer ?? args?.peerWebid ?? tr('circle.reveal.someone');
      const action = args?.action ?? (args?.reveal ? 'on' : 'off');
      return {
        ok: true,
        message: action === 'on'
          ? tr('circle.reveal.on', { peer })
          : tr('circle.reveal.off', { peer }),
        peer, action,
      };
    }
    // setHolidayMode: real returns {holidayMode: bool} → friendly text.
    if (opId === 'setHolidayMode' && typeof data.holidayMode === 'boolean') {
      return {
        ok: true,
        message: data.holidayMode
          ? tr('circle.holiday.on')
          : tr('circle.holiday.off'),
        holidayMode: data.holidayMode,
      };
    }
    // getHolidayMode: real returns {holidayMode: bool} → record reply.
    if (opId === 'getHolidayMode' && typeof data.holidayMode === 'boolean') {
      return {
        title:       tr('circle.availability.holiday'),
        holidayMode: data.holidayMode,
        status:      data.holidayMode ? 'on' : 'off',
      };
    }
    // listContacts: real returns {contacts: [...]} → chat-shell {items: [...]}.
    // Each contact carries {webid, displayName?, handle?, trustLevel?, tags?, ...};
    // surface displayName || handle || webid as the label.  Stoop
    // persists trustLevel in Dutch ('bekend'/'vertrouwd'); we translate
    // to EN for the chat surface.
    const TRUST_NL_TO_EN = { bekend: 'known', vertrouwd: 'trusted' };
    if (opId === 'listContacts' && Array.isArray(data.contacts)) {
      if (typeof console !== 'undefined') {
        console.log('[realAgent] listContacts result:', data.contacts.map((c) => ({
          webid: String(c.webid).slice(0,32),
          peerAddr: c.peerAddr ? (c.peerAddr.slice(0,16) + '…') : 'NONE',
        })));
      }
      return {
        // The book's own rows, under the name both shells' Contacten roster reads (`stoopContactToRow` was
        // written for this shape: displayName, the Dutch trust words). Until 2026-09-18 only the chat-shell
        // `items` below were returned, so a person added from a card — the seeded contact included — was in
        // the book and on no screen: the roster read `contacts`, found nothing, and said "No contacts yet".
        contacts: data.contacts,
        items: data.contacts.map((c) => ({
          id:          c.webid,
          type:        'contact',
          webid:       c.webid,
          label:       c.displayName ?? c.handle ?? c.webid,
          handle:      c.handle ?? null,
          trustLevel:  c.trustLevel ? (TRUST_NL_TO_EN[c.trustLevel] ?? c.trustLevel) : null,
          tags:        c.tags ?? [],
          // 2026-05-27 — surface the contact's NKN peer address (set
          // by addContactFromQr from the scanned card) so the [DM]
          // button can target the right NKN destination instead of
          // the contact's stableId/webid.  ListItemRow forwards this
          // to buttonSpecials.startDm.
          peerAddr:    c.peerAddr ?? null,
          personKey:   c.personKey ?? null,   // what a direct message to them is sealed to
          pairCircleId: c.pairCircleId ?? null,   // the pair roster, once it exists (the row says "verbonden")
        })),
        _sync: simulateSync(),
      };
    }
    // addContact / setContactTrust / setContactTags: real returns
    // {contact} → friendly text reply.
    if ((opId === 'addContact' || opId === 'setContactTrust' || opId === 'setContactTags')
        && data.contact) {
      const c = data.contact;
      const who = c.displayName ?? c.handle ?? c.webid;
      const trustEn = c.trustLevel
        ? (TRUST_NL_TO_EN[c.trustLevel] ?? c.trustLevel) : null;
      // the trust level in the person's words (the book stores the Dutch codes `bekend` / `vertrouwd`)
      const trustSaid = c.trustLevel && TRUST_NL_TO_EN[c.trustLevel] ? tr(`circle.contacts.trust.${c.trustLevel}`) : (c.trustLevel ?? null);
      const msg = opId === 'addContact'
        ? tr('circle.contacts.added_named', { name: who })
        : opId === 'setContactTrust'
          ? tr('circle.contacts.trust_updated', { name: who, level: trustSaid ?? tr('circle.contacts.trust_cleared') })
          : `✓ Tags updated for ${who}: ${(c.tags ?? []).join(', ') || '(none)'}`;
      return {
        ok: true, message: msg, contact: { ...c, trustLevel: trustEn }, _sync: simulateSync(),
      };
    }
    // getContactShareQr: real returns {payload: 'onderling-contact://...'}
    // → record reply with the URL spelt out (user can paste into any
    // QR generator).  Canvas-rendered QR image is a follow-up.
    if (opId === 'getContactShareQr' && data.payload) {
      return {
        title:    tr('circle.contacts.share_title'),
        trust:    args?.trustOffer ?? args?.trust ?? 'bekend',
        payload:  data.payload,
        // Where the card says this person can be found — surfaced so the person sees what they hand out.
        ...(Array.isArray(data.relays) ? { relays: data.relays } : {}),
        message:  tr('circle.contacts.share_hint'),
      };
    }
    // listGroupMembers: {groupId, members: []} → chat-shell list.
    // Each member carries webid/handle/displayName/role from MemberMap.
    if (opId === 'listGroupMembers' && Array.isArray(data.members)) {
      return {
        // Preserve the RAW roster alongside the chat projection so programmatic
        // consumers (the admin panel roster, the mandate WIE picker) read the
        // full-fidelity `members` (webid/role/displayName/sealingPublicKey/…),
        // while the chat-shell list renderer reads the projected `items`. Dropping
        // `members` here silently emptied every non-chat roster consumer even
        // after the trail-derived roster (B1) started returning members.
        groupId: data.groupId,
        members: data.members,
        // The chat-shell item (shape 2) is now a PROJECTION of the ONE canonical
        // Member (kring-host), not a hand-reshape: `memberToChatItem(memberFrom(row))`.
        // Identity 5B/C — the recorded per-circle address rides through
        // `memberToChatItem` (additive; absent for pre-substrate members).
        items: data.members.map((m) => memberToChatItem(memberFrom(m))),
        _sync: simulateSync(),
      };
    }
    // getGroupRules: real returns {rules: <rules-item> | null}
    // where the item carries the structured rules under
    // source.rules (an object with rulesText + accessPolicy +
    // leavePolicy + conflictPolicy + tags etc, as written by C1).
    if (opId === 'getGroupRules') {
      if (!data || data.error) {
        return {
          title:   tr('circle.rules.title'),
          status:  'no-rules-set',
          message: tr('circle.rules.none'),
        };
      }
      const item = data.rules ?? data.item ?? data;
      // 2026-05-24 fix — when the circle was created without freeform
      // rulesText (user left the textarea blank in C1), the structured
      // rules object exists but has no `rulesText` field.  Synthesize
      // a human-readable summary from the structured fields instead of
      // emitting "shape unknown".
      const rulesObj = item?.source?.rules ?? null;
      let rulesText = rulesObj?.rulesText
        ?? item?.source?.text
        ?? item?.text
        ?? null;
      if (!rulesText && rulesObj) {
        const parts = [];
        // THE AGREEMENTS FIRST, and the rest of the question set that `circleRules.js` actually
        // defines. This summary used to list the POLICY fields only — access, leave, conflict — and
        // silently dropped `agreements`, `admission`, `leaving` and `responsibility`. The agreements
        // are the part a person reads, and the part a joiner is asked to ACCEPT, so a rules document
        // that answers without them answers with the machinery and not the meaning (F-014).
        const field = (name, value) => `${tr(`circle.rules.field.${name}`)}: ${value}`;
        if (rulesObj.purpose)        parts.push(field('purpose', rulesObj.purpose));
        if (rulesObj.agreements)     parts.push(field('agreements', rulesObj.agreements));
        if (rulesObj.admission)      parts.push(field('admission', rulesObj.admission));
        if (rulesObj.leaving)        parts.push(field('leaving', rulesObj.leaving));
        if (rulesObj.responsibility) parts.push(field('responsibility', rulesObj.responsibility));
        if (rulesObj.conflict)       parts.push(field('conflict', rulesObj.conflict));
        if (rulesObj.accessPolicy)   parts.push(field('access', rulesObj.accessPolicy));
        if (rulesObj.leavePolicy)    parts.push(field('leave_policy', rulesObj.leavePolicy));
        if (rulesObj.conflictPolicy) parts.push(field('conflict_policy', rulesObj.conflictPolicy));
        if (Array.isArray(rulesObj.tags) && rulesObj.tags.length) {
          parts.push(field('tags', rulesObj.tags.join(', ')));
        }
        if (Array.isArray(rulesObj.additionalAdmins) && rulesObj.additionalAdmins.length) {
          parts.push(field('extra_admins', rulesObj.additionalAdmins.join(', ')));
        }
        rulesText = parts.length > 0
          ? parts.join('\n')
          : tr('circle.rules.defaults_apply');
      }
      if (!rulesText) {
        rulesText = tr('circle.rules.none_set');
      }
      return {
        title:   tr('circle.rules.title'),
        groupId: item?.source?.groupId ?? args?.groupId ?? '(unknown)',
        rules:   rulesText,
        addedAt: item?.addedAt ? new Date(item.addedAt).toISOString() : null,
        // The STRUCTURED document alongside the rendered text — additive, so every consumer reading
        // `rules` keeps working, and anything that needs a field rather than a paragraph (a joiner
        // being asked to accept, a screen showing one section) can reach it without re-parsing prose.
        ...(rulesObj ? { doc: rulesObj, version: item?.source?.version ?? rulesObj.version ?? null } : {}),
      };
    }
    // leaveGroup: real returns {ok} or {error}. Confirm-gated
    // above; when invoked for real, friendly text.
    if (opId === 'leaveGroup' && data.ok) {
      // Forget the left circle's no-pod sync peers (stops stale-peer boot HI-pings).
      clearCirclePeers(args?.groupId ?? args?.circleId ?? args?.circleId).catch(() => {});
      return {
        ok: true,
        message: tr('circle.groups.left'),
        _sync: simulateSync(),
      };
    }
    // Default: pass through.
    return data;
  }

  // 5.8 — host-injected `LlmClient` providers, surfaced as-is.  Downstream
  // consumers pair the per-circle policy with `selectLlmClient(policy, agent.
  // llmProviders)`; the realAgent itself doesn't call .invoke() — it just
  // makes the seam available.  Defaults to `{}` so callers can read
  // `agent.llmProviders.local` without a null guard.
  const llmProviders = (opts.llmProviders && typeof opts.llmProviders === 'object')
    ? opts.llmProviders
    : {};

  // G7 — turn on live presence now that `_listMyKnownCircles` + the roster invoke exist. Idempotent.
  _enableReachabilityOracle();

  // The personal history mirror (the sealed follower sink) — param-gated, OFF by default. When the
  // person has turned `history.mirror` on AND the shell can reach a backend (`opts.provisionHistoryMirror`,
  // the settings-medium pattern), the device log mirrors outward as sealed batches plus a snapshot head.
  // Sealed to the SAME seal-to-self strategy settings use — identical across the user's enrolled devices,
  // re-derived by the phrase ceremony. `historyMirrorSync` reconciles the running state with the switch:
  // the boot kicks it once, and a LIVE set-param of the switch kicks it again (the callSkill params branch),
  // so flipping it on starts following immediately — no reboot. Serialized; failures never touch boot.
  historyMirrorSync = () => {
    if (typeof opts.provisionHistoryMirror !== 'function' || !opts.deviceLog) return Promise.resolve();
    historyMirrorOp = historyMirrorOp.then(async () => {
      const want = paramsService.register.valueOf(HISTORY_MIRROR_PARAM_KEY) === true;
      if (!want) {
        if (historyMirror) {
          const m = historyMirror;
          historyMirror = null;
          await m.stop();   // one final flush — nothing buffered is lost by turning it off
          if (typeof console !== 'undefined') console.info('[history-mirror] stopped (switch off)');
        }
        return;
      }
      if (historyMirror) return;   // already following
      try {
        const strategy = settingsSealStrategyForIdentity(chatId);
        const source = strategy ? await opts.provisionHistoryMirror(strategy) : null;
        if (!source) return;
        // INSTANT RESTORE (the ladder): a fresh install's log is empty — hydrate the mirror back
        // FIRST (recent window per circle, then the tail in background), so a device that signed in
        // with the phrase opens its conversations live. Idempotent (id-dedup); a device with a
        // lived-in log skips it (its record IS current; the lanes carry what it missed via peers).
        let skip = null;
        if (opts.deviceLog.size === 0) {
          const r = await hydrateHistory({
            source,
            eventLog:     opts.deviceLog,
            recencyDays:  Number(paramsService.register.valueOf(HISTORY_RECENCY_DAYS_KEY)) || 30,
            maxPerCircle: Number(paramsService.register.valueOf(HISTORY_RECENCY_MAX_KEY)) || 500,
          });
          skip = r.hydratedIds;
          if (typeof console !== 'undefined') console.info(`[history-restore] recent window live: ${r.recent} entries (tail follows)`);
          r.tailDone.catch(() => { /* logged inside; the recent window is already live */ });
        }
        // The SINK: this device's own lane (what restore hydrated stays out of it — it already
        // lives in the lane it came from).
        const m = createHistoryMirror({
          eventLog: opts.deviceLog,
          source,
          laneId: custody.deviceId ?? enrolledDevice?.deviceId ?? 'root',
          skip,
          // The snapshot head: the registry rows (circles, key refs, delegations — structure the log
          // does not derive). Settings ride their own pod-sync; the head does not duplicate them.
          snapshot: async () => ({ registry: (await agentsRegistryRef?.list?.()) ?? [] }),
        });
        await m.start();
        historyMirror = m;
        if (typeof console !== 'undefined') console.info('[history-mirror] following the device log (sealed)');
      } catch (err) {
        if (typeof console !== 'undefined') console.warn('[history-mirror] not started:', err?.message ?? err);
      }
    }).catch(() => { /* serialized chain must never wedge */ });
    return historyMirrorOp;
  };

  // The VIEW LANES (remote surface reads — "the addressed editions"): one partial, sealed lane
  // per view holding a read grant. The lane's filter is the grant's sections; its seal is the
  // owner's strategy WIDENED to that view's key (`sealStrategyForRecipients`), so the view opens
  // its own lane and nothing else — the seal is the gate, on any host. Runs on the same
  // serialized chain as the main mirror and under the same switch: mirror off → all view lanes
  // stop (a read grant then waits, recorded but inert, until the mirror runs again). Revoking a
  // view stops WRITING its lane — every batch after the revoke simply never exists for it, the
  // subscription-stopped semantics the sitting ratified.
  viewLanesSync = () => {
    if (typeof opts.provisionHistoryMirror !== 'function' || !opts.deviceLog) return Promise.resolve();
    historyMirrorOp = historyMirrorOp.then(async () => {
      const mirrorOn = paramsService.register.valueOf(HISTORY_MIRROR_PARAM_KEY) === true;
      const wanted = mirrorOn ? surfaceGrants.readGrants() : [];
      const wantedBy = new Map(wanted.map((w) => [w.viewPubKey, w]));
      // Stop lanes whose grant is gone, or whose sections changed (a re-grant rewires the filter).
      for (const [key, running] of [...viewLaneMirrors]) {
        const w = wantedBy.get(key);
        if (w && JSON.stringify(w.reads) === running.readsKey) continue;
        viewLaneMirrors.delete(key);
        await running.mirror.stop();
      }
      // Start lanes for grants not yet running. Backfill is the sink's own: a fresh lane mirrors
      // every live entry passing the filter — the grant-time backfill, no extra machinery.
      for (const w of wanted) {
        if (viewLaneMirrors.has(w.viewPubKey)) continue;
        try {
          const strategy = sealStrategyForRecipients(chatId, [w.viewPubKey]);
          const source = strategy ? await opts.provisionHistoryMirror(strategy) : null;
          if (!source) continue;
          const mirror = createHistoryMirror({
            eventLog: opts.deviceLog,
            source,
            laneId: w.laneId,
            filter: compileReadFilter(w.reads),
            // The CONTENTLESS re-pull nudge, per durable flush: lane id only, best-effort over
            // the reliable peer choke (hold-forward — an offline view gets it on reconnect).
            // Tests inject `opts.surfaceNudge`; production sends to the view's own address.
            onFlush: ({ laneId }) => {
              try {
                const send = opts.surfaceNudge
                  ?? ((viewPubKey, lane) => sa.peer.sendTo(viewPubKey, { subtype: SURFACE_NUDGE_SUBTYPE, laneId: lane }, { guarantee: 'hold-forward' }));
                Promise.resolve(send(w.viewPubKey, laneId)).catch(() => { /* the lane is the truth; the nudge is best-effort */ });
              } catch { /* best-effort */ }
            },
          });
          await mirror.start();
          viewLaneMirrors.set(w.viewPubKey, { mirror, readsKey: JSON.stringify(w.reads) });
        } catch (err) {
          if (typeof console !== 'undefined') console.warn('[view-lane] not started:', err?.message ?? err);
        }
      }
    }).catch(() => { /* serialized chain must never wedge */ });
    return historyMirrorOp;
  };
  historyMirrorSync();
  viewLanesSync();

  // The persisted TRANSPORT MODE is applied at boot from the register (device scope). Before the
  // consolidation the mode lived in three write-only homes and nothing read any of them back — a
  // restart silently reset every device. Applied ONLY when it differs from the declared default:
  // the register cannot distinguish "never chosen" from "chose the default", and force-applying
  // the default would narrow a router that the relay-connect path deliberately widens to 'both'
  // (the mode is advisory against that upgrade; an explicit set-param always applies live).
  try {
    const bootMode = paramsService.register.valueOf('transport.mode');
    if (['nkn', 'relay', 'both'].includes(bootMode)
        && bootMode !== paramsService.register.defaultOf?.('transport.mode')) {
      sa.setTransportMode?.(bootMode);
    }
  } catch { /* the default stands */ }

  // THE A2A SURFACE — the declared ops, projected onto the agent peers can reach (2026-08-19).
  //
  // An agent could already invoke another agent's skill over A2A, with capability tokens and revocation,
  // and this app already does it in-process. What was missing was narrow: no manifest op was ever
  // REGISTERED as a kernel skill, so that path could not reach the waist. `renderA2A` is the projection
  // that closes it — the same declaration that becomes chat tools and slash commands becomes the ops
  // another agent may call, gated by the engine composed above.
  //
  // Registration is per-op (`app.opId`), so a CapabilityToken for one op cannot name another — the
  // existing token scoping does the work, with nothing new invented. Ops that must never be delegated
  // are `policy: 'never'` and refuse before a token is even read: a UI that simply did not offer them
  // was a convention, and a different client would have asked anyway.
  //
  // Inert without `a2aManifests` — the SHELLS own manifest composition, so they pass the list they
  // already build. Nothing is exposed to a peer until one does.
  if (Array.isArray(opts.a2aManifests) && opts.a2aManifests.length) {
    try {
      const { renderA2A } = await import('@onderling/app-manifest');
      const skills = renderA2A(opts.a2aManifests, { callSkill });
      for (const def of skills) chatAgent.skills.register(def.id, def.handler, def);
      console.info(`[a2a] ${skills.length} declared ops exposed to peers (token-gated)`);
    } catch (e) {
      // Never break boot over a surface nobody has asked for yet — but say so, because a silently
      // missing A2A surface looks exactly like a working one from the outside.
      console.warn('[a2a] surface NOT exposed:', e?.message ?? e);
    }
  }

  const api = {
    // Part G — the REAL household app manifest (item/task vocab) is now the
    // catalogue source of truth for the household surface.  (The mock manifest
    // + createMockHouseholdAgent stay in mockAgent.js as a test fixture.)
    manifest: householdManifest,
    callSkill,
    // #36 — a consumer's read of a registered param's LIVE value (sync, from the hydrated register), e.g. the
    // retention window. Reads only; writes go through callSkill('params','set-param',…).
    getParamValue: (key) => paramsService.register.valueOf(key),
    /** The history mirror's live status for the my-data surface (null = not running on this boot). */
    historyMirrorStatus: () => historyMirror?.status?.() ?? null,
    /** One-shot sealed export of the whole live device log — "mirror to a file", the same sink and
     *  the same seal; `archiveSource` + `hydrateHistory` open it again on any future install. */
    exportHistoryArchive: async () => {
      if (!opts.deviceLog) throw new Error('no device log on this composition');
      const strategy = settingsSealStrategyForIdentity(chatId);
      if (!strategy) throw new Error('no seal identity — sign in first');
      return exportHistoryArchive({
        eventLog: opts.deviceLog,
        strategy,
        snapshot: async () => ({ registry: (await agentsRegistryRef?.list?.()) ?? [] }),
      });
    },
    /** The live grants-lane entry a surface token belongs to, or null (an allow-list answer; see `surfaceGrants`). */
    surfaceTokenEntry: async (tokenId) => { await surfaceGrantsReady; return surfaceGrants.activeEntryOf(tokenId); },
    /** Resolves once the durable surface registry has loaded (grants are refused until then). */
    surfaceGrantsReady: () => surfaceGrantsReady,
    llmProviders,
    // host-injected claim router; called after every successful
    // claimTask.  Hosts wire `makeAfterClaimHook` here once the agent +
    // override store are both available.
    setAfterClaimHook(fn) { claimRouterRef.hook = typeof fn === 'function' ? fn : null; },
    // L3 — reset/state operate on the wired per-circle CircleItemStore (the live household data).
    // `reset()` wipes every open item + reseeds the demo items; `state()` returns the current open items.
    async reset() {
      const store = householdService.stores.getStore(homeCircleId);
      const open = await householdApp.listOpen(store, {});
      for (const it of open) {
        try { await store.delete(it.id); } catch { /* defensive */ }
      }
      if (opts.seedHousehold !== false) {
        for (const seed of SEED_HOUSEHOLD_ITEMS) {
          try { await householdApp.addItem(store, { type: seed.type, text: seed.text }, { by: 'webid:local-demo-user' }); }
          catch { /* defensive */ }
        }
      }
    },
    async state() {
      try { return await householdApp.listOpen(householdService.stores.getStore(homeCircleId), {}); }
      catch { return []; }
    },
    meta: {
      hostAddress: hostAgent.address,
      chatAddress: chatAgent.address,
      transport:   'internal',
    },
    // agents — the ISSUER-side TokenRegistry backing grantAgent/revokeAgent/
    // revokeGrant (issue → store; revoke → isRevoked flips true).  null when the
    // token wiring fell back to registry-only mode.  Tests + admin surfaces
    // consult `isRevoked(tokenId)` here.
    agentsTokenRegistry,
    // v0.7. — caller wires the pod-writer on sign-in / clears on
    // sign-out so calendar's .ics feed writes-through to the user's
    // pod under <pod>/onderling/calendar/feed.ics.
    // N5 — caller wires the folio Drive's real-pod source on sign-in
    // (a PodClient + container) / clears on sign-out.  Lights up the
    // "My pod" toggle in the circle Folio browser.  Pass null to detach.
    setFolioPodSource: (src) => folioAgent.setPodSource?.(src) ?? null,
    // 52.25 — wire the `/zoek` semantic embedder from the ACTIVE circle's
    // embed policy (embedTool ?? llmTool). The circle shell resolves the
    // embedder (`resolveCircleEmbedder`) and calls this on circle switch /
    // settings change; pass null (policy 'off' / unconfigured) to revert
    // `/zoek` to lexical-only. Rebuilds the note index on the next `/zoek`
    // when the embedder identity changes.
    setFolioNoteEmbedder: (e) => folioAgent.setNoteEmbedder?.(e) ?? null,
    // S4 — route stoop's items to the user's REAL pod on sign-in (parity with folio/
    // calendar). Delegates to the stoop agent's attachPod (builds a SolidPodSource +
    // activates the already-built pod-routing write-through). Pass {podRoot, webid, fetch}.
    attachStoopPod: (opts) => (typeof stoopAgent?.attachPod === 'function' ? stoopAgent.attachPod(opts) : Promise.resolve({ ok: false })),
    detachStoopPod: () => stoopAgent?.detachPod?.(),
    // S6.4 — subscribe to events the inner stoop agent emits (e.g.
    // 'stoop:attachment-fetched' when a recipient's requested attachment bytes
    // arrive over the 1:1 channel). The stoop agent extends core.Emitter
    // (on/off). Returns an unsubscribe fn; a no-op when stoop isn't composed.
    onStoopEvent: (event, handler) => {
      const a = stoopAgent?.bundle?.agent;
      if (!a || typeof a.on !== 'function' || typeof handler !== 'function') return () => {};
      a.on(event, handler);
      return () => { try { a.off?.(event, handler); } catch { /* defensive */ } };
    },
    // Expose identity info for /me + /pod-status.  pubKeys are stable
    // across refreshes because identity is persisted to VaultLocalStorage.
    identity: {
      host: { pubKey: hostId.pubKey, stableId: hostId.stableId },
      chat: { pubKey: chatId.pubKey, stableId: chatId.stableId },
    },
    /** A household bot's identity-link offer, made by this device (`/koppel`) — `{offer, nonce, root}`, or null. */
    signLinkOffer,
    /**
     * The proof a turn to a household bot the person's identity is linked to carries: THIS device's statement over
     * exactly that turn (its words, its message id) — the bot accepts it as the person only by it. Null for anyone else
     * (a statement names this device's root and id, which no other contact is shown). The contact channel's `authFor`.
     * @param {string} peerAddr
     * @param {{text: string, messageId: string}} turn
     */
    linkedTurnAuth: async (peerAddr, { text, messageId } = {}) => {
      const statement = () => deviceStatementFor(STATEMENT_DOMAINS.IDENTITY_LINK, peerAddr, LINK_OPS.TURN, { text, messageId });
      // an agent this person admitted themselves WITH (linked, or admitted by its card's code): every turn is signed
      if (await isLinkedBot(peerAddr)) return statement();
      // the admission itself: the person typed `/start <code>` to a contact whose card says it is a bot — their own act,
      // the one turn to a not-yet-admitted contact that carries a statement; this device then waits for the bot's word
      if (ADMISSION_TURN.test(String(text ?? '').trim()) && await claimsBot(peerAddr)) {
        identityLinks.expectAdmission(peerAddr);
        return statement();
      }
      return null;
    },
    /** The person's identity links: the offer's view, the bot's statement → a contact row (every shell spreads `handlers`). */
    identityLinks,
    /** Whether this install is an ENROLLED device (a delegation under the owner root) — read by a
     *  headless operator command that must refuse to enrol an install twice. */
    // ENROLLED means "by a ceremony" — the delegation the first device mints for itself at first boot (2026-09-16) does
    // not make it an enrolled device: the runner's `--enrol` and the add-a-device flows still apply to it.
    isEnrolledDevice: () => !!enrolledDevice && enrolledDevice.selfMinted !== true,

    // Cross-peer state (delegates to sa.peer).  Same surface main.js
    // already consumes: peer.address / peer.status / peer.error.
    peer: sa.peer,

    // A1 (2026-05-23) — second cross-peer transport: WebSocket relay.
    // Symmetric to .peer; main.js + the /set-relay slash use these.
    relay: sa.relay,
    // Every relay this device is on — the primary plus the relays its circles ride (2026-09-08). The host
    // registers per-circle addresses on each, scoped, through `registerCircleAddressesOnRelays`.
    relays: sa.relays,
    /**
     * Be on ONE MORE relay — the one an invite names, or one a circle recorded. The primary stays what it
     * is: a join used to swap the device's relay for the circle's, so the person was then on the new one
     * and off their own. `awaitReady` for a caller about to send over it (the join's redeem).
     */
    async addRelay(url, { awaitReady = true } = {}) {
      if (typeof url !== 'string' || !url) return { ok: false, error: 'no-url' };
      try {
        const entry = await sa.relays.add(url, { awaitReady });
        return { ok: true, url, connected: entry.connected === true, primary: entry.primary === true };
      } catch (err) {
        return { ok: false, url, error: err?.message ?? String(err) };
      }
    },

    // T5.2d — secure-mesh seams (the unified secure-mesh factory's surface).
    // Lets a shell inject a RUNTIME-built transport (e.g. basis-mobile's
    // mDNS, which needs the agent's identity so it can't go through the
    // construction-time `meshTransports` opt) — security-wrapped + on the
    // unified router — and drive WebRTC rendezvous. connectPeerTransport below
    // calls enableSecureRendezvous for the common case; these stay exposed for
    // the Nearby/mDNS path + diagnostics.
    addSecureTransport:     sa.addSecureTransport,
    /** The roster-read window at the stoop waist; a shell that lands a membership statement outside the waist clears it here. */
    rosterReads,
    removeSecureTransport:  sa.removeSecureTransport,
    enableSecureRendezvous: sa.enableSecureRendezvous,
    upgradeToRendezvous:    sa.upgradeToRendezvous,
    isRendezvousActive:     sa.isRendezvousActive,

    // OBJ-2 (S1c) — household no-pod sync roster. Fed two ways: the circle-membership
    // feed (listGroupRoster) AND the in-app "paired devices" screen. Both land here;
    // add/remove persist the manual pairings (see HOUSEHOLD_PEERS_KEY) so they survive a
    // reload. Inert until peers are added. Returns the resulting roster for the UI.
    // OBJ-2 Phase 6 — peer ops are PER-CIRCLE. `(circleId, pubKey)`; a legacy 1-arg `(pubKey)` call
    // scopes to the active circle (the paired-devices screen pairs the open circle). Each circle's
    // mirror has its own roster — pairing circle A never fans A's items to a B-only device.
    addCirclePeer:    async (circleId, pubKey) => {
      if (pubKey === undefined) { pubKey = circleId; circleId = resolveCircleId({}); }
      const id = (typeof circleId === 'string' && circleId) ? circleId : 'household';
      const mirror = await ensureCircleMirror(id);
      const fresh = isNewCirclePeer(id, pubKey);
      await mirror.addPeer(pubKey); await persistCirclePeers(id);
      if (fresh) republishCircleItemsToNewPeer(id).catch(() => {});
      return mirror.listPeers?.() ?? [];
    },
    /** This circle's current fan-out recipients — what `feedHouseholdRoster` reconciles against. */
    listCirclePeers: async (circleId) => {
      const id = (typeof circleId === 'string' && circleId) ? circleId : 'household';
      const mirror = await ensureCircleMirror(id);
      return mirror.listPeers?.() ?? [];
    },
    removeHouseholdPeer: async (circleId, pubKey) => {
      if (pubKey === undefined) { pubKey = circleId; circleId = resolveCircleId({}); }
      const id = (typeof circleId === 'string' && circleId) ? circleId : 'household';
      const mirror = await ensureCircleMirror(id);
      mirror.removePeer(pubKey); await persistCirclePeers(id);
      return mirror.listPeers?.() ?? [];
    },
    // OBJ-2 mutual pairing — add the peer AND ask it to add us back (a __pairReq carrying our address +
    // the circle), so a single scan makes the no-pod sync bidirectional. No echo → no loop.
    pairWithPeer:        (circleId, pubKey) => pairCirclePeer(circleId, pubKey),
    listHouseholdPeers:  (circleId) => circleMirrors.get((typeof circleId === 'string' && circleId) ? circleId : 'household')?.listPeers?.() ?? [],
    // This device's shareable household address (the pubKey peers route to — matches
    // relay.address; the OTHER device pastes this into its "paired devices" screen).
    householdSelfAddr:   chatId.pubKey,
    // OBJ-2 — re-push THIS circle's current open items to ALL its peers. Called on circle-open
    // (feedHouseholdRoster) so a late-subscribing / already-paired peer still converges: the
    // live publish-on-write only reaches peers subscribed AT THAT MOMENT, and catch-up fires
    // only on a FRESH pair — so without this, items added before the other side opened the
    // circle never arrive. The receiver de-dupes by etag/_v (idempotent), so re-push is safe.
    resyncHouseholdCircle: async (circleId) => { try { await republishCircleItemsToNewPeer(circleId); } catch { /* best-effort */ } },
    /**
     * Pull this circle's pod contents again — what "opening the circle" does, on demand.
     *
     * A pod-backed circle carries content THROUGH THE POD and skips the peer fan, and its catch-up
     * ran exactly once: inside `ensureCircleSync`, behind a guard that returns early ever after. So
     * a device that opened a circle and stayed open never saw another member's writes at all — not
     * "no reactive delivery", which is the documented trade, but no delivery until the process
     * restarted. Anything that refreshes a circle (pull-to-refresh, re-entering the screen, a
     * journey asserting the other member can read it back) needs this.
     *
     * No-op for a circle with no pod medium: there the peer mirror is the carry and it is live.
     */
    catchUpCircle: async (circleId) => {
      const id = (typeof circleId === 'string' && circleId) ? circleId : 'household';
      const medium = circleMedia.get(id);
      if (!medium || typeof medium.catchUp !== 'function') return false;
      try { await medium.catchUp(); return true; } catch { return false; }
    },
    // Sync seam (mirror + inbound handler) — used by S1d skill hooks + tests.
    householdSync: {
      mirror:        circleMirror,
      handleInbound: householdEnvelopeAdapter.handleInbound,
      circleId:      householdCircleId,
      selfAddr:      chatId.pubKey,
    },
    // Wire a circle's store↔mirror sync (publish AND inbound) WITHOUT waiting for a wired op.
    //
    // It was only ever wired lazily, on the first `addTask`/`listTasks`/… for that circle. For the
    // PUBLISH half that is fine — you cannot publish a write you have not made. For the INBOUND half it
    // is a race the receiver always loses: a peer's item arrives before this device has opened the tab
    // that would wire the listener, so it lands nowhere and nothing re-sends it.
    //
    // Measured 2026-08-03: A adds a task, B has the circle open, B's Taken tab reads empty — because B
    // wires its inbound only when the tab opens, which is AFTER A published. The pairing was fine
    // (`[circle-sync] paired 1 peer(s)`); there was simply nobody listening yet.
    //
    // Idempotent (guarded by `circleSyncWired`), so circle-open can call it every time.
    ensureCircleSync,

    // Registry restore-and-open: re-open every circle this device belongs to, straight from the
    // circle-membership registry (the READ side of write-on-join). Run once at boot; also exposed so a
    // shell can re-run it after a late registry import/restore without a full reload. Returns
    // `{ reopened: [circleId] }`. Idempotent + best-effort per circle.
    reopenMemberCircles,
    registryCarrierStatus: () => registryCarrierStatus(),
    /**
     * PUT A CIRCLE AWAY, or take it out (opbergen, Frits 2026-09-24): the person's mark on the circle's registry
     * record, carried to their other devices. Out of sight on every device; wakes nobody (the rule the notification
     * gate reads when there is one). A person-level fact — never a circle statement.
     */
    setCircleSight: async (circleId, putAway) => {
      const sight = { putAway: putAway === true, at: Date.now() };
      const r = await callSkill('agents', 'setProfileCircleMembership', { id: 'default', circleId, sight });
      if (r?.ok) circleFollowSync?.fanSight?.(circleId).catch?.(() => {});
      return r?.ok ? { ok: true, sight } : { ok: false, reason: r?.reason ?? 'not-recorded' };
    },
    /** `{ [circleId]: { putAway, at } }` — the marks this device holds. */
    circleSights: async () => {
      const m = await readSelfCircleMemberships().catch(() => ({}));
      return Object.fromEntries(Object.entries(m ?? {}).filter(([, r]) => r?.sight).map(([id, r]) => [id, { ...r.sight }]));
    },   // where the registry rides: local / cache, and the probe outcome

    // Transport-NEUTRAL reachability — true when ANY peer transport can carry a
    // message (NKN `.peer` OR the WebSocket `.relay`; sendPeerMessage already
    // picks whichever is up via the core RoutingStrategy). Callers that gate a
    // fan-out MUST use this, NOT `peer.status` alone — keying on `.peer` is an
    // NKN-only check that wrongly skips when relay is up but NKN is down.
    // (The whole peer layer is transport-agnostic; the `nkn`-flavoured naming
    // around it is a known cleanup — see REMAINING-WORK / the transport-naming note.)
    isPeerReachable: () => sa.peer?.status === 'connected' || sa.relay?.status === 'connected',

    get transportMode() { return sa.transportMode; },
    setTransportMode:    sa.setTransportMode,

    // The slash handlers persist the relay URL here (key: cc-relay-url).
    // The transport MODE moved to the parameter register (device scope) —
    // boot applies it and the set-param hook applies a live flip.
    vault: sa.identity?.vault ?? sa.vault ?? null,

    /**
     * Connect the cross-peer transport(s). Transport-neutral / local-first: NKN is ONE transport,
     * not a prerequisite — bring up whichever is configured (`nknLib` and/or `relayUrl`). Passing only
     * `relayUrl` is the LAN no-pod path (two devices over a relay, no public-NKN dependency); passing
     * only `nknLib` is the original NKN path; both → the unified router picks the best route per peer.
     * Caller (web main.js / circleApp / RN bundle) injects its runtime's nkn-sdk when available.
     */
    async connectPeerTransport({ nknLib, onPeerMessage, relayUrl, extraRelayUrls = [], rendezvous = false, rtcLib = null, awaitRelayReady = false }) {
      if (!nknLib && !relayUrl) {
        throw new Error('connectPeerTransport: provide nknLib and/or relayUrl (nothing to connect)');
      }
      // OBJ-2 (S1a) — consume household substrate-sync envelopes off the inbound
      // peer-message stream BEFORE the shell router. handleInbound returns true
      // (consumed) only for tagged household-item envelopes; everything else
      // (DMs, circle-posts, calendar invites) falls through to the shell's
      // onPeerMessage unchanged.
      //
      // The secure-mesh receive path delivers a SINGLE `{ from, payload, ts }` env
      // (createSecureAgent makeReceiveHandler → onPeerMessageFn({from,payload,ts})),
      // and the shell router (makePeerRouter) also takes that env object. handleInbound,
      // though, wants `(fromAddress, payload)` positionally — so extract them from the
      // env. (The earlier `(addr, payload)` form passed the whole env as the address +
      // undefined payload, so household sync never matched over the real wire — a latent
      // bug surfaced by the Layer-3 relay test; the shell router was unaffected as it
      // reads the env object regardless.)
      const routedOnPeerMessage = (env) => {
        // OBJ-2 mutual pairing — the other device added us as a peer and asks us to add it back, so the
        // sync is bidirectional from one scan. Add + persist (no echo → no loop), then consume.
        const pr = env?.payload?.__pairReq;
        if (pr && typeof pr.addr === 'string' && pr.addr && pr.addr !== chatId.pubKey) {
          const cid = (typeof pr.circleId === 'string' && pr.circleId) ? pr.circleId : 'household';
          // Honoured only from a member of that circle (by the roster the membership rail folds) or one of my own
          // devices — the sender AND the address it asks to add. A stranger's request would otherwise grow the
          // circle's persisted peer list on its say-so, and make this device re-fan every open item to every member
          // as often as it liked. Refused: counted, nothing added, nothing sent.
          pairRequestAllowed(cid, [pr.addr, env?.from])
            .then((ok) => {
              if (!ok) { inboundRefused['pair-request-stranger'] = (inboundRefused['pair-request-stranger'] ?? 0) + 1; return null; }
              const fresh = isNewCirclePeer(cid, pr.addr);
              return ensureCircleMirror(cid)
                .then((m) => m.addPeer(pr.addr))
                .then(() => persistCirclePeers(cid))
                .then(() => { if (fresh) return republishCircleItemsToNewPeer(cid); });   // backfill, per-circle
            })
            .catch(() => {});
          return;
        }
        // THE OLD ITEM-ENVELOPE WIRE IS CUT INBOUND (2026-10-07). An envelope tagged `__ntfyEnv` used to reach
        // notify-envelope, which writes its payload into this agent's local pseudo-pod at whatever `ref` it names
        // before anything checks it — the pod that holds this agent's endorsements (the catalogue's trust). Any
        // address that could say hello on the relay could rewrite them. Nothing current sends the shape (items ride
        // the signed task lane), so it stops here, counted, and writes nothing. The adapter and the mirror stay in
        // the tree (kept mechanisms); the wire to them is what is cut.
        if (env?.payload && typeof env.payload === 'object' && Object.prototype.hasOwnProperty.call(env.payload, '__ntfyEnv')) {
          inboundRefused['old-envelope'] = (inboundRefused['old-envelope'] ?? 0) + 1;
          return;
        }
        return onPeerMessage?.(env);
      };
      // THE RELAY NEVER WAITS ON NKN (2026-09-18). This used to `await` NKN first and dial the relay after
      // — so an unreachable NKN network (its fallback chain is minutes long, then it throws) meant the relay,
      // the alpha's one default transport, was never dialled at all, while the settings panel said
      // "connected". With a relay configured it comes up FIRST, and NKN is brought up beside it without
      // being waited for: its outcome is a log line and, when it does connect, a wider route set. Without a
      // relay, NKN is awaited as before — the NKN-only walks keep their contract.
      let nknUp = false;
      const bringNkn = async () => {
        if (!nknLib) return;
        try {
          await sa.peer.connect({ nknLib, onPeerMessage: routedOnPeerMessage });
          nknUp = true;
        } catch (err) {
          if (typeof console !== 'undefined') console.warn(`[realAgent] nkn connect failed${relayUrl ? ' (the relay carries on)' : ' (no cross-peer wire — nkn was the only transport)'}:`, err?.message ?? err);
          if (!relayUrl) throw err;
        }
      };
      // T3a (unification / OBJ-1) — when a relay is configured, bring it up. With NKN also up the
      // secure-agent's RoutingStrategy (T2) picks the BEST route per peer (relay > nkn by priority);
      // relay-ONLY pins transportMode to 'relay' so sends route over it. Best-effort: a relay failure
      // never blocks NKN — but if relay is the ONLY transport, its failure means no cross-peer wire.
      const bringRelay = async () => {
        if (!relayUrl) return;
        try {
          // `awaitRelayReady` — for callers who send on the next line (a join dialling the endpoint its
          // invite names). Boot leaves it off: blocking start-up behind a relay is what the transport's
          // non-blocking connect exists to avoid.
          await sa.relay.connect({ relayUrl, onPeerMessage: routedOnPeerMessage, awaitReady: awaitRelayReady });
          sa.setTransportMode(nknUp ? 'both' : 'relay');
          if (typeof console !== 'undefined') console.info(`[realAgent] relay connected — routing across {${nknUp ? 'nkn, relay' : 'relay'}}`);
          // The relays my circles ride, beside the primary (2026-09-08). Best-effort each: one relay that is
          // down must not cost the others. Boot does not wait for their sockets (same reason as above).
          for (const url of (Array.isArray(extraRelayUrls) ? extraRelayUrls : [])) {
            if (!url || url === relayUrl) continue;
            try { await sa.relays.add(url); }
            catch (err) { if (typeof console !== 'undefined') console.warn(`[realAgent] extra relay ${url} failed:`, err?.message ?? err); }
          }
        } catch (err) {
          if (typeof console !== 'undefined') console.warn(`[realAgent] relay connect failed${nknLib ? ' (continuing on NKN)' : ' (no cross-peer wire — relay was the only transport)'}:`, err?.message ?? err);
        }
      };
      if (relayUrl) {
        await bringRelay();
        // NKN beside it, unawaited: when it connects later the router widens to both routes.
        bringNkn().then(() => { if (nknUp && sa.relay?.status === 'connected') sa.setTransportMode('both'); }).catch(() => { /* said above */ });
      } else {
        await bringNkn();
      }
      // T5.2d — opt in to direct WebRTC rendezvous, signalled over whichever transport just
      // came up (peer/relay). Web needs no rtcLib (RendezvousTransport uses globalThis
      // .RTCPeerConnection); RN injects react-native-webrtc via `rtcLib`. Best-effort: when the
      // rtcLib is missing the agent keeps routing over nkn/relay/mdns — rendezvous just stays off.
      if (rendezvous) {
        try {
          await sa.enableSecureRendezvous({ rtcLib });
          if (typeof console !== 'undefined') console.info('[realAgent] rendezvous enabled — direct WebRTC upgrade available');
        } catch (err) {
          if (typeof console !== 'undefined') console.warn('[realAgent] rendezvous enable failed (continuing without direct WebRTC):', err?.message ?? err);
        }
      }
      // revokes owed to a node the person owns (a contact deleted while it was away): told now that this device is on
      retryPendingRevokes().catch(() => {});
      return sa.peer;
    },
    /** Tell the person's nodes the revokes they are still owed (the connect and a node's answer do this themselves). */
    retryPendingCompanionRevokes: () => retryPendingRevokes(),

    /**
     * Fire-and-forget cross-peer send.  Auto-HI on first contact,
     * SecurityLayer sign+encrypt — both handled inside the factory.
     * S1 mute-block: throws when targetAddress is muted.
     *
     * `opts` is forwarded to the secure send path. Pass
     * `{ guarantee: 'hold-forward' }` (or `{ hold: true }`) to opt in to the
     * delivery guarantee: a send to an unreachable peer is parked locally and
     * flushed on the peer's next presence signal instead of being lost/errored
     * (returns a `{ held: true, ... }` result rather than throwing).
     */
    async sendPeerMessage(targetAddress, payload, opts = {}) {
      // `asPerson`: speak as the current PERSON key — for the own-device messages the other end cannot yet
      // place (an enrolling device's first requests). Without a person key the send speaks as it always did.
      if (opts?.asPerson) {
        const { asPerson, ...rest } = opts;   // eslint-disable-line no-unused-vars
        const pa = personAddress();
        // The relay refuses a frame from an address this socket has not registered — and tells only the relay's
        // log, the sender still sees "delivered". So the person address is (re)registered right before the first
        // person-speaking send, whatever a shell's boot order (found on the runner's enrol walk, 2026-09-16).
        if (pa) await registerPersonAddressOnRelays();
        return sendCircleScoped(targetAddress, payload, { ...rest, ...(pa ? { sendAs: pa } : {}) });
      }
      return sendCircleScoped(targetAddress, payload, opts);
    },
    /** The current person key's wire address (b64 pubKey), or null. */
    personAddress,
    /** `[{ address, sign }]` for a shell's relay alias registration: the person address beside the per-circle ones. */
    ownAddressBindings,
    /** Every address this person's devices speak as — what keeps me out of my own Contacten. */
    ownAddresses,

    /**
     * Presence hook for the delivery guarantee — call when a peer becomes
     * reachable again (a reachability / peer-joined event) to flush any
     * messages held for them. Inbound traffic from the peer flushes
     * automatically; this is the explicit trigger for reachability events.
     */
    presenceSignal(targetAddress) {
      return sa.presenceSignal(targetAddress);
    },

    /** Diagnostics: how many messages are currently held for a peer. */
    heldFor(targetAddress) {
      return sa.heldFor(targetAddress);
    },
    /**
     * The address-fallback setting changed under held messages. A message held because its circle had no
     * route it MAY use is waiting on us, not on the peer — no presence signal will release it. Re-stamp
     * every hold with the terms as they are NOW (the same live read each send makes) and re-send.
     */
    /** The shell registers what happens when another member's post LANDS in a circle store (see noticeboardCarry.js). */
    setNoticeboardLandedHook(fn) { _noticeboardLanded = typeof fn === 'function' ? fn : null; },
    retryHeldUnderCurrentTerms() {
      const requireAliasCapable = !addressFallbackOn();
      return sa.flushHeld?.({
        rescope: (o) => (o?.scope ? { ...o, scope: { ...o.scope, requireAliasCapable } } : o),
      }) ?? Promise.resolve({ flushed: 0 });
    },
    /** Receipt-keyed hold removal (per peer + msgId) — the receipt receiver's outbox hook. */
    removeHeld(a) {
      return sa.removeHeld?.(a) ?? 0;
    },

    /**
     * Rotate the chat-agent's Ed25519 identity.  Old key stays valid
     * for a 7-day grace period; KeyRotation.broadcast notifies known
     * peers.  S6 autoLog fires 'identity.rotate'.
     */
    async rotateChatIdentity(rotateOpts = {}) {
      return sa.rotateIdentity(rotateOpts);
    },

    /** Diagnostic for /security-status (proxies through the factory). */
    securityStatus() { return sa.securityStatus(); },

    /**
     * Direct access to the underlying secure-agent.  Lets new
     * basis commands (mute, audit-tail, claim, …) tap every
     * primitive the factory wires without re-exposing each one.
     */
    sa,
    /** Read one resource of this agent's local substrate pod (diagnostics: what a peer could have written there). */
    readLocalPod: (uri) => circleSubstrate.pseudoPod.read(uri),
    /** Inbound peer messages the router refused, by reason (never silent). */
    inboundRefusals: () => ({ ...inboundRefused }),
    // Diagnostic (step 2.4a) — the enforcement gate on the host skills' agent. Non-null proves
    // the PolicyEngine attached (vs the try/catch having silently swallowed it).
    hostPolicyEngine: hostAgent.policyEngine ?? null,
    /**
     * A door admitted a person with a role: set their tier in the host gate. member → `authenticated`, admin →
     * `trusted`. Nothing else: the owner's level (`private`) is self only and cannot be given from a door.
     */
    /**
     * The host gate's answer for a door's person on an op the door answers itself (its own ops: a person's thread
     * settings, the bot admin's app list): a refusal code, or null. `visibility` is the op's declared level.
     */
    doorRefusal: (opId, caller, visibility) => doorRefusal(opId, caller, visibility),
    /**
     * Expose skill definitions to peers (from `renderA2A`) after boot: a door that answers as a PERSON builds them over
     * its own call, which exists only once the door does. Token-gated like the boot-time ones. It never REPLACES a
     * skill (the registry is last-write-wins): an id already registered — a kernel skill, an op withheld with
     * `policy: 'never'` — throws, before any of the defs is registered.
     * @param {Array<{id: string, handler: Function}>} defs
     * @returns {number} how many were registered
     */
    exposeToPeers: (defs) => {
      const list = (Array.isArray(defs) ? defs : []).filter((def) => def?.id && typeof def.handler === 'function');
      const taken = list.filter((def) => chatAgent.skills.has(def.id)).map((def) => def.id);
      if (taken.length) throw new Error(`exposeToPeers: already registered, not replaced: ${taken.join(', ')}`);
      for (const def of list) chatAgent.skills.register(def.id, def.handler, def);
      return list.length;
    },
    /**
     * Let go of ONE circle's content on this device: its store's rows (beneath the store, so no member hears of a
     * removal) and every entry of it on the device log. For a device that left, or was removed from, a circle and keeps
     * nothing of it — a household bot (a person's device keeps its history: leaving says "your local data stays").
     * The household itself is never forgotten here.
     * @param {string} circleId
     * @returns {Promise<{ok: boolean, rows?: number, entries?: number, reason?: string}>}
     */
    forgetCircleContent: async (circleId) => {
      if (typeof circleId !== 'string' || !circleId || circleId === 'household' || circleId === homeCircleId) return { ok: false, reason: 'not-a-joined-circle' };
      let rows = await householdService.stores.forget(circleId);
      // …and the legacy per-circle bucket the peer mirror kept, if it ever held this circle
      if (householdDataSource) {
        const legacy = (await householdDataSource.list(`mem://household/circles/${circleId}/`).catch(() => [])) ?? [];
        for (const k of legacy) await householdDataSource.delete(k);
        rows += legacy.length;
      }
      householdStores.delete(circleId);
      circleSyncWired.delete(circleId);
      const entries = opts.deviceLog?.forgetCircle?.(circleId) ?? 0;
      return { ok: true, rows, entries };
    },
    /**
     * Every item of the household's store, as stored (the export writes its public fields from these). The household,
     * by name: a circle the bot joined is never in its export, whatever circle a shell calls active.
     */
    /** A household bot's circle id (derived from its key), and what its first boot of this version moved there. */
    householdCircleId: botHouseholdId,
    householdCircleMove,
    householdItems: async () => (await householdService.stores.getStore(homeCircleId).list()) ?? [],
    /** A household bot's reminders read the household's chores and appointments, whole (dates, who comes) — never a joined circle's. */
    /**
     * The circle stores this node holds, each under its circle id: what its planned-work book reads beside its own
     * store. The home circle and every circle it is a member of.
     */
    heldCircleStores: async () => {
      const ids = new Set(homeCircleId && homeCircleId !== 'household' ? [homeCircleId] : []);
      try {
        for (const c of ((await callSkill('stoop', 'listMyCircles', {}))?.circles ?? [])) {
          const id = typeof c === 'string' ? c : (c?.groupId ?? c?.id);
          if (typeof id === 'string' && id && id !== 'household') ids.add(id);
        }
      } catch { /* the home circle alone still serves */ }
      return [...ids].map((id) => ({ scope: id, store: householdService.stores.getStore(id) }));
    },
    reminderSources: async () => {
      const store = householdService.stores.getStore(homeCircleId);
      const [chores, events] = await Promise.all([store.listByType('task'), store.listByType('calendar-event')]);
      return { chores: chores ?? [], events: events ?? [] };
    },
    /**
     * Whose profile this node runs: a PERSON's (their devices keep their inbox; nothing answers it) or a FUNCTION's
     * (a household bot on its own node — its inbox is the bot's, and the assistant answers it). Read from the
     * profile record, never from a flag or from "not enrolled".
     */
    profileKind: async () => ((await agentsRegistryRef?.lookup?.('default'))?.kind === 'function' ? 'function' : 'person'),
    /**
     * Name this node's profile a function's (once, at the bot's install: the bot IS its own profile, this node its
     * device). Refused when the profile has another device: a profile with a phone and a laptop behind it is a
     * person's, and their inbox must never start answering (the VPS box, enrolled as Frits' device).
     */
    markFunctionProfile: async () => {
      if (!agentsRegistryRef || typeof agentsRegistryRef.updateKind !== 'function') throw new Error('markFunctionProfile: no profile registry');
      const cur = await agentsRegistryRef.lookup('default');
      if (profileHasOtherDevices(cur ?? {}, enrolledDevice?.deviceId ?? null)) throw new Error('markFunctionProfile: this profile has other devices — it is a person\'s, not a function\'s');
      await agentsRegistryRef.updateKind('default', 'function');
    },
    /** A door dropped a person (revoked): the gate treats them as a stranger from now on. */
    clearDoorCaller: async (callerId) => {
      doorRoles.delete(callerId);
      if (!hostTrustRegistry) throw new Error('clearDoorCaller: the host gate is not attached');
      if (typeof callerId !== 'string' || !callerId) throw new Error('clearDoorCaller: a caller id is required');
      await hostTrustRegistry.setTier(callerId, 'public');
    },
    setDoorCaller: async (callerId, role) => {
      const tier = DOOR_TIER_FOR_ROLE[role];
      if (!tier) throw new Error(`setDoorCaller: a door gives only ${Object.keys(DOOR_TIER_FOR_ROLE).join(' or ')} (got "${role}")`);
      if (!hostTrustRegistry) throw new Error('setDoorCaller: the host gate is not attached');
      if (typeof callerId !== 'string' || !callerId) throw new Error('setDoorCaller: a caller id is required');
      await hostTrustRegistry.setTier(callerId, tier);
      doorRoles.set(callerId, role);
    },
    // Who may retire this device's addresses: the persona's authority, at a ceremony (core ceremonyCommitment.js).
    ceremonyCommitmentFor, signCeremonyCommitment,
    /** The persona runtime this device runs for a persona id (personaRuntime.js) — 'default' only today. */
    persona: (id = 'default') => personas.get(id) ?? null,
    circleSealingKeyPairFor,   // this device's per-circle sealing keypair (the address key's ed2curve image)
    historyKeyChainFor,   // group-key versions absorbed at a replace ceremony (the history sidecar)
    restorePending: () => restorePendingAtBoot,   // a phrase ceremony ran here and the restore-finish flow has not asked yet
    /** The ceremony was an ADD (an offer is being consumed), not a restore: drop the note without the flow. */
    dismissRestorePending: async () => {
      try { await ownerRootVault.delete?.(RESTORE_PENDING_KEY); } catch { /* best-effort — the next boot asks again */ }
      restorePendingAtBoot = false;
    },
    // Step 5B/C — the per-circle ADDRESS this device presents in a circle (unlinkable-by-default),
    // derived from the default profile seed. The substrate the roster-recording wire consumes.
    circleAddressFor,
    // The address IS a public key, so registering it on a relay means answering a challenge with the
    // matching private key. This is that signer — it stays beside circleAddressFor because the two are
    // one fact: an address you cannot prove is an address you cannot register.
    circleAddressSignerFor: (circleId) => circleAddressSigner(deviceDerivationSeed, circleId),
    // Decision 4 — the per-circle SIGNING identity behind that address, and the one call a shell
    // makes to switch it on. `installCircleIdentities(ids)` must run for every circle this device is
    // in: without it this device cannot OPEN what was sent to its per-circle address, and a shell
    // that forgets it looks exactly like a shell whose relay is down. Both shells call it beside
    // their existing per-circle address registration.
    circleIdentityFor,
    // The membership rider's rail (null without opts.deviceLog) — the shells register the fan receiver +
    // the catch-up pair over THIS instance so both ends verify with the same declaration + binding rules.
    membershipRail,
    // The grants lane (connections belong to the person): the shells register the ready-made fan
    // receiver (`grantsPeerHandler` under GRANTS_BROADCAST) + the catch-up pair, and kick
    // `grantsCatchUp.requestFromSiblings()` on connect so a revoke made elsewhere binds at this
    // door before a stale view is served.
    grantsRail,
    grantsPeerHandler,
    grantsCatchUp,
    // The contact-thread fan (a DM reaches the person, not one of their devices): the shells hand
    // `contactTurnFan` to the contact channel and register `contactTurnHandler(applyTurn)` under
    // CONTACT_TURN_BROADCAST.
    contactTurnFan,
    contactTurnHandler,
    contactTurnBroadcast: CONTACT_TURN_BROADCAST,
    // Who this device knows, carried to the person's other devices (bindings + contact book): the
    // shells spread `handlers` into the router and kick `requestFromSiblings` on connect; the
    // announce landing calls `pushTo` for a device of mine that just appeared.
    knownPeersSync,
    // Siblings follow a circle: the lane table spreads `handlers`; the shells `setConsume(entry => consumeCircleEntry(deps, entry))`
    // beside their enrol consume and kick `requestFromSiblings` on connect; the registry setter fans a new membership.
    circleFollowSync,
    /** Say something about myself on the rosters named: `{ circleIds, props }` → `{ emitted, unchanged, failed }` (the `member-props` writer). */
    emitMemberProps: sayOnRosters,
    /** The person's address-fallback setting, read live — the lanes' catch-ups aim at the global key only when it is on. */
    addressFallbackOn,
    /** The current person key `{ version, pubKey }` (rotating, per profile), or null on an enrolled device from before person keys. */
    personKey: currentPersonKey,
    // The person key between my devices: the lane table spreads its handlers; the shells kick its request on connect.
    /** The primary-device choice (sync-policy §12): `isMine()`, `claim()`, `requestFromSiblings()`, `handlers`. */
    primaryDevice,
    /** Where a message to a contact goes once their pair roster exists (`pairRoster.js`): `{ to, circleId, personKey }` or null. */
    pairRouteFor: (contactWebid) => pairRouteFor({ callSkill: (a, o, g) => callSkill(a, o, g), selfWebid: chatId.pubKey, contactWebid }),
    claimPrimaryDevice: () => primaryDevice.claim(),
    personKeySync,
    /** My person-key chain `{ current, links }` — what a contact pulls after a rotation. */
    personKeyChain,
    personKeyChainOf,
    /** The direct-message seal to the person (`sealFor` / `openFor`) — the shells hand it to the contact channel. */
    contactSeal,
    /** A contact's current person key: a shared circle's row, else the contact book. */
    contactPersonKeyOf,
    // The one sibling carry (L100): the lane table (`buildCircleLanes`) hands it every landed statement.
    siblingCarry,
    /** The person's own store (the own-devices scope), one per node: built on first ask from what the shell handed in. */
    ownStore: getOwnStore,
    /** Its catch-up between the person's devices: `requestFromSiblings()` on connect; `onRequest`/`onBatch`/`onOffer` + `subtypes` for the router. */
    ownStoreSync,
    /** Inbound envelopes the security layer refused, per reason — the diagnostic read of the warning above. */
    refusedInboundByReason: () => Object.fromEntries(refusedInbound),
    // The roster seed (pod-less enroll S1): the shells register `onRequest`/`onBatch` under its
    // subtypes; `consumeEnrollOffer` sends `buildRequest` to the sibling.
    rosterSeed,
    // The task lane's rail (same contract): the shells register circle-task-broadcast + its catch-up pair
    // over this instance; its ingest also causally merges the snapshot into the circle's store head.
    taskRail,
    // The chat lane's rail + emitter: the shells register circle-chat-statement + the windowed catch-up
    // over the rail, and their SEND sites call chatEmit (append-signed-render-entry + fan) instead of
    // the legacy append-then-fan pair.
    chatRail,
    chatEmit,
    // The KEY lane's rail + emitter: the sink hands every establish/rotation to keyEmit (sign +
    // chain + append) and fans the statement; the shells register circle-key-statement + the
    // catch-up pair over the rail, and refresh their key-event store as the lane's projection.
    keyRail,
    keyEmit,
    /** State the circle's policy on the governance lane: `{groupId, policy, version}` → the signed statement or null. */
    emitPolicyUpdate: policyUpdateEmit,
    registerSelfIdentity: (address, identity) => sa.registerSelfIdentity?.(address, identity) ?? false,
    forgetSelfIdentity:   (address) => sa.forgetSelfIdentity?.(address) ?? false,
    installCircleIdentities: (circleIds) => installCircleSigningIdentities({
      circleIds,
      circleAddressFor,
      circleIdentityFor,
      registerSelfIdentity: (address, id) => sa.registerSelfIdentity(address, id),
      onFailed: (cid) => console.warn(`[realAgent] no per-circle signing identity for ${cid} — this `
        + 'device signs that circle as its global identity, and messages sealed to its per-circle '
        + 'address cannot be opened.'),
    }),
    // G12 — bind a member's PER-CIRCLE address to their identity key, so this device can seal to it.
    // Without this, routing to a per-circle address (G13 step C) throws `No pubKey registered` above the
    // transport and every message holds. The shells call it with the circle roster, which already carries
    // `{pubKey, circleAddress}` per member. → `src/v2/circleAddressKeys.js` for the reasoning.
    registerPeerAddress: (address, pubKey, addrOpts) =>
      sa.registerPeerAddress?.(address, pubKey, addrOpts) ?? false,
    forgetPeerAddress:   (address) => sa.forgetPeerAddress?.(address) ?? false,
    /**
     * WHO is at this address — the person's canonical identity key, or the address itself when this
     * device has never been told they are the same peer.
     *
     * The linkage already exists and deliberately lives ONE layer down, device-local (`sa.resolver`,
     * "the one place that LINKS a person's per-circle addresses back to one person"): per-circle
     * unlinkability means that fact is nobody else's to see, so it is never derived on the wire or from
     * a shareable MemberMap. This is only the pass-through that lets a surface ask.
     *
     * Surfaces that name a PERSON — a DM thread, a contact row — key on this rather than on the address
     * a message happened to arrive at. Decided by Frits 2026-09-03: threads are keyed by identity, and
     * someone who is one person in the data does not get to appear as several. A genuinely separate
     * persona is a separate webid, not a second address for the same one.
     *
     * @param {string} address
     * @returns {string} the canonical identity key, or `address` unchanged
     */
    identityOfAddress: (address) => {
      if (typeof address !== 'string' || !address) return address;
      try { return sa.resolver?.pubKeyForAddr?.(address) || address; }
      catch { return address; }
    },
    // Decision 1 step 3 — feed the roster authorize. Called from `bindCircleAddressKeysFor`, i.e.
    // from the same read of the same rows that binds each member's address to their key: the two
    // facts are one fact, and reading them twice is how the two drift. Returns how many distinct
    // keys may now speak in the circle, so a caller can tell "recorded" from "the read came back
    // empty and I recorded nothing".
    async recordCircleSenders({ circleId, members } = {}) {
      const ownAddress = circleAddressFor(circleId);
      if (!ownAddress) return 0;
      let selfCircleKey = null;
      try { selfCircleKey = (await circleIdentityFor(circleId))?.pubKey ?? null; } catch { /* derive-only */ }
      return circleSenders.recordCircleRoster({
        circleId,
        ownAddress,
        members,
        // Our per-circle signing key. The static profile key is NOT admitted any more (2026-09-16): no own-device
        // lane speaks as it, and the one that had to — the enrolling device's first requests — speaks as the
        // person key now, which the authorizer admits live (`ownKeysLive`), rotation and all.
        selfKeys: [selfCircleKey].filter(Boolean),
        // …and our WEBID, because a founder's own row can carry a pubKey that is neither of those:
        // `deriveRoster` gives a founder no keys, so the row comes from the display cache and brings
        // this device's stoop identity with it. Without this the row reads as a stranger's.
        selfWebid: chatId.pubKey,
      });
    },
    /** Drop a circle's authorize snapshot — the circle was left. */
    forgetCircleSenders: (circleId) => circleSenders.forgetCircleSenders(circleId),
    /**
     * THE circle's store — one per circle, the `CircleItemStore` every typed item lives in and the one
     * the rail mirrors. Exposed because a composition that needs items (the lists service, and any
     * feature after it) must be handed THIS store rather than building one: "two stores for one circle
     * is a defect, not a design", and a second store is how a feature comes to reach no peer at all.
     */
    circleStoreFor: (circleId) => householdService.stores.getStore(circleId),
    /** Diagnostics for `/security-status`: how strong this device's membership check actually is. */
    circleSenderAuthorization: () => ({
      installed:               !!sa.senderAuthorizerInstalled,
      circles:                 circleSenders.circleAddressCount,
      unknownRosterAllowances: circleSenders.unknownRosterAllowances,
      refusedStrangers:        circleSenders.refusedStrangers,
      // B6 — the two halves of "is per-circle signing enforced here, and how far is it done?"
      refusedCanonicalSigners: circleSenders.refusedCanonicalSigners,
      canonicalOnlyMembers:    circleSenders.canonicalOnlyMembers,
    }),
    // Decision B (SENSITIVE) — sign the cross-circle link challenge with the SOURCE circle's
    // key (seed-derived, no vault) so a "continue as an existing self" claim is PROVABLE. The
    // join wizard passes this on the redeem seam; the admin verifies it before recording.
    signCircleLink: (circleId, groupId, address) => signCircleLinkFromSeed(deviceDerivationSeed, circleId, groupId, address),
    /**
     * Mount an app's LOCAL ops on this agent's waist — today `basis`, whose handlers end in the
     * device's own affordances (a picker, a camera, a panel, a pod login) and so cannot be agent
     * skills. A shell calls this after boot with its seam-rich `createLocalBuiltins` table; until it
     * does, the default table above serves the ops that need nothing but the agent.
     *
     * Deliberately a REPLACE, not a merge: a half-mounted table is the shape that produces "some rows
     * work", which is harder to see than none working.
     *
     * @param {string} appOrigin  'basis' (the only local app today)
     * @param {Record<string, Function>} ops  opId → handler, e.g. `createLocalBuiltins({…})`
     */
    mountAppOps: (appOrigin, ops, manifest = null) => {
      if (appOrigin === 'basis') {
        mountedBasisOps = ops && typeof ops === 'object' ? ops : null;
        return;
      }
      // Any other local app must bring its MANIFEST, because that is what says which ops exist —
      // basis's is known here, another app's is not, and a table with no contract behind it is exactly
      // the "feature only its own screen can open" this mechanism exists to end.
      if (!manifest?.operations) throw new Error(`mountAppOps: "${appOrigin}" needs its manifest`);
      if (ops && typeof ops === 'object') mountedLocalApps.set(appOrigin, { manifest, ops });
      else mountedLocalApps.delete(appOrigin);
    },
  };
  selfAgent = api;
  return api;
}
