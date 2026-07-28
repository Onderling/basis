/**
 * basis v2 — "shared with me" store (SILENT out-of-circle delivery).
 *
 * When a peer SILENTLY shares an item out of their circle, the sealed COPY is pushed over the relay directly to
 * this device's peer (see circleShare.js `shareSilentCopyToPublishedKey` → `sendSharedCopy`). The inbound
 * `shared-copy` handler (makeHandleSharedCopy) lands each received copy HERE — an append-only list of
 * `{ id, sealed, itemMeta, from, receivedAt }` entries the "shared with me" surface projects + opens.
 *
 * Pure portable factory over an injectable `{ load, save }` adapter — the SAME shape as `createCirclePinStore`
 * / `createCirclePolicyStore`. Web composes a localStorage adapter (`localStorageSharedWithMeIo`); mobile
 * composes an AsyncStorage adapter at the same key. The factory never touches a platform global — the shell
 * injects the concrete IO at the call site (invariant #1/#2: logic lives once, web ≡ mobile).
 *
 * PERSISTENCE — TIERED (product call, Frits): the entries carry SEALED ciphertext + structural metadata only
 * (openable solely with THIS user's network-derived sealing key), so persisting them leaks nothing — safe to
 * store on the pod. Local (localStorage/AsyncStorage) stays the canonical device store; when a signed-in pod
 * writer is present the list is MIRRORED to a per-user pod resource so received copies SURVIVE + SYNC across the
 * user's devices. This reuses the exact tiered pattern the availability pref uses
 * (`podAvailabilityIo`/`tieredAvailabilityIo` in memberAvailability.js): `podSharedWithMeIo({getWriter})` +
 * `tieredSharedWithMeIo(local, pod)`. Unsigned → the pod writer thunk returns null and the store is local-only
 * (unchanged). Dedupe is by copy id so a redelivered envelope — or the same copy seen on two devices — never
 * doubles a row.
 */

export function createSharedWithMeStore({ load, save } = {}) {
  return {
    /** Return the received copies, newest-first. `[]` if storage is empty. */
    async list() {
      let raw = null;
      try { raw = typeof load === 'function' ? await load() : null; }
      catch { raw = null; }
      return normalizeEntries(raw);
    },

    /**
     * Append a received sealed copy. Dedupes by entry id (the copy's resource id) so a redelivery is a no-op.
     * Returns the new normalised list so callers can re-render without a follow-up `list()`.
     *
     * @param {{sealed:object, itemMeta?:object, from?:string, receivedAt?:number}} entry
     */
    async add(entry) {
      const norm = normalizeEntry(entry);
      if (!norm) return await this.list();
      const current = await this.list();
      if (current.some((e) => e.id === norm.id)) return current;   // idempotent — already have this copy
      const next = [norm, ...current];
      if (typeof save === 'function') await save(next);
      return next;
    },

    /** Drop every received copy (e.g. on sign-out). */
    async clear() {
      if (typeof save === 'function') await save([]);
      return [];
    },
  };
}

/** localStorage-backed IO (web). Single key: `cc.sharedWithMe`. */
export function localStorageSharedWithMeIo(storage = globalThis.localStorage) {
  const KEY = 'cc.sharedWithMe';
  return {
    load: async () => {
      try {
        const s = storage?.getItem(KEY);
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    },
    save: async (value) => {
      try { storage?.setItem(KEY, JSON.stringify(value)); }
      catch { /* quota / disabled — the list still holds in-memory this session */ }
    },
  };
}

/* ────────────────────────────────────────────────────────────────────
 * TIERED persistence — mirror received copies to a per-user pod resource
 * so they SURVIVE + SYNC across the user's devices (Frits' call).
 *
 * We reuse the SAME shareable-substrate pattern the availability pref
 * uses (`podAvailabilityIo`/`tieredAvailabilityIo`), NOT a divergent
 * home: a per-user pod resource under the `onderling/<app>/` namespace,
 * written through a `createPodWriter`-shaped writer. The list holds only
 * sealed ciphertext + structural metadata, so it is leak-safe on the pod.
 *
 * DESIGN — where the shared copy lives: a PER-USER pod resource
 * (`onderling/cc-shared-with-me/received.json`), NOT a per-circle item. The
 * "shared with me" inbox is cross-circle + per-user by definition (it
 * collects copies pushed to THIS user out of any circle), so a single
 * per-user home is the one truth — mirroring the availability pref's home.
 * ──────────────────────────────────────────────────────────────────── */

/** Per-user pod resource for the received "shared with me" list. */
const SHARED_WITH_ME_RESOURCE = 'received.json';

/**
 * JSON IO over a `createPodWriter`-shaped writer for the per-user
 * "shared with me" list. `getWriter` is a thunk so the host can wire the
 * store before a Solid session has restored (returns `null` while no
 * writer is configured → load/save are no-ops and the composite falls
 * through to the local side). Mirrors `podAvailabilityIo`.
 *
 * @param {object} opts
 * @param {() => object|null} opts.getWriter — thunk returning a podWriter or null
 * @param {string} [opts.app='cc-shared-with-me']
 */
export function podSharedWithMeIo({ getWriter, app = 'cc-shared-with-me' } = {}) {
  if (typeof getWriter !== 'function') {
    throw new TypeError('podSharedWithMeIo: getWriter thunk required');
  }
  return {
    load: async () => {
      const w = getWriter();
      if (!w || typeof w.read !== 'function') return null;
      try {
        const res = await w.read(app, SHARED_WITH_ME_RESOURCE);
        if (!res?.ok || typeof res.body !== 'string') return null;
        return JSON.parse(res.body);
      } catch {
        return null;
      }
    },
    save: async (value) => {
      const w = getWriter();
      if (!w || typeof w.write !== 'function') return;
      try {
        await w.write(app, SHARED_WITH_ME_RESOURCE, JSON.stringify(value), 'application/json');
      } catch {
        /* a pod-write failure must not break the local-canonical write */
      }
    },
  };
}

/**
 * Compose a local (canonical) IO with a pod (mirror) IO for the received
 * list. Unlike the availability pref (a single record — local wins, pod
 * only fills an empty local), the "shared with me" list GROWS on multiple
 * devices, so hydration MERGES both sides by copy id (union, newest-first)
 * and seeds local with any pod-only copies so this device holds them
 * offline. Writes always mirror to the pod (a no-op when no writer is
 * wired). Unsigned (getWriter→null) → pod side is inert and the store is
 * local-only, unchanged.
 *
 * @param {{load, save}} localIo
 * @param {{load, save}} podIo
 * @returns {{load, save}}
 */
export function tieredSharedWithMeIo(localIo, podIo) {
  return {
    load: async () => {
      const localList = normalizeEntries(await safeLoad(localIo));
      const podList   = normalizeEntries(await safeLoad(podIo));
      if (podList.length === 0) return localList;          // nothing to merge in
      const merged = mergeEntriesById(localList, podList);
      if (merged.length !== localList.length) {
        // pod carried copies this device lacked → seed local so they persist offline.
        try { await localIo.save(merged); } catch { /* mirror-down best-effort */ }
      }
      return merged;
    },
    save: async (value) => {
      await localIo.save(value);
      await podIo.save(value);
    },
  };
}

async function safeLoad(io) {
  try { return typeof io?.load === 'function' ? await io.load() : null; }
  catch { return null; }
}

/** Union of normalized entry lists, deduped by copy id (first seen wins), newest-first. */
function mergeEntriesById(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const e of list) if (!byId.has(e.id)) byId.set(e.id, e);
  }
  return normalizeEntries([...byId.values()]);
}

/** Coerce one raw entry into `{ id, sealed, itemMeta, from, receivedAt }`; null if it has no sealed payload. */
function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const sealed = entry.sealed;
  if (!sealed || typeof sealed !== 'object') return null;
  const itemMeta = (entry.itemMeta && typeof entry.itemMeta === 'object') ? entry.itemMeta : {};
  // Prefer the minted copy id (stable across redelivery) → the sealed object's id → a synthesized fallback.
  const id = (typeof itemMeta.copyId === 'string' && itemMeta.copyId)
    || (typeof sealed.id === 'string' && sealed.id)
    || `swm-${entry.receivedAt ?? Date.now()}`;
  const receivedAt = Number.isFinite(entry.receivedAt) ? entry.receivedAt : Date.now();
  return {
    id,
    sealed,
    itemMeta,
    from: typeof entry.from === 'string' ? entry.from : null,
    receivedAt,
  };
}

function normalizeEntries(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeEntry)
    .filter(Boolean)
    .sort((a, b) => b.receivedAt - a.receivedAt);
}
