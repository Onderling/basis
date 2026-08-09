/**
 * Media mobile twin (2026-07) — the media-card render MODEL.
 *
 * Mirrors web's `renderMediaCard` (apps/basis/src/web/domAdapter.js)
 * as a pure model so the RN bubble stays a dumb projector and the
 * behaviour is testable at the model level (mobile convention — Vitest
 * can't render RN components):
 *
 *   - chip = `openThumbnail(line, opener)` FIRST — the sealed inline
 *     thumbnail ships in the manifest line itself (no gate, no fetch);
 *   - fallback = the mime/dims placeholder (`details`);
 *   - when the line's `enc` hints and the item's top-level hints
 *     disagree, `enc` WINS (decided: the enc fields were written at
 *     upload time, next to the bytes).
 *
 * RN has no object-URLs/Blob, so the thumbnail lands as a base64
 * data-URL for `<Image source={{uri}}>`.  The FULL image (openBlob
 * behind the deny-by-default gate) is a later affordance — the model
 * already carries the line it will need (`embed.snapshot.source`).
 */
import { openThumbnail } from '@onderling/blob-gateway';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** Display box the thumb scales into (longest edge, RN dp). */
// Parameter register (#36) — thumbnail max edge (scope:device, kind:internal render cap).
const THUMB_MAX_EDGE = param({ key: 'basisMobile.thumbMaxEdge', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 220 });

/** Uint8Array → standard base64 (chunked — a big spread/apply would
 *  blow the arg limit; Hermes ships atob/btoa). */
export function bytesToStdB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Fit the (full-image) hint dims into the thumb display box, keeping
 *  aspect.  No usable hints → a square default. */
export function fitThumbBox(width, height, maxEdge = THUMB_MAX_EDGE) {
  if (!(width > 0) || !(height > 0)) return { width: 120, height: 120 };
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Build the view model for a `media-card` embed.
 *
 * @param {object} embed            the media-card embed (snapshot = media item)
 * @param {object} [deps]
 * @param {function} [deps.opener]  sealing opener (sealedText => text) —
 *                                  absent/failing → placeholder chip
 * @returns {{thumbUri: string|null, mime: string|null, width: number|null,
 *            height: number|null, details: string, caption: string|null,
 *            alt: string, thumbBox: {width: number, height: number}}}
 */
export function buildMediaCardModel(embed, { opener } = {}) {
  const snap = embed?.snapshot ?? {};
  const line = (snap.source && typeof snap.source === 'object') ? snap.source : null;
  const enc  = line?.enc ?? {};
  // enc-wins (decided) — both are writer-asserted layout hints, not truth.
  const mime   = enc.mime   ?? snap.mime;
  const width  = enc.width  ?? snap.width;
  const height = enc.height ?? snap.height;

  let thumbUri = null;
  if (line && typeof opener === 'function') {
    try {
      const bytes = openThumbnail({ ref: line, opener });
      if (bytes && bytes.length > 0) {
        thumbUri = `data:${mime || 'application/octet-stream'};base64,${bytesToStdB64(bytes)}`;
      }
    } catch { thumbUri = null; /* wrong key / plaintext-refused thumb → placeholder */ }
  }

  const details = [];
  if (typeof mime === 'string') details.push(mime);
  if (width != null && height != null) details.push(`${width}×${height}`);

  return {
    thumbUri,
    mime:     mime ?? null,
    width:    width ?? null,
    height:   height ?? null,
    details:  details.join(' · ') || 'media',
    caption:  (typeof snap.caption === 'string' && snap.caption !== '') ? snap.caption : null,
    alt:      snap.caption || mime || 'media',
    thumbBox: fitThumbBox(width, height),
  };
}
