/**
 * feedShelf — a person's agenda file, held for a household's bot and served at a link, BLIND AT REST.
 *
 * The bot (the node's owner) renders a person's `.ics`, seals it to a key `k` that only the link carries
 * (`sealForLink`), and puts the envelope here under the link's `id`. The shelf stores it in the companion's blob
 * BUCKET — the same ciphertext-only store as the media edge (`put` / `get` / `delete`; the one R2/S3 swap covers
 * both) — under the hash of the id, so the bucket holds no id, no `k`, no plaintext. A GET of `/feed/<id>.<k>.ics`
 * fetches the envelope by that hash, opens it with the `k` from the path, serves it, and forgets both: a disk image of
 * the box reveals nothing, while a running node sees what it serves, as any web server does.
 *
 * Each file also keeps WHO PUT IT (the agent's key — the token's subject), in the bucket object beside the envelope,
 * never in its key; and a small index per putter (under the hash of its key) lists the bucket keys it put — hashes,
 * never ids. So when that agent's grant is revoked, every file it put is dropped and its links go dark (`dropAllBy`).
 *
 * Every miss — an unknown id, a wrong key, no file — is the SAME answer (`null` → one 404). The lookup is by
 * SHA-256 of the id, which a caller cannot steer, so its timing says nothing about which ids exist. Nothing here logs
 * an id or a path.
 */
import { hashHex } from '@onderling/core';
import { openForLink, isLinkSealed, LINK_TOKEN, parseFeedLinkPath } from '@onderling/blob-gateway';

/** An id or a key as the link carries them — the link grammar's own word (`@onderling/blob-gateway`'s `linkPath.js`). */
export const FEED_TOKEN = LINK_TOKEN;
/** The largest sealed file the shelf takes (a household's agenda is a few kilobytes). */
const MAX_SEALED_CHARS = 512 * 1024;

/** The bucket key of a link's file: the hash of its id (never the id). */
const bucketKeyOf = (id) => `feed-${hashHex(`feed|${id}`)}`;
/** The bucket key of a putter's index (the bucket keys it put): the hash of its key. */
const indexKeyOf = (by) => `feedby-${hashHex(`feedby|${by}`)}`;
/** What a bucket object holds: `{e: envelope, by?: putter}`, as text. */
const readObject = (text) => {
  if (typeof text !== 'string') return null;
  try { const o = JSON.parse(text); return o && typeof o.e === 'string' ? o : null; } catch { return null; }
};

/**
 * @param {{bucket: {put: Function, get: Function, delete: Function}}} o   the companion's blob bucket
 */
export function createFeedShelf({ bucket }) {
  if (!bucket || typeof bucket.get !== 'function' || typeof bucket.put !== 'function' || typeof bucket.delete !== 'function') {
    throw new Error('feedShelf: a bucket with put / get / delete is required');
  }
  // one index change at a time per putter (a read, then a write)
  const chains = new Map();
  const serial = (by, fn) => {
    const next = (chains.get(by) ?? Promise.resolve()).then(fn, fn);
    chains.set(by, next.catch(() => {}));
    return next;
  };
  const readIndex = async (by) => { try { const v = JSON.parse((await bucket.get(indexKeyOf(by))) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

  return {
    /**
     * Put (or replace) a sealed file under a link's id, recording who put it (`by`, the caller's key). `{ok}` or
     * `{ok: false, error}`.
     */
    async put(id, envelope, { by = null } = {}) {
      if (typeof id !== 'string' || !FEED_TOKEN.test(id)) return { ok: false, error: 'bad-id' };
      if (!isLinkSealed(envelope)) return { ok: false, error: 'not-sealed' };
      if (envelope.length > MAX_SEALED_CHARS) return { ok: false, error: 'too-large' };
      const key = bucketKeyOf(id);
      await bucket.put(key, JSON.stringify({ e: envelope, ...(by ? { by } : {}) }));
      if (by) {
        await serial(by, async () => {
          const index = await readIndex(by);
          if (!index.includes(key)) await bucket.put(indexKeyOf(by), JSON.stringify([...index, key]));
        });
      }
      return { ok: true };
    },
    /**
     * Drop every file `by` put (its grant was revoked): its links go dark. A file another agent has since replaced is
     * not `by`'s, and stays. Returns how many were dropped.
     */
    async dropAllBy(by) {
      if (typeof by !== 'string' || !by) return 0;
      return serial(by, async () => {
        let dropped = 0;
        for (const key of await readIndex(by)) {
          const o = readObject(await bucket.get(key).catch(() => null));
          if (o?.by !== by) continue;
          await bucket.delete(key);
          dropped += 1;
        }
        await bucket.delete(indexKeyOf(by));
        return dropped;
      });
    },
    /** Drop a link's file (a new link minted, or the person revoked). Dropping what is not there is fine. */
    async drop(id) {
      if (typeof id !== 'string' || !FEED_TOKEN.test(id)) return { ok: false, error: 'bad-id' };
      await bucket.delete(bucketKeyOf(id));
      return { ok: true };
    },
    /** The file's text for `<id>.<k>`, or `null` for every kind of miss alike. */
    async open(id, k) {
      if (typeof id !== 'string' || typeof k !== 'string' || !FEED_TOKEN.test(id) || !FEED_TOKEN.test(k)) return null;
      const o = readObject(await bucket.get(bucketKeyOf(id)).catch(() => null));
      return o ? openForLink(o.e, k) : null;
    },
  };
}

/** This node's own route: `/feed/<id>.<k>.ics` → `{id, k}`, or null (the relay's form, with a node, is not this route's). */
export function parseFeedPath(pathname) {
  const at = parseFeedLinkPath(pathname);
  return at && at.node === null ? { id: at.id, k: at.k } : null;
}
