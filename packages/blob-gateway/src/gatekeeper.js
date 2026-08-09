// gatekeeper.js — the poortwachter (READ path).
//
//   createBlobGatekeeper({ verifyToken, acl, bucket, ttl }) -> gate(token, ref)
//     gate(token, ref) -> { url } | { denied }
//
// The bucket host is untrusted, so nobody gets the ciphertext without passing the gate:
//   1. verifyToken(token) -> { webId } | null   (a Solid-token check, INJECTED / duck-typed)
//   2. acl.canRead(webId, ref) -> bool          (pod ACL check, INJECTED)
//   3. bucket.presign(key, { ttl }) -> url      (short-lived URL to the *ciphertext*)
//
// DENY-BY-DEFAULT is the whole point:
//   • no token / invalid token / verifier returns null  -> { denied }
//   • acl.canRead false                                  -> { denied }
//   • a non-blob ref, or ANY thrown error anywhere       -> { denied }
// Only the happy path returns a URL. A denial never carries a URL — no leak.

import { bucketKeyFromRef } from './ref.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

// Parameter register (#36) — presigned ciphertext-URL TTL, seconds (scope:device, kind:internal).
const DEFAULT_TTL = param({ key: 'blobGateway.presignTtlSec', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60 }); // seconds — short-lived by default.

export function createBlobGatekeeper({ verifyToken, acl, bucket, ttl = DEFAULT_TTL } = {}) {
  if (typeof verifyToken !== 'function') {
    throw new Error('createBlobGatekeeper: verifyToken(token) => {webId}|null required');
  }
  if (!acl || typeof acl.canRead !== 'function') {
    throw new Error('createBlobGatekeeper: acl with canRead(webId, ref) required');
  }
  if (!bucket || typeof bucket.presign !== 'function') {
    throw new Error('createBlobGatekeeper: bucket with presign(key, {ttl}) required');
  }

  return async function gate(token, ref) {
    try {
      // 1. authenticate. No token or a null result denies.
      if (!token) return deny('no-token');
      const verified = await verifyToken(token);
      const webId = verified && verified.webId;
      if (!webId) return deny('invalid-token');

      // 2. authorize (deny-by-default). Only an explicit true opens the gate.
      const allowed = await acl.canRead(webId, ref);
      if (allowed !== true) return deny('acl');

      // 3. issue a short-lived presigned URL to the ciphertext.
      const key = bucketKeyFromRef(ref);
      const url = await bucket.presign(key, { ttl });
      if (!url) return deny('presign-failed');
      return { url };
    } catch (err) {
      // Any failure (bad ref, verifier throw, acl throw, presign throw) denies. Never leak.
      return deny('error', err);
    }
  };
}

function deny(reason, err) {
  const out = { denied: true, reason };
  if (err) out.message = err.message;
  return out;
}
