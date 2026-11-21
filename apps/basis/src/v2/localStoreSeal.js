/**
 * The shell's handle on the device's content-at-rest key.
 *
 * `realAgent` mints the key at boot (it is the only place that holds the sealed vault it lives in), but the
 * stores that need it are built in the SHELLS: the web app constructs its search index at module scope,
 * and both shells build a circle's item store the moment a circle is opened. So the key is PUBLISHED here
 * at boot and READ lazily at first use — which works because every backend call is already async.
 *
 * One shared source, so web and mobile seal by construction rather than by both remembering to (invariant
 * #2/#3). A store wrapped through `sealedLocalBackend` is sealed on both platforms or on neither, and the
 * guard that keeps it that way greps for exactly this call.
 *
 * ── Why a module-level holder is right HERE and would be wrong in the agent ─────────────────────────
 * A shell is one app instance with one person and one key, so "the current device's content key" is a
 * genuinely global fact for it. The AGENT deliberately does not read this: it takes its strategy as a
 * local value, because a test process routinely boots several agents and a shared holder would hand the
 * second one's key to the first one's stores. Shells never do that; test processes always do.
 */
import { createSealingBackend } from '@onderling/pseudo-pod';

let current = null;

/**
 * Publish this device's content-seal strategy. Called once by `realAgent` during boot.
 * @param {{seal:Function, open:Function}|null} strategy
 */
export function setShellContentSeal(strategy) {
  current = (strategy && typeof strategy.seal === 'function' && typeof strategy.open === 'function') ? strategy : null;
  if (current && waiting.length) {
    const now = waiting.splice(0);
    for (const fn of now) { try { fn(current); } catch { /* one listener never stops the others */ } }
  }
}

/** Listeners waiting for the key (`onShellContentSeal`), each called once. */
const waiting = [];

/**
 * Call `fn(strategy)` once the content key is published: at once when it already is, else when `setShellContentSeal`
 * publishes it. For a reader that may run before the key (a screen's first frame): it reads again when the key arrives.
 * @param {(strategy: object) => void} fn
 * @returns {() => void} unsubscribe (a no-op once called)
 */
export function onShellContentSeal(fn) {
  if (typeof fn !== 'function') return () => {};
  if (current) { try { fn(current); } catch { /* the listener's own failure */ } return () => {}; }
  waiting.push(fn);
  return () => { const i = waiting.indexOf(fn); if (i >= 0) waiting.splice(i, 1); };
}

/** This device's content-seal strategy, or null before boot has reached it. */
export function shellContentSeal() {
  return current;
}

/**
 * A write refused because the value it would replace is stored but could not be opened with this device's key
 * (ledger L1115). Writing over it would lose it for good: a setting's stored endpoint, a pin map, a circle's key. The
 * refusal holds until a read of that key succeeds or the key is removed on purpose. `code` is what a caller reads.
 * Where the save was the person's own act (the model setting, a pin), the shell SAYS it (`isStoredValueUnreadable`).
 */
export class StoredValueUnreadable extends Error {
  constructor(name, key) {
    super(`${name}: "${key}" holds a value this device could not open; not written over`);
    this.name = 'StoredValueUnreadable';
    this.code = 'stored-value-unreadable';
    this.key = key;
  }
}

/** True for a StoredValueUnreadable (also across a bundle boundary, by its code). */
export function isStoredValueUnreadable(err) {
  return err instanceof StoredValueUnreadable || err?.code === 'stored-value-unreadable';
}

/** Who hears a refused write (the shells: they SAY it on the launcher, `bootFailure.js`). */
const refusedListeners = new Set();
/**
 * Hear every write refused because the value it would replace could not be opened: `fn({name, key})`. A shell
 * subscribes once and says it where the person looks; the stores themselves swallow the throw.
 * @returns {() => void} unsubscribe
 */
export function onStoredValueRefused(fn) {
  if (typeof fn !== 'function') return () => {};
  refusedListeners.add(fn);
  return () => { refusedListeners.delete(fn); };
}
function refuse(name, key, said = false) {
  const err = new StoredValueUnreadable(name, key);
  console.warn(`[at-rest] ${name}: a save was refused; the stored value could not be opened and is kept`);
  // SAID only for a save that was the person's own act (a store built with `said: true`: the model setting, a pin, an
  // override, the availability, a page, a contact's name, a draft); a background save (seen-marks, counters) is logged
  if (said) for (const fn of [...refusedListeners]) { try { fn({ name, key }); } catch { /* one listener never stops the others */ } }
  return err;
}

/**
 * The keys whose stored value would not open, per storage object. Per STORAGE, not per wrapper: a store that builds a
 * fresh wrapper for each read and each write still sees the read's verdict at its write.
 */
const unopened = new WeakMap();

// A VALUE OPENS ONLY UNDER ITS OWN KEY (the independent read, 2026-11-20). secretbox has no associated data, so the
// storage key is sealed INSIDE the value: `onderling-kv1\n<key length>:<key>\n<value>`. A sealed value copied under
// another key opens to the wrong key and is "not readable" there.
const BOUND = 'onderling-kv1\n';
const bindToKey = (key, value) => `${BOUND}${String(key).length}:${key}\n${value}`;

/**
 * Open a stored value and say what it is: `plain` (not sealed at all), `unbound` (sealed before values were bound),
 * `bound` (sealed under THIS key), `other-key` (sealed under another key). Throws when it will not open.
 */
function openStored(s, key, stored) {
  const text = String(stored);
  const opened = s.open(text);
  if (opened === text) return { kind: 'plain', value: opened };
  if (!opened.startsWith(BOUND)) return { kind: 'unbound', value: opened };
  const rest = opened.slice(BOUND.length);
  const colon = rest.indexOf(':');
  const n = colon > 0 ? Number(rest.slice(0, colon)) : NaN;
  if (!Number.isInteger(n) || n < 0 || rest[colon + 1 + n] !== '\n') return { kind: 'other-key' };
  if (rest.slice(colon + 1, colon + 1 + n) !== String(key)) return { kind: 'other-key' };
  return { kind: 'bound', value: rest.slice(colon + 2 + n) };
}

/**
 * The one rule for what a read may hand on: a value bound to this key, always; a plain or unbound one only on a
 * device whose content key is older than this rule (`plainRefused` false: the upgrade's values, rewritten bound at
 * that read); never one bound to another key. Answers `{ ok, value, rewrite }`.
 */
function judgeStored(s, r) {
  if (r.kind === 'bound') return { ok: true, value: r.value, rewrite: false };
  if (r.kind === 'other-key') return { ok: false };
  if (s.plainRefused === true) return { ok: false };
  return { ok: true, value: r.value, rewrite: true };
}
const unopenedOf = (storage) => {
  let set = unopened.get(storage);
  if (!set) { set = new Set(); unopened.set(storage, set); }
  return set;
};

/**
 * Wrap a local StorageBackend so what it writes is sealed at rest.
 *
 * Use this at EVERY local backend construction in a shell — the circle item store, the search index, the
 * device-log snapshot, the circle cache. It is deliberately the same call on both platforms so a reviewer
 * can see at a glance which stores are covered and a guard can prove it.
 *
 * @param {object} backend  a `StorageBackend` (IndexedDB on web, AsyncStorage on mobile, memory in tests)
 * @returns {object} the same port, sealed
 */
export function sealedLocalBackend(backend, { scope = null } = {}) {
  // `scope`: the storage's own name, so a value it could not open stays refused across a rebuilt store (L1115)
  return createSealingBackend({ backend, getStrategy: () => shellContentSeal(), ...(scope ? { markScope: scope } : {}) });
}

/**
 * The storage names of a circle's local stores, one rule for every shell: the circle's own item store and, for a
 * pod-backed circle, its cache medium. A store is rebuilt over the same storage when the circle's producer is dropped
 * (a posture change), so the refusal must be kept per NAME; the name and the scope therefore come from here, never typed
 * twice at a call site.
 */
export const circleStorageName = Object.freeze({
  store: (circleId) => `cc-circle-${circleId}`,
  cache: (circleId) => `cc-circle-cache-${circleId}`,
});

/**
 * Open a named local storage and seal it, the refusal kept under that same name: `open(name)` makes the platform's
 * backend (IndexedDB on web, AsyncStorage on the phone), and the name it was opened under is the refusal's scope.
 */
export function sealedNamedBackend(name, open) {
  return sealedLocalBackend(open(name), { scope: name });
}

/**
 * Wrap a key-value storage (localStorage on web, AsyncStorage on mobile, a file on the box) so the VALUES are sealed at
 * rest with this device's content key; the KEYS stay legible, so a store that lists its keys (a versions store) still
 * can. A write before the key exists is REFUSED rather than stored in the clear.
 *
 * Two modes for a READ:
 *   • default (the first stores that took this): a plain value written before this reads as it is (`open` passes it
 *     through: no migration), and a read before the key hands the stored text on unopened;
 *   • `strict: true` (ledger L1083, every store of a person's content sealed since): a read before the key answers
 *     `null` — "not readable yet", never the sealed text as if it were the value — and so does a value that will not
 *     open with this key (nothing is written over it); a PLAIN value from before is rewritten sealed at its first read
 *     with the key, once, so content does not wait in plain text for the person to change it. A read that finds a
 *     sealed value writes nothing. With `waitForKey: true` as well, a read before the key WAITS for it instead
 *     (`onShellContentSeal`): for a value read at the first frame whose absence would be read as "empty" (a page book,
 *     a contact's name, the person's availability) — "not read yet" is then the honest answer, and nothing seeds or
 *     overwrites in the meantime.
 * @param {object} storage  `getItem` / `setItem` / `removeItem` (sync or async), and whatever listing it offers
 *   (`key(i)` + `length`, or `getAllKeys()`), passed through
 * @param {{name?: string, strict?: boolean, waitForKey?: boolean}} [o]
 */
export function sealedKeyValue(storage, { name = 'a store', strict = false, waitForKey = false, said = false, overwritable = false } = {}) {
  // EVERY mode keeps what it could not open (L1115): a value that will not open is marked, and a write to it is refused
  // until a read of it opens. `overwritable: true` only for a store whose loss is harmless, its reason at the call site
  // (a cache rebuilt from elsewhere, a remembered "no" that may simply be asked again).
  const strategy = () => {
    const s = shellContentSeal();
    if (!s) throw new Error(`sealedKeyValue: refusing to write ${name} unsealed — no content key yet`);
    return s;
  };
  const keyArrives = () => new Promise((resolve) => { onShellContentSeal(resolve); });
  const kv = {
    async getItem(key) {
      const v = await storage.getItem(key);
      if (v == null) return null;
      if (!strict) {
        const s = shellContentSeal();
        if (!s) return v;
        let verdict;
        try { verdict = judgeStored(s, openStored(s, key, v)); } catch (err) {
          if (!overwritable) unopenedOf(storage).add(key);
          throw err;   // as before: the caller's own catch decides what it reads; the write after it is refused
        }
        if (!verdict.ok) {
          if (!overwritable) unopenedOf(storage).add(key);
          throw new Error(`sealedKeyValue: ${name}: a stored value that is not genuine here (plain, or another key's); kept`);
        }
        unopenedOf(storage).delete(key);
        if (verdict.rewrite) { try { await storage.setItem(key, s.seal(bindToKey(key, verdict.value))); } catch { /* the next read tries again */ } }
        return verdict.value;
      }
      const s = shellContentSeal() ?? (waitForKey ? await keyArrives() : null);
      if (!s) return null;
      let verdict;
      try { verdict = judgeStored(s, openStored(s, key, v)); } catch { verdict = { ok: false }; }
      if (!verdict.ok) {
        if (!overwritable) unopenedOf(storage).add(key);   // not written over until it reads (L1115)
        console.warn(`[at-rest] ${name}: a stored value this device cannot take (will not open, plain, or another key's); it is kept, not written over`);
        return null;
      }
      unopenedOf(storage).delete(key);
      if (verdict.rewrite) {   // the upgrade's plain or unbound value: sealed and bound now, once
        try { await storage.setItem(key, s.seal(bindToKey(key, verdict.value))); } catch { /* the next read tries again */ }
      }
      return verdict.value;
    },
    async setItem(key, value) {
      if (!overwritable && unopened.get(storage)?.has(key)) throw refuse(name, key, said);
      await storage.setItem(key, strategy().seal(bindToKey(key, String(value))));
    },
    // a remove does NOT lift the refusal: remove-then-set is a common save, and would write over the value just the same
    // (Fable's review, L1115). The mark lives this session; a later start that finds nothing there writes freely.
    async removeItem(key) { await storage.removeItem(key); },
  };
  if (typeof storage.key === 'function') {
    kv.key = (i) => storage.key(i);
    Object.defineProperty(kv, 'length', { get: () => storage.length, enumerable: true });
  }
  if (typeof storage.getAllKeys === 'function') kv.getAllKeys = (...a) => storage.getAllKeys(...a);
  return kv;
}

/**
 * Wrap the per-circle KEY vault so what it holds is sealed at rest.
 *
 * ── What was found, 2026-09-10 ──────────────────────────────────────────────────────────────────
 * The vault at `cc-circle-pod` holds, in its own comment's words, "per-circle sealing identities +
 * controller keys + the persisted group-key resource". It was created in the SHELLS — `VaultIndexedDB`
 * on web, `VaultAsyncStorage` on mobile — and so never passed through `realAgent`'s `sealedVault()`,
 * which is what seals every vault that agent owns. Nothing sealed it. Read back raw, its rows are:
 *
 *     cc.circle-sealing-id:<circle>     {"publicKey":"MCowBQ…","privateKey":"MC4CAQAw…"}
 *     cc.circle-controller-key:<circle> {"publicKey":"MCowBQ…","privateKey":"MC4CAQAw…"}
 *     cc.circle-groupkey:<circle>       {"v":1,"members":2,"recipients":[…]}
 *
 * Two PRIVATE KEYS per circle, in the clear, next to the group key they unwrap.
 *
 * This mattered more than it looked, because it undercut the sealing beside it: content was being sealed
 * at rest on the same device where the keys that open it lay readable. Someone holding the disk did not
 * need to break the seal — the keys were next to it. The at-rest work is only worth what its weakest row
 * is worth, and this was the weakest row.
 *
 * ── The one difference from the content path: this one RESEALS ──────────────────────────────────
 * Content deliberately does not migrate (Frits: *"sealed, but from the start"*) — a pass over live data is
 * the part that could lose someone's things. Key material is the opposite case and gets the opposite
 * treatment: there are three small rows per circle, they are read on every circle open, and a plaintext
 * private key left behind does not merely fail to protect new writes — it opens everything in that circle
 * for as long as it exists, past and future. So a plaintext value found on read is written back sealed.
 *
 * It cannot lose anything: the plaintext is only replaced after a successful seal, and a crash in between
 * leaves exactly what is there today. It needs no boot pass and no enumeration, and it converges on its
 * own, because a key nobody reads is a key nobody is using.
 */
export function sealedLocalVault(vault) {
  if (!vault || typeof vault.get !== 'function' || typeof vault.set !== 'function') {
    throw new Error('sealedLocalVault: a vault with get/set is required');
  }
  const strategy = () => shellContentSeal();

  const wrapped = {
    async set(key, value) {
      if (unopened.get(vault)?.has(key)) throw refuse('a circle key vault', key);
      const s = strategy();
      if (!s) throw new Error(`sealedLocalVault: refusing to store "${key}" unsealed — no content key yet`);
      return vault.set(key, s.seal(bindToKey(key, typeof value === 'string' ? value : JSON.stringify(value))));
    },

    async get(key) {
      const stored = await vault.get(key);
      if (stored == null) return null;
      const s = strategy();
      if (!s) return stored;
      let verdict;
      try { verdict = judgeStored(s, openStored(s, key, stored)); }
      catch (err) { verdict = { ok: false, err }; }
      if (!verdict.ok) {
        console.warn(`[at-rest] ${key}: a circle key is stored here that this device cannot take (will not open, plain, or another key's); kept, not written over`, verdict.err ?? '');
        unopenedOf(vault).add(key);
        return null;
      }
      unopenedOf(vault).delete(key);
      // Written before sealing (or before binding) began: sealed and bound now, on the way past. See the header for
      // why key material gets this.
      if (verdict.rewrite) {
        try { await vault.set(key, s.seal(bindToKey(key, verdict.value))); }
        catch { /* best-effort — the value is still readable either way */ }
      }
      return verdict.value;
    },

    async delete(key) {
      if (typeof vault.delete !== 'function') throw new Error('sealedLocalVault: this vault has no delete');
      const r = await vault.delete(key);
      unopened.get(vault)?.delete(key);   // removed on purpose: a fresh write may follow
      return r;
    },
  };

  return new Proxy(vault, {
    get(target, prop, receiver) {
      if (prop in wrapped) return wrapped[prop];
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

/**
 * A JSON value per key, SEALED at rest with this device's content key (ledger L1083) — the io the small stores of a
 * person's content use (`load(key)`, `save(key, value)`, `remove(key)`). Keys stay legible.
 *   • Before the key exists a write is REFUSED (it throws; the stores' saves swallow it) and a read answers `null`
 *     ("nothing kept"): a sealed value is never handed on as if it were the value.
 *   • A value that will not open with this key (another device's, or corrupt) reads `null` too, and is not overwritten.
 *   • A PLAIN value from before sealing reads as itself and is rewritten sealed at that read, once, so content does not
 *     sit in plain text until the person happens to change it. A read that finds a sealed value writes nothing.
 * The value is never logged.
 *
 * `load` answers `null` for everything it cannot hand on. `loadOrThrow` tells the cases apart for a caller that would
 * otherwise WRITE over what it could not read (the seen-marks): it answers `null` only when the storage answered —
 * nothing stored, or a value that will not open with this key (nothing readable here: starting empty is right) — and
 * THROWS when the storage read itself failed, or there is no content key yet (not known: do not write).
 * @param {object} storage  `getItem` / `setItem` / `removeItem` (sync or async)
 */
export function sealedJsonIo(storage, { waitForKey = false, name = 'a sealed value', said = false } = {}) {
  const kv = sealedKeyValue(storage, { name, strict: true, waitForKey, said });
  async function loadOrThrow(key) {
    if (!waitForKey && !shellContentSeal()) throw new Error('sealedJsonIo: no content key yet — the value is not known');
    const raw = await kv.getItem(key);   // a storage error comes through; a value this key cannot open is null
    if (raw == null || raw === '') return null;
    // a value that OPENS but is not JSON is not readable either: kept, and not written over (L1115)
    try { return JSON.parse(raw); } catch { unopenedOf(storage).add(key); return null; }
  }
  return {
    async load(key) {
      try { return await loadOrThrow(key); } catch { return null; }
    },
    loadOrThrow,
    async save(key, value) { await kv.setItem(key, JSON.stringify(value)); },
    async remove(key) { await kv.removeItem(key); },
  };
}
