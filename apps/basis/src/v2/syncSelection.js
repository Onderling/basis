/**
 * syncSelection — what THIS device holds of what its owner's devices sync (sync-policy §11, held 2026-09-16).
 *
 * The policy: a person's devices sync the same data, for the silos and kringen this device selected. Two axes,
 * one setting per device, on Mij / My data, never on the wire — the RECEIVER enforces, the sender does not know:
 *
 *   • per SILO — chat · tasks · contacts — *hold on this device*, on by default. Off = HOLD NOTHING, STILL
 *     CARRY: what lands here is verified and handed on to the siblings, and not kept (a box that holds no
 *     chat still keeps the phone's chat in sync — that is what the box is for).
 *   • per KRING — *this device holds this roster*, on by default. Off = off the roster on this device: it does
 *     not announce its address into that circle, does not pair as a peer for it, pulls nothing, and refuses
 *     what a sibling still carries for it (the stale case — a sibling cannot know; there is no negotiation).
 *     An address announced BEFORE the kring was turned off stays on the row until a ceremony retires it.
 *   • BYTES are a field of what a device KEEPS of a file, never of what it forwards (§11.4 as amended): the
 *     carry forwards bytes; this device keeps them in full or as a description only. Full by default.
 *
 * Device-scoped params (the register; `set-param` writes them, the shells' My data reads them live).
 */
/** The silos a device may decline to hold. Membership, governance and keys are the circle's truth, never a silo. */
export const SYNC_SILOS = Object.freeze(['chat', 'tasks', 'contacts']);

export const SYNC_SILO_PARAM_KEYS = Object.freeze({
  chat:     'sync.silo.chat',
  tasks:    'sync.silo.tasks',
  contacts: 'sync.silo.contacts',
});
/** Comma-separated circle ids this device does NOT hold. A string, so the register keeps a scalar. */
export const SYNC_KRINGEN_OFF_PARAM_KEY = 'sync.kringenOff';
/** What this device keeps of a file: `full` or `description`. */
export const SYNC_FILE_BYTES_PARAM_KEY = 'sync.files.bytes';
export const FILE_BYTES_MODES = Object.freeze(['full', 'description']);

/** The defaults: hold every silo, keep bytes in full. Declared in the register by `paramsService.js`. */
export const DEFAULT_SILO_HOLD = true;
export const DEFAULT_FILE_BYTES = 'full';

/** Anything unrecognised reads as the DEFAULT (hold): a corrupt setting must not silently empty a device. */
export function normalizeSiloHold(stored) {
  if (stored === false || stored === 'false') return false;
  return true;
}
export function normalizeFileBytes(stored) {
  return stored === 'description' ? 'description' : 'full';
}
/** The off-list as a Set of circle ids; junk → empty (everything held). */
export function parseKringenOff(stored) {
  if (typeof stored !== 'string' || !stored.trim()) return new Set();
  return new Set(stored.split(',').map((s) => s.trim()).filter(Boolean));
}
export function serializeKringenOff(set) {
  return [...(set ?? [])].filter((s) => typeof s === 'string' && s).sort().join(',');
}

/**
 * The live reader every enforcement site uses. `getParamValue(key)` is the register read (device scope), so a
 * flip on My data holds at the next landing, pull or pairing — no restart.
 * @param {{ getParamValue: (key: string) => any }} a
 */
export function makeSyncSelection({ getParamValue } = {}) {
  const read = (key) => { try { return typeof getParamValue === 'function' ? getParamValue(key) : undefined; } catch { return undefined; } };
  const siloOn = (silo) => (SYNC_SILO_PARAM_KEYS[silo] ? normalizeSiloHold(read(SYNC_SILO_PARAM_KEYS[silo])) : true);
  const kringOn = (circleId) => !parseKringenOff(read(SYNC_KRINGEN_OFF_PARAM_KEY)).has(circleId);
  return {
    siloOn,
    kringOn,
    /** Does this device HOLD `silo` for `circleId`? (a personal silo passes null for the circle) */
    holds: (silo, circleId = null) => siloOn(silo) && (circleId == null || kringOn(circleId)),
    /** Does this device keep a file's bytes in full? */
    keepsBytes: () => normalizeFileBytes(read(SYNC_FILE_BYTES_PARAM_KEY)) === 'full',
    fileBytes: () => normalizeFileBytes(read(SYNC_FILE_BYTES_PARAM_KEY)),
    kringenOff: () => parseKringenOff(read(SYNC_KRINGEN_OFF_PARAM_KEY)),
  };
}

/** A selection that holds everything — what a composition without a register gets. */
export const HOLD_EVERYTHING = Object.freeze({
  siloOn: () => true, kringOn: () => true, holds: () => true, keepsBytes: () => true, fileBytes: () => 'full', kringenOff: () => new Set(),
});
