/**
 * Attachments — Stoop Phase 39 (2026-05-07); canonical-media
 * consolidation (media Phase 1 anti-drift tail, 2026-07-10).
 *
 * Server-side helpers for image attachments on prikbord posts and
 * 1:1 chat messages.  Storage shape: each attachment's full bytes
 * live as a separate blob in the bundle's `CachingDataSource` at
 *
 *   mem://stoop/items/<itemId>/attachments/<attId>.<ext>
 *
 * The Item record carries a canonical **`media` item**
 * (`@onderling/item-types` MEDIA_SCHEMA) per attachment — no bytes:
 *
 *   item.source.attachments = [
 *     { type: 'media', id, createdAt, createdBy,
 *       source: { type: 'stoop-att', ref: 'stoop-att://<itemId>/<attId>' },
 *       mime, width, height,            // canonical render hints
 *       bytes, thumbnail,               // stoop extras (forward-additive)
 *       ref }                           // LOCAL-ONLY cache path
 *   ]
 *
 * - `id` (ulid-shaped, `att-...`) — stable per-attachment identifier;
 *   also the filename stem.  Same key as the pre-consolidation shape,
 *   so mixed-version peers keep resolving attachments by id.
 * - `source` — the embeds-shaped `{type, ref}` storage pointer the
 *   media schema requires.  Stoop's ref convention is
 *   `stoop-att://<itemId>/<attId>`: install-independent (any stoop
 *   instance resolves it via the item's attachment list — local cache
 *   when the bytes are here, `requestAttachment` round-trip when not).
 *   NOT a local path, NOT a pod URL — safe on the wire.
 * - `mime` / `width` / `height` — canonical writer-asserted render
 *   hints (same keys as the legacy shape — old peers read them
 *   unchanged).
 * - `bytes` — size of the post-resize payload (informational; stoop
 *   extra, allowed by the schema's forward-additive policy).
 * - `thumbnail` — `data:image/jpeg;base64,...` (~3-8 KB after
 *   client-side resize to ~120px).  Travels in broadcasts.  UNSEALED
 *   today — see the sealing note below.
 * - `ref` — local cache path (sender) or absent (recipient that
 *   hasn't fetched the full bytes yet).  Recipients populate
 *   `ref` after a `requestAttachment` round-trip.
 *
 * **Privacy invariants** (per the project-wide rule
 * `Project Files/projects/README.md#personal-pod-urls-stay-out-of-peer-to-peer-messages`):
 *
 * - The `ref` field is local-only — NEVER goes on the wire.  The
 *   `toBroadcastShape()` helper strips it explicitly.  (`source.ref`
 *   — the stoop-att:// wire ref — DOES travel; it names the
 *   attachment, not a location.)
 * - Full bytes do NOT travel in broadcasts.  Recipients see the
 *   thumbnail; on click, they request the bytes from the original
 *   author over a 1:1 chat channel.  Bytes for chat messages DO
 *   travel inline (1:1, smaller, expected behaviour).
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
 * `@onderling/chat-p2p` plaintext `attachment-request`/`-response` handlers are
 * now structurally inert (stoop no longer injects `attachmentSupport`, and no
 * plaintext bytes exist to serve).
 */

import nacl from 'tweetnacl';
import { isBlobRef, bucketKeyFromRef, BLOB_TYPE } from '@onderling/blob-gateway';

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

/** Max prikbord attachments per item (web picker enforces too). */
export const MAX_ATTACHMENTS_PER_POST = 4;

/** Max bytes per prikbord attachment AFTER client-side resize. */
export const MAX_PRIKBORD_BYTES_PER_ATT = 600_000;     // ~600 KB

/** Max bytes per chat-message attachment AFTER client-side resize. */
export const MAX_CHAT_BYTES_PER_ATT = 250_000;         // ~250 KB

/** Allowed mime types. */
export const ALLOWED_MIMES = Object.freeze(new Set([
  'image/jpeg', 'image/png', 'image/webp',
]));

const MIME_TO_EXT = Object.freeze({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
});

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
 * Build the local cache path for an attachment.
 */
export function attachmentPath(itemId, attId, mime) {
  const ext = MIME_TO_EXT[mime];
  if (!ext) throw new Error(`Attachments: unsupported mime ${mime}`);
  return `mem://stoop/items/${itemId}/attachments/${attId}.${ext}`;
}

/* ── Canonical media wire-ref convention ──────────────────────
 * `stoop-att://<itemId>/<attId>` — the install-independent name of
 * an attachment.  Any stoop instance resolves it: locate the item,
 * find the attachment by id, then read the local cache (when `ref`
 * is present) or run the `requestAttachment` round-trip.  This is
 * the `source.ref` of the canonical media item; it replaces nothing
 * local (bytes stay at `attachmentPath(...)`) and leaks nothing
 * (no local path, no pod URL).
 * ────────────────────────────────────────────────────────────── */

/** `source.type` of a stoop-resolved media item. */
export const STOOP_ATT_REF_TYPE = 'stoop-att';

/** Ref scheme prefix — mirrors the type name. */
export const STOOP_ATT_REF_SCHEME = 'stoop-att://';

/** Build the wire ref for an attachment: `stoop-att://<itemId>/<attId>`. */
export function attachmentWireRef(itemId, attId) {
  if (!itemId || !attId) throw new Error('attachmentWireRef: itemId + attId required');
  return `${STOOP_ATT_REF_SCHEME}${itemId}/${attId}`;
}

/**
 * Parse a `stoop-att://<itemId>/<attId>` ref.  Returns
 * `{itemId, attId}` or null when the ref isn't ours.  attIds carry
 * no slashes (`att-<time>-<rand>`), so the LAST segment is the
 * attId and everything before it is the itemId.
 */
export function parseAttachmentWireRef(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(STOOP_ATT_REF_SCHEME)) return null;
  const rest = ref.slice(STOOP_ATT_REF_SCHEME.length);
  const cut = rest.lastIndexOf('/');
  if (cut <= 0 || cut === rest.length - 1) return null;
  return { itemId: rest.slice(0, cut), attId: rest.slice(cut + 1) };
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
 * Read attachment bytes from the local cache.  Returns base64 (so
 * it can travel in a chat envelope as a string).  null when the
 * blob isn't on this machine.
 */
export async function readAttachmentBytesB64({ dataSource, ref }) {
  const data = await dataSource.read(ref);
  if (data == null) return null;
  if (data instanceof Uint8Array) return _b64encode(data);
  if (typeof data === 'string') return data;       // already-encoded; legacy path
  return null;
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
 * Legacy records (a pre-seal peer's `stoop-att://` item, or the chat-p2p
 * substrate's receiver-built record) pass through in the legacy shape so a
 * mixed-version network still renders; stoop no longer MINTS that shape.
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
