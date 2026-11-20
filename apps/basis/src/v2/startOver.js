/**
 * START THIS DEVICE OVER FROM YOUR PHRASE — the way out when a key on this device can never be read (ledger L1115).
 *
 * "Try again" comes first (a read that failed once may pass). When it does not, a restore of the SAME phrase is not
 * enough: the sealed vaults reset only for another root, so the unreadable entry would stay and stop every later boot.
 * So this path, in an order that cannot strand the person (Fable's ruling, 2026-11-20):
 *
 *   1. the phrase FIRST, and checked: a valid phrase, and where this device's root fingerprint can still be read it must
 *      match ("this is another phrase" stops here); nothing is cleared before a correct phrase;
 *   2. the confirm in words (the shell's: what is lost, what comes back) — before `startDeviceOver` is called;
 *   3. a mark that a start-over is under way, THEN the clear of everything the app keeps on this device (one wipe: a
 *      per-circle store cannot be found once the registry is unreadable, so a list would leave sealed rows behind);
 *   4. the ordinary restore of that phrase; then the mark goes.
 *
 * A crash after 3 leaves the mark: the next boot finishes the clear before anything reads (`finishStartOver`) and
 * opens the restore door — never half a vault. The shells only hand in their storage (how to wipe, where the mark is)
 * and the restore; no shell decides the order.
 */
import { Bootstrap, validateMnemonic } from '@onderling/core';
import { readCustodyMode } from '../core/agent/ownerRootCustody.js';

/** The mark, on the device's plain marker vault (beside `restore-pending` and `forget-pending`). */
export const START_OVER_PENDING_KEY = 'start-over-pending';

/** Trim, lowercase, one space between words (as every phrase entry reads it). */
export const normalizePhrase = (p) => String(p ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');

/**
 * Step 1: is this the phrase of THIS device? `{ok: true}`, or `{ok: false, code: 'invalid' | 'other-phrase'}`. Where the
 * device's own fingerprint cannot be read (the very thing that failed may be the key door), a valid phrase is taken.
 * @param {string} phrase
 * @param {{rootKeyStore?: {getSeed: Function}, markerVault?: {get: Function}}} device
 */
export async function checkPhraseForThisDevice(phrase, { rootKeyStore = null, markerVault = null } = {}) {
  const normalized = normalizePhrase(phrase);
  if (normalized.split(' ').length !== 24 || !validateMnemonic(normalized)) return { ok: false, code: 'invalid' };
  let root;
  try { root = Bootstrap.fromMnemonic(normalized); } catch { return { ok: false, code: 'invalid' }; }
  const given = root.fingerprint();
  // the device's own: the delegation marker names the root's fingerprint; a root-custody door holds the root seed
  let own = null;
  try { const m = await readCustodyMode(markerVault); if (m.mode === 'delegation' && m.fingerprint) own = m.fingerprint; } catch { /* unreadable: unknown */ }
  if (!own) {
    try { const seed = await rootKeyStore?.getSeed?.(); if (seed) own = Bootstrap.fromSeed(seed).fingerprint(); } catch { /* unreadable: unknown */ }
  }
  if (own && own !== given) return { ok: false, code: 'other-phrase' };
  return { ok: true, phrase: normalized };
}

/**
 * Steps 3 and 4, after the person confirmed: mark, wipe, restore, unmark.
 * @param {object} a
 * @param {string} a.phrase  a phrase `checkPhraseForThisDevice` took
 * @param {{get: Function, set: Function, delete: Function}} a.markerVault
 * @param {() => Promise<void>} a.wipe  removes everything the app keeps on this device EXCEPT the mark
 * @param {(phrase: string) => Promise<{ok: boolean, code?: string}>} a.restore  the ordinary restore of that phrase
 * @returns {Promise<{ok: boolean, code?: string}>}
 */
export async function startDeviceOver({ phrase, markerVault, wipe, restore }) {
  await markerVault.set(START_OVER_PENDING_KEY, JSON.stringify({ at: new Date().toISOString() }));
  await wipe();
  const r = await restore(phrase);
  if (r?.ok) await markerVault.delete(START_OVER_PENDING_KEY);
  return r?.ok ? { ok: true } : { ok: false, code: r?.code ?? 'storage' };
}

/**
 * The FIRST act of a shell's boot: a start-over cut short is finished (the wipe again: it is the same either way), the
 * mark removed, and `{startedOver: true}` returned so the shell opens its restore door instead of an empty app.
 * @param {{markerVault: {get: Function, delete: Function}, wipe: () => Promise<void>}} a
 * @returns {Promise<{startedOver: boolean}>}
 */
export async function finishStartOver({ markerVault, wipe }) {
  let pending = null;
  try { pending = await markerVault.get(START_OVER_PENDING_KEY); } catch { pending = null; }
  if (!pending) return { startedOver: false };
  await wipe();
  await markerVault.delete(START_OVER_PENDING_KEY);
  return { startedOver: true };
}

/**
 * The wipe over a key-value storage (localStorage, AsyncStorage): every key but the mark's. A shell with more (IndexedDB
 * databases, a key door) adds its own after this.
 * @param {{getAllKeys?: Function, key?: Function, length?: number, removeItem: Function, multiRemove?: Function}} storage
 * @param {string} markKey  the full storage key of the mark (the marker vault's prefix + `START_OVER_PENDING_KEY`)
 */
export async function wipeKeyValueStorage(storage, markKey) {
  let keys = [];
  if (typeof storage.getAllKeys === 'function') keys = [...(await storage.getAllKeys())];
  else for (let i = 0; i < (storage.length ?? 0); i += 1) { const k = storage.key(i); if (k != null) keys.push(k); }
  const gone = keys.filter((k) => k !== markKey);
  if (typeof storage.multiRemove === 'function') await storage.multiRemove(gone);
  else for (const k of gone) await storage.removeItem(k);
  return gone.length;
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
