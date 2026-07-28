// @onderling/blob-gateway — media substrate (Objective S, first slice).
//
// Large media doesn't belong inline in a pod. Instead: the client ENCRYPTS the blob locally
// (reusing the `@onderling/pod-client/sealing` CEK-envelope — no new crypto), uploads the
// CIPHERTEXT to an untrusted object bucket, and writes only a small `embeds`-style manifest
// line into the pod (cross-pod-ref convention). To read it back, a deny-by-default
// poortwachter verifies a Solid token, checks the pod ACL, and issues a short-lived presigned
// URL to the ciphertext (the client decrypts locally). The host never sees plaintext.
//
// The manifest line can optionally carry media metadata (mime, width/height, an inline
// SEALED thumbnail) so a chat chip renders without fetching the blob — see ref.js /
// uploadBlob's `media` opts / openThumbnail.
//
// INJECTED contracts (cloud-agnostic, testable — no real S3/Solid required here):
//   bucket      = { put(key, bytes) => Promise, presign(key, {ttl}) => Promise<url>, delete(key) }
//   verifyToken = token => Promise<{ webId } | null>
//   acl         = { canRead(webId, ref) => Promise<bool> }
//   sealer      = text => sealedText   (makeSealer / makeGroupSealer from the sealing module)
//   opener      = sealedText => text   (makeOpener / makeGroupOpener — the read-side inverse)

export { uploadBlob, MAX_SEALED_THUMB_CHARS } from './uploadBlob.js';
export { openBlob, openThumbnail } from './openBlob.js';
export { createBlobGatekeeper } from './gatekeeper.js';
export {
  makeManifestLine, isBlobRef, bucketKeyFromRef, BLOB_SCHEME, BLOB_TYPE,
} from './ref.js';
export {
  bytesToB64u, b64uToBytes, randomKey,
} from './bytes.js';

// REAL adapters that satisfy the injected contracts (Objective S, second slice).
// Kept behind subpath exports so this core entry stays browser-safe (the S3 +
// Solid-verifier adapters use `node:crypto`):
//   • bucket      → '@onderling/blob-gateway/adapters/s3'                  createS3Bucket
//   • verifyToken → '@onderling/blob-gateway/adapters/capability-verifier' createCapabilityVerifier / anyVerifier
//                   (PRIMARY media-gate auth: Onderling capability tokens)
//   • verifyToken → '@onderling/blob-gateway/adapters/solid-verifier'      createSolidVerifier / createJwksVerifier
//                   (additional verifier: Solid-OIDC — compose via anyVerifier)
//   • acl         → '@onderling/blob-gateway/adapters/pod-acl'             createPodAcl
//   • HTTP edge   → '@onderling/blob-gateway/http'                         createHttpGate
