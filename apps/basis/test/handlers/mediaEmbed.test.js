/**
 * basis — sealed media embed round-trip (media Phase 1: the chat →
 * blob-gateway wiring, web slice).
 *
 * Full path under test, with the MEMORY bucket + a REAL sealer pair (group-key
 * mode — the circle posture; mirrors blob-gateway's own test rig):
 *
 *   pick (stub File) → /embed-file --pick → sealed uploadBlob → canonical
 *   `media` item (source = manifest line) → media-card embed with the
 *   `{type:'media', ref}` message-side pointer → chip renders the sealed
 *   inline thumbnail (happy-dom) → FULL image back via openBlob behind the
 *   deny-by-default gate.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeAll } from 'vitest';

import {
  generateGroupKey, makeGroupSealer, makeGroupOpener, isSealed,
} from '@onderling/pod-client/sealing';
import { openBlob, createBlobGatekeeper, isBlobRef } from '@onderling/blob-gateway';
import { validate } from '@onderling/item-types';
// blob-gateway's own test doubles (memory bucket + fake verifier/ACL) — the
// injected-contract rig; imported relatively, same as the package's tests use it.
import {
  makeMemoryBucket, makeVerifier, makeAcl,
} from '../../../../packages/blob-gateway/test/helpers.js';

import { createLocalBuiltins } from '../../src/core/localBuiltins.js';
import { createMediaEmbed, hasMediaGateway, isImageMime } from '../../src/core/handlers/mediaEmbed.js';
import { renderToDom } from '../../src/web/domAdapter.js';
import { initLocalisation, t } from '../../src/localisation.js';

beforeAll(async () => { await initLocalisation({ lng: 'en' }); });

/* ── rig ─────────────────────────────────────────────────────────────── */

const WEBID = 'https://anne.pod/profile/card#me';

const fullBytes  = () => new Uint8Array([255, 216, 255, 224, 0, 1, 2, 250, 251, 42, 7, 0]);   // "resized" image
const thumbBytes = () => new Uint8Array([255, 216, 255, 224, 9, 8, 7]);                        // tiny "thumbnail"

const b64 = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

/** Stub picked File — exercises the browser `arrayBuffer()` read path. */
function stubFile(bytes = fullBytes(), { name = 'photo.jpg', type = 'image/jpeg' } = {}) {
  return {
    name, type, size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

/** Stub web encoder — the shape src/v2/attachmentEncoder.encodeImageFile emits
 *  ({mime, dataB64, width, height, thumbnail: data-URL}). */
function stubEncodeImage({ bytes = fullBytes(), thumb = thumbBytes() } = {}) {
  return async () => ({
    mime: 'image/jpeg', dataB64: b64(bytes), width: 640, height: 480,
    thumbnail: `data:image/jpeg;base64,${b64(thumb)}`,
  });
}

/** A circle-style gateway: memory bucket + group-key sealer/opener. */
function makeGateway() {
  const groupKey = generateGroupKey();
  return {
    bucket: makeMemoryBucket(),
    sealer: makeGroupSealer(groupKey),
    opener: makeGroupOpener(groupKey),
    keyRef: 'urn:circle:test:group-key',
  };
}

function makeBuiltins(overrides = {}) {
  return createLocalBuiltins({
    catalogue: { opsById: new Map() }, t,
    localActor: WEBID,
    ...overrides,
  });
}

/* ── the round trip ──────────────────────────────────────────────────── */

describe('media round-trip — pick → sealed upload → pointer → chip → openBlob', () => {
  it('walks the full path with the memory bucket + a real group-key sealer pair', async () => {
    const gw = makeGateway();
    const encoded = fullBytes();
    const thumb   = thumbBytes();
    const builtins = makeBuiltins({
      openFilePicker: async () => stubFile(),
      mediaGateway:   gw,
      encodeImage:    stubEncodeImage({ bytes: encoded, thumb }),
    });

    // Bare /embed-file auto-picks; the image + wired gateway upgrade to media.
    const embed = await builtins['embed-file']({});
    expect(embed.ok).not.toBe(false);
    expect(embed.kind).toBe('media-card');
    expect(embed.appOrigin).toBe('basis');
    expect(embed.issuedBy).toBe(WEBID);

    // Message-side pointer — the DECIDED embeds-style attachment shape.
    expect(embed.pointer).toEqual({ type: 'media', ref: `urn:dec:item:${embed.itemRef.id}` });
    expect(embed.stored).toBe(false);   // no item-store seam wired → rides on the embed
    expect(embed.itemRef).toEqual({ app: 'basis', type: 'media', id: embed.snapshot.id });

    // The media item is canonical and holds the manifest line UNCHANGED.
    const item = embed.snapshot;
    expect(validate(item)).toEqual({ ok: true });
    expect(item.type).toBe('media');
    expect(item.createdBy).toBe(WEBID);
    expect(item).toMatchObject({ mime: 'image/jpeg', width: 640, height: 480 });
    const line = item.source;
    expect(line.type).toBe('blob');
    expect(isBlobRef(line.ref)).toBe(true);
    expect(line.enc).toMatchObject({
      sealed: true, keyRef: gw.keyRef, mime: 'image/jpeg', width: 640, height: 480,
    });
    expect(isSealed(line.enc.thumb)).toBe(true);

    // Sealed-only invariant: the bucket never holds plaintext, and neither the
    // line nor the bucket leaks the raw base64 of image or thumbnail.
    for (const stored of gw.bucket.store.values()) expect(isSealed(stored)).toBe(true);
    expect(JSON.stringify(line)).not.toContain(b64(encoded));
    expect(JSON.stringify(line)).not.toContain(b64(thumb));

    // Chip: sealed inline thumbnail → <img> (object-URL or data-URL), no gate/fetch.
    const el = renderToDom(
      { kind: 'embed-card', embed, messageId: 'm-1', lifecycleState: 'live' },
      { doc: document, media: { opener: gw.opener } },
    );
    expect(el.classList.contains('cc-media-card')).toBe(true);
    const img = el.querySelector('img.cc-media-thumb');
    expect(img).not.toBeNull();
    expect(img.src.length).toBeGreaterThan(0);
    expect(img.getAttribute('width')).toBe('640');
    expect(img.getAttribute('height')).toBe('480');

    // Full image: through the deny-by-default gate, byte-for-byte.
    const gate = createBlobGatekeeper({
      verifyToken: makeVerifier({ 'good-token': WEBID }),
      acl:         makeAcl([[WEBID, line.ref]]),
      bucket:      gw.bucket,
    });
    const opened = await openBlob({
      ref: line, gate, token: 'good-token', opener: gw.opener, fetch: gw.bucket.fetchPresigned,
    });
    expect(Array.from(opened.bytes)).toEqual(Array.from(encoded));
    expect(opened.media).toEqual({ mime: 'image/jpeg', width: 640, height: 480 });

    // …and the gate stays deny-by-default for everyone else.
    await expect(openBlob({
      ref: line, gate, token: 'bad-token', opener: gw.opener, fetch: gw.bucket.fetchPresigned,
    })).rejects.toThrow(/denied/);
  });

  it('without an encoder: raw file bytes upload, no thumbnail → placeholder chip', async () => {
    const gw = makeGateway();
    const raw = fullBytes();
    const builtins = makeBuiltins({
      openFilePicker: async () => stubFile(raw),
      mediaGateway:   gw,
      // no encodeImage — v1 note: raw bytes, no resize/thumb
    });
    const embed = await builtins['embed-file']({});
    expect(embed.kind).toBe('media-card');
    expect(embed.snapshot.source.enc.thumb).toBeUndefined();
    expect(embed.snapshot.mime).toBe('image/jpeg');
    expect(embed.snapshot.width).toBeUndefined();

    // Chip falls back to the mime placeholder (no thumb to open).
    const el = renderToDom(
      { kind: 'embed-card', embed, messageId: 'm-2', lifecycleState: 'live' },
      { doc: document, media: { opener: gw.opener } },
    );
    expect(el.querySelector('img.cc-media-thumb')).toBeNull();
    expect(el.querySelector('.cc-media-placeholder .cc-media-details').textContent)
      .toBe('image/jpeg');

    // Bytes still round-trip (raw, unresized).
    const gate = createBlobGatekeeper({
      verifyToken: makeVerifier({ tok: WEBID }),
      acl:         makeAcl([[WEBID, embed.snapshot.source.ref]]),
      bucket:      gw.bucket,
    });
    const opened = await openBlob({
      ref: embed.snapshot.source, gate, token: 'tok', opener: gw.opener, fetch: gw.bucket.fetchPresigned,
    });
    expect(Array.from(opened.bytes)).toEqual(Array.from(raw));
  });
});

/* ── the item-store seam (stored vs on-embed) ────────────────────────── */

describe('storeMediaItem seam', () => {
  const deps = (extra) => ({
    file: stubFile(), mediaGateway: makeGateway(), encodeImage: stubEncodeImage(),
    localActor: WEBID, t, ...extra,
  });

  it('stored: the seam persists the item and its ref becomes the pointer target', async () => {
    const seen = [];
    const embed = await createMediaEmbed({}, deps({
      storeMediaItem: async (item) => { seen.push(item); return { ref: `pseudo-pod://circle-1/media/${item.id}` }; },
    }));
    expect(embed.stored).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe('media');
    expect(embed.pointer).toEqual({ type: 'media', ref: `pseudo-pod://circle-1/media/${seen[0].id}` });
    expect(embed.snapshot).toEqual(seen[0]);   // snapshot still rides along for rendering
  });

  it('stored with no ref returned: falls back to the local urn:dec:item ref', async () => {
    const embed = await createMediaEmbed({}, deps({ storeMediaItem: async () => {} }));
    expect(embed.stored).toBe(true);
    expect(embed.pointer.ref).toBe(`urn:dec:item:${embed.snapshot.id}`);
  });

  it('a throwing store degrades honestly to on-embed (stored:false), not an error', async () => {
    const embed = await createMediaEmbed({}, deps({
      storeMediaItem: async () => { throw new Error('pod offline'); },
    }));
    expect(embed.ok).not.toBe(false);
    expect(embed.stored).toBe(false);
    expect(embed.pointer.ref).toBe(`urn:dec:item:${embed.snapshot.id}`);
  });

  it('caption arg lands on the media item', async () => {
    const embed = await createMediaEmbed({ caption: 'de kat' }, deps({}));
    expect(embed.snapshot.caption).toBe('de kat');
    expect(validate(embed.snapshot)).toEqual({ ok: true });
  });
});

/* ── upgrade gating: when the sealed path does NOT engage ────────────── */

describe('embed-file upgrade gating (no fork — legacy paths intact)', () => {
  it('no mediaGateway → the legacy inline file-card path, byte-identical behaviour', async () => {
    const builtins = makeBuiltins({
      openFilePicker: async () => ({ name: 'photo.jpg', type: 'image/jpeg', size: 3, dataB64: 'AAEC' }),
      // no mediaGateway
    });
    const embed = await builtins['embed-file']({});
    expect(embed.kind).toBe('file-card');
    expect(embed.appOrigin).toBe('folio');
    expect(embed.snapshot.dataB64).toBe('AAEC');
  });

  it('a non-image keeps the file-card path even WITH the gateway wired', async () => {
    const gw = makeGateway();
    const builtins = makeBuiltins({
      openFilePicker: async () => ({ name: 'notes.pdf', type: 'application/pdf', size: 3, dataB64: 'AAEC' }),
      mediaGateway: gw,
    });
    const embed = await builtins['embed-file']({});
    expect(embed.kind).toBe('file-card');
    expect(gw.bucket.store.size).toBe(0);   // nothing touched the bucket
  });

  it('cancelled picker still reports via the existing embed-file key', async () => {
    const builtins = makeBuiltins({
      openFilePicker: async () => null,
      mediaGateway: makeGateway(),
    });
    const r = await builtins['embed-file']({});
    expect(r.ok).toBe(false);
    expect(r.error).toBe(t('embed-file.pick_cancelled'));
  });

  it('hasMediaGateway / isImageMime gate exactly on the seams uploadBlob needs', () => {
    expect(hasMediaGateway(undefined)).toBe(false);
    expect(hasMediaGateway({ bucket: {}, sealer: () => '' })).toBe(false);        // bucket.put missing
    expect(hasMediaGateway({ bucket: { put: async () => {} } })).toBe(false);      // sealer missing
    expect(hasMediaGateway({ bucket: { put: async () => {} }, sealer: () => '' })).toBe(true);
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('application/pdf')).toBe(false);
    expect(isImageMime(undefined)).toBe(false);
  });
});

/* ── error paths (locale keys resolve, invariants hold) ──────────────── */

describe('createMediaEmbed error paths', () => {
  it('refuses without the gateway seams (no inline-bytes fallback in v1)', async () => {
    const r = await createMediaEmbed({}, { file: stubFile(), localActor: WEBID, t });
    expect(r.ok).toBe(false);
    expect(r.error).toBe(t('media.no_gateway'));
    expect(r.error).not.toBe('media.no_gateway');   // the key resolves to a real string
  });

  it('a plaintext (non-sealing) sealer is refused by uploadBlob and surfaced', async () => {
    const gw = { ...makeGateway(), sealer: (text) => text };   // NOT an envelope
    const r = await createMediaEmbed({}, {
      file: stubFile(), mediaGateway: gw, encodeImage: stubEncodeImage(), localActor: WEBID, t,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain(t('media.upload_failed', { error: '' }).replace(':', '').trim().split(' ')[0]);
    expect(r.error).toMatch(/plaintext/);
  });

  it('an unreadable file reports media.read_failed', async () => {
    const r = await createMediaEmbed({}, {
      file: { name: 'x.jpg', type: 'image/jpeg' },   // no dataB64, no arrayBuffer
      mediaGateway: makeGateway(), localActor: WEBID, t,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unreadable file/);
  });

  it('a failing encoder falls back to raw bytes instead of erroring', async () => {
    const gw = makeGateway();
    const raw = fullBytes();
    const embed = await createMediaEmbed({}, {
      file: stubFile(raw), mediaGateway: gw,
      encodeImage: async () => { throw new Error('no canvas here'); },
      localActor: WEBID, t,
    });
    expect(embed.ok).not.toBe(false);
    expect(embed.kind).toBe('media-card');
    expect(embed.snapshot.source.enc.thumb).toBeUndefined();
  });

  it('RN-style picked file (dataB64, no arrayBuffer) uploads fine', async () => {
    const raw = fullBytes();
    const embed = await createMediaEmbed({}, {
      file: { name: 'p.jpg', mime: 'image/jpeg', dataB64: b64(raw) },
      mediaGateway: makeGateway(), localActor: WEBID, t,
    });
    expect(embed.kind).toBe('media-card');
    expect(embed.snapshot.mime).toBe('image/jpeg');
  });
});

/* ── renderer: enc hints win over top-level (decided) ────────────────── */

describe('media-card chip — enc hints beat top-level hints', () => {
  it('placeholder shows the enc values when the two disagree', () => {
    const embed = {
      kind: 'media-card', appOrigin: 'basis',
      itemRef: { app: 'basis', type: 'media', id: 'media-x' },
      pointer: { type: 'media', ref: 'urn:dec:item:media-x' },
      snapshot: {
        type: 'media', id: 'media-x', createdAt: new Date().toISOString(), createdBy: WEBID,
        mime: 'image/png', width: 100, height: 100,                       // top-level (stale)
        source: { type: 'blob', ref: 'blob://k1', enc: { sealed: true, keyRef: null, format: 'fp1', bytes: 9, mime: 'image/jpeg', width: 640, height: 480 } },
      },
      issuedBy: WEBID,
    };
    const el = renderToDom(
      { kind: 'embed-card', embed, messageId: 'm-3', lifecycleState: 'live' },
      { doc: document },   // no opener → placeholder
    );
    expect(el.querySelector('.cc-media-details').textContent).toBe('image/jpeg · 640×480');
  });

  it('caption renders under the chip', () => {
    const embed = {
      kind: 'media-card', appOrigin: 'basis',
      itemRef: { app: 'basis', type: 'media', id: 'media-y' },
      pointer: { type: 'media', ref: 'urn:dec:item:media-y' },
      snapshot: {
        type: 'media', id: 'media-y', createdAt: new Date().toISOString(), createdBy: WEBID,
        caption: 'zonsondergang', source: { type: 'blob', ref: 'blob://k2' },
      },
      issuedBy: WEBID,
    };
    const el = renderToDom({ kind: 'embed-card', embed, messageId: 'm-4', lifecycleState: 'live' }, { doc: document });
    expect(el.querySelector('.cc-media-caption').textContent).toBe('zonsondergang');
  });
});
