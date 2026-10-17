/**
 * `media` type — a media item (images first; `mime` distinguishes
 * photo/video/audio later). Media Phase 1 (2026-07-09): the canonical
 * noun for "a picture in chat / on a card" that pinboard, basis and
 * folio can all point at.
 *
 * A media item does NOT carry bytes. Its `source` field is the storage
 * pointer: an embeds-shaped `{type, ref, enc?}` line per
 * docs/conventions/cross-pod-refs.md. blob-gateway's enriched manifest
 * line (`packages/blob-gateway/src/ref.js` — `{type:'blob',
 * ref:'blob://<key>', enc:{sealed, keyRef, format, bytes, mime?,
 * width?, height?, thumb?}}`) slots in UNCHANGED — this schema
 * composes with that line, it does not duplicate it: `enc` stays an
 * opaque object owned by blob-gateway. Non-blob refs (https://,
 * pseudo-pod://, urn:dec:item:) are equally valid `source.ref`s, so
 * pinboard's inline-bytes migration and pod-hosted files fit the same
 * noun.
 *
 * `mime` / `width` / `height` are writer-asserted passthrough hints
 * (layout reservation, renderer pick) — they are NOT verified against
 * the sealed bytes; renderers treat them as hints, not truth.
 */

import { BASE_PROPERTIES, BASE_REQUIRED, NAMESPACE } from '../baseSchema.js';

export const MEDIA_SCHEMA = {
  iri:         `${NAMESPACE}Media`,
  description: 'A media item (image first). source is the embeds-shaped storage pointer ({type, ref, enc?} — blob-gateway manifest lines slot in directly); mime/width/height are writer-asserted render hints.',
  type:        'object',
  required:    [...BASE_REQUIRED, 'source'],
  properties: {
    ...BASE_PROPERTIES,
    type:    { const: 'media' },
    source: {
      type:     'object',
      required: ['type', 'ref'],                     // the embeds-entry contract — a media item without a ref is rejected
      properties: {
        type: { type: 'string', minLength: 1 },      // e.g. 'blob' (blob-gateway) — any ref'd type allowed
        ref:  { type: 'string', minLength: 1 },      // 'blob://<key>' / 'https://…' / 'pseudo-pod://…' / 'urn:dec:item:…'
        enc:  { type: 'object' },                    // sealing metadata — opaque here; shape owned by blob-gateway ref.js
      },
      additionalProperties: true,                    // forward-compat, matching EMBEDS_SCHEMA entries
    },
    mime:    { type: 'string' },                     // writer-asserted, e.g. 'image/jpeg'
    width:   { type: 'integer', minimum: 1 },        // writer-asserted pixel dimensions
    height:  { type: 'integer', minimum: 1 },
    caption: { type: 'string' },
  },
};
