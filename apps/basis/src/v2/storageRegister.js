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
 *  - `shape`  what is stored and the version a later build reads it by (below, at SNAP).
 *
 * Every name starts with the one prefix `basis.` (the alpha build's fresh start: the move carries no migration, so
 * the first build with it opens empty stores and a new identity on every device). Two kinds of name stand outside
 * it, each on purpose: the keys INSIDE a vault (`vault:…`, the vault adds its own prefix) and a toolbox screen
 * page's grant (`screenGrant`), which is the page's and not the person's, so a start-over leaves it.
 */

const row = (name, kind, shells, forget, seal, shape) => Object.freeze({ name, kind, shells: Object.freeze(shells), forget, seal, shape });
const W = 'web', M = 'mobile', B = 'box';

/**
 * `shape`: what is stored under the name, and the version a later build reads it by (`lint-shapes` compares it with
 * `scripts/stored-shapes.json`). A `v` is only ever one a reader sees:
 *  - SNAP  a Map written through the snapshot gate (`mapSnapshotGate`, local-store): `v` is the stamp the gate writes and
 *          checks. A fitness test pins it to MAP_SNAPSHOT_V until the store passes its own `v` to its gate;
 *  - LOG   the device log's segmented manifest (`backendSnapshotIo`, eventLogPersistence.js), which carries its own `v`;
 *  - ROWS  a backend of one row per key (a per-circle store, the peer graph, a blob store): no stamp, `v: 'none'`;
 *  - k(…)  a single value under a key or a key family: no carrier, so `v: 'none'`; its kind changes under a NEW key,
 *          never in place (`flag` a marker such as '1' · `string` a plain text value · `json` an object or a list);
 *  - OPAQUE  a vault value, a key, a container this build does not read as a shape, or a name nothing writes today.
 */
const SNAP = Object.freeze({ v: 1, carrier: 'snapshot' });
const LOG = Object.freeze({ v: 1, carrier: 'device-log manifest' });
const ROWS = Object.freeze({ v: 'none', value: 'rows' });
const k = (value) => Object.freeze({ v: 'none', value });
const OPAQUE = 'opaque';

export const STORAGE = Object.freeze({
  // ── stores: an IndexedDB database (web), an AsyncStorage scope (phone), a file (box) ──
  agentRegistry:          row('basis.agent-registry', 'store', [W, M], 'throwaway', 'sealed', ROWS),
  deviceLog:              row('basis.device-log', 'store', [W, M, B], 'throwaway', 'sealed', LOG),
  contactDms:             row('basis.contact-dm-state', 'store', [W, M], 'throwaway', 'sealed', SNAP),
  ownDevices:             row('basis.own-devices', 'store', [W, M], 'throwaway', 'sealed', SNAP),
  outbox:                 row('basis.outbox', 'store', [W, M], 'throwaway', 'sealed', SNAP),
  // what the former self had already taken (the inbound repeat record), kept BESIDE the outbox under a derived
  // name (`besidePersistDb`)
  outboxSeen:             row('basis.outbox-seen-inbound', 'store', [W, M], 'throwaway', 'sealed', SNAP),
  pushDevice:             row('basis.push-device', 'store', [W, M], 'throwaway', 'sealed', SNAP),
  // Settings, the pinboard and the household: one name on every shell (the box maps each to its file)
  settings:               row('basis.settings', 'store', [W, M], 'throwaway', 'sealed', SNAP),
  pinboard:               row('basis.pinboard', 'store', [W, M, B], 'throwaway', 'sealed', SNAP),
  household:              row('basis.household', 'store', [W, M], 'throwaway', 'sealed', SNAP),
  // the web keeps its tasks in the per-circle stores; only the phone has this one
  tasks:                  row('basis.tasks', 'store', [M], 'throwaway', 'sealed', SNAP),
  circleLists:            row('basis.circle-lists-state', 'store', [M], 'throwaway', 'sealed', SNAP),
  circleRag:              row('basis.circle-rag', 'store', [W, M], 'throwaway', 'sealed', ROWS),
  // the phone's object-version snapshots (a circle's policy and recipe as they were): the throwaway self's too
  objectVersionsPhone:    row('basis.object-versions', 'store', [M], 'throwaway', 'sealed', ROWS),
  // the object-version snapshots' key family (kring-host's versionsRootFor, handed this prefix): in the sealed
  // localStorage on the web, inside the phone's object-versions scope
  objectVersionKeys:      row('basis.versions.', 'prefix', [W, M], 'throwaway', 'sealed', ROWS),
  // The help circle's own stores, named explicitly. Its id is the literal `cc-help`, so the throwaway self and the
  // enrolled person share its store NAME: the one database where two identities' sealed rows sit together. A
  // throwaway self that never provisioned it is not in the registry either, so the per-circle route would skip it.
  helpCircleStore:        row('basis.circle-cc-help', 'store', [W, M], 'throwaway', 'sealed', ROWS),
  helpCircleCache:        row('basis.circle-cache-cc-help', 'store', [W, M], 'throwaway', 'sealed', ROWS),
  attachmentBlobs:        row('basis.attachment-blobs', 'store', [W], 'throwaway', 'sealed', ROWS),
  circlePodVault:         row('basis.circle-pod', 'store', [W], 'keep', 'sealed', OPAQUE),
  peerGraph:              row('basis.peers:', 'prefix', [W, M], 'throwaway', 'sealed', ROWS),
  rootKeyDb:              row('basis.root-key', 'store', [W], 'keep', 'not sealable: holds the non-extractable WebCrypto root key itself: it is what the seal is made from', OPAQUE),

  // ── key families (the suffix is a circle, a persona or a screen) ──
  // what was last shared with a circle, keyed `<persona>::<circle>` with no identity in it: on `cc-help` the two
  // selves collide exactly and a stale memo would answer "unchanged" to a real first disclosure
  sharedDisclosure:       row('basis.sharedDisclosure.', 'prefix', [W, M], 'throwaway', 'sealed', k('json')),
  circlePolicy:           row('basis.circlePolicy.', 'prefix', [W, M], 'throwaway', 'sealed', k('json')),
  circlePolicyHead:       row('basis.circlePolicyHead.', 'prefix', [W, M], 'throwaway', 'sealed', k('json')),
  circlePolicyPending:    row('basis.circlePolicyPending.', 'prefix', [W, M], 'throwaway', 'not content: a pending flag ({pending: bool}) per circle', k('json')),
  circleRecipe:           row('basis.circleRecipe.', 'prefix', [W, M], 'throwaway', 'sealed', k('json')),
  circleRecipePending:    row('basis.circleRecipePending.', 'prefix', [W, M], 'throwaway', 'sealed', k('json')),
  circleOverride:         row('basis.circleOverride.', 'prefix', [W, M], 'throwaway', 'sealed', k('json')),
  screenBlocksCache:      row('basis.screenBlocksCache.', 'prefix', [W, M], 'throwaway', 'sealed', k('json')),
  // the circle offering an admin is drafting, per circle
  circleSkill:            row('basis.circleSkill.', 'prefix', [W, M], 'throwaway', 'sealed', k('json')),
  keptCircles:            row('basis.keptCircles', 'prefix', [W, M], 'throwaway', 'sealed', k('json')),
  nearbyAsked:            row('basis.nearby-asked:', 'prefix', [W, M], 'throwaway', 'not content: whether Nearby was asked about, per circle', k('flag')),
  // when the circle advisor card was last shown, per circle
  advisorShown:           row('basis.advisorShown.', 'prefix', [W, M], 'throwaway', 'not content: when the advisor card was last shown', k('string')),
  screenClient:           row('basis.screen.', 'prefix', [W], 'keep', 'not sealable: a screen\'s own storage: a screen has no content key (its own key sits in the same storage)', k('json')),
  mappings:               row('basis.mappings:', 'prefix', [M], 'throwaway', 'not sealable: read before a key exists: bootAgentBundle loads the extension mappings at its start, before the content key', k('json')),
  // the web's extension mappings, sealed (the phone's, above, are read before the key)
  mappingsWeb:            row('basis.mappings-web:', 'prefix', [W], 'throwaway', 'sealed', k('json')),

  // ── single keys ──
  // The help circle's two flags go TOGETHER: clear one and keep the other and the enrolled person gets a help
  // circle that never says anything.
  helpCircleProvisioned:  row('basis.helpCircleProvisioned', 'key', [W, M], 'throwaway', 'not content: a first-run flag', k('flag')),
  onboardingDone:         row('basis.onboardingDone', 'key', [W, M], 'throwaway', 'not content: a first-run flag', k('flag')),
  // set for the THROWAWAY identity's phrase; the enrolled person typed a different one, so a kept flag would be a
  // safety record making a false claim
  mnemonicAck:            row('basis.mnemonicAck', 'key', [W, M], 'throwaway', 'not content: a first-run flag', k('flag')),
  keyCardSnoozedUntil:    row('basis.keyCardSnoozedUntil', 'key', [W, M], 'throwaway', 'not content: when the key card may show again', k('string')),
  contactNames:           row('basis.contactNames', 'key', [W, M], 'throwaway', 'sealed', k('json')),
  contactSeenAt:          row('basis.contactSeenAt', 'key', [W, M], 'throwaway', 'sealed', k('json')),
  // kept, every thread of the former self would open already-read
  circleSeenAt:           row('basis.circleSeenAt', 'key', [W, M], 'throwaway', 'sealed', k('json')),
  circlePinned:           row('basis.circlePinned', 'key', [W, M], 'throwaway', 'sealed', k('json')),
  activeCircle:           row('basis.activeCircle', 'key', [W, M], 'throwaway', 'not content: which circle is open (web sessionStorage, view state)', k('string')),
  circleViewMode:         row('basis.circleViewMode', 'key', [W, M], 'throwaway', 'not content: view state', k('json')),
  connectionPoints:       row('basis.connectionPoints', 'key', [W, M], 'throwaway', 'not sealable: read at module load on the web, before the agent and its key (the boot relay); sealed by its caller on the phone', k('json')),
  delivery:               row('basis.delivery', 'key', [W, M], 'throwaway', 'not content: the person\'s delivery-receipt preferences', k('json')),
  availability:           row('basis.availability', 'key', [W, M], 'throwaway', 'sealed', k('json')),
  agentRequests:          row('basis.agentRequests', 'key', [W, M], 'throwaway', 'unwritten: only the default name the one caller overrides', OPAQUE),
  agentRequestQueue:      row('basis.agentRequestQueue', 'key', [W], 'throwaway', 'sealed', k('json')),
  reciprocityQueue:       row('basis.reciprocityQueue', 'key', [W, M], 'throwaway', 'unwritten: createMessageQueue has no consumer', OPAQUE),
  sharedWithMe:           row('basis.sharedWithMe', 'key', [W, M], 'throwaway', 'sealed', k('json')),
  userScreens:            row('basis.userScreens', 'key', [W, M], 'throwaway', 'sealed', k('json')),
  actionFrequency:        row('basis.actionFrequency', 'key', [W, M], 'throwaway', 'sealed', k('json')),
  firstBootSeeded:        row('basis.firstBootSeeded.v1', 'key', [M], 'throwaway', 'not content: a first-boot flag', k('flag')),
  nearbyAllows:           row('basis.nearbyAllows', 'key', [W, M], 'throwaway', 'not content: Nearby consent switches', k('json')),
  nearbySelf:             row('basis.nearbySelf', 'key', [W, M], 'throwaway', 'not content: which self enters the room', k('string')),
  nearbyRadio:            row('basis.nearbyRadio', 'key', [M], 'keep', 'not content: the radio switch', k('string')),
  askMatchSkips:          row('basis.askMatchSkips', 'key', [W, M], 'throwaway', 'sealed', k('json')),
  fallbackOffer:          row('basis.fallbackOffer', 'key', [W, M], 'keep', 'sealed', k('json')),
  firstOpenSeen:          row('basis.firstOpenSeen', 'key', [W, M], 'keep', 'not content: a first-run flag', k('flag')),
  introCardSeen:          row('basis.introCardSeen', 'key', [W, M], 'keep', 'not content: a first-run flag', k('flag')),
  lastTab:                row('basis.lastTab', 'key', [W, M], 'keep', 'not content: view state', k('string')),
  nativeCalendarIds:      row('basis.nativeCalendar.eventIdMap', 'key', [M], 'throwaway', 'sealed', k('json')),
  inFlightFlows:          row('basis.in-flight-flows', 'key', [W, M], 'throwaway', 'unwritten: an exported constant nothing writes under', OPAQUE),
  startOverPage:          row('basis.startOverPage', 'key', [W], 'keep', 'not content: a one-load flag that opens the start-over page (web sessionStorage)', k('flag')),
  // the offer stash: the next start joins the circles it names; a device that forgets it comes back enrolled and
  // in no circle (the box keeps it explicitly)
  enrollOffer:            row('basis.enrollOffer', 'key', [W, M, B], 'keep', 'not sealable: stashed under the throwaway self\'s key and read after the enrol ceremony, across the key change (realAgent.js)', k('string')),
  relayUrl:               row('basis.relayUrl', 'key', [W, M], 'keep', 'not sealable: read at module load, before the agent and its key (circleApp.js boot relay; the phone at boot)', k('string')),
  userLlmDefault:         row('basis.userLlmDefault', 'key', [W, M], 'keep', 'sealed', k('json')),
  theme:                  row('basis.theme', 'key', [W, M], 'keep', 'not content: the theme', k('string')),
  language:               row('basis.app.lang', 'key', [W, M], 'keep', 'not content: the app language', k('string')),
  welcomed:               row('basis.welcomed', 'key', [M], 'keep', 'not content: a first-run flag', k('flag')),

  // ── vault key prefixes: the device's identity and keys (the ceremony has just written them) ──
  // the ceremony has JUST written these; a key sweep cannot reach them, but an unsaid survivor is the failure
  // this register exists to prevent, so they are said
  vaultChatId:            row('basis.chat-id:', 'vault', [W, M], 'keep', 'sealed', OPAQUE),
  vaultOwnerRoot:         row('basis.owner-root:', 'vault', [W, M], 'keep', 'not sealable: the marker vault: the root\'s own store and the plain markers (forget / restore / start-over pending), read before the key', OPAQUE),
  vaultOwnerRootSeed:     row('basis.owner-root-seed', 'vault', [M], 'keep', 'not sealable: the root seed itself, in the OS secure store', OPAQUE),
  vaultHostId:            row('basis.host-id:', 'vault', [W, M], 'keep', 'sealed', OPAQUE),
  vaultHostGrants:        row('basis.host-grants:', 'vault', [W, M], 'keep', 'sealed', OPAQUE),
  vaultHostTrust:         row('basis.host-trust:', 'vault', [W, M], 'keep', 'sealed', OPAQUE),
  vaultPeerTrust:         row('basis.peer-trust:', 'vault', [W, M], 'keep', 'sealed', OPAQUE),
  vaultHistoryKeys:       row('basis.history-keys:', 'vault', [W, M], 'keep', 'sealed', OPAQUE),
  vaultAgentTokens:       row('basis.agent-tokens:', 'vault', [W, M], 'keep', 'sealed', OPAQUE),
  vaultPinboardId:        row('basis.pinboard-id:', 'vault', [W, M], 'keep', 'sealed', OPAQUE),
  vaultTasksId:           row('basis.tasks-id:', 'vault', [W, M], 'keep', 'sealed', OPAQUE),
  vaultCirclePod:         row('basis.circle-pod:', 'vault', [M], 'keep', 'sealed', OPAQUE),
  vaultRelayUrl:          row('basis.relay-url', 'vault', [W, M], 'keep', 'sealed', OPAQUE),
  circleGroupKey:         row('basis.circle-groupkey', 'vault', [W, M], 'keep', 'sealed', OPAQUE),
  circleControllerKey:    row('basis.circle-controller-key', 'vault', [W, M], 'keep', 'sealed', OPAQUE),
  screenGrant:            row('onderling-screen:', 'vault', [W], 'keep', 'not sealable: a screen\'s grant: a screen has no content key (its own key sits in the same storage)', OPAQUE),
  vaultOwnerRootKey:      row('vault:owner-root', 'vault', [W, M, B], 'keep', 'not sealable: the owner root key itself (the vault\'s at-rest key is derived from it)', OPAQUE),
  vaultContentKey:        row('vault:content-at-rest-key', 'vault', [W, M, B], 'keep', 'not sealable: the content key itself; it is random, and rests inside the sealed device vault (sealed by the vault, not by itself)', OPAQUE),
  vaultDelegationSeed:    row('vault:device-delegation-seed', 'vault', [W, M, B], 'keep', 'not sealable: the device\'s delegation seed itself (the vault\'s at-rest key is derived from it)', OPAQUE),
  vaultCustodyMode:       row('vault:custody-mode', 'vault', [W, M, B], 'keep', 'not sealable: read before the key: it says which key to derive', OPAQUE),
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
