/**
 * Media mobile twin — the RN picker → createMediaEmbed round trip
 * through mobile's hostOps composition, mirroring the web slice's
 * test (apps/basis/test/handlers/mediaEmbed.test.js) with the
 * MEMORY bucket + a REAL group-key sealer pair:
 *
 *   pickAndResize shape ({mime, dataB64, width, height, thumbnail})
 *     → /embed-file (media-picker instance) → sealed uploadBlob
 *     → canonical `media` item (source = manifest line)
 *     → media-card embed + {type:'media', ref} pointer
 *     → RN chip model opens the sealed inline thumbnail
 *     → FULL image back via openBlob behind the deny-by-default gate.
 *
 * Plus the composition pins:
 *   - the identity-shaped encodeImage adapter (no re-encode on RN —
 *     pickAndResize already resized + thumbnailed)
 *   - /send-file keeps the DOCUMENT picker even when media is wired
 *   - honest degradation, identical to web: no gateway / no sealer in
 *     reach ⇒ legacy inline file-card, NOTHING touches any bucket.
 */
import { describe, it, expect } from 'vitest';

import {
  generateGroupKey, makeGroupSealer, makeGroupOpener, isSealed,
} from '@onderling/pod-client/sealing';
import { validate } from '@onderling/item-types';
// blob-gateway imported relatively (Metro/package-exports gotcha — same
// route the web test takes for the shared test doubles).
import {
  openBlob, createBlobGatekeeper, isBlobRef,
} from '../../../packages/blob-gateway/src/index.js';
import {
  makeMemoryBucket, makeVerifier, makeAcl,
} from '../../../packages/blob-gateway/test/helpers.js';

import { buildMobileLocalBuiltins } from '../src/core/hostOps.js';
import {
  pickedImageToFile, openMediaFilePicker, encodePickedImage,
} from '../src/core/mediaPicker.js';
import { buildMediaCardModel } from '../src/core/mediaCardModel.js';
import {
  createInitialThreadState, __resetThreadIdSeq,
} from '../src/core/threadState.js';

const t = (key, params = {}) => {
  const tail = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(' ');
  return tail ? `[${key}](${tail})` : `[${key}]`;
};

const WEBID = 'https://anne.pod/profile/card#me';

const fullBytes  = () => new Uint8Array([255, 216, 255, 224, 0, 1, 2, 250, 251, 42, 7, 0]);
const thumbBytes = () => new Uint8Array([255, 216, 255, 224, 9, 8, 7]);

const b64 = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

/** The EXACT shape `@onderling/react-native/picker` pickAndResize emits. */
function pickedImage({ full = fullBytes(), thumb = thumbBytes() } = {}) {
  return {
    mime:      'image/jpeg',
    width:     640,
    height:    480,
    dataB64:   b64(full),
    bytes:     full.length,
    thumbnail: `data:image/jpeg;base64,${b64(thumb)}`,
  };
}

/** Circle-style gateway: memory bucket + real group-key sealer/opener. */
function makeGateway() {
  const groupKey = generateGroupKey();
  return {
    bucket: makeMemoryBucket(),
    sealer: makeGroupSealer(groupKey),
    opener: makeGroupOpener(groupKey),
    keyRef: 'urn:circle:test:group-key',
  };
}

function buildHarness({ openFilePicker, openMediaFilePicker: mediaPicker, mediaGateway } = {}) {
  __resetThreadIdSeq();
  const threadStateRef = { current: createInitialThreadState() };
  const setThreadState = (v) => {
    threadStateRef.current = typeof v === 'function' ? v(threadStateRef.current) : v;
  };
  const agent = {
    identity: { chat: { pubKey: 'pk' }, host: { webid: WEBID } },
    peer:     { address: 'app.peer-addr', status: 'connected' },
    sendPeerMessage: async () => ({ ok: true }),
  };
  const handlers = buildMobileLocalBuiltins({
    threadStateRef, setThreadState,
    agent,
    catalogue:   { opsById: new Map(), appOrigins: new Set(['basis']), appsById: new Map() },
    callSkill: async () => ({}),
    t,
    openFilePicker,
    openMediaFilePicker: mediaPicker,
    mediaGateway,
  });
  return { handlers };
}

/* ── the round trip ──────────────────────────────────────────────────── */

describe('mobile media round-trip — RN picker → sealed upload → pointer → chip model → openBlob', () => {
  it('walks the full path with the memory bucket + a real group-key sealer pair', async () => {
    const gw = makeGateway();
    const full  = fullBytes();
    const thumb = thumbBytes();
    const { handlers } = buildHarness({
      openFilePicker:      async () => { throw new Error('doc picker must NOT fire on the media path'); },
      openMediaFilePicker: async () => pickedImageToFile(pickedImage({ full, thumb })),
      mediaGateway:        gw,
    });

    // Bare /embed-file auto-picks; the RN image picker + gateway upgrade to media.
    const embed = await handlers['embed-file']({});
    expect(embed.ok).not.toBe(false);
    expect(embed.kind).toBe('media-card');
    expect(embed.appOrigin).toBe('basis');
    expect(embed.issuedBy).toBe(WEBID);

    // Message-side pointer — the DECIDED embeds-style attachment shape.
    expect(embed.pointer).toEqual({ type: 'media', ref: `urn:dec:item:${embed.itemRef.id}` });
    expect(embed.stored).toBe(false);   // no item-store seam wired → rides on the embed
    expect(embed.itemRef).toEqual({ app: 'basis', type: 'media', id: embed.snapshot.id });

    // Canonical media item; source = manifest line UNCHANGED; the picker's
    // pre-resized dims + thumbnail survived the identity encodeImage adapter.
    const item = embed.snapshot;
    expect(validate(item)).toEqual({ ok: true });
    expect(item).toMatchObject({ type: 'media', createdBy: WEBID, mime: 'image/jpeg', width: 640, height: 480 });
    const line = item.source;
    expect(line.type).toBe('blob');
    expect(isBlobRef(line.ref)).toBe(true);
    expect(line.enc).toMatchObject({
      sealed: true, keyRef: gw.keyRef, mime: 'image/jpeg', width: 640, height: 480,
    });
    expect(isSealed(line.enc.thumb)).toBe(true);

    // Sealed-only invariant: no plaintext in the bucket, no raw base64 leaks.
    for (const stored of gw.bucket.store.values()) expect(isSealed(stored)).toBe(true);
    expect(JSON.stringify(line)).not.toContain(b64(full));
    expect(JSON.stringify(line)).not.toContain(b64(thumb));

    // RN chip model: sealed inline thumbnail → data-URL, byte-for-byte.
    const m = buildMediaCardModel(embed, { opener: gw.opener });
    expect(m.thumbUri).toMatch(/^data:image\/jpeg;base64,/);
    const decoded = Uint8Array.from(atob(m.thumbUri.slice(m.thumbUri.indexOf(',') + 1)), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(thumb));

    // FULL image: through the deny-by-default gate, byte-for-byte.
    const gate = createBlobGatekeeper({
      verifyToken: makeVerifier({ 'good-token': WEBID }),
      acl:         makeAcl([[WEBID, line.ref]]),
      bucket:      gw.bucket,
    });
    const opened = await openBlob({
      ref: line, gate, token: 'good-token', opener: gw.opener, fetch: gw.bucket.fetchPresigned,
    });
    expect(Array.from(opened.bytes)).toEqual(Array.from(full));
    expect(opened.media).toEqual({ mime: 'image/jpeg', width: 640, height: 480 });

    // …and the gate stays deny-by-default for everyone else.
    await expect(openBlob({
      ref: line, gate, token: 'bad-token', opener: gw.opener, fetch: gw.bucket.fetchPresigned,
    })).rejects.toThrow(/denied/);
  });

  it('caption arg lands on the media item', async () => {
    const gw = makeGateway();
    const { handlers } = buildHarness({
      openMediaFilePicker: async () => pickedImageToFile(pickedImage()),
      mediaGateway:        gw,
    });
    const embed = await handlers['embed-file']({ caption: 'de kat' });
    expect(embed.snapshot.caption).toBe('de kat');
    expect(buildMediaCardModel(embed, { opener: gw.opener }).caption).toBe('de kat');
  });

  it('a cancelled media pick reports via the existing embed-file key', async () => {
    const { handlers } = buildHarness({
      openMediaFilePicker: async () => null,
      mediaGateway:        makeGateway(),
    });
    const r = await handlers['embed-file']({});
    expect(r.ok).toBe(false);
    expect(r.error).toBe('[embed-file.pick_cancelled]');
  });
});

/* ── the picker-shape seams ──────────────────────────────────────────── */

describe('picker-shape handling (mediaPicker.js seams)', () => {
  it('pickedImageToFile: PickedImage → the File-like the shared handler expects', () => {
    const f = pickedImageToFile(pickedImage());
    expect(f).toMatchObject({
      type: 'image/jpeg', mime: 'image/jpeg', size: 12,
      width: 640, height: 480,
    });
    expect(typeof f.dataB64).toBe('string');
    expect(f.thumbnail.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(pickedImageToFile(null)).toBeNull();                    // cancel
    expect(pickedImageToFile({ mime: 'image/jpeg' })).toBeNull();  // no bytes
  });

  it('openMediaFilePicker: first PickedImage of pickAndResize, null on cancel', async () => {
    const calls = [];
    const f = await openMediaFilePicker({
      _pick: async (args) => { calls.push(args); return [pickedImage()]; },
    });
    expect(f.mime).toBe('image/jpeg');
    expect(calls[0]).toMatchObject({ mode: 'library', max: 1 });
    expect(calls[0].preset).toBeTruthy();
    expect(await openMediaFilePicker({ _pick: async () => [] })).toBeNull();
  });

  it('encodePickedImage: identity for the full picker shape — NO re-encode on RN', () => {
    const f = pickedImageToFile(pickedImage());
    expect(encodePickedImage(f)).toEqual({
      mime: 'image/jpeg', dataB64: f.dataB64, width: 640, height: 480, thumbnail: f.thumbnail,
    });
  });

  it('encodePickedImage: document-picker shape (dataB64 only) degrades to {mime, dataB64}', () => {
    // = web's "without an encoder" case: raw bytes upload, no thumb → placeholder chip.
    expect(encodePickedImage({ name: 'x.jpg', type: 'image/jpeg', size: 3, dataB64: 'AAEC' }))
      .toEqual({ mime: 'image/jpeg', dataB64: 'AAEC' });
    expect(encodePickedImage({ name: 'x.jpg', type: 'image/jpeg' })).toBeNull();
    expect(encodePickedImage(null)).toBeNull();
  });

  it('an image through the DOCUMENT picker still takes the sealed path (raw, thumb-less)', async () => {
    const gw = makeGateway();
    const raw = fullBytes();
    const { handlers } = buildHarness({
      openFilePicker: async () => ({ name: 'photo.jpg', type: 'image/jpeg', size: raw.length, dataB64: b64(raw) }),
      mediaGateway:   gw,
      // no openMediaFilePicker → the doc picker stays the embed-file input
    });
    const embed = await handlers['embed-file']({});
    expect(embed.kind).toBe('media-card');
    expect(embed.snapshot.source.enc.thumb).toBeUndefined();
    expect(buildMediaCardModel(embed, { opener: gw.opener }).thumbUri).toBeNull();   // placeholder chip
    for (const stored of gw.bucket.store.values()) expect(isSealed(stored)).toBe(true);
  });
});

/* ── composition routing: media picker is embed-file-only ────────────── */

describe('composition routing', () => {
  it('/send-file keeps the DOCUMENT picker even when media is fully wired', async () => {
    const pickerCalls = [];
    const { handlers } = buildHarness({
      openFilePicker: async () => {
        pickerCalls.push('doc');
        return { name: 'notes.pdf', type: 'application/pdf', size: 3, dataB64: 'AAEC' };
      },
      openMediaFilePicker: async () => { pickerCalls.push('media'); return pickedImageToFile(pickedImage()); },
      mediaGateway:        makeGateway(),
    });
    await handlers['send-file']({ peer: 'app.peer-addr' });
    expect(pickerCalls).toEqual(['doc']);
  });

  it('a non-image (via the doc picker path) keeps the file-card even WITH the gateway', async () => {
    const gw = makeGateway();
    const { handlers } = buildHarness({
      openFilePicker: async () => ({ name: 'notes.pdf', type: 'application/pdf', size: 3, dataB64: 'AAEC' }),
      mediaGateway:   gw,
    });
    const embed = await handlers['embed-file']({});
    expect(embed.kind).toBe('file-card');
    expect(gw.bucket.store.size).toBe(0);   // nothing touched the bucket
  });
});

/* ── honest degradation (identical to web) ───────────────────────────── */

describe('degradation — no sealer in reach ⇒ no unsealed upload', () => {
  it('no mediaGateway (today\'s LIVE mobile build): legacy inline file-card', async () => {
    const { handlers } = buildHarness({
      openFilePicker: async () => ({ name: 'photo.jpg', type: 'image/jpeg', size: 3, dataB64: 'AAEC' }),
      openMediaFilePicker: async () => { throw new Error('media picker must not fire without a gateway'); },
      // no mediaGateway
    });
    const embed = await handlers['embed-file']({});
    expect(embed.kind).toBe('file-card');
    expect(embed.appOrigin).toBe('folio');
    expect(embed.snapshot.dataB64).toBe('AAEC');   // inline, unchanged legacy behaviour
  });

  it('a gateway missing its sealer does NOT engage the media path (sealed-only stands)', async () => {
    const bucket = makeMemoryBucket();
    const { handlers } = buildHarness({
      openFilePicker: async () => ({ name: 'photo.jpg', type: 'image/jpeg', size: 3, dataB64: 'AAEC' }),
      openMediaFilePicker: async () => pickedImageToFile(pickedImage()),
      mediaGateway: { bucket },   // sealer absent → hasMediaGateway false
    });
    const embed = await handlers['embed-file']({});
    expect(embed.kind).toBe('file-card');           // legacy inline, NOT an unsealed upload
    expect(bucket.store.size).toBe(0);              // the bucket never saw bytes
  });
});
