/**
 * START THIS DEVICE OVER FROM YOUR PHRASE — the way out when a key on this device can never be read (ledger L1115).
 *
 * "Try again" comes first (a read that failed once may pass). When it does not, a restore of the SAME phrase is not
 * enough: the sealed vaults reset only for another root, so the unreadable entry would stay and stop every later boot.
 * So this path, in an order that cannot strand the person (Fable's ruling and review, 2026-11-20):
 *
 *   1. the phrase FIRST, and checked: a valid phrase, and where this device's own root can be named it must match
 *      ("this is another phrase" stops here). Where it cannot be named, the confirm says so;
 *   2. the confirm in words (the shell's: what is lost, what comes back, what stays) — before `startDeviceOver`;
 *   3. a mark that a start-over is under way (it holds the fingerprint the phrase was checked against, never the
 *      phrase), THEN the clear of what the app keeps on this device, then the mark says "cleared";
 *   4. the ordinary restore of that phrase; only then the mark goes.
 *
 * NOTHING IS CLEARED WITHOUT A PHRASE CHECKED IN THIS RUN. A mark found at a boot (a start-over cut short) clears
 * nothing by itself: the shell asks the phrase again (checked against the mark's fingerprint, since the device's own
 * may be gone with the clear) and runs the same order; "cancel" removes the mark and clears nothing more — and when the
 * mark says the device was already cleared, the shell says first that it will start as a new identity.
 * The shells hand in only their storage (how to clear, where the mark is) and the restore; no shell decides the order.
 */
import { Bootstrap, validateMnemonic } from '@onderling/core';
import { readCustodyMode } from '../core/agent/ownerRootCustody.js';

/** The mark, on the device's plain marker vault (beside `restore-pending` and `forget-pending`). */
export const START_OVER_PENDING_KEY = 'start-over-pending';

/** Trim, lowercase, one space between words (as every phrase entry reads it). */
export const normalizePhrase = (p) => String(p ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');

/**
 * This device's own root fingerprint, or null when it cannot be named. Only two sources name it: a readable custody
 * marker in delegation mode that carries the fingerprint, or a readable marker in root mode (or none: every install
 * before the cutover) with a readable key door — in root mode the door holds the root seed. A delegation device's door
 * holds the DELEGATION seed, never the root, so it is never read as the root.
 */
async function ownFingerprint({ rootKeyStore, markerVault }) {
  let mode;
  try { mode = await readCustodyMode(markerVault); } catch { return null; }
  if (mode?.mode === 'delegation') return mode.fingerprint || null;
  if (mode?.mode !== 'root') return null;
  try { const seed = await rootKeyStore?.getSeed?.(); return seed ? Bootstrap.fromSeed(seed).fingerprint() : null; } catch { return null; }
}

/**
 * Step 1: is this the phrase of THIS device? `{ok: true, phrase, fingerprint, known}` (`known: false` = this device
 * could not name its own root; the confirm must say so), or `{ok: false, code: 'invalid' | 'other-phrase'}`.
 * @param {string} phrase
 * @param {{rootKeyStore?: {getSeed: Function}, markerVault?: {get: Function}, markFingerprint?: string|null}} device
 *   `markFingerprint`: from a start-over mark found at boot; it wins (the device's own may be gone with the clear)
 */
export async function checkPhraseForThisDevice(phrase, { rootKeyStore = null, markerVault = null, markFingerprint = null } = {}) {
  const normalized = normalizePhrase(phrase);
  if (normalized.split(' ').length !== 24 || !validateMnemonic(normalized)) return { ok: false, code: 'invalid' };
  let given;
  try { given = Bootstrap.fromMnemonic(normalized).fingerprint(); } catch { return { ok: false, code: 'invalid' }; }
  const own = markFingerprint || await ownFingerprint({ rootKeyStore, markerVault });
  if (own && own !== given) return { ok: false, code: 'other-phrase' };
  return { ok: true, phrase: normalized, fingerprint: given, known: !!own };
}

/** The mark found at a boot: `null`, or `{stage: 'marked' | 'cleared', fingerprint}`. An unreadable mark reads as one. */
export async function readStartOverMark(markerVault) {
  let raw;
  try { raw = await markerVault.get(START_OVER_PENDING_KEY); } catch { return { stage: 'cleared', fingerprint: null }; }
  if (!raw) return null;
  let m = null;
  try { m = JSON.parse(raw); } catch { /* an older or broken mark: the worst case */ }
  return { stage: m?.stage === 'marked' ? 'marked' : 'cleared', fingerprint: typeof m?.fingerprint === 'string' ? m.fingerprint : null };
}

/**
 * What "Cancel" must ask first, the same in every shell: `null` (no start-over under way: back, nothing changed), or
 * `'may-be-cleared'` for ANY mark. A stage of 'marked' does not prove nothing was cleared: a kill inside the clear
 * leaves 'marked' over a half-cleared device (the custody marker gone, the key door still holding a delegation seed,
 * which the next boot would read as a root). So the person is told this device may already be cleared and may start
 * as a new identity, and confirms.
 * @param {{stage: string}|null} mark  `readStartOverMark`'s answer
 * @returns {null|'may-be-cleared'}
 */
export function cancelStartOverAsks(mark) {
  return mark ? 'may-be-cleared' : null;
}

/** "Cancel" on a start-over cut short: the mark goes, nothing more is cleared. */
export async function cancelStartOver(markerVault) {
  await markerVault.delete(START_OVER_PENDING_KEY);
}

/**
 * Steps 3 and 4, after the person checked the phrase and confirmed IN THIS RUN: mark, clear, mark "cleared", restore,
 * unmark. A clear the shell could not finish (a database another tab holds) stops here with its code, the mark kept.
 * @param {object} a
 * @param {string} a.phrase  a phrase `checkPhraseForThisDevice` took
 * @param {string} [a.fingerprint]  the fingerprint it was checked against (`checkPhraseForThisDevice`'s)
 * @param {{get: Function, set: Function, delete: Function}} a.markerVault
 * @param {() => Promise<void>} a.wipe  removes what the app keeps on this device EXCEPT the mark; throws `{code}` on a
 *   delete it could not finish (`'blocked'`)
 * @param {(phrase: string) => Promise<{ok: boolean, code?: string}>} a.restore  the ordinary restore of that phrase
 * @returns {Promise<{ok: boolean, code?: string}>}
 */
export async function startDeviceOver({ phrase, fingerprint = null, markerVault, canClear = null, wipe, restore }) {
  // a shell that cannot clear all of what it keeps (a browser that cannot list its databases) says so before anything
  // is touched: per-circle stores left behind would stay sealed under a key that is gone
  if (canClear) {
    let can;
    try { can = await canClear(); } catch { can = { ok: false, code: 'storage' }; }
    if (!can?.ok) return { ok: false, code: can?.code ?? 'storage' };
  }
  const mark = (stage) => markerVault.set(START_OVER_PENDING_KEY, JSON.stringify({ at: new Date().toISOString(), stage, fingerprint }));
  try { await mark('marked'); } catch { return { ok: false, code: 'storage' }; }
  try { await wipe(); } catch (e) { return { ok: false, code: e?.code === 'blocked' ? 'blocked' : 'storage' }; }
  try { await mark('cleared'); } catch { return { ok: false, code: 'storage' }; }
  const r = await restore(phrase);
  if (r?.ok) await markerVault.delete(START_OVER_PENDING_KEY);
  return r?.ok ? { ok: true } : { ok: false, code: r?.code ?? 'storage' };
}

/**
 * The clear over a key-value storage (localStorage, AsyncStorage): every key `isOurs` names, never the mark's. A shell
 * with more (IndexedDB databases, a key door, files) adds its own after this.
 * @param {{getAllKeys?: Function, key?: Function, length?: number, removeItem: Function, multiRemove?: Function}} storage
 * @param {string} markKey  the full storage key of the mark (the marker vault's prefix + `START_OVER_PENDING_KEY`)
 * @param {{isOurs?: (key: string) => boolean}} [opts]  default: every key (a storage that is the app's alone)
 */
export async function wipeKeyValueStorage(storage, markKey, { isOurs = () => true } = {}) {
  let keys = [];
  if (typeof storage.getAllKeys === 'function') keys = [...(await storage.getAllKeys())];
  else for (let i = 0; i < (storage.length ?? 0); i += 1) { const k = storage.key(i); if (k != null) keys.push(k); }
  const gone = keys.filter((k) => k !== markKey && isOurs(k));
  if (typeof storage.multiRemove === 'function') await storage.multiRemove(gone);
  else for (const k of gone) await storage.removeItem(k);
  return gone.length;
}

/**
 * Delete IndexedDB databases by name. A delete another tab blocks is a FAILURE (`{code: 'blocked'}`), never a success:
 * `deleteDatabase` fires `onblocked` and then waits, so resolving there would report bytes gone that sit on disk.
 * @param {{deleteDatabase: Function}} idb
 * @param {string[]} names
 */
export async function deleteDatabases(idb, names) {
  for (const name of names) {
    await new Promise((resolve, reject) => {
      let settled = false;
      const end = (fn, v) => { if (!settled) { settled = true; fn(v); } };
      let req;
      try { req = idb.deleteDatabase(name); } catch (e) { end(reject, Object.assign(new Error(`delete ${name}: ${e?.message ?? e}`), { code: 'storage' })); return; }
      req.onsuccess = () => end(resolve);
      req.onerror = () => end(reject, Object.assign(new Error(`delete ${name} failed`), { code: 'storage' }));
      req.onblocked = () => end(reject, Object.assign(new Error(`delete ${name} blocked by another tab`), { code: 'blocked' }));
    });
  }
}

/**
 * The ordinary restore of a phrase WITHOUT a booted agent (what a device that cannot start needs): the same
 * `restoreOwnerRoot` the phone's first-run restore runs, over the shell's own vault backings and key door. The boot that
 * follows reads exactly these. `{ok}` or `{ok: false, code: 'invalid' | 'storage'}`.
 * @param {{mnemonic: string, rootKeyStore: object, chatVault: object, markerVault: object}} a
 */
export async function restorePhraseWithoutAgent({ mnemonic, rootKeyStore, chatVault, markerVault }) {
  const { restoreOwnerRoot } = await import('../core/agent/ownerRootRestore.js');
  const r = await restoreOwnerRoot({ mnemonic: normalizePhrase(mnemonic), rootKeyStore, chatVault, markerVault });
  return r?.ok ? { ok: true } : { ok: false, code: r?.code === 'invalid' ? 'invalid' : 'storage' };
}
