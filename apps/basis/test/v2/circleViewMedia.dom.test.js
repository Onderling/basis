/**
 * basis v2 — sealed media, the LIVE circle wiring (media user-reachable slice).
 *
 * mediaEmbed.test.js proves the handler round-trip with a test-harness composition;
 * THIS suite proves the composition the v2 web shell actually ships:
 *
 *   circleMediaGateway (circle seal strategy + dev bucket + deny-by-default gate)
 *     → the circle composer's 📎 affordance (hidden-file-input, circleView.js)
 *     → createMediaEmbed (sealed upload, canonical media item, {type:'media'} pointer)
 *     → the embed rides the outgoing message payload
 *     → the media-card chip renders in the thread (shared domAdapter branch)
 *     → the full image comes back ONLY through the gate (deny-by-default provable).
 *
 * Sealed-only degradation: a p0/p1 circle (no seal strategy) composes to null and
 * the composer renders NO attach button — never an unsealed upload.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';

import {
  generateGroupKey, makeGroupSealer, makeGroupOpener, isSealed,
} from '@onderling/pod-client/sealing';
import { openBlob, isBlobRef } from '@onderling/blob-gateway';
import { validate } from '@onderling/item-types';

import { createCircleMediaGateway, makeDevMediaBucket } from '../../src/v2/circleMediaGateway.js';
import { createMediaEmbed } from '../../src/core/handlers/mediaEmbed.js';
import { renderCircleView } from '../../web/v2/circleView.js';

const t = (key) => key;
const ACTOR = 'me';
const CIRCLE = { id: 'g1', name: 'Selwerd' };

const fullBytes  = () => new Uint8Array([255, 216, 255, 224, 0, 1, 2, 250, 251, 42, 7, 0]);
const thumbBytes = () => new Uint8Array([255, 216, 255, 224, 9, 8, 7]);
const b64 = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

/** Stub picked File — the browser `arrayBuffer()` read path. */
function stubFile(bytes = fullBytes(), { name = 'photo.jpg', type = 'image/jpeg' } = {}) {
  return {
    name, type, size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

/** Stub encoder — the shape src/v2/attachmentEncoder.encodeImageFile emits (happy-dom
 *  has no real canvas, so the shell's encoder is stubbed; the seal/upload/gate path
 *  under test is the LIVE one). */
const stubEncodeImage = ({ bytes = fullBytes(), thumb = thumbBytes() } = {}) => async () => ({
  mime: 'image/jpeg', dataB64: b64(bytes), width: 640, height: 480,
  thumbnail: `data:image/jpeg;base64,${b64(thumb)}`,
});

/** A p2-style circle seal strategy — the {seal, open} shape
 *  circleControlAgent.sealingStrategy() resolves to. */
function groupStrategy() {
  const groupKey = generateGroupKey();
  return { seal: makeGroupSealer(groupKey), open: makeGroupOpener(groupKey) };
}

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/** A chat-message row carrying the media embed on its payload — the exact shape
 *  circleApp's circleAttachMedia appends (circleChatMessageEvent + payload.media). */
function mediaRow(embed, { id = 'm-1', text = '📷 photo.jpg' } = {}) {
  return {
    id, ts: Date.now(), app: 'circle', type: 'chat-message', actor: ACTOR, circleId: CIRCLE.id,
    event: { id, type: 'chat-message', payload: { circleId: CIRCLE.id, kind: 'chat-message', text, scope: 'circle', media: embed } },
  };
}

describe('circleMediaGateway — the live composition', () => {
  it('a circle WITHOUT a seal strategy (p0/p1) composes to null — sealed-only stands', async () => {
    expect(await createCircleMediaGateway({
      circleId: 'g1', getSealStrategy: async () => null, localActor: ACTOR, bucket: makeDevMediaBucket(),
    })).toBeNull();
    // …and a throwing resolver degrades the same way (no partial gateway).
    expect(await createCircleMediaGateway({
      circleId: 'g1', getSealStrategy: async () => { throw new Error('pod down'); }, localActor: ACTOR, bucket: makeDevMediaBucket(),
    })).toBeNull();
  });

  it('a sealed circle composes the full gateway: seams for uploadBlob + gate/token + opener', async () => {
    const comp = await createCircleMediaGateway({
      circleId: 'g1', getSealStrategy: async () => groupStrategy(), localActor: ACTOR, bucket: makeDevMediaBucket(),
    });
    expect(comp).not.toBeNull();
    const gw = comp.mediaGateway;
    expect(typeof gw.bucket.put).toBe('function');
    expect(typeof gw.sealer).toBe('function');
    expect(typeof gw.opener).toBe('function');
    expect(typeof gw.gate).toBe('function');
    expect(typeof gw.token).toBe('string');
    expect(gw.keyRef).toBe('urn:circle:g1:content-key');
  });
});

describe('circle composer — the attach affordance', () => {
  it('renders NO attach button when the host wired no onAttachMedia (p0/p1 / unresolved)', () => {
    const el = mount();
    renderCircleView(el, { circle: CIRCLE, rows: [], t, onSend: () => {} });
    expect(el.querySelector('.circle-circle__composer')).not.toBeNull();
    expect(el.querySelector('.circle-circle__attach')).toBeNull();
    expect(el.querySelector('.circle-circle__file')).toBeNull();
  });

  it('renders the 📎 button + hidden file input, and a picked file reaches onAttachMedia', async () => {
    const el = mount();
    const picked = [];
    renderCircleView(el, {
      circle: CIRCLE, rows: [], t, onSend: () => {},
      onAttachMedia: (f) => picked.push(f),
    });
    const btn = el.querySelector('.circle-circle__attach');
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('aria-label')).toBe('circle.circle.attach');
    const fileInput = el.querySelector('.circle-circle__file');
    expect(fileInput).not.toBeNull();
    expect(fileInput.getAttribute('accept')).toContain('image/');
    const f = stubFile();
    Object.defineProperty(fileInput, 'files', { value: [f], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    expect(picked).toEqual([f]);
  });
});

describe('the live path — pick → sealed upload → payload.media → chip → gated full image', () => {
  it('walks the wiring end-to-end with the dev bucket + a real group-key strategy', async () => {
    const bucket = makeDevMediaBucket();
    const comp = await createCircleMediaGateway({
      circleId: CIRCLE.id, getSealStrategy: async () => groupStrategy(), localActor: ACTOR, bucket,
    });
    const encoded = fullBytes();
    const thumb   = thumbBytes();

    // The host handler exactly as circleApp.circleAttachMedia composes it.
    const rows = [];
    let attachDone;
    const onAttachMedia = (file) => {
      attachDone = (async () => {
        const embed = await createMediaEmbed({}, {
          file, mediaGateway: comp.mediaGateway,
          encodeImage: stubEncodeImage({ bytes: encoded, thumb }),
          localActor: ACTOR, t,
        });
        expect(embed.ok).not.toBe(false);
        rows.unshift(mediaRow(embed));   // buildCircleStream order: newest first
        return embed;
      })();
    };

    // Drive it through the REAL DOM affordance.
    const el = mount();
    const rerender = () => renderCircleView(el, {
      circle: CIRCLE, rows, t, onSend: () => {},
      onAttachMedia,
      media: { opener: comp.mediaGateway.opener },
    });
    rerender();
    const fileInput = el.querySelector('.circle-circle__file');
    Object.defineProperty(fileInput, 'files', { value: [stubFile()], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    const embed = await attachDone;
    rerender();

    // The embed is the handler's shape, unchanged, riding the message payload.
    expect(embed.kind).toBe('media-card');
    expect(embed.pointer).toEqual({ type: 'media', ref: `urn:dec:item:${embed.snapshot.id}` });
    expect(validate(embed.snapshot)).toEqual({ ok: true });
    expect(embed.snapshot.createdBy).toBe(ACTOR);
    const line = embed.snapshot.source;
    expect(isBlobRef(line.ref)).toBe(true);
    expect(line.enc).toMatchObject({ sealed: true, keyRef: 'urn:circle:g1:content-key', mime: 'image/jpeg' });

    // Sealed-only invariant on the DEV bucket too: ciphertext only, no leaked base64.
    expect(bucket.store.size).toBeGreaterThan(0);
    for (const stored of bucket.store.values()) expect(isSealed(stored)).toBe(true);
    expect(JSON.stringify([...bucket.store.values()])).not.toContain(b64(encoded));

    // The chip renders in the thread via the shared domAdapter branch, thumbnail open.
    const chip = el.querySelector('.circle-circle__bubble .cc-media-card');
    expect(chip).not.toBeNull();
    const img = chip.querySelector('img.cc-media-thumb');
    expect(img).not.toBeNull();
    expect(img.src.length).toBeGreaterThan(0);
    expect(img.getAttribute('width')).toBe('640');

    // Full image: byte-for-byte through the composed gate…
    const opened = await comp.openFullImage(line);
    expect(Array.from(opened.bytes)).toEqual(Array.from(encoded));
    expect(opened.media).toMatchObject({ mime: 'image/jpeg', width: 640, height: 480 });

    // …and DENY-BY-DEFAULT holds on the live composition: a foreign token is refused,
    // and a ref never uploaded through this gateway is refused even with OUR token.
    await expect(openBlob({
      ref: line, gate: comp.mediaGateway.gate, token: 'stolen-token',
      opener: comp.mediaGateway.opener, fetch: bucket.fetchPresigned,
    })).rejects.toThrow(/denied/);
    await expect(openBlob({
      ref: 'blob://never-granted-key', gate: comp.mediaGateway.gate, token: comp.mediaGateway.token,
      opener: comp.mediaGateway.opener, fetch: bucket.fetchPresigned,
    })).rejects.toThrow(/denied/);
  });

  it('circleView threads media.openFull to the chip → the "[View]" affordance appears + opens', async () => {
    const comp = await createCircleMediaGateway({
      circleId: CIRCLE.id, getSealStrategy: async () => groupStrategy(), localActor: ACTOR, bucket: makeDevMediaBucket(),
    });
    const embed = await createMediaEmbed({}, {
      file: stubFile(), mediaGateway: comp.mediaGateway,
      encodeImage: stubEncodeImage(), localActor: ACTOR, t,
    });
    const el = mount();
    let opened = null;
    renderCircleView(el, {
      circle: CIRCLE, rows: [mediaRow(embed)], t, onSend: () => {},
      // The live wiring: the composition injects {opener, openFull}. openFull is the
      // gateway's gated full-size read — stubbed here (composition is another workstream).
      media: {
        opener: comp.mediaGateway.opener,
        openFull: (line) => { opened = line; return { bytes: fullBytes(), media: { mime: 'image/jpeg' } }; },
      },
    });
    const chip = el.querySelector('.circle-circle__bubble .cc-media-card');
    const view = chip.querySelector('.cc-media-view');
    expect(view).not.toBeNull();
    // `t: tr` threads through circleView → the label is localised (identity t → the key).
    expect(view.textContent).toBe('circle.media.view.label');

    view.click();
    await Promise.resolve(); await Promise.resolve();
    expect(opened).toEqual(embed.snapshot.source);
    expect(document.querySelector('.cc-media-lightbox img.cc-media-lightbox__img')).not.toBeNull();
    // Clean up the appended overlay for the next test.
    document.querySelector('.cc-media-lightbox')?.remove();
  });

  it('no openFull → the chip has NO View control (thumbnail-only degradation)', async () => {
    const comp = await createCircleMediaGateway({
      circleId: CIRCLE.id, getSealStrategy: async () => groupStrategy(), localActor: ACTOR, bucket: makeDevMediaBucket(),
    });
    const embed = await createMediaEmbed({}, {
      file: stubFile(), mediaGateway: comp.mediaGateway,
      encodeImage: stubEncodeImage(), localActor: ACTOR, t,
    });
    const el = mount();
    renderCircleView(el, {
      circle: CIRCLE, rows: [mediaRow(embed)], t, onSend: () => {},
      media: { opener: comp.mediaGateway.opener },   // opener but NO openFull
    });
    const chip = el.querySelector('.circle-circle__bubble .cc-media-card');
    expect(chip.querySelector('img.cc-media-thumb')).not.toBeNull();   // thumbnail still renders
    expect(chip.querySelector('.cc-media-view')).toBeNull();           // but no View affordance
  });

  it('without an opener in ctx the chip degrades to the mime placeholder (no crash)', async () => {
    const comp = await createCircleMediaGateway({
      circleId: CIRCLE.id, getSealStrategy: async () => groupStrategy(), localActor: ACTOR, bucket: makeDevMediaBucket(),
    });
    const embed = await createMediaEmbed({}, {
      file: stubFile(), mediaGateway: comp.mediaGateway,
      encodeImage: stubEncodeImage(), localActor: ACTOR, t,
    });
    const el = mount();
    renderCircleView(el, { circle: CIRCLE, rows: [mediaRow(embed)], t, onSend: () => {} });   // no media ctx
    const chip = el.querySelector('.circle-circle__bubble .cc-media-card');
    expect(chip).not.toBeNull();
    expect(chip.querySelector('img.cc-media-thumb')).toBeNull();
    expect(chip.querySelector('.cc-media-placeholder .cc-media-details').textContent).toContain('image/jpeg');
  });
});
