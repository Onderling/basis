/**
 * WHAT A FRESHLY ENROLLED DEVICE FORGETS — the one list, and the clear that reads it.
 *
 * Every device boots unenrolled first. The service starts before anyone can enrol it, so it comes up as a
 * throwaway profile of its own: an identity, a registry record, a member map with itself in it, settings, held
 * messages, and the device log — the record every lane rides. The add-a-device ceremony then replaces that
 * identity and its content key. What the old self wrote is not the person's, and the ceremony's vault reset has
 * already dropped the key it was sealed under: left in place, the next boot greets a former self in every circle
 * and warns about rows it cannot open.
 *
 * The box has done this since 2026-09-14 (`bin/device-runner.mjs`, `contentPaths`). Web and mobile never did —
 * not because anyone forgot the delete, but because there was nothing to call it on: their stores are declared
 * as literals at the call sites that build them, spread across two shells. So this file is the missing half, and
 * the LIST is the deliverable. The delete is five lines.
 *
 * The list is DECLARED here rather than grepped, because a grepped list rots the first time someone adds a store
 * and nothing fails. `lint-content-classification` is red when a shell builds a durable store this file does not
 * name — on either side. That is what keeps it honest.
 *
 * Every shell hands its own adapter (drop a named store, drop a key, list the keys, list the circle ids); no
 * shell decides WHAT is forgotten, only HOW its storage is reached.
 */

/**
 * The stores and keys a former self wrote, and the ones that are this device's own.
 *
 * A name belongs to exactly one side. `keep` is not decoration: an unlisted survivor is precisely how this goes
 * wrong, so the classification is asserted to be total and disjoint rather than left to reading.
 */
export const THROWAWAY_CONTENT = Object.freeze({
  /**
   * Whole namespaces: an IndexedDB database on web, an AsyncStorage scope on mobile, a file or directory on the
   * box. Per-circle stores are added at run time from the registry — see `perCircleStores`.
   */
  stores: Object.freeze([
    'cc-agent-registry',        // which circles this device is in, which devices the person has
    'cc-device-log',            // the record every lane rides
    'cc-contact-dm-state',      // 1:1 threads
    'cc-outbox-state',          // web's outbox
    'cc-outbox-cache',          // mobile's
    // Settings, the stoop and the household — each shell names its own, and the two sets are NOT the same
    // words. `lint-content-classification` found the web half missing from this list on its first run, which
    // is the entire reason it exists: the table was assembled by hand and reviewed by hand, and three of the
    // person's stores were still unsaid.
    'cc-settings-state',        // web
    'cc-settings-cache',        // mobile
    'cc-stoop-state',
    'cc-stoop-cache',
    'cc-household-state',
    'cc-household-cache',
    'cc-tasks-cache',
    'cc-circle-lists-state',
    'cc-circle-rag',            // embeddings of the former self's items
    // The help circle's own stores, named explicitly. `HELP_CIRCLE_ID` is the literal `cc-help`, so the
    // throwaway self and the enrolled person do not merely both HAVE a help circle — they share its store NAME,
    // and it is the one database where two identities' sealed rows sit together. A throwaway self that never
    // provisioned it is also not in the registry, so the registry-driven route below would skip exactly this one.
    'cc-circle-cc-help',
    'cc-circle-cache-cc-help',
  ]),

  /** Flat keys — `localStorage` on web, `AsyncStorage` on mobile. Statements about, or marks on, people. */
  keys: Object.freeze([
    // The help circle's two flags go TOGETHER. `helpCircleProvisioned` says the circle exists; `onboardingDone`
    // gates the bot's guided conversation inside it. Clear one and keep the other and the enrolled person gets a
    // fresh Uitleg circle that never says anything, for ever.
    'cc.helpCircleProvisioned',
    'cc.onboardingDone',
    // Set for the THROWAWAY chat identity's phrase. The enrolled person typed the owner phrase, which is a
    // different phrase — so a kept flag is a safety record making a false claim, and a redundant prompt is the
    // cheaper mistake.
    'cc.mnemonicAck',
    'cc.contactNames',          // who the former self saw renamed
    'cc.contactSeenAt',
    'cc.circleSeenAt',          // when the former self last read a thread: kept, every thread opens already-read
    'cc.circlePinned',
    'cc.activeCircle',
    'cc.circleViewMode',
    'cc.connectionPoints',
    'cc.delivery',
    'cc.availability',
    'cc.agentRequests',
    'cc.agentRequestQueue',
    'cc.reciprocityQueue',
    'cc.sharedWithMe',
    'cc.userScreens',
    'cc.actionFrequency',       // which ops the former self used
    'cc.chatHistoryMigrated.v1',
    'cc.firstBootSeeded.v1',
    'basis.nearbyAllows',       // who this device was told to allow — the former self's consent…
    'basis.nearbyMineSeen',
    'cc.nearbyAllows',
    'cc.nearbyMineSeen',
  ]),

  /** Key families, cleared by prefix. The suffix is a circle id, a persona, or a screen — all the former self's. */
  keyPrefixes: Object.freeze([
    'cc.sharedDisclosure.',     // what was last shared with a circle. Keyed `<persona>::<circle>` with no
                                // identity in it, so on `cc-help` — whose id is a constant — the two selves
                                // collide exactly and a stale memo answers "unchanged" to a real first disclosure.
    'cc.circlePolicy.',
    'cc.circlePolicyPending.',
    'cc.circleRules.',
    'cc.circleRulesPending.',
    'cc.circleRecipe.',
    'cc.circleRecipePending.',
    'cc.screenBlocksCache.',
    'cc.circleOverride.',
  ]),

  /**
   * This device's own, or the ceremony's. Named out loud so the totality check has something to check against,
   * and so a reader can see the survivors rather than infer them from an absence.
   */
  keep: Object.freeze([
    'onderling.enrollOffer',    // the offer stash — the next start joins the circles it names. The box keeps it
                                // explicitly; a device that forgets it comes back enrolled and in no circle.
    // The vault, which the ceremony JUST wrote. It lives in its own store (the `cc-owner-root:` / `cc-chat-id:` /
    // `cc-host-id:` / `cc-circle-pod:` prefixes on mobile), so a key sweep cannot reach it by accident — but an
    // unsaid survivor is the failure mode this list exists to prevent, so it is said.
    'vault:owner-root',
    'vault:content-at-rest-key',
    'vault:device-delegation-seed',
    'vault:custody-mode',
    // How this browser or phone is set up. No person in them.
    'cc.relayUrl',
    'cc.userLlmDefault',
    'basis.theme',
    'basis.nearbyFace',         // how the device PRESENTS itself, unlike the two `nearby` marks above
    'circle.app.lang',
    'cc.welcomed',              // the welcome screen is about the app, not about who is using it
  ]),

  /** The per-circle stores for one circle id. Resolved from the registry before the registry is dropped. */
  perCircleStores: (circleId) => [`cc-circle-${circleId}`, `cc-circle-cache-${circleId}`],
});

/**
 * Forget the throwaway self's content. Called on a SUCCESSFUL ceremony only — never on the failure path, which
 * removes the offer and leaves everything (the box's rule).
 *
 * The order is the safety. The per-circle stores are named after circle ids only the registry knows, so the ids
 * are read FIRST and the registry is dropped last. `indexedDB.databases()` would have listed them without the
 * read, but Firefox does not implement it, so that route clears nothing on one browser and passes everywhere it
 * is tested — the worst available failure. And if the read throws we clear NOTHING: half-cleared is a device
 * that is enrolled in the vault and in circles it cannot open, which is worse than the warnings this fixes.
 *
 * @param {object} shell
 * @param {() => Promise<string[]>} shell.listCircleIds   circle ids from the registry, read before it is dropped
 * @param {() => Promise<string[]>} [shell.listKeys]      every flat key, so the prefixes can be resolved
 * @param {(name: string) => Promise<void>|void} shell.dropStore
 * @param {(key: string) => Promise<void>|void} shell.dropKey
 * @returns {Promise<{ok: boolean, reason?: string, stores?: number, keys?: number}>}
 */
export async function forgetThrowawaySelf({ listCircleIds, listKeys, dropStore, dropKey } = {}) {
  if (typeof dropStore !== 'function' || typeof dropKey !== 'function') {
    return { ok: false, reason: 'shell-adapter-required' };
  }
  let circleIds = [];
  try {
    circleIds = typeof listCircleIds === 'function' ? ((await listCircleIds()) ?? []) : [];
  } catch (err) {
    // Nothing has been dropped yet, and nothing will be.
    return { ok: false, reason: `circle-ids-unreadable: ${err?.message ?? err}` };
  }

  const perCircle = circleIds.flatMap((id) => THROWAWAY_CONTENT.perCircleStores(id));
  // The per-circle stores go first: they are the ones the registry had to be alive to name.
  const stores = [...new Set([...perCircle, ...THROWAWAY_CONTENT.stores])];

  // Keys are INTERSECTED with what is actually there when the storage can be listed, so the count this returns
  // is what was forgotten rather than what was attempted — a walk reads that number. Stores cannot be listed
  // portably (that is the whole reason the ids come from the registry), so those stay best-effort attempts.
  let keys = [...THROWAWAY_CONTENT.keys];
  if (typeof listKeys === 'function') {
    try {
      const present = new Set((await listKeys()) ?? []);
      const byPrefix = [...present].filter((k) => THROWAWAY_CONTENT.keyPrefixes.some((p) => k.startsWith(p)));
      keys = [...new Set([...keys.filter((k) => present.has(k)), ...byPrefix])];
    } catch { /* a storage that cannot be listed still gets the named keys, attempted blind */ }
  }
  const keep = new Set(THROWAWAY_CONTENT.keep);

  let droppedStores = 0;
  let droppedKeys = 0;
  let failed = 0;
  // A refusal is COUNTED, not swallowed. The boot marker is removed only when this comes back with none:
  // a blocked IndexedDB delete (another tab holding the database) would otherwise read as success and the
  // bytes would stay for ever with nothing left to say so.
  for (const name of stores) {
    if (keep.has(name)) continue;
    try { await dropStore(name); droppedStores += 1; } catch { failed += 1; }
  }
  for (const key of keys) {
    if (keep.has(key)) continue;
    try { await dropKey(key); droppedKeys += 1; } catch { failed += 1; }
  }
  return { ok: true, stores: droppedStores, keys: droppedKeys, failed };
}

/**
 * The note the ceremony leaves and the NEXT BOOT reads. Same shape, same vault and same lifecycle as
 * `restore-pending` (`ownerRootRestore.js`): written on the ceremony's success path, read as the first awaited
 * act of a shell's boot, deleted only once the work it names is done.
 *
 * Why a marker rather than a call at the end of the ceremony: the clear was wired to the web flow's terminal
 * button and the mobile modal's effect, and the live walk enrols by calling the op DIRECTLY — so the one path
 * that is actually walked went straight past it. A marker is reached by every path that enrols or restores,
 * survives a crash mid-clear (the next boot finishes it), and needs no UI driven to be tested.
 */
export const FORGET_PENDING_KEY = 'forget-pending';

/**
 * Leave the note. Called on the success path of the add-a-device ceremony and of the owner-root restore — a
 * wiped device restoring from its phrase also booted unenrolled first, and its throwaway content is just as
 * unopenable as an enrolled device's.
 */
export async function markForgetPending(markerVault, why = 'enrol', circleIds = []) {
  if (!markerVault || typeof markerVault.set !== 'function') return false;
  // The ids ride the NOTE, captured here rather than read at boot. The per-circle stores are named after the
  // THROWAWAY self's circles, which only its registry knows — and by the time boot reads this note the agent
  // does not exist yet, so there is nothing to ask. Written at the one moment both facts are true: the
  // ceremony has succeeded and the old registry is still readable.
  const ids = Array.isArray(circleIds) ? circleIds.filter((c) => typeof c === 'string' && c) : [];
  try { await markerVault.set(FORGET_PENDING_KEY, JSON.stringify({ at: new Date().toISOString(), why, circleIds: ids })); return true; }
  catch { return false; }   // the clear is best-effort; a ceremony never fails because of it
}

/**
 * Read the note at boot and, if it is there, forget the throwaway self — then remove the note, and ONLY then.
 *
 * Ordering: this must be the first awaited act of a shell's boot, before any store is read or written. The
 * IndexedDB backend opens lazily (`IndexedDbBackend.js`: `dbPromise` is null until the first operation), so a
 * constructed-but-untouched store is not yet a connection — but a store that has been READ is, and deleting a
 * database with an open connection blocks.
 *
 * Crash-safety: the marker is deleted only when every drop succeeded. A blocked delete (another tab holding the
 * database), a storage that refuses, a registry that cannot be read — all leave the marker set, and the next
 * boot tries again. Clearing twice is a no-op; clearing never is the bug.
 *
 * @returns {Promise<{ran: boolean, ok?: boolean, reason?: string, stores?: number, keys?: number, failed?: number}>}
 */
export async function runPendingForget({ markerVault, shell } = {}) {
  if (!markerVault || typeof markerVault.get !== 'function') return { ran: false, reason: 'no-marker-vault' };
  let pending = null;
  try { pending = await markerVault.get(FORGET_PENDING_KEY); } catch { return { ran: false, reason: 'marker-unreadable' }; }
  if (!pending) return { ran: false, reason: 'nothing-pending' };

  let noted = [];
  try { noted = JSON.parse(typeof pending === 'string' ? pending : JSON.stringify(pending))?.circleIds ?? []; }
  catch { noted = []; }   // an unreadable note still clears everything it can name without one

  // The ids come from the note, not from a registry read: there is no agent at this point in a boot, and the
  // shell's own `listCircleIds` would answer "none" — silently skipping every per-circle store, which is the
  // half-cleared state this whole file exists to avoid. A shell may still supply one as a fallback.
  const shellArg = { ...(shell ?? {}) };
  if (noted.length) shellArg.listCircleIds = async () => noted;
  const r = await forgetThrowawaySelf(shellArg);
  if (r.ok && !r.failed) {
    try { await markerVault.delete?.(FORGET_PENDING_KEY); } catch { /* the next boot clears again; harmless */ }
    return { ran: true, ...r };
  }
  // Left set ON PURPOSE: whatever refused is still there, and a device half-forgotten is the state this
  // whole file exists to avoid.
  return { ran: true, ...r };
}

/**
 * A marker vault over a plain key-value storage, so every shell reads the ceremony's note the same way and
 * none of them has to reach into the agent to get one.
 *
 * The note is PLAIN and device-local, exactly like `restore-pending` beside it — it says only "a ceremony
 * happened here, finish it", which is worth nothing to anyone who can already read this device's storage.
 * The prefix is the owner-root vault's, so the marker lives with the ceremony that wrote it and survives the
 * clear for the same reason the delegation blob does.
 */
export function markerVaultOver(storage, prefix = 'cc-owner-root:') {
  const at = (k) => `${prefix}${k}`;
  return {
    get: async (k) => { try { return (await storage?.getItem?.(at(k))) ?? null; } catch { return null; } },
    set: async (k, v) => { try { await storage?.setItem?.(at(k), v); } catch { /* full or disabled */ } },
    delete: async (k) => { try { await storage?.removeItem?.(at(k)); } catch { /* same */ } },
  };
}
