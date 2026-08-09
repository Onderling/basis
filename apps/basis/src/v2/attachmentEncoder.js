/**
 * attachmentEncoder — S5 client-side image attachment encoder (web).
 *
 * Turns a user-picked image File into the inbound-attachment shape stoop's
 * `postRequest` expects (and `validateInboundAttachment` checks):
 *
 *   { mime, dataB64, width, height, thumbnail }
 *
 * - resizes the full image to fit `maxDim` (keeps it under the prikbord byte
 *   cap) and re-encodes as JPEG/PNG/WebP,
 * - generates a ~120px JPEG `thumbnail` data-URL (this is what travels in the
 *   broadcast; full bytes are fetched on demand),
 * - reports the post-resize pixel `width`/`height` for layout-without-decode.
 *
 * The browser primitives (Image decode + Canvas) are injected (`loadImage`,
 * `makeCanvas`) so the geometry + plumbing are unit-testable with fakes; the
 * real Canvas round-trip is exercised in a browser. Mirrors the byte caps in
 * `apps/stoop/src/lib/Attachments.js` (kept in sync by value, not import, to
 * avoid an app→app dependency).
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — attachment size/dimension caps (scope:device, kind:internal — safety bounds).
// `param()` returns each existing default. NOTE the by-value mirror below is a known duplication with
// stoop's Attachments.MAX_PRIKBORD_BYTES_PER_ATT (app→app import is forbidden); unifying both on the shared
// `attachment.maxPrikbordBytesPerAtt` key is a follow-up once the register is read at runtime (L24).
export const MAX_PRIKBORD_BYTES_PER_ATT = param({ key: 'attachment.maxPrikbordBytesPerAtt', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 600_000 });     // mirror Attachments.MAX_PRIKBORD_BYTES_PER_ATT
export const ALLOWED_MIMES = Object.freeze(new Set(['image/jpeg', 'image/png', 'image/webp']));
const THUMB_DIM = param({ key: 'attachment.thumbDim', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 120 });
const DEFAULT_MAX_DIM = param({ key: 'attachment.maxImageDim', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 1280 });

/** Scale (w,h) to fit inside a `maxDim` box, preserving aspect ratio. Pure. */
export function fitDimensions(w, h, maxDim) {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const longest = Math.max(w, h);
  if (longest <= maxDim) return { width: Math.round(w), height: Math.round(h) };
  const scale = maxDim / longest;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Strip the `data:<mime>;base64,` prefix → the raw base64 payload. Pure. */
export function dataUrlToB64(dataUrl) {
  if (typeof dataUrl !== 'string') return '';
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Choose the output mime: keep png/webp; everything else (incl. jpeg) → jpeg. */
export function outputMimeFor(inputMime) {
  if (inputMime === 'image/png' || inputMime === 'image/webp') return inputMime;
  return 'image/jpeg';
}

function defaultLoadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ drawable: img, width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e instanceof Error ? e : new Error('image-decode-failed')); };
    img.src = url;
  });
}

function defaultMakeCanvas(width, height) {
  const canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
  if (!canvas) throw new Error('canvas-unavailable');
  canvas.width = width; canvas.height = height;
  return canvas;
}

/**
 * Encode a File into the inbound-attachment record. Rejects unsupported mimes.
 * Returns null for a non-File input.
 *
 * @param {File}   file
 * @param {object} [opts]
 * @param {number} [opts.maxDim=1280]      longest-edge cap for the full image
 * @param {number} [opts.maxBytes]         hard byte cap (re-encodes down to fit)
 * @param {Function}[opts.loadImage]       (file) => {drawable,width,height}
 * @param {Function}[opts.makeCanvas]      (w,h) => HTMLCanvasElement-like
 */
export async function encodeImageFile(file, {
  maxDim = DEFAULT_MAX_DIM,
  maxBytes = MAX_PRIKBORD_BYTES_PER_ATT,
  loadImage = defaultLoadImage,
  makeCanvas = defaultMakeCanvas,
} = {}) {
  if (!file || typeof file !== 'object') return null;
  const inputMime = file.type || 'image/jpeg';
  if (!ALLOWED_MIMES.has(inputMime)) throw new Error(`attachment-mime-not-allowed:${inputMime}`);
  const mime = outputMimeFor(inputMime);

  const src = await loadImage(file);
  const { width, height } = fitDimensions(src.width, src.height, maxDim);
  if (!width || !height) throw new Error('attachment-empty-image');

  const draw = (w, h) => {
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas-2d-unavailable');
    ctx.drawImage(src.drawable, 0, 0, w, h);
    return canvas;
  };

  // Full image — re-encode, dropping JPEG quality until it fits the byte cap.
  let dataUrl = '';
  const full = draw(width, height);
  const qualities = mime === 'image/png' ? [undefined] : [0.85, 0.7, 0.55, 0.4];
  for (const q of qualities) {
    dataUrl = full.toDataURL(mime, q);
    if (dataUrlToB64(dataUrl).length * 0.75 <= maxBytes) break;
  }

  // Thumbnail — always JPEG, ~120px, for the broadcast payload.
  const thumbDims = fitDimensions(width, height, THUMB_DIM);
  const thumbCanvas = draw(thumbDims.width, thumbDims.height);
  const thumbnail = thumbCanvas.toDataURL('image/jpeg', 0.6);

  return { mime, dataB64: dataUrlToB64(dataUrl), width, height, thumbnail };
}
