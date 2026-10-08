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

/**
 * @param {{bucket: {put: Function, get: Function, delete: Function}}} o   the companion's blob bucket
 */
export function createFeedShelf({ bucket }) {
  if (!bucket || typeof bucket.get !== 'function' || typeof bucket.put !== 'function' || typeof bucket.delete !== 'function') {
    throw new Error('feedShelf: a bucket with put / get / delete is required');
  }
  return {
    /** Put (or replace) a sealed file under a link's id. `{ok}` or `{ok: false, error}`. */
    async put(id, envelope) {
      if (typeof id !== 'string' || !FEED_TOKEN.test(id)) return { ok: false, error: 'bad-id' };
      if (!isLinkSealed(envelope)) return { ok: false, error: 'not-sealed' };
      if (envelope.length > MAX_SEALED_CHARS) return { ok: false, error: 'too-large' };
      await bucket.put(bucketKeyOf(id), envelope);
      return { ok: true };
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
      const envelope = await bucket.get(bucketKeyOf(id)).catch(() => null);
      return envelope ? openForLink(envelope, k) : null;
    },
  };
}

/** This node's own route: `/feed/<id>.<k>.ics` → `{id, k}`, or null (the relay's form, with a node, is not this route's). */
export function parseFeedPath(pathname) {
  const at = parseFeedLinkPath(pathname);
  return at && at.node === null ? { id: at.id, k: at.k } : null;
}
