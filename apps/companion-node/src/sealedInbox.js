/**
 * companion-node M2 — the durable SEALED INBOX (the "lightweight sealed
 * personal-relay" the ladder's rung-c calls for; PLAN-offline-delivery M2 +
 * NOTE-companion-node §96-99).
 *
 * WHAT IT IS
 *   A deny-by-default, SEALED-ONLY holder that keeps sealed messages for its
 *   OWNER while their device is away, and DRAINS them to the device on
 *   reconnect. It is the DURABLE upgrade over the relay's ephemeral 5-min
 *   in-memory queue: messages persist (file-backed store) so they survive
 *   beyond the relay-queue TTL and a node restart — "never miss a message".
 *
 * THE SEALED-ONLY INVARIANT (invariant #7 — sealed-only ⇒ any-host trust tier)
 *   The inbox NEVER sees plaintext and NEVER decrypts:
 *     • `deposit` REFUSES anything that isn't a sealed envelope (`isSealed`,
 *       reusing `@onderling/pod-client/sealing`'s sentinel — we do NOT reimplement
 *       crypto). A non-sealed deposit is rejected `{ok:false, error:'not-sealed'}`.
 *     • It stores only the opaque ciphertext string; it holds NO recipient
 *       private key, so it cannot open what it holds even in principle.
 *     • `drain` returns the SAME opaque ciphertext; only the owner device (which
 *       holds the key) can `open` it. The node is a blind holder.
 *   ⇒ the inbox is a sealed-only function ⇒ it may run on ANY host (no
 *   attestation needed), exactly the companion-note trust tier.
 *
 * OWNER-GATED DRAIN (reuse of the R2b delegation posture)
 *   Only the configured owner may drain (checked at the node's `inbox.drain`
 *   skill via `ctx.from === inboxOwnerPubKey`, deny-by-default). Even a
 *   mis-addressed drain would only ever yield ciphertext, but we still gate it
 *   so the metadata (who has mail, how much) doesn't leak.
 *
 * M1 BATCHING (digest / stitch)
 *   `drain` returns a `digest` — a CONTENTLESS summary (just counts + the set of
 *   topics) — so the device renders ONE notification for a drained batch instead
 *   of N. The waker is likewise throttled per owner (one wake per window), so a
 *   burst of deposits yields at most one wake, not N. Both are sealed-safe: a
 *   count is not content.
 */

import { isSealed as defaultIsSealed } from '@onderling/pod-client/sealing';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

// ── Durable stores ───────────────────────────────────────────────────────────

/**
 * In-memory inbox store (tests / node-less default). NOT durable across a
 * process restart — use `FileSealedInboxStore` for the durable rung-c holder.
 * Shape per owner: `[{ id, sealed, topic, at }]`.
 */
export class MemorySealedInboxStore {
  /** @type {Map<string, Array<object>>} */ #byOwner = new Map();

  async append(owner, item) {
    if (!this.#byOwner.has(owner)) this.#byOwner.set(owner, []);
    this.#byOwner.get(owner).push(item);
    return item;
  }
  async list(owner) { return [...(this.#byOwner.get(owner) ?? [])]; }
  async clear(owner) { this.#byOwner.delete(owner); }
  async count(owner) { return this.#byOwner.get(owner)?.length ?? 0; }
  /** Full snapshot (for the plaintext-at-rest assertion). */
  async snapshot() {
    const out = {};
    for (const [owner, items] of this.#byOwner) out[owner] = [...items];
    return out;
  }
}

/**
 * File-backed durable inbox store — persists to a single JSON file, "like the
 * identity vault volume" (`VaultNodeFs` under the config dir). Survives node
 * restarts + the relay-queue TTL: a fresh instance reading the same path sees
 * every held message. Writes are synchronous + atomic-ish (write-tmp-rename) so
 * a crash mid-write can't corrupt the file.
 *
 * NOTE: this is STORAGE, not crypto — it round-trips opaque sealed strings. It
 * never sees plaintext (the strings are already ciphertext when they arrive).
 */
export class FileSealedInboxStore {
  #filePath;

  /** @param {string} filePath  where to persist (e.g. <configDir>/inbox.json) */
  constructor(filePath) {
    this.#filePath = filePath;
  }

  /**
   * A FILE THAT IS THERE BUT CANNOT BE READ IS NEVER WRITTEN OVER. Read as "empty", the next deposit wrote a file holding
   * only itself and a drain listed nothing and cleared: every message held for every owner, gone. Now only a MISSING
   * file is an empty inbox; one that does not parse, is not an object, or cannot be read refuses every read and write
   * (INBOX_NOT_READABLE: a deposit fails, so the sender keeps its copy) and is said at start (`notReadable()`).
   * @returns {{ obj: object|null, reason: null|'unparseable'|'shape'|'read-failed' }}
   */
  #read() {
    let text;
    try { text = readFileSync(this.#filePath, 'utf8'); }
    catch (err) { return err?.code === 'ENOENT' ? { obj: {}, reason: null } : { obj: null, reason: 'read-failed' }; }
    let obj;
    try { obj = JSON.parse(text); } catch { return { obj: null, reason: 'unparseable' }; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { obj: null, reason: 'shape' };
    return { obj, reason: null };
  }
  #load() {
    const { obj, reason } = this.#read();
    if (reason) {
      throw Object.assign(new Error(`sealed inbox: ${this.#filePath} is not readable by this build (${reason}); nothing is written over it`),
        { code: 'INBOX_NOT_READABLE', reason });
    }
    return obj;
  }
  /** null, or why the stored inbox cannot be read (said at start; every read and write is refused meanwhile). */
  notReadable() { return this.#read().reason; }
  #save(obj) {
    try { mkdirSync(dirname(this.#filePath), { recursive: true }); } catch { /* exists */ }
    const tmp = `${this.#filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(obj), 'utf8');
    renameSync(tmp, this.#filePath);
  }

  async append(owner, item) {
    const obj = this.#load();
    if (!Array.isArray(obj[owner])) obj[owner] = [];
    obj[owner].push(item);
    this.#save(obj);
    return item;
  }
  async list(owner) { return [...(this.#load()[owner] ?? [])]; }
  async clear(owner) { const obj = this.#load(); delete obj[owner]; this.#save(obj); }
  async count(owner) { return (this.#load()[owner] ?? []).length; }
  async snapshot() { return this.#load(); }
}

// ── Digest (M1 batching) ─────────────────────────────────────────────────────

/**
 * Build a CONTENTLESS drain digest for a batch of held items — a summary the
 * device renders as ONE notification instead of N. Carries only counts + the
 * set of topics (a topic is a routing label, not content); NEVER any plaintext.
 *
 * @param {Array<{topic?:string}>} items
 * @returns {{ count:number, topics:string[] }}
 */
export function buildDrainDigest(items) {
  const list = Array.isArray(items) ? items : [];
  const topics = [...new Set(list.map((m) => m.topic).filter(Boolean))].sort();
  return { count: list.length, topics };
}

// ── The inbox ────────────────────────────────────────────────────────────────

let _seq = 0;
const nextId = (now) => `inbox-${now}-${(++_seq).toString(36)}`;

/**
 * Create a sealed inbox.
 *
 * @param {object} [opts]
 * @param {object}  [opts.store]        a store (Memory/File); default in-memory.
 * @param {(t:string)=>boolean} [opts.isSealed]  sentinel predicate (reused from sealing).
 * @param {(owner:string)=>Promise<void>|void} [opts.notify]  fire a reliable wake for `owner`
 *                                                             (throttled). Optional — off ⇒ hold only.
 * @param {number}  [opts.throttleMs=30000]  min gap between wakes per owner (M1 batching).
 * @param {()=>number} [opts.now]        injectable clock (tests).
 * @returns {object} the inbox surface.
 */
export function createSealedInbox({
  store    = new MemorySealedInboxStore(),
  isSealed = defaultIsSealed,
  notify   = null,
  throttleMs = 30_000,
  now      = () => Date.now(),
} = {}) {
  /** owner → last wake timestamp (throttle) */
  const lastWakeAt = new Map();

  async function maybeWake(owner) {
    if (typeof notify !== 'function') return false;
    const t = now();
    const last = lastWakeAt.get(owner) ?? -Infinity;
    if (t - last < throttleMs) return false;   // batch: swallow the extra wakes
    lastWakeAt.set(owner, t);
    try { await notify(owner); } catch { /* wake is best-effort; hold still succeeded */ }
    return true;
  }

  return {
    store,

    /**
     * Deposit a SEALED message for `owner`. Deny-by-default: rejects anything
     * that isn't a sealed envelope (the node must never hold plaintext). On a
     * held message, fires a throttled reliable wake if a `notify` is wired.
     *
     * @param {string} owner   recipient device/owner address
     * @param {string} sealed  an opaque sealed-envelope string (`isSealed`)
     * @param {object} [meta]  { topic? }
     * @returns {Promise<{ok:boolean, id?:string, error?:string, count?:number, woke?:boolean}>}
     */
    async deposit(owner, sealed, { topic } = {}) {
      if (!owner || typeof owner !== 'string') return { ok: false, error: 'no-owner' };
      if (!isSealed(sealed)) {
        // SEALED-ONLY: refuse plaintext / anything not a sealed envelope.
        return { ok: false, error: 'not-sealed' };
      }
      const t = now();
      const item = { id: nextId(t), sealed, topic: topic ?? null, at: t };
      await store.append(owner, item);
      const woke = await maybeWake(owner);
      return { ok: true, id: item.id, count: await store.count(owner), woke };
    },

    /** How many sealed messages are held for `owner`. */
    async count(owner) { return store.count(owner); },

    /** The held items (opaque ciphertext) for `owner` — for inspection/tests. */
    async list(owner) { return store.list(owner); },

    /**
     * Drain everything held for `owner` and clear it (durably). Returns the
     * opaque sealed items + a CONTENTLESS digest (M1 batching). The caller
     * (the node's owner-gated `inbox.drain` skill) delivers these to the device,
     * which alone can `open` them.
     *
     * @param {string} owner
     * @returns {Promise<{items:Array<object>, digest:{count:number, topics:string[]}}>}
     */
    async drain(owner) {
      const items = await store.list(owner);
      await store.clear(owner);
      lastWakeAt.delete(owner);
      return { items, digest: buildDrainDigest(items) };
    },
  };
}
