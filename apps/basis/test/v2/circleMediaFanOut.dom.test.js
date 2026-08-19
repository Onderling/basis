/**
 * basis v2 — media over the SIGNED chat lane: the media pointer rides the statement's whitelisted wire
 * payload so PEERS render the photo chip, with the same leakage pins the legacy fan carried.
 *
 * End-to-end with REAL sealing — two shells sharing one circle key:
 *
 *   SENDER  circleMediaGateway (group sealer) → createMediaEmbed (sealed upload, sealed inline thumb) →
 *           `chatRail.appendMessage` keeps the FULL embed on the LOCAL render entry and projects the
 *           WIRE copy through `mediaForCircleWire` into the SIGNED statement payload
 *   WIRE    the statement is what fans (or lands in a pod row) — nothing else crosses the boundary
 *   PEER    `chatRail.ingest` verifies, derives the render entry FROM THE VERIFIED BODY →
 *           buildCircleStream row → renderCircleView's payload.media branch → chip, thumbnail OPENED
 *           with the receiving shell's circle opener (same group key)
 *
 * Plus the pins:
 *   • a message WITHOUT media renders exactly as today (no chip),
 *   • a wrong circle key degrades to the placeholder (sealed stays sealed), never a crash,
 *   • nothing local-only (sender bookkeeping / plaintext bytes) survives into the signed payload.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';

import {
  generateGroupKey, makeGroupSealer, makeGroupOpener, isSealed,
} from '@onderling/pod-client/sealing';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createCircleMediaGateway, makeDevMediaBucket } from '../../src/v2/circleMediaGateway.js';
import { createMediaEmbed } from '../../src/core/handlers/mediaEmbed.js';
import { EventLog } from '../../src/eventLog.js';
import { makeChatRail } from '../../src/v2/chatRail.js';
import { buildCircleStream } from '../../src/v2/circleStream.js';
import { renderCircleView } from '../../web/v2/circleView.js';

const t = (key) => key;
const CIRCLE = { id: 'g1', name: 'Selwerd' };
const SENDER = 'webid:anne';

const fullBytes  = () => new Uint8Array([255, 216, 255, 224, 0, 1, 2, 250, 251, 42, 7, 0]);
const thumbBytes = () => new Uint8Array([255, 216, 255, 224, 9, 8, 7]);
const b64 = (bytes) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

function stubFile(bytes = fullBytes(), { name = 'photo.jpg', type = 'image/jpeg' } = {}) {
  return {
    name, type, size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

const stubEncodeImage = ({ bytes = fullBytes(), thumb = thumbBytes() } = {}) => async () => ({
  mime: 'image/jpeg', dataB64: b64(bytes), width: 640, height: 480,
  thumbnail: `data:image/jpeg;base64,${b64(thumb)}`,
});

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

/** One CIRCLE key, two holders — the sealer seals on the sender, the opener
 *  opens on the RECEIVER (the group-key semantics of a p2/p3 circle). */
function circleKeyPair() {
  const groupKey = generateGroupKey();
  return { seal: makeGroupSealer(groupKey), open: makeGroupOpener(groupKey) };
}

/** Sender half: seal + upload the picked file, then SIGN a message carrying the embed through the real
 *  chat rail. Returns the embed, the sender's circle key, the signed statement, and its wire payload. */
async function senderSide(strategy, { text = '📷 photo.jpg', withMedia = true } = {}) {
  const cid = await AgentIdentity.generate(new VaultMemory());
  const rail = makeChatRail({
    eventLog: new EventLog({ initial: [] }),
    circleIdentityFor: async () => cid,
    myRef: SENDER,
    callSkill: async () => ({}),
    verifyBinding: async () => true,
  });
  let embed = null;
  if (withMedia) {
    const comp = await createCircleMediaGateway({
      circleId: CIRCLE.id, getSealStrategy: async () => strategy,
      localActor: SENDER, bucket: makeDevMediaBucket(),
    });
    embed = await createMediaEmbed({}, {
      file: stubFile(), mediaGateway: comp.mediaGateway,
      encodeImage: stubEncodeImage(), localActor: SENDER, t,
    });
    expect(embed.ok).not.toBe(false);
  }
  const { statement } = await rail.appendMessage(CIRCLE.id, {
    msgId: 'circle-g1-1', ts: 1735_000_000_000, text, actor: SENDER, ...(embed ? { media: embed } : {}),
  });
  return { embed, cid, statement, wire: statement.body.payload };
}

/** A receiving device: its own rail over a real EventLog, bound to the sender's circle key. */
async function receiverFor(senderCid) {
  const eventLog = new EventLog({ initial: [] });
  const cid = await AgentIdentity.generate(new VaultMemory());
  const rail = makeChatRail({
    eventLog, circleIdentityFor: async () => cid, myRef: 'webid:bob',
    callSkill: async () => ({}),
    verifyBinding: async ({ author }) => author === senderCid.pubKey,
  });
  return { eventLog, rail };
}

describe('media over the signed lane — sender seals, the statement carries the pointer, the PEER chip opens', () => {
  it('walks sender → signed wire → verified receiver → chip end-to-end with one real circle key', async () => {
    const strategy = circleKeyPair();
    const { embed, cid, statement, wire } = await senderSide(strategy);

    /* ── the SIGNED wire copy: whitelisted, sealed, nothing local-only ── */
    expect(wire.media.kind).toBe('media-card');
    expect(wire.media.pointer).toEqual(embed.pointer);
    expect(wire.media.snapshot.source).toEqual(embed.snapshot.source);   // the manifest line, unchanged
    expect(wire.media).not.toHaveProperty('stored');                     // sender-local bookkeeping stripped
    const wireJson = JSON.stringify(wire);
    expect(wireJson).not.toContain(b64(fullBytes()));    // no plaintext image bytes
    expect(wireJson).not.toContain(b64(thumbBytes()));   // no plaintext thumb bytes
    expect(isSealed(wire.media.snapshot.source.enc.thumb)).toBe(true);   // the inline thumb is a sealed envelope
    expect(wire.media.snapshot.source.enc.keyRef).toBe('urn:circle:g1:content-key');   // a POINTER, not a key

    /* ── receiver: verify at the rail, land the render entry FROM THE VERIFIED BODY ── */
    const recv = await receiverFor(cid);
    const res = await recv.rail.ingest(CIRCLE.id, statement);
    expect(res.ok).toBe(true);
    const events = recv.eventLog.query({});
    expect(events).toHaveLength(1);
    expect(events[0].payload.media).toEqual(wire.media);   // the chip payload landed

    /* ── render on the RECEIVING shell: same circle key → the thumb opens ── */
    const rows = buildCircleStream({ events, circles: [CIRCLE], circleId: CIRCLE.id });
    const el = mount();
    renderCircleView(el, {
      circle: CIRCLE, rows, t, onSend: () => {},
      media: { opener: strategy.open },   // the receiver's own circle opener (gateway-cached per circle)
    });
    const chip = el.querySelector('.circle-circle__bubble .cc-media-card');
    expect(chip).not.toBeNull();
    const img = chip.querySelector('img.cc-media-thumb');
    expect(img).not.toBeNull();           // sealed thumb OPENED — not the placeholder
    expect(img.src.length).toBeGreaterThan(0);
    expect(img.getAttribute('width')).toBe('640');
    // The text line still renders alongside the chip.
    expect(el.textContent).toContain('📷 photo.jpg');
  });

  it('a WRONG circle key degrades to the placeholder (sealed stays sealed), never a crash', async () => {
    const { cid, statement } = await senderSide(circleKeyPair());
    const recv = await receiverFor(cid);
    await recv.rail.ingest(CIRCLE.id, statement);

    const rows = buildCircleStream({ events: recv.eventLog.query({}), circles: [CIRCLE], circleId: CIRCLE.id });
    const el = mount();
    renderCircleView(el, {
      circle: CIRCLE, rows, t, onSend: () => {},
      media: { opener: circleKeyPair().open },   // a DIFFERENT circle's key
    });
    const chip = el.querySelector('.circle-circle__bubble .cc-media-card');
    expect(chip).not.toBeNull();
    expect(chip.querySelector('img.cc-media-thumb')).toBeNull();
    expect(chip.querySelector('.cc-media-placeholder')).not.toBeNull();
  });

  it('a message WITHOUT media renders exactly as today — no chip, no media key on the wire', async () => {
    const { cid, statement, wire } = await senderSide(circleKeyPair(), { text: 'Hoi circle!', withMedia: false });
    expect(wire).not.toHaveProperty('media');

    const recv = await receiverFor(cid);
    await recv.rail.ingest(CIRCLE.id, statement);
    const events = recv.eventLog.query({});
    expect(events).toHaveLength(1);
    expect(events[0].payload).not.toHaveProperty('media');

    const rows = buildCircleStream({ events, circles: [CIRCLE], circleId: CIRCLE.id });
    const el = mount();
    renderCircleView(el, { circle: CIRCLE, rows, t, onSend: () => {} });
    expect(el.querySelector('.cc-media-card')).toBeNull();      // no chip
    expect(el.textContent).toContain('Hoi circle!');             // the bubble is untouched
  });
});
