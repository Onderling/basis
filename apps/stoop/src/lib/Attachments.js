/**
 * Attachments — Stoop Phase 39 (2026-05-07); canonical-media
 * consolidation (media Phase 1 anti-drift tail, 2026-07-10).
 *
 * Helpers for image attachments on noticeboard posts and 1:1 chat
 * messages.  The Item record carries one canonical **`media` item**
 * (`@onderling/item-types` MEDIA_SCHEMA) per attachment — no bytes:
 *
 *   item.source.attachments = [
 *     { type: 'media', id, createdAt, createdBy,
 *       source: { type: 'blob', ref: 'blob://<key>', enc: { sealed: true, …, thumb } },
 *       mime, width, height }           // canonical render hints
 *   ]
 *
 * **Privacy invariants** (per the project-wide rule
 * `Project Files/projects/README.md#personal-pod-urls-stay-out-of-peer-to-peer-messages`):
 *
 * - No plaintext bytes, `data:` thumbnail or local cache `ref` ever goes on
 *   the wire; `toBroadcastShape()` strips them defensively.
 * - Full bytes never travel in chat or broadcasts.  Recipients open the sealed
 *   thumbnail and the full image through their own circle media gateway.
 *
 * **Sealing status (2026-07-11 — sealed-media):** DONE.  Stoop image
 * attachments are now SEALED end to end, via the SAME per-circle path
 * basis's own circle images use.  Stoop stays key-agnostic: the
 * per-circle stoop wrapper (`apps/basis/src/v2/circleStoopScope.js`,
 * `scopeStoopCallSkill`) seals each picked image's bytes + thumbnail through
 * the circle media gateway (`@onderling/blob-gateway` `uploadBlob`, mirroring
 * `core/handlers/mediaEmbed.js`) BEFORE it reaches stoop, and hands stoop an
 * opaque canonical `media` item whose `source` IS the blob manifest line
 * (`{type:'blob', ref:'blob://<key>', enc:{sealed:true,…,thumb}}`).  Stoop
 * only carries/stores that pointer — it never decodes, persists, or serves
 * plaintext bytes, and the old inline-`dataB64` path is REMOVED
 * (`validateInboundAttachment` refuses it).  Recipients open the sealed inline
 * thumbnail (`openThumbnail`) + the full image (`openBlob`, gated) through
 * their own circle media gateway — the sealing key stays out of stoop.  The
 * older plaintext fetch route (the author answering an `attachment-request`
 * over chat with base64 bytes, plus the `requestAttachment` /
 * `getAttachmentDataUrl` skills and the local-cache path helpers it needed)
 * was superseded by this sealed path and removed on 2026-10-07.
 */

import nacl from 'tweetnacl';
import { isBlobRef, bucketKeyFromRef, BLOB_TYPE } from '@onderling/blob-gateway';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Tiny standard-base64 helpers (NOT base64url — attachments are
// runtime payloads, not URL components).  Browser uses btoa/atob;
// node falls back to Buffer.
function _b64encode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return (typeof btoa === 'function')
    ? btoa(bin)
    : Buffer.from(bytes).toString('base64');
}
// (_b64decode removed with the plaintext path — stoop no longer decodes attachment bytes.)

// Parameter register (#36) — attachment count + byte caps (scope:device, kind:internal).
/** Max noticeboard attachments per item (web picker enforces too). */
export const MAX_ATTACHMENTS_PER_POST = param({ key: 'stoop.maxAttachmentsPerPost', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 4 });

/** Max bytes per noticeboard attachment AFTER client-side resize. */
export const MAX_NOTICEBOARD_BYTES_PER_ATT = param({ key: 'attachment.maxNoticeboardBytesPerAtt', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 600_000 });     // ~600 KB

/** Allowed mime types. */
export const ALLOWED_MIMES = Object.freeze(new Set([
  'image/jpeg', 'image/png', 'image/webp',
]));

/**
 * Generate a fresh attachment id.  ULID-ish: time-prefixed +
 * randomness.  Short enough to fit in a path segment.
 */
export function freshAttachmentId() {
  const time = Date.now().toString(36).padStart(9, '0');
  const rand = _b64encode(nacl.randomBytes(6))
    .replace(/[+/=]/g, '').slice(0, 8);
  return `att-${time}-${rand}`;
}

/**
 * Validate a single inbound attachment — SEALED-ONLY (2026-07-11 sealed-media).
 *
 * Stoop is now key-agnostic: the caller (basis's per-circle stoop wrapper,
 * `scopeStoopCallSkill`) seals the bytes + thumbnail through the circle media
 * gateway and hands stoop an OPAQUE canonical `media` item whose `source` is a
 * blob-gateway manifest line (`{type:'blob', ref:'blob://…', enc:{sealed:true,…,
 * thumb}}`).  Stoop only carries/stores that pointer; it never sees plaintext.
 *
 * So this validator REFUSES the old inline-plaintext shape (`dataB64` +
 * `data:image` thumbnail) outright and requires the sealed blob pointer.  This
 * is the structural guard that the removed inline path can't come back.
 *
 * Returns null on success, an error string on failure.
 */
export function validateInboundAttachment(att) {
  if (!att || typeof att !== 'object') return 'attachment-not-object';
  // Sealed-only: plaintext bytes / data: thumbnails are refused (the inline path is gone).
  if (att.dataB64 != null) return 'attachment-plaintext-refused';
  if (typeof att.thumbnail === 'string' && att.thumbnail.startsWith('data:')) {
    return 'attachment-plaintext-thumbnail-refused';
  }
  if (att.type !== 'media') return 'attachment-not-media';
  const src = att.source;
  if (!src || typeof src !== 'object') return 'attachment-source-missing';
  // The blob-ref grammar lives in ONE place (`@onderling/blob-gateway`), not in a literal here. This used
  // to be a hand-rolled `startsWith('blob://')`, which also admitted a bare `blob://` with NO bucket key —
  // a ref the reader can never open, stored happily by the writer and failing opaquely at read time.
  // `bucketKeyFromRef` is the strict form: it throws on exactly that.
  if (src.type !== BLOB_TYPE || typeof src.ref !== 'string' || !isBlobRef(src.ref)) {
    return 'attachment-not-sealed-blob';
  }
  try { bucketKeyFromRef(src.ref); } catch { return 'attachment-not-sealed-blob'; }
  if (!src.enc || src.enc.sealed !== true) return 'attachment-not-sealed';
  if (!ALLOWED_MIMES.has(att.mime)) return `attachment-mime-not-allowed:${att.mime}`;
  return null;
}

/**
 * Normalize an inbound SEALED attachment for storage on the item's
 * `source.attachments`.  NO bytes are decoded and NOTHING is written to a
 * local cache — the ciphertext already lives in the circle media gateway's
 * bucket; stoop keeps only the opaque manifest-line pointer.
 *
 * `actor` becomes the media item's `createdBy` (the post author's webid —
 * already public on the broadcast, so no new exposure).  Any stray local-only
 * or plaintext field (`dataB64` / local cache `ref` / a `data:` `thumbnail`)
 * is defensively stripped so it can never reach the item record or the wire.
 *
 * (Kept async + name-compatible with the pre-seal call site; `dataSource`/
 * `itemId` args are accepted-and-ignored so callers don't churn.)
 */
export async function persistInboundAttachment({ att, actor } = {}) {
  const {
    dataB64: _dataB64, ref: _localRef, thumbnail: _thumb, ...rest
  } = att ?? {};
  return {
    ...rest,
    // ── canonical media item (BASE_REQUIRED + source) ──
    type:      'media',
    id:        att?.id || freshAttachmentId(),
    createdAt: att?.createdAt || new Date().toISOString(),
    createdBy: typeof actor === 'string' && actor ? actor : (att?.createdBy || 'stoop:unknown'),
    source:    att?.source,          // {type:'blob', ref:'blob://…', enc:{sealed:true,…,thumb}}
    mime:      att?.mime,
    ...(att?.width  != null ? { width:  att.width }  : {}),
    ...(att?.height != null ? { height: att.height } : {}),
  };
}

/**
 * Project an attachment onto its WIRE shape (broadcasts + chat envelopes).
 *
 * SEALED media pointer (the only shape stoop now produces): carry the opaque
 * canonical `media` item — including the full manifest line `source.enc`, which
 * holds the SEALED inline thumbnail (`enc.thumb`) + the blob ref the recipient
 * opens through its own circle media gateway.  There is NO plaintext to strip:
 * a sealed item never carries `dataB64` or a `data:image` `thumbnail`, and there
 * is no local cache `ref` (the bytes live in the gateway bucket, not in stoop).
 * A defensive strip below drops any of those anyway — belt and braces.
 *
 * Legacy records (a pre-seal peer's `stoop-att://` item) pass through in the
 * legacy shape so a mixed-version network still renders; stoop no longer MINTS
 * that shape.
 */
export function toWireShape(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  // Sealed media pointer — carry the opaque line, never plaintext / local ref.
  if (attachment.type === 'media' && attachment.source && attachment.source.type === 'blob') {
    return {
      type:      'media',
      id:        attachment.id,
      createdAt: attachment.createdAt,
      createdBy: attachment.createdBy,
      source:    attachment.source,          // {type:'blob', ref, enc:{sealed:true,…,thumb}}
      mime:      attachment.mime,
      ...(attachment.width  != null ? { width:  attachment.width }  : {}),
      ...(attachment.height != null ? { height: attachment.height } : {}),
    };
  }
  // Legacy interop (never freshly minted by stoop): strip the local `ref`/`dataB64`.
  const wire = {
    id:        attachment.id,
    mime:      attachment.mime,
    bytes:     attachment.bytes,
    width:     attachment.width,
    height:    attachment.height,
    thumbnail: attachment.thumbnail,
  };
  if (attachment.type === 'media' && attachment.source && attachment.source.ref) {
    wire.type      = 'media';
    wire.createdAt = attachment.createdAt;
    wire.createdBy = attachment.createdBy;
    wire.source    = { type: attachment.source.type, ref: attachment.source.ref };
  }
  return wire;
}

/**
 * Strip local-only fields from an array of attachments (broadcast
 * shape).  Returns [] for falsy input.
 */
export function toBroadcastShape(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.map(toWireShape).filter(Boolean);
}
