// podKeyStore.js — back the control-agent's `keyStore` with a pod resource (e.g. `/.keys/group.json`,
// holding the CURRENT key-resource version). This is the "membership → pod access" bridge: the
// control-agent reads/writes the key resource here while granting/revoking ACLs.
//
// The key resource is stored as PLAIN JSON — its sensitive part (the group key) is already a
// recipient-wrapped envelope (self-protecting), so the host only sees `{version, member count, opaque
// sealed blob}`. A plain PodClient suffices; no SealedPodClient is needed for the key resource itself.
// (The circle's CONTENT, by contrast, is sealed under the group key via a SealedPodClient.)

import { KeyReadTornError, KEY_READ_AGREE_ATTEMPTS } from './keyResourceWrite.js';
import { unwrapGroupKey } from './groupKeyResource.js';

/**
 * Back the control-agent's `keyStore` with a pod resource holding the current group-key resource.
 * Stored as plain JSON — the group key inside is already a recipient-wrapped envelope, so a plain
 * `PodClient` suffices. `read()` returns null while the circle is not bootstrapped yet (404).
 *
 * @param {{ read: Function, write: Function }} podClient   a PodClient-shaped client
 * @param {string} uri                                      the key-resource URI (e.g. <pod>/.keys/group.json)
 * @returns {{ read: () => Promise<object|null>, write: (resource:object) => Promise<void>, writeIfUnchanged: (resource:object, cur:object|null) => Promise<boolean> }}
 */
export function createPodKeyStore({ podClient, uri, agreeAttempts = KEY_READ_AGREE_ATTEMPTS } = {}) {
  if (!podClient || typeof podClient.read !== 'function' || typeof podClient.write !== 'function') {
    throw new Error('createPodKeyStore: a PodClient with read/write is required');
  }
  if (!uri) throw new Error('createPodKeyStore: a key-resource uri is required');
  // the ETag each parsed resource was read with, so a later conditional write can name the version it built on
  const readEtags = new WeakMap();
  // one GET: the parsed resource (null: none stored), the text it was read as and the ETag it came with
  const readOnce = async () => {
    let res;
    try {
      res = await podClient.read(uri, { decode: 'text' });
    } catch (err) {
      if (err && (err.code === 'NOT_FOUND' || err.status === 404)) return { parsed: null, text: null, etag: null };   // not bootstrapped yet
      throw err;
    }
    const body = typeof res === 'string' ? res : res?.content;
    if (body == null) return { parsed: null, text: null, etag: null };
    const etag = (res && typeof res === 'object' && typeof res.etag === 'string') ? res.etag : null;
    let parsed = null;
    if (typeof body === 'object') parsed = body;
    else { try { parsed = JSON.parse(body); } catch { parsed = null; } }
    return { parsed: parsed && typeof parsed === 'object' ? parsed : null, text: typeof body === 'string' ? body : JSON.stringify(body), etag };
  };
  return {
    /**
     * THE READ A CHANGE BUILDS ON (`changeKeyResource`, the canonical share's loops): trusted only when two consecutive
     * GETs agree on the ETag AND the body. A pod can serve a torn read (the old body under the new ETag, when the GET
     * overlaps another writer's PUT); a change built on it would pass its If-Match and write that writer's change away.
     * A disagreement reads again (bounded); one that never settles throws KEY_READ_TORN and nothing is written.
     */
    async readForWrite() {
      for (let i = 0; i < agreeAttempts; i += 1) {
        const a = await readOnce();
        const b = await readOnce();
        if (a.etag === b.etag && a.text === b.text) {
          if (b.parsed) readEtags.set(b.parsed, b.etag);
          return b.parsed;
        }
      }
      throw new KeyReadTornError(agreeAttempts);
    },
    /** A read that only OPENS the key (a strategy, a reseal): one GET. Never the base of a write. */
    async read() {
      let res;
      try {
        res = await podClient.read(uri, { decode: 'text' });
      } catch (err) {
        if (err && (err.code === 'NOT_FOUND' || err.status === 404)) return null;   // not bootstrapped yet
        throw err;
      }
      const body = typeof res === 'string' ? res : res?.content;
      if (body == null) return null;
      const etag = (res && typeof res === 'object' && typeof res.etag === 'string') ? res.etag : null;
      // A PodClient auto-decodes an application/json resource to an OBJECT (its
      // `auto`/unknown decode path JSON-parses for us), while an in-memory client
      // hands back the raw JSON string. Accept either — JSON.parse on an object
      // would yield "[object Object]" → SyntaxError → a spurious null, which would
      // make the control agent rebuild the group key and silently drop members.
      let parsed = null;
      if (typeof body === 'object') parsed = body;
      else { try { parsed = JSON.parse(body); } catch { parsed = null; } }
      if (parsed && typeof parsed === 'object') readEtags.set(parsed, etag);
      return parsed;
    },
    async write(resource) {
      await podClient.write(uri, JSON.stringify(resource), { contentType: 'application/json' });
    },
    /**
     * COMPARE-AND-SWAP: write `resource` only while the stored key resource is still the one `cur` was read as —
     * a conditional PUT on the ETag of the read that produced `cur` (`cur` null: only while nothing is stored).
     * Returns false when another writer changed it in between (412 / conflict): the caller re-reads and applies
     * its own change on the newest base. A `cur` whose read carried no ETag cannot be compared: refused on an http(s)
     * pod (KEY_WRITE_UNCONDITIONED), a plain write on an in-memory or pseudo store.
     */
    async writeIfUnchanged(resource, cur) {
      const payload = JSON.stringify(resource);
      let opts;
      if (cur == null) opts = { contentType: 'application/json', ifMatch: null, ifNoneMatch: '*', _suppressConflictEvent: true };
      else {
        const etag = readEtags.get(cur);
        if (!etag) {
          // a real pod that gave no ETag cannot be compared against: a plain write there would bring the lost update back
          // silently, so it is refused (the caller reports it); an in-memory or pseudo store without one writes plainly
          if (/^https?:/i.test(uri)) {
            throw Object.assign(new Error('the pod gave no ETag for the key file: the change was not written (it could undo another writer\'s)'), { code: 'KEY_WRITE_UNCONDITIONED' });
          }
          await podClient.write(uri, payload, { contentType: 'application/json' });
          return true;
        }
        opts = { contentType: 'application/json', ifMatch: etag, _suppressConflictEvent: true };
      }
      try {
        await podClient.write(uri, payload, opts);
        return true;
      } catch (err) {
        if (err && (err.code === 'CONFLICT' || err.status === 412 || err.status === 409 || err.name === 'ConflictError')) return false;
        throw err;
      }
    },
  };
}

/**
 * Load the current key resource from a keyStore and unwrap the group key for a member. Returns null when
 * the circle has no key resource yet (not bootstrapped). Throws if the member is not a recipient of the
 * current version (revoked / never granted).
 */
export async function readGroupKey({ keyStore, privateKey }) {
  const resource = await keyStore.read();
  if (!resource) return null;
  return unwrapGroupKey(resource, privateKey);
}
