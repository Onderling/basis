/**
 * SealingBackend — a StorageBackend that seals on the way in and opens on the way out.
 *
 * The port already said this is how it works. `StorageBackend`'s own contract reads
 * `put(ref, ciphertext)` — "a sealed envelope — the backend never opens it" — and nothing local upheld it:
 * a list item written on this device sat in IndexedDB, in AsyncStorage and in a file as plain text.
 * Measured 2026-09-10, one item added through the real agent, `household-items.json`, 403 bytes, the words
 * in the clear. So this is not a new scheme; it is the port's own contract, finally kept, and it invents no
 * crypto — the envelope is the same `fp1:` group-key envelope the pod side already writes.
 *
 * Wrapping the BACKEND rather than each store is what makes it hold everywhere at once. Every local store —
 * a circle's items, the household list, the agent registry, the search index, the device-log snapshot —
 * reaches disk through this one interface, so one adapter covers all of them and a store added tomorrow is
 * covered without being told.
 *
 * This is the same layering `podStorageBackend` chose in @onderling/pod-client: **the seal sits ABOVE a
 * blind store**. That adapter puts a pod under the port; this one puts the seal over it. Do not wrap the
 * two around the same content — one seal, applied once, above whichever store the content lands in.
 *
 * ── The KEY, and why it is not the vault-at-rest key ────────────────────────────────────────────────
 * The obvious key was `deriveVaultAtRestKey()`, which already seals every vault holding key material. It is
 * the wrong one here, and the reason is a path that ships today: the self-enroll ceremony (a root-custody
 * device proving the phrase during a device revocation) ROTATES that key, root-derived → delegation-derived,
 * and reseals every registered vault. Vaults are small and enumerated, so rewriting them is cheap. A
 * person's circles, messages and lists are neither, and a store the ceremony did not know about would be
 * stranded under a key the next boot no longer derives.
 *
 * So content is sealed under a CONTENT KEY that never rotates: random per device, generated once, and kept
 * inside the already-sealed vault. The ceremony reseals the vault, the content key rides along, and not one
 * item byte is rewritten. The rotation stays where rotation is cheap.
 *
 * ── What this does NOT do, said plainly ─────────────────────────────────────────────────────────────
 *   • **It does not hide the keys.** `list(prefix)` is passed through untouched, because callers enumerate
 *     by ref and a sealed key would break every read. A ref names a circle and an item id, so someone with
 *     the raw store learns HOW MUCH there is and roughly of what shape — never the words. Hiding that means
 *     a different layout, not a different cipher, and it is not what this closes.
 *   • **It does not migrate.** Frits, 2026-09-10: *"All data must be sealed, but from the start."* A value
 *     already stored in plain text is returned as it is (the underlying `open` passes non-sealed text
 *     through by design), nothing walks the store at boot to reseal, and data written before this starts
 *     over — which the alpha note already tells people. A migration over live data is the one part of this
 *     that could lose someone's things, and it is deliberately absent.
 *   • **It is not the seal that protects a circle from its own members.** That is the per-circle group key.
 *     This is the at-rest layer under it: what a stolen laptop, a copied browser profile, or a phone backup
 *     hands over.
 */

/**
 * Wrap a StorageBackend so everything written through it is sealed.
 *
 * The wrapper is a TRANSPARENT proxy: it changes exactly one thing, the `bytes` a record carries, and
 * forwards every other argument, every returned field and every other method (`subscribe`, `listDirty`,
 * `delete`, …) untouched. That matters more than it sounds — the etag and the Lamport `_v` are how the
 * replication ring resolves a conflict, and a wrapper that swallowed them would turn "sealed at rest"
 * into "sync quietly stops converging".
 *
 * The strategy is resolved LAZILY and cached, because the stores are built before the agent that holds
 * the key: the web shell constructs its search index at module scope, long before anyone has typed a
 * phrase. put/get are already async, so the first call is the natural moment to ask for the key.
 *
 * @param {object} a
 * @param {object} a.backend  the real store underneath
 * @param {() => ({seal:Function, open:Function}|null|Promise<{seal:Function, open:Function}|null>)} a.getStrategy
 *   resolves this device's content-seal strategy, or null while none is available (no identity yet).
 * @param {(msg: string, err?: unknown) => void} [a.onWarn]  where an unopenable value is reported.
 * @returns {object} the same port, sealed
 */
/**
 * The person chose NOT to seal this device's storage.
 *
 * A `getStrategy` that returns this writes plain text, deliberately. It exists so that choice can never be
 * confused with `null`, which means "the key is not ready yet" and refuses the write. One is a decision and
 * the other is a bug, they want opposite handling, and a single falsy value for both is how the bug would
 * come to look like the decision — silently, on the path where it matters most.
 */
export const PLAINTEXT_AT_REST = Symbol.for('onderling.plaintextAtRest');

export function createSealingBackend({ backend, getStrategy, onWarn = null } = {}) {
  if (!backend || typeof backend.put !== 'function' || typeof backend.get !== 'function') {
    throw new Error('createSealingBackend: a StorageBackend (put/get/list) is required');
  }
  if (typeof getStrategy !== 'function') {
    throw new Error('createSealingBackend: getStrategy must be a function');
  }
  const warn = typeof onWarn === 'function' ? onWarn : (m, e) => console.warn(m, e);

  // Resolved once and kept. A null result is NOT cached — "no identity yet" is a passing state, and
  // caching it would leave the store writing in the clear for the rest of the session.
  let cached = null;
  async function strategy() {
    if (cached) return cached;
    const s = await getStrategy();
    if (s === PLAINTEXT_AT_REST) return PLAINTEXT_AT_REST;   // a choice, re-read every time it can change
    if (s && typeof s.seal === 'function' && typeof s.open === 'function') cached = s;
    return cached;
  }

  /**
   * A record's value goes in as one of three things and must come back as the SAME one, or a caller
   * that stored an object and got a string back breaks in a way no type checker here would catch. So
   * the type travels WITH the value inside the envelope: `s` a string, `j` anything JSON-shaped, `b`
   * raw bytes as base64. Binary is spelled out rather than left to `JSON.stringify`, which turns a
   * Uint8Array into `{"0":31,…}` — an object that parses back cleanly and is silently not the bytes.
   */
  const TAGS = { STRING: 's', JSON: 'j', BYTES: 'b' };

  function encode(value) {
    if (typeof value === 'string') return `${TAGS.STRING}${value}`;
    if (value instanceof Uint8Array) {
      let bin = '';
      for (let i = 0; i < value.length; i++) bin += String.fromCharCode(value[i]);
      return `${TAGS.BYTES}${btoa(bin)}`;
    }
    return `${TAGS.JSON}${JSON.stringify(value)}`;
  }

  function decode(text) {
    const tag = text.slice(0, 1);
    const rest = text.slice(1);
    if (tag === TAGS.STRING) return rest;
    if (tag === TAGS.JSON) return JSON.parse(rest);
    if (tag === TAGS.BYTES) {
      const bin = atob(rest);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    // No tag: written before sealing began. Returned as it stands — the no-migration decision.
    return text;
  }

  const proxy = {
    /**
     * The one place a local write becomes ciphertext.
     *
     * With no strategy this THROWS rather than storing the plain text. That is the deliberate half: an
     * app that cannot seal must not quietly fall back to the behaviour this exists to end, because the
     * fallback is invisible and the promise it breaks is the one on the front page.
     */
    async put(ref, bytes, ...rest) {
      const s = await strategy();
      if (s === PLAINTEXT_AT_REST) return backend.put(ref, bytes, ...rest);   // opted out — stored as it is
      if (!s) throw new Error(`SealingBackend: refusing to store "${ref}" unsealed — no content key yet`);
      return backend.put(ref, s.seal(encode(bytes)), ...rest);
    },

    /**
     * Open on the way out, leaving the rest of the record alone. Four cases:
     *   • a sealed value opens — the ordinary path;
     *   • a PLAIN value passes through — the underlying `open` does this itself, which is what makes
     *     the no-migration decision work: pre-seal rows stay readable instead of becoming noise;
     *   • no strategy yet — the record is returned as it stands, as it always was;
     *   • an envelope this key cannot open yields a null record, loudly. Not the ciphertext, which a
     *     caller would parse and store onward as if it were content, and not a throw, which would take
     *     a whole store down over one bad row. Null is what an absent ref already means.
     */
    async get(ref, ...rest) {
      const rec = await backend.get(ref, ...rest);
      if (rec == null) return null;
      const s = await strategy();
      // Opted out, or not ready: hand back what is stored. Anything sealed BEFORE the person opted out
      // stays sealed on disk and is opened by the seal path above whenever the key is available again —
      // turning the setting off does not strand what was already written.
      if (!s || s === PLAINTEXT_AT_REST) return rec;
      // Some backends hand back the value itself, others a record carrying it as `bytes`.
      const carried = (rec && typeof rec === 'object' && 'bytes' in rec) ? rec.bytes : rec;
      if (carried == null) return rec;
      try {
        const opened = decode(s.open(typeof carried === 'string' ? carried : String(carried)));
        return (rec && typeof rec === 'object' && 'bytes' in rec) ? { ...rec, bytes: opened } : opened;
      } catch (err) {
        warn(`[at-rest] ${ref}: stored here but not openable with this device's content key`, err);
        return null;
      }
    },
  };

  // Everything else the concrete backend offers — list, delete, subscribe, listDirty, subscribeDirty —
  // is forwarded verbatim. Refs are NOT sealed (see the header), so enumeration and subscription keep
  // working exactly as before.
  return new Proxy(backend, {
    get(target, prop, receiver) {
      if (prop in proxy) return proxy[prop];
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

export default createSealingBackend;
