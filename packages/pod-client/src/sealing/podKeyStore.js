// podKeyStore.js — back the control-agent's `keyStore` with a pod resource (e.g. `/.keys/group.json`,
// holding the CURRENT key-resource version). This is the "membership → pod access" bridge: the
// control-agent reads/writes the key resource here while granting/revoking ACLs.
//
// The key resource is stored as PLAIN JSON — its sensitive part (the group key) is already a
// recipient-wrapped envelope (self-protecting), so the host only sees `{version, member count, opaque
// sealed blob}`. A plain PodClient suffices; no SealedPodClient is needed for the key resource itself.
// (The circle's CONTENT, by contrast, is sealed under the group key via a SealedPodClient.)

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
export function createPodKeyStore({ podClient, uri } = {}) {
  if (!podClient || typeof podClient.read !== 'function' || typeof podClient.write !== 'function') {
    throw new Error('createPodKeyStore: a PodClient with read/write is required');
  }
  if (!uri) throw new Error('createPodKeyStore: a key-resource uri is required');
  // the ETag each parsed resource was read with, so a later conditional write can name the version it built on
  const readEtags = new WeakMap();
  return {
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
     * its own change on the newest base. A `cur` whose read carried no ETag cannot be compared: plain write.
     */
    async writeIfUnchanged(resource, cur) {
      const payload = JSON.stringify(resource);
      let opts;
      if (cur == null) opts = { contentType: 'application/json', ifMatch: null, ifNoneMatch: '*', _suppressConflictEvent: true };
      else {
        const etag = readEtags.get(cur);
        if (!etag) { await podClient.write(uri, payload, { contentType: 'application/json' }); return true; }
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
