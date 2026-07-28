/**
 * manifest.js — IdentityManifest content-hash + signature helpers.
 *
 * Implements the deterministic 6-step `dw:contentHash` algorithm
 * from `Design-v3/identity-pod-schema.md` §`dw:contentHash` algorithm
 * byte-for-byte.  Any deviation is a spec bug — surface it.
 *
 * Signing uses the existing `AgentIdentity.sign` (Ed25519 detached);
 * the canonical form for signing is the manifest's Turtle
 * representation with the `dw:signature` triple removed.
 */

import crypto from 'node:crypto';
import { b64encode, b64decode } from '@onderling/core';
import { AgentIdentity } from '@onderling/core';
import { serializeManifest } from './turtle.js';

const ENC_SUFFIX = '.enc';

/**
 * Strip the identity-root prefix from a resource URI to produce the
 * relative path used in step 2 of the contentHash algorithm.
 *
 * Example:
 *   identityRoot = 'https://alice.example/onderling/'
 *   uri          = 'https://alice.example/onderling/grants/issued/grant-x.enc'
 *   →              'grants/issued/grant-x.enc'
 *
 * Rejects URIs that don't start with the identity root.
 *
 * @param   {string} uri
 * @param   {string} identityRoot  must end in `/`.
 * @returns {string}
 */
export function relativizeUri(uri, identityRoot) {
  const root = identityRoot.endsWith('/') ? identityRoot : `${identityRoot}/`;
  if (!uri.startsWith(root)) {
    throw new Error(`relativizeUri: '${uri}' is not under identity root '${root}'`);
  }
  let rel = uri.slice(root.length);
  // No leading slash, no trailing slash (per spec step 2).
  while (rel.startsWith('/')) rel = rel.slice(1);
  while (rel.endsWith('/'))   rel = rel.slice(0, -1);
  return rel;
}

/**
 * Sort an array of strings in Unicode codepoint (raw byte) order.
 * Step 3 of the contentHash algorithm; `localeCompare` is forbidden.
 *
 * @param   {string[]} arr
 * @returns {string[]} new array (input not mutated).
 */
export function sortByCodepoint(arr) {
  // Default JS string `<`/`>` is codepoint-based for the BMP and
  // pair-based above — adequate for our path strings (ASCII +
  // hex fingerprints + tokenIds).  Explicit comparator for clarity.
  return [...arr].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Bytes for a payload whose shape can be string, Uint8Array, or
 * ArrayBuffer.  Used to normalize what `PodClient.read` returns.
 *
 * @param   {string|Uint8Array|ArrayBuffer} content
 * @returns {Uint8Array}
 */
function toBytes(content) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (typeof content === 'string')   return new TextEncoder().encode(content);
  if (content && typeof content === 'object') {
    // Defensive: PodClient may have decoded JSON for us.  Re-stringify
    // for hashing so we hash the canonical text.  This path should
    // not be hit in practice — we read with `decode: 'string'`.
    return new TextEncoder().encode(JSON.stringify(content));
  }
  throw new Error('toBytes: unsupported content type');
}

/**
 * Compute `dw:contentHash` per the schema's deterministic 6-step
 * algorithm.
 *
 * 1. Walk `<identityRoot>/` recursively; include every file ending in
 *    `.enc`; exclude `.acl`, `manifest.ttl`, container indexes, empty
 *    containers, and anything else.
 * 2. For each file, compute its path relative to `<identityRoot>/`.
 * 3. Sort paths in Unicode codepoint order (NOT `localeCompare`).
 * 4. SHA-256 each file's raw stored bytes (envelope JSON byte-for-byte).
 * 5. Concatenate the 32-byte digests.
 * 6. SHA-256 the concatenation; lowercase hex; prefix `sha256:`.
 *
 * @param   {object} podClient   `@onderling/pod-client` PodClient.
 * @param   {string} identityRoot  e.g. `'https://alice.example/onderling/'`.
 * @returns {Promise<string>}      `'sha256:<64 lowercase hex>'`.
 */
export async function computeContentHash(podClient, identityRoot) {
  const root = identityRoot.endsWith('/') ? identityRoot : `${identityRoot}/`;

  // Step 1 — enumerate all .enc resources via recursive walk.
  const encUris = await walkEncResources(podClient, root);

  // Step 2 — compute relative paths.
  const relPaths = encUris.map((uri) => relativizeUri(uri, root));

  // Step 3 — sort in Unicode codepoint order.
  const sorted = sortByCodepoint(relPaths);

  // Step 4 — SHA-256 each resource's raw bytes.
  const finalHash = crypto.createHash('sha256');
  for (const rel of sorted) {
    const uri = root + rel;
    const res = await podClient.read(uri, { decode: 'string' });
    const bytes = toBytes(res.content);
    const fileDigest = crypto.createHash('sha256').update(bytes).digest();
    // Step 5 — concatenate.  `update` accumulates without a separator.
    finalHash.update(fileDigest);
  }

  // Step 6 — final hash, lowercase hex, prefix.
  return `sha256:${finalHash.digest('hex')}`;
}

/**
 * Recursively walk a container, returning every `.enc` resource URI.
 * Excludes containers themselves, `.ttl` files, `.acl` files, and any
 * other non-`.enc` resource.
 *
 * @param   {object} podClient
 * @param   {string} containerUri
 * @returns {Promise<string[]>}
 */
async function walkEncResources(podClient, containerUri) {
  const out = [];
  const stack = [containerUri];
  const seen  = new Set();
  while (stack.length > 0) {
    const here = stack.pop();
    if (seen.has(here)) continue;
    seen.add(here);
    let res;
    try {
      res = await podClient.list(here);
    } catch (err) {
      // Missing container = no contribution.
      if (err?.code === 'NOT_FOUND') continue;
      throw err;
    }
    for (const entry of res.entries || []) {
      if (entry.type === 'container') {
        stack.push(entry.uri);
      } else if (entry.uri.endsWith(ENC_SUFFIX)) {
        out.push(entry.uri);
      }
      // .ttl, .acl, anything else → silently excluded per spec step 1.
    }
  }
  return out;
}

/**
 * Sign a manifest object using an `AgentIdentity`.  Returns a NEW
 * manifest object with the `signature` field set.  Idempotent: the
 * signing input excludes the signature triple itself.
 *
 * @param   {object} manifest
 * @param   {AgentIdentity} identity
 * @returns {object}
 */
export function signManifest(manifest, identity) {
  if (!(identity instanceof AgentIdentity)) {
    throw new Error('signManifest: identity must be an AgentIdentity');
  }
  const canonical = serializeManifest(manifest, { withoutSignature: true });
  const sigBytes  = identity.sign(canonical);
  return { ...manifest, signature: b64encode(sigBytes) };
}

/**
 * Verify a manifest signature against the embedded `rootDevicePubkey`.
 *
 * The pubkey is encoded base64url (matching `AgentIdentity.pubKey`).
 * Returns `true` on a valid signature, `false` otherwise.
 *
 * @param   {object} manifest
 * @returns {boolean}
 */
export function verifyManifestSignature(manifest) {
  if (typeof manifest?.signature !== 'string')        return false;
  if (typeof manifest?.rootDevicePubkey !== 'string') return false;
  const canonical = serializeManifest(manifest, { withoutSignature: true });
  try {
    const sig = b64decode(manifest.signature);
    return AgentIdentity.verify(canonical, sig, manifest.rootDevicePubkey);
  } catch {
    return false;
  }
}
