/**
 * THE STORAGE REGISTER — every name a shell or the box stores under, declared once.
 *
 * A browser keeps everything a page stores by origin, and Basis's web app shares its origin with other pages; the
 * phone and the box have stores of their own. Until this file, a storage name was a literal at the call site that
 * opened it, on each shell separately, and the lists that must know every name (what a freshly enrolled device
 * forgets, what a start-over removes) were kept by hand beside them. A name added at a call site and missed in a
 * list fails nothing, so this is the one table the lists are derived from.
 *
 * One row per name:
 *  - `name`   the stored name today (a key, a key prefix, a store / database, a vault key prefix, a box file);
 *  - `kind`   `key` · `prefix` (a key family, the suffix a circle, persona or screen) · `store` (an IndexedDB
 *             database on web, an AsyncStorage scope on the phone, a file on the box) · `vault` (a vault key prefix,
 *             the device's identity and keys) · `file` (the box only);
 *  - `shells` which shells open it;
 *  - `forget` what a device that has just been enrolled does with it: `throwaway` (the throwaway self wrote it,
 *             it goes), `keep` (the device's own or the ceremony's, it stays). Every row is ruled; a new name is
 *             ruled in the PR that adds it.
 *  - `seal`   how it sits on the disk: `'sealed'` (with the device's content key, or by the vault), or why not, under
 *             one head: `not content:` (a device flag or view state) · `not sealable:` (read before a key exists, or a
 *             key itself) · `unwritten:` (nothing writes under it today) · `debt: L<n>` (should be sealed; its ledger
 *             row). `lint-storage-register` holds a raw write to a `'sealed'` row red.
 *
 * The names keep today's spelling. The move to one prefix (`basis.`) lands in the alpha build, together with the
 * choice between a fresh start and a one-time rewrite: renaming without a migration would empty a live device's
 * identity and data.
 */

const row = (name, kind, shells, forget, seal) => Object.freeze({ name, kind, shells: Object.freeze(shells), forget, seal });
const W = 'web', M = 'mobile', B = 'box';

export const STORAGE = Object.freeze({
  // ── stores: an IndexedDB database (web), an AsyncStorage scope (phone), a file (box) ──
  agentRegistry:          row('cc-agent-registry', 'store', [W, M], 'throwaway', 'sealed'),
  deviceLog:              row('cc-device-log', 'store', [W, M, B], 'throwaway', 'sealed'),
  contactDms:             row('cc-contact-dm-state', 'store', [W, M], 'throwaway', 'sealed'),
  ownDevices:             row('cc-own-devices', 'store', [W, M], 'throwaway', 'sealed'),
  outboxWeb:              row('cc-outbox-state', 'store', [W], 'throwaway', 'sealed'),
  outboxPhone:            row('cc-outbox-cache', 'store', [M], 'throwaway', 'sealed'),
  // what the former self had already taken (the inbound repeat record), kept BESIDE each outbox under a derived
  // name (`besidePersistDb`)
  outboxSeenWeb:          row('cc-outbox-state-seen-inbound', 'store', [W], 'throwaway', 'sealed'),
  outboxSeenPhone:        row('cc-outbox-cache-seen-inbound', 'store', [M], 'throwaway', 'sealed'),
  pushDevice:             row('cc-push-device', 'store', [W, M], 'throwaway', 'sealed'),
  // Settings, the pinboard and the household: each shell names its own, and the two sets are NOT the same words.
  settingsWeb:            row('cc-settings-state', 'store', [W], 'throwaway', 'sealed'),
  settingsPhone:          row('cc-settings-cache', 'store', [M], 'throwaway', 'sealed'),
  pinboardWeb:            row('cc-pinboard-state', 'store', [W, B], 'throwaway', 'sealed'),
  pinboardPhone:          row('cc-pinboard-cache', 'store', [M, B], 'throwaway', 'sealed'),
  householdWeb:           row('cc-household-state', 'store', [W], 'throwaway', 'sealed'),
  householdPhone:         row('cc-household-cache', 'store', [M], 'throwaway', 'sealed'),
  tasksPhone:             row('cc-tasks-cache', 'store', [M], 'throwaway', 'sealed'),
  tasksWeb:               row('cc-tasks-state', 'store', [W], 'throwaway', 'unwritten: left by an earlier build; the web keeps its tasks in the per-circle stores'),
  circleLists:            row('cc-circle-lists-state', 'store', [M], 'throwaway', 'sealed'),
  circleRag:              row('cc-circle-rag', 'store', [W, M], 'throwaway', 'sealed'),
  // the phone's object-version snapshots (a circle's policy, rules and recipe as they were): the throwaway self's too
  objectVersionsPhone:    row('ccv', 'store', [M], 'throwaway', 'sealed'),
  // The help circle's own stores, named explicitly. Its id is the literal `cc-help`, so the throwaway self and the
  // enrolled person share its store NAME: the one database where two identities' sealed rows sit together. A
  // throwaway self that never provisioned it is not in the registry either, so the per-circle route would skip it.
  helpCircleStore:        row('cc-circle-cc-help', 'store', [W, M], 'throwaway', 'sealed'),
  helpCircleCache:        row('cc-circle-cache-cc-help', 'store', [W, M], 'throwaway', 'sealed'),
  attachmentBlobs:        row('cc-attachment-blobs', 'store', [W], 'throwaway', 'sealed'),
  circlePodVault:         row('cc-circle-pod', 'store', [W], 'keep', 'sealed'),
  peerGraph:              row('cc-peers:', 'prefix', [W, M], 'throwaway', 'sealed'),
  basisDb:                row('basis', 'store', [W], 'throwaway', 'unwritten: nothing writes it today; listed so a start-over removes it'),
  vaultDb:                row('dwag-vault', 'store', [W], 'keep', 'not sealable: the device vault\'s container: what it holds is ruled per vault row below (sealed by the vault, or a key itself)'),
  rootKeyDb:              row('onderling-root-key', 'store', [W], 'keep', 'not sealable: holds the non-extractable WebCrypto root key itself: it is what the seal is made from'),
  pseudoPodDb:            row('onderling-pseudo-pod', 'store', [W], 'throwaway', 'unwritten: the package default name; every shell store passes its own name (pickWebBackend)'),
  podClientDb:            row('onderling-pod-client', 'store', [W], 'throwaway', 'unwritten: the package default name; IndexedDBTombstones is not constructed by any shell'),

  // ── key families (the suffix is a circle, a persona or a screen) ──
  // what was last shared with a circle, keyed `<persona>::<circle>` with no identity in it: on `cc-help` the two
  // selves collide exactly and a stale memo would answer "unchanged" to a real first disclosure
  sharedDisclosure:       row('cc.sharedDisclosure.', 'prefix', [W, M], 'throwaway', 'sealed'),
  circlePolicy:           row('cc.circlePolicy.', 'prefix', [W, M], 'throwaway', 'sealed'),
  circlePolicyHead:       row('cc.circlePolicyHead.', 'prefix', [W, M], 'throwaway', 'sealed'),
  circlePolicyPending:    row('cc.circlePolicyPending.', 'prefix', [W, M], 'throwaway', 'not content: a pending flag ({pending: bool}) per circle'),
  circleRules:            row('cc.circleRules.', 'prefix', [W, M], 'throwaway', 'sealed'),
  circleRulesPending:     row('cc.circleRulesPending.', 'prefix', [W, M], 'throwaway', 'sealed'),
  circleRecipe:           row('cc.circleRecipe.', 'prefix', [W, M], 'throwaway', 'sealed'),
  circleRecipePending:    row('cc.circleRecipePending.', 'prefix', [W, M], 'throwaway', 'sealed'),
  circleOverride:         row('cc.circleOverride.', 'prefix', [W, M], 'throwaway', 'sealed'),
  screenBlocksCache:      row('cc.screenBlocksCache.', 'prefix', [W, M], 'throwaway', 'sealed'),
  keptCircles:            row('basis.keptCircles', 'prefix', [W, M], 'throwaway', 'sealed'),
  nearbyAskedWeb:         row('basis.nearby-asked:', 'prefix', [W], 'throwaway', 'not content: whether Nearby was asked about, per circle'),
  nearbyAskedPhone:       row('cc.nearby-asked:', 'prefix', [M], 'throwaway', 'not content: whether Nearby was asked about, per circle'),
  // when the circle advisor card was last shown, per circle
  advisorShown:           row('cc.advisorShown.', 'prefix', [W, M], 'throwaway', 'not content: when the advisor card was last shown'),
  screenClient:           row('onderling.screen.', 'prefix', [W], 'keep', 'not sealable: a screen\'s own storage: a screen has no content key (its own key sits in the same storage)'),
  mappings:               row('onderling.mappings:', 'prefix', [M], 'throwaway', 'not sealable: read before a key exists: bootAgentBundle loads the extension mappings at its start, before the content key'),

  // ── single keys ──
  // The help circle's two flags go TOGETHER: clear one and keep the other and the enrolled person gets a help
  // circle that never says anything.
  helpCircleProvisioned:  row('cc.helpCircleProvisioned', 'key', [W, M], 'throwaway', 'not content: a first-run flag'),
  onboardingDone:         row('cc.onboardingDone', 'key', [W, M], 'throwaway', 'not content: a first-run flag'),
  // set for the THROWAWAY identity's phrase; the enrolled person typed a different one, so a kept flag would be a
  // safety record making a false claim
  mnemonicAck:            row('cc.mnemonicAck', 'key', [W, M], 'throwaway', 'not content: a first-run flag'),
  keyCardSnoozedUntil:    row('cc.keyCardSnoozedUntil', 'key', [W, M], 'throwaway', 'not content: when the key card may show again'),
  contactNames:           row('cc.contactNames', 'key', [W, M], 'throwaway', 'sealed'),
  contactSeenAt:          row('cc.contactSeenAt', 'key', [W, M], 'throwaway', 'sealed'),
  // kept, every thread of the former self would open already-read
  circleSeenAt:           row('cc.circleSeenAt', 'key', [W, M], 'throwaway', 'sealed'),
  circlePinned:           row('cc.circlePinned', 'key', [W, M], 'throwaway', 'sealed'),
  activeCircle:           row('cc.activeCircle', 'key', [W, M], 'throwaway', 'not content: which circle is open (web sessionStorage, view state)'),
  circleViewMode:         row('cc.circleViewMode', 'key', [W, M], 'throwaway', 'not content: view state'),
  connectionPoints:       row('cc.connectionPoints', 'key', [W, M], 'throwaway', 'not sealable: read at module load on the web, before the agent and its key (the boot relay); sealed by its caller on the phone'),
  delivery:               row('cc.delivery', 'key', [W, M], 'throwaway', 'not content: the person\'s delivery-receipt preferences'),
  availability:           row('cc.availability', 'key', [W, M], 'throwaway', 'sealed'),
  agentRequests:          row('cc.agentRequests', 'key', [W, M], 'throwaway', 'unwritten: only the default name the one caller overrides'),
  agentRequestQueue:      row('cc.agentRequestQueue', 'key', [W], 'throwaway', 'sealed'),
  reciprocityQueue:       row('cc.reciprocityQueue', 'key', [W, M], 'throwaway', 'unwritten: createMessageQueue has no consumer'),
  sharedWithMe:           row('cc.sharedWithMe', 'key', [W, M], 'throwaway', 'sealed'),
  userScreens:            row('cc.userScreens', 'key', [W, M], 'throwaway', 'sealed'),
  actionFrequency:        row('cc.actionFrequency', 'key', [W, M], 'throwaway', 'sealed'),
  firstBootSeeded:        row('cc.firstBootSeeded.v1', 'key', [M], 'throwaway', 'not content: a first-boot flag'),
  nearbyAllowsWeb:        row('basis.nearbyAllows', 'key', [W], 'throwaway', 'not content: Nearby consent switches'),
  nearbyAllowsPhone:      row('cc.nearbyAllows', 'key', [M], 'throwaway', 'not content: Nearby consent switches'),
  nearbyMineSeenWeb:      row('basis.nearbyMineSeen', 'key', [W], 'throwaway', 'unwritten: left by an earlier build'),
  nearbyMineSeenPhone:    row('cc.nearbyMineSeen', 'key', [M], 'throwaway', 'unwritten: left by an earlier build'),
  nearbySelfWeb:          row('basis.nearbySelf', 'key', [W], 'throwaway', 'not content: which self enters the room'),
  nearbySelfPhone:        row('cc.nearbySelf', 'key', [M], 'throwaway', 'not content: which self enters the room'),
  nearbyRadio:            row('cc.nearbyRadio', 'key', [M], 'keep', 'not content: the radio switch'),
  askMatchSkips:          row('cc.askMatchSkips', 'key', [W, M], 'throwaway', 'sealed'),
  fallbackOffer:          row('cc.fallbackOffer', 'key', [W, M], 'keep', 'sealed'),
  firstOpenSeen:          row('cc.firstOpenSeen', 'key', [W, M], 'keep', 'not content: a first-run flag'),
  introCardSeen:          row('cc.introCardSeen', 'key', [W, M], 'keep', 'not content: a first-run flag'),
  lastTab:                row('cc.lastTab', 'key', [W, M], 'keep', 'not content: view state'),
  // which tab of the assistant panel was last chosen (Gesprek / Maken)
  assistantTab:           row('cc.assistantTab', 'key', [W, M], 'keep', 'not content: which assistant panel tab was last chosen (view state)'),
  nativeCalendarIds:      row('cc.nativeCalendar.eventIdMap', 'key', [M], 'throwaway', 'sealed'),
  inFlightFlows:          row('cc-in-flight-flows', 'key', [W, M], 'throwaway', 'unwritten: an exported constant nothing writes under'),
  wakeNudges:             row('cc-wake-nudges', 'key', [M], 'throwaway', 'unwritten: the switch lives in the parameter register (settings, sealed)'),
  startOverPage:          row('basis.startOverPage', 'key', [W], 'keep', 'not content: a one-load flag that opens the start-over page (web sessionStorage)'),
  // the offer stash: the next start joins the circles it names; a device that forgets it comes back enrolled and
  // in no circle (the box keeps it explicitly)
  enrollOffer:            row('onderling.enrollOffer', 'key', [W, M, B], 'keep', 'not sealable: stashed under the throwaway self\'s key and read after the enrol ceremony, across the key change (realAgent.js)'),
  relayUrl:               row('cc.relayUrl', 'key', [W, M], 'keep', 'not sealable: read at module load, before the agent and its key (circleApp.js boot relay; the phone at boot)'),
  userLlmDefault:         row('cc.userLlmDefault', 'key', [W, M], 'keep', 'sealed'),
  theme:                  row('basis.theme', 'key', [W, M], 'keep', 'not content: the theme'),
  language:               row('circle.app.lang', 'key', [W, M], 'keep', 'not content: the app language'),
  welcomed:               row('cc.welcomed', 'key', [M], 'keep', 'not content: a first-run flag'),

  // ── vault key prefixes: the device's identity and keys (the ceremony has just written them) ──
  // the ceremony has JUST written these; a key sweep cannot reach them, but an unsaid survivor is the failure
  // this register exists to prevent, so they are said
  vaultChatId:            row('cc-chat-id:', 'vault', [W, M], 'keep', 'sealed'),
  vaultOwnerRoot:         row('cc-owner-root:', 'vault', [W, M], 'keep', 'not sealable: the marker vault: the root\'s own store and the plain markers (forget / restore / start-over pending), read before the key'),
  vaultOwnerRootSeed:     row('cc-owner-root-seed', 'vault', [M], 'keep', 'not sealable: the root seed itself, in the OS secure store'),
  vaultHostId:            row('cc-host-id:', 'vault', [W, M], 'keep', 'sealed'),
  vaultHostGrants:        row('cc-host-grants:', 'vault', [W, M], 'keep', 'sealed'),
  vaultHostTrust:         row('cc-host-trust:', 'vault', [W, M], 'keep', 'sealed'),
  vaultPeerTrust:         row('cc-peer-trust:', 'vault', [W, M], 'keep', 'sealed'),
  vaultHistoryKeys:       row('cc-history-keys:', 'vault', [W, M], 'keep', 'sealed'),
  vaultAgentTokens:       row('cc-agent-tokens:', 'vault', [W, M], 'keep', 'sealed'),
  vaultPinboardId:        row('cc-pinboard-id:', 'vault', [W, M], 'keep', 'sealed'),
  vaultTasksId:           row('cc-tasks-id:', 'vault', [W, M], 'keep', 'sealed'),
  vaultCirclePod:         row('cc-circle-pod:', 'vault', [M], 'keep', 'sealed'),
  vaultRelayUrl:          row('cc-relay-url', 'vault', [W, M], 'keep', 'sealed'),
  circleGroupKey:         row('cc.circle-groupkey', 'vault', [W, M], 'keep', 'sealed'),
  circleControllerKey:    row('cc.circle-controller-key', 'vault', [W, M], 'keep', 'sealed'),
  sealingIdentity:        row('cc.sealing-identity', 'vault', [W, M], 'keep', 'sealed'),
  screenGrant:            row('onderling-screen:', 'vault', [W], 'keep', 'not sealable: a screen\'s grant: a screen has no content key (its own key sits in the same storage)'),
  vaultOwnerRootKey:      row('vault:owner-root', 'vault', [W, M, B], 'keep', 'not sealable: the owner root key itself (the content key is derived from it)'),
  vaultContentKey:        row('vault:content-at-rest-key', 'vault', [W, M, B], 'keep', 'not sealable: the content key itself'),
  vaultDelegationSeed:    row('vault:device-delegation-seed', 'vault', [W, M, B], 'keep', 'not sealable: the device\'s delegation seed itself (the content key is derived from it)'),
  vaultCustodyMode:       row('vault:custody-mode', 'vault', [W, M, B], 'keep', 'not sealable: read before the key: it says which key to derive'),
});

/**
 * The words Basis stores under on a shared web origin (the prefixes of the names above). A toolbox may not take one as
 * its name (Frits 2026-11-20): a toolbox's page shares the origin, and a page named after one of Basis's prefixes could
 * read or write what Basis keeps there.
 */
export const RESERVED_NAMES = Object.freeze(['basis', 'circle', 'cc', 'onderling']);
/** @param {string} name  true when the name is one of `RESERVED_NAMES` or starts with one and a separator */
export function isReservedName(name) {
  const n = String(name ?? '').trim().toLowerCase();
  return RESERVED_NAMES.some((r) => n === r || n.startsWith(`${r}-`) || n.startsWith(`${r}.`) || n.startsWith(`${r}:`));
}

/** The stored name for a register id. An id that is not in the register is a programming error, said at once. */
export function storageName(id) {
  const r = STORAGE[id];
  if (!r) throw new Error(`storageName: '${id}' is not in the storage register (apps/basis/src/v2/storageRegister.js)`);
  return r.name;
}

/** The names of the rows that match. */
export function storageNames(pred) {
  return Object.values(STORAGE).filter(pred).map((r) => r.name);
}
