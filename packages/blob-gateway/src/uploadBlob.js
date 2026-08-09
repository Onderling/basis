// uploadBlob.js — the client-side UPLOAD path.
//
//   uploadBlob({ bytes, bucket, sealer, keyRef, media? }) -> { ref, manifestLine, key, ciphertext }
//
// Flow (all client-side; the host never sees plaintext):
//   1. bytes -> base64url string          (binary carried through the string-sealing envelope)
//   2. sealer(b64uString) -> ciphertext   (injected sealing: makeSealer / makeGroupSealer from
//                                           @onderling/pod-client/sealing — the same CEK-envelope
//                                           used elsewhere; blob-gateway adds NO new crypto)
//   3. bucket.put(key, ciphertext)        (the untrusted bucket stores ONLY the sealed envelope)
//   4. return an `embeds`-style manifest line pointing at the bucket key + sealing metadata
//
// The caller writes `manifestLine` into their pod item's `embeds` array. The blob bytes never
// touch the pod and never reach the bucket in plaintext.
//
// Optional `media` opts enrich the manifest line so a chat chip can render WITHOUT fetching
// the blob: { mime, width, height, thumbnail }. `thumbnail` is small raw bytes (Uint8Array)
// or a base64/base64url string (the RN picker emits `thumbnail.dataB64` — pass it directly).
// The thumbnail is SEALED with the same injected sealer before it enters the manifest line
// (sealed-only applies to thumbnails too — they are content), and the SEALED size is capped
// at MAX_SEALED_THUMB_CHARS: an inline thumbnail that big defeats its purpose.

import { isSealed } from '@onderling/pod-client/sealing';
import { bytesToB64u, b64uToBytes, randomKey } from './bytes.js';
import { makeManifestLine } from './ref.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

/** Ceiling on the SEALED thumbnail envelope carried inline in a manifest line (ascii chars,
 *  which is bytes for the envelope). ~48KB — beyond that, fetch the blob instead. */
// Parameter register (#36) — inline sealed-thumbnail envelope ceiling (scope:device, kind:internal).
export const MAX_SEALED_THUMB_CHARS = param({ key: 'blobGateway.sealedThumbMaxChars', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 48 * 1024 });

export async function uploadBlob({ bytes, bucket, sealer, keyRef, key, media }) {
  if (!bytes) throw new Error('uploadBlob: bytes required');
  if (!bucket || typeof bucket.put !== 'function') {
    throw new Error('uploadBlob: bucket with put(key, bytes) required');
  }
  if (typeof sealer !== 'function') {
    throw new Error('uploadBlob: sealer (text => sealedText) required');
  }

  // 1 + 2: client-side encrypt. Seal the base64url of the raw bytes.
  const ciphertext = sealer(bytesToB64u(bytes));
  if (!isSealed(ciphertext)) {
    // Guard the core invariant: what we hand the bucket MUST be a sealing envelope.
    throw new Error('uploadBlob: sealer did not return a sealed envelope (refusing to upload plaintext)');
  }

  // Media enrichment (optional): seal the thumbnail with the SAME sealer and enforce the
  // inline ceiling BEFORE touching the bucket, so a rejected upload leaves nothing behind.
  const enrich = sealMedia(media, sealer);

  // 3: upload ciphertext to the untrusted bucket under an opaque, random key.
  const bucketKey = key || randomKey();
  await bucket.put(bucketKey, ciphertext);

  // 4: the pod-side manifest line (cross-pod-ref shape).
  const manifestLine = makeManifestLine({
    key: bucketKey,
    keyRef,
    bytes: ciphertext.length,
    ...enrich,
  });

  return { ref: manifestLine.ref, manifestLine, key: bucketKey, ciphertext };
}

/** Normalize + seal the optional media opts into manifest-line fields ({mime, width,
 *  height, thumb}). Absent opts stay absent — a media-less call yields no fields at all,
 *  keeping the line byte-identical to the pre-enrichment shape. */
function sealMedia(media, sealer) {
  if (!media) return {};
  const { mime, width, height, thumbnail } = media;
  const out = {};
  if (mime != null) out.mime = mime;
  if (width != null) out.width = width;
  if (height != null) out.height = height;
  if (thumbnail != null) {
    // Accept raw bytes (Uint8Array) or a base64/base64url string (RN picker's `dataB64`).
    const thumbBytes = typeof thumbnail === 'string' ? b64uToBytes(thumbnail) : thumbnail;
    const thumb = sealer(bytesToB64u(thumbBytes));
    if (!isSealed(thumb)) {
      // Same invariant as the blob itself: only sealed content leaves the client.
      throw new Error('uploadBlob: sealer did not return a sealed envelope for the thumbnail (refusing plaintext thumbnail)');
    }
    if (thumb.length > MAX_SEALED_THUMB_CHARS) {
      throw new Error(
        `uploadBlob: sealed thumbnail too large (${thumb.length} > ${MAX_SEALED_THUMB_CHARS} chars) — an inline thumbnail that big defeats its purpose`,
      );
    }
    out.thumb = thumb;
  }
  return out;
}
