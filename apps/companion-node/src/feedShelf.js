/**
 * feedShelf — a person's agenda file, held for a household's bot and served at a link, BLIND AT REST.
 *
 * The bot (the node's owner) renders a person's `.ics`, seals it to a key `k` that only the link carries, and puts the
 * ciphertext here under the link's `id`. The shelf keeps `hash(id) → ciphertext` and nothing else: no `k`, no
 * plaintext, no id. A GET of `/feed/<id>.<k>.ics` opens the file with the `k` from the path, serves it, and forgets
 * both — so a disk image of the box reveals nothing, while a running node sees what it serves, as any web server does.
 *
 * Every miss — an unknown id, a wrong key, no file — is the SAME answer (`null` → one 404), and the id is compared
 * against the stored hashes in constant time, so the route is no oracle for which links exist. Nothing here logs an id
 * or a path.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { openTunnelOW } from '@onderling/core';

/** An id or a key as the link carries them: base64url, long enough to be unguessable. */
const TOKEN = /^[A-Za-z0-9_-]{22,64}$/;
/** The largest sealed file the shelf takes (a household's agenda is a few kilobytes). */
const MAX_SEALED_BYTES = 512 * 1024;

const hashOf = (id) => createHash('sha256').update(`feed|${id}`).digest();

/** The shelf's memory: `hex(hash(id)) → {sealed, nonce}`. */
export class MemoryFeedStore {
  constructor() { this.map = new Map(); }
  async all() { return [...this.map.entries()]; }
  async set(h, v) { this.map.set(h, v); }
  async delete(h) { this.map.delete(h); }
}

/** The same, kept in one file (written whole, then renamed into place; readable by the node only). */
export class FileFeedStore extends MemoryFeedStore {
  constructor(file) {
    super();
    this.file = file;
    try { this.map = new Map(Object.entries(JSON.parse(readFileSync(file, 'utf8')))); } catch { /* none yet */ }
  }
  #save() {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map)), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
  async set(h, v) { await super.set(h, v); this.#save(); }
  async delete(h) { await super.delete(h); this.#save(); }
}

/**
 * @param {{store?: MemoryFeedStore}} [o]
 */
export function createFeedShelf({ store = new MemoryFeedStore() } = {}) {
  /** The stored entry for this id, found by comparing its hash with every stored one in constant time. */
  async function find(id) {
    const want = hashOf(id);
    let hit = null;
    for (const [h, v] of await store.all()) {
      const have = Buffer.from(h, 'hex');
      if (have.length === want.length && timingSafeEqual(have, want) && !hit) hit = v;
    }
    return hit;
  }
  return {
    /** Put (or replace) a sealed file under a link's id. `{ok}` or `{ok: false, error}`. */
    async put(id, blob) {
      if (typeof id !== 'string' || !TOKEN.test(id)) return { ok: false, error: 'bad-id' };
      const sealed = blob?.sealed; const nonce = blob?.nonce;
      if (typeof sealed !== 'string' || typeof nonce !== 'string' || !sealed || !nonce) return { ok: false, error: 'not-sealed' };
      if (sealed.length > MAX_SEALED_BYTES) return { ok: false, error: 'too-large' };
      await store.set(hashOf(id).toString('hex'), { sealed, nonce });
      return { ok: true };
    },
    /** Drop a link's file (a new link minted, or the person revoked). Dropping what is not there is fine. */
    async drop(id) {
      if (typeof id !== 'string' || !TOKEN.test(id)) return { ok: false, error: 'bad-id' };
      await store.delete(hashOf(id).toString('hex'));
      return { ok: true };
    },
    /** The file's text for `<id>.<k>`, or `null` for every kind of miss alike. */
    async open(id, k) {
      if (typeof id !== 'string' || typeof k !== 'string' || !TOKEN.test(id) || !TOKEN.test(k)) return null;
      const entry = await find(id);
      if (!entry) return null;
      const inner = openTunnelOW({ key: k, sealed: entry.sealed, nonce: entry.nonce });
      return typeof inner?.ics === 'string' ? inner.ics : null;
    },
    /** How many files the shelf holds (the owner's status; never which). */
    async count() { return (await store.all()).length; },
  };
}

/** The route's path: `/feed/<id>.<k>.ics` → `{id, k}`, or null. */
export function parseFeedPath(pathname) {
  const m = /^\/feed\/([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.ics$/.exec(String(pathname ?? ''));
  return m ? { id: m[1], k: m[2] } : null;
}
