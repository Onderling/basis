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
 *
 * The names keep today's spelling. The move to one prefix (`basis.`) lands in the alpha build, together with the
 * choice between a fresh start and a one-time rewrite: renaming without a migration would empty a live device's
 * identity and data.
 */

const row = (name, kind, shells, forget) => Object.freeze({ name, kind, shells: Object.freeze(shells), forget });
const W = 'web', M = 'mobile', B = 'box';

export const STORAGE = Object.freeze({
  // ── stores: an IndexedDB database (web), an AsyncStorage scope (phone), a file (box) ──
  agentRegistry:          row('cc-agent-registry', 'store', [W, M], 'throwaway'),
  deviceLog:              row('cc-device-log', 'store', [W, M, B], 'throwaway'),
  contactDms:             row('cc-contact-dm-state', 'store', [W, M], 'throwaway'),
  ownDevices:             row('cc-own-devices', 'store', [W, M], 'throwaway'),
  outboxWeb:              row('cc-outbox-state', 'store', [W], 'throwaway'),
  outboxPhone:            row('cc-outbox-cache', 'store', [M], 'throwaway'),
  // what the former self had already taken (the inbound repeat record), kept BESIDE each outbox under a derived
  // name (`besidePersistDb`)
  outboxSeenWeb:          row('cc-outbox-state-seen-inbound', 'store', [W], 'throwaway'),
  outboxSeenPhone:        row('cc-outbox-cache-seen-inbound', 'store', [M], 'throwaway'),
  pushDevice:             row('cc-push-device', 'store', [W, M], 'throwaway'),
  // Settings, the pinboard and the household: each shell names its own, and the two sets are NOT the same words.
  settingsWeb:            row('cc-settings-state', 'store', [W], 'throwaway'),
  settingsPhone:          row('cc-settings-cache', 'store', [M], 'throwaway'),
  pinboardWeb:            row('cc-pinboard-state', 'store', [W, B], 'throwaway'),
  pinboardPhone:          row('cc-pinboard-cache', 'store', [M, B], 'throwaway'),
  householdWeb:           row('cc-household-state', 'store', [W], 'throwaway'),
  householdPhone:         row('cc-household-cache', 'store', [M], 'throwaway'),
  tasksPhone:             row('cc-tasks-cache', 'store', [M], 'throwaway'),
  tasksWeb:               row('cc-tasks-state', 'store', [W], 'throwaway'),
  circleLists:            row('cc-circle-lists-state', 'store', [M], 'throwaway'),
  circleRag:              row('cc-circle-rag', 'store', [W, M], 'throwaway'),
  // The help circle's own stores, named explicitly. Its id is the literal `cc-help`, so the throwaway self and the
  // enrolled person share its store NAME: the one database where two identities' sealed rows sit together. A
  // throwaway self that never provisioned it is not in the registry either, so the per-circle route would skip it.
  helpCircleStore:        row('cc-circle-cc-help', 'store', [W, M], 'throwaway'),
  helpCircleCache:        row('cc-circle-cache-cc-help', 'store', [W, M], 'throwaway'),
  attachmentBlobs:        row('cc-attachment-blobs', 'store', [W], 'throwaway'),
  circlePodVault:         row('cc-circle-pod', 'store', [W], 'keep'),
  peerGraph:              row('cc-peers:', 'prefix', [W, M], 'throwaway'),
  basisDb:                row('basis', 'store', [W], 'throwaway'),
  vaultDb:                row('dwag-vault', 'store', [W], 'keep'),
  rootKeyDb:              row('onderling-root-key', 'store', [W], 'keep'),
  pseudoPodDb:            row('onderling-pseudo-pod', 'store', [W], 'throwaway'),
  podClientDb:            row('onderling-pod-client', 'store', [W], 'throwaway'),

  // ── key families (the suffix is a circle, a persona or a screen) ──
  // what was last shared with a circle, keyed `<persona>::<circle>` with no identity in it: on `cc-help` the two
  // selves collide exactly and a stale memo would answer "unchanged" to a real first disclosure
  sharedDisclosure:       row('cc.sharedDisclosure.', 'prefix', [W, M], 'throwaway'),
  circlePolicy:           row('cc.circlePolicy.', 'prefix', [W, M], 'throwaway'),
  circlePolicyHead:       row('cc.circlePolicyHead.', 'prefix', [W, M], 'throwaway'),
  circlePolicyPending:    row('cc.circlePolicyPending.', 'prefix', [W, M], 'throwaway'),
  circleRules:            row('cc.circleRules.', 'prefix', [W, M], 'throwaway'),
  circleRulesPending:     row('cc.circleRulesPending.', 'prefix', [W, M], 'throwaway'),
  circleRecipe:           row('cc.circleRecipe.', 'prefix', [W, M], 'throwaway'),
  circleRecipePending:    row('cc.circleRecipePending.', 'prefix', [W, M], 'throwaway'),
  circleOverride:         row('cc.circleOverride.', 'prefix', [W, M], 'throwaway'),
  screenBlocksCache:      row('cc.screenBlocksCache.', 'prefix', [W, M], 'throwaway'),
  keptCircles:            row('basis.keptCircles', 'prefix', [W, M], 'throwaway'),
  nearbyAskedWeb:         row('basis.nearby-asked:', 'prefix', [W], 'throwaway'),
  nearbyAskedPhone:       row('cc.nearby-asked:', 'prefix', [M], 'throwaway'),
  screenClient:           row('onderling.screen.', 'prefix', [W], 'keep'),
  mappings:               row('onderling.mappings:', 'prefix', [M], 'throwaway'),

  // ── single keys ──
  // The help circle's two flags go TOGETHER: clear one and keep the other and the enrolled person gets a help
  // circle that never says anything.
  helpCircleProvisioned:  row('cc.helpCircleProvisioned', 'key', [W, M], 'throwaway'),
  onboardingDone:         row('cc.onboardingDone', 'key', [W, M], 'throwaway'),
  // set for the THROWAWAY identity's phrase; the enrolled person typed a different one, so a kept flag would be a
  // safety record making a false claim
  mnemonicAck:            row('cc.mnemonicAck', 'key', [W, M], 'throwaway'),
  keyCardSnoozedUntil:    row('cc.keyCardSnoozedUntil', 'key', [W, M], 'throwaway'),
  contactNames:           row('cc.contactNames', 'key', [W, M], 'throwaway'),
  contactSeenAt:          row('cc.contactSeenAt', 'key', [W, M], 'throwaway'),
  // kept, every thread of the former self would open already-read
  circleSeenAt:           row('cc.circleSeenAt', 'key', [W, M], 'throwaway'),
  circlePinned:           row('cc.circlePinned', 'key', [W, M], 'throwaway'),
  activeCircle:           row('cc.activeCircle', 'key', [W, M], 'throwaway'),
  circleViewMode:         row('cc.circleViewMode', 'key', [W, M], 'throwaway'),
  connectionPoints:       row('cc.connectionPoints', 'key', [W, M], 'throwaway'),
  delivery:               row('cc.delivery', 'key', [W, M], 'throwaway'),
  availability:           row('cc.availability', 'key', [W, M], 'throwaway'),
  agentRequests:          row('cc.agentRequests', 'key', [W, M], 'throwaway'),
  agentRequestQueue:      row('cc.agentRequestQueue', 'key', [W], 'throwaway'),
  reciprocityQueue:       row('cc.reciprocityQueue', 'key', [W, M], 'throwaway'),
  sharedWithMe:           row('cc.sharedWithMe', 'key', [W, M], 'throwaway'),
  userScreens:            row('cc.userScreens', 'key', [W, M], 'throwaway'),
  actionFrequency:        row('cc.actionFrequency', 'key', [W, M], 'throwaway'),
  firstBootSeeded:        row('cc.firstBootSeeded.v1', 'key', [M], 'throwaway'),
  nearbyAllowsWeb:        row('basis.nearbyAllows', 'key', [W], 'throwaway'),
  nearbyAllowsPhone:      row('cc.nearbyAllows', 'key', [M], 'throwaway'),
  nearbyMineSeenWeb:      row('basis.nearbyMineSeen', 'key', [W], 'throwaway'),
  nearbyMineSeenPhone:    row('cc.nearbyMineSeen', 'key', [M], 'throwaway'),
  nearbySelfWeb:          row('basis.nearbySelf', 'key', [W], 'throwaway'),
  nearbySelfPhone:        row('cc.nearbySelf', 'key', [M], 'throwaway'),
  nearbyRadio:            row('cc.nearbyRadio', 'key', [M], 'keep'),
  askMatchSkips:          row('cc.askMatchSkips', 'key', [W, M], 'throwaway'),
  fallbackOffer:          row('cc.fallbackOffer', 'key', [W, M], 'keep'),
  firstOpenSeen:          row('cc.firstOpenSeen', 'key', [W, M], 'keep'),
  introCardSeen:          row('cc.introCardSeen', 'key', [W, M], 'keep'),
  lastTab:                row('cc.lastTab', 'key', [W, M], 'keep'),
  nativeCalendarIds:      row('cc.nativeCalendar.eventIdMap', 'key', [M], 'throwaway'),
  inFlightFlows:          row('cc-in-flight-flows', 'key', [W, M], 'throwaway'),
  wakeNudges:             row('cc-wake-nudges', 'key', [M], 'throwaway'),
  startOverPage:          row('basis.startOverPage', 'key', [W], 'keep'),
  // the offer stash: the next start joins the circles it names; a device that forgets it comes back enrolled and
  // in no circle (the box keeps it explicitly)
  enrollOffer:            row('onderling.enrollOffer', 'key', [W, M, B], 'keep'),
  relayUrl:               row('cc.relayUrl', 'key', [W, M], 'keep'),
  userLlmDefault:         row('cc.userLlmDefault', 'key', [W, M], 'keep'),
  theme:                  row('basis.theme', 'key', [W, M], 'keep'),
  language:               row('circle.app.lang', 'key', [W, M], 'keep'),
  welcomed:               row('cc.welcomed', 'key', [M], 'keep'),

  // ── vault key prefixes: the device's identity and keys (the ceremony has just written them) ──
  // the ceremony has JUST written these; a key sweep cannot reach them, but an unsaid survivor is the failure
  // this register exists to prevent, so they are said
  vaultChatId:            row('cc-chat-id:', 'vault', [W, M], 'keep'),
  vaultOwnerRoot:         row('cc-owner-root:', 'vault', [W, M], 'keep'),
  vaultOwnerRootSeed:     row('cc-owner-root-seed', 'vault', [M], 'keep'),
  vaultHostId:            row('cc-host-id:', 'vault', [W, M], 'keep'),
  vaultHostGrants:        row('cc-host-grants:', 'vault', [W, M], 'keep'),
  vaultHostTrust:         row('cc-host-trust:', 'vault', [W, M], 'keep'),
  vaultPeerTrust:         row('cc-peer-trust:', 'vault', [W, M], 'keep'),
  vaultHistoryKeys:       row('cc-history-keys:', 'vault', [W, M], 'keep'),
  vaultAgentTokens:       row('cc-agent-tokens:', 'vault', [W, M], 'keep'),
  vaultPinboardId:        row('cc-pinboard-id:', 'vault', [W, M], 'keep'),
  vaultTasksId:           row('cc-tasks-id:', 'vault', [W, M], 'keep'),
  vaultCirclePod:         row('cc-circle-pod:', 'vault', [M], 'keep'),
  vaultRelayUrl:          row('cc-relay-url', 'vault', [W, M], 'keep'),
  circleGroupKey:         row('cc.circle-groupkey', 'vault', [W, M], 'keep'),
  circleControllerKey:    row('cc.circle-controller-key', 'vault', [W, M], 'keep'),
  sealingIdentity:        row('cc.sealing-identity', 'vault', [W, M], 'keep'),
  screenGrant:            row('onderling-screen:', 'vault', [W], 'keep'),
  vaultOwnerRootKey:      row('vault:owner-root', 'vault', [W, M, B], 'keep'),
  vaultContentKey:        row('vault:content-at-rest-key', 'vault', [W, M, B], 'keep'),
  vaultDelegationSeed:    row('vault:device-delegation-seed', 'vault', [W, M, B], 'keep'),
  vaultCustodyMode:       row('vault:custody-mode', 'vault', [W, M, B], 'keep'),
});

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
