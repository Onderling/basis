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
 * @param {{ read: Function, write: Function }} podClient   a PodClient-shaped client
 * @param {string} uri                                      the key-resource URI (e.g. <pod>/.keys/group.json)
 * @returns {{ read: () => Promise<object|null>, write: (resource:object) => Promise<void> }}
 */
export function createPodKeyStore({ podClient, uri } = {}) {
  if (!podClient || typeof podClient.read !== 'function' || typeof podClient.write !== 'function') {
    throw new Error('createPodKeyStore: a PodClient with read/write is required');
  }
  if (!uri) throw new Error('createPodKeyStore: a key-resource uri is required');
  return {
    async read() {
      let res;
      try {
        res = await podClient.read(uri, { decode: 'text' });
      } catch (err) {
        if (err && (err.code === 'NOT_FOUND' || err.status === 404)) return null;   // not bootstrapped yet
        throw err;
      }
      const text = typeof res === 'string' ? res : res?.content;
      if (!text) return null;
      try { return JSON.parse(text); } catch { return null; }
    },
    async write(resource) {
      await podClient.write(uri, JSON.stringify(resource), { contentType: 'application/json' });
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
