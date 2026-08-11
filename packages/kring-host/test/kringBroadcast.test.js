// Vocabulary note (decision 1, 2026-07-29): `sent` and `reached-device` are retired. `sent` read as
// success while meaning only "the fan-out accepted it", so the app said the same thing for "their phone
// took it" and "we never heard anything back" (S2/J-D2). `reached-device` is the transport ack, never
// shown, because a phone acks whatever its owner's receipt setting says — surfacing it would identify a
// peer who turned receipts off by where their ladder stops (S2/J-D5). The resting state for an
// unconfirmed message is `maybe-received`.

import { describe, it, expect, vi } from 'vitest';
import { kringChatMessageEvent, broadcastKringFanOut, classifyFanOut, mediaForKringWire } from '../src/kringBroadcast.js';

const mapOf = () => {
  const m = new Map();
  return { set: (id, s) => (s == null ? m.delete(id) : m.set(id, s)), get: (id) => m.get(id) ?? null, _m: m };
};

describe('kringChatMessageEvent', () => {
  it('builds the canonical kring chat-message event', () => {
    expect(kringChatMessageEvent({ msgId: 'm1', ts: 7, circleId: 'c', actor: 'me', text: 'hi' })).toEqual({
      id: 'm1', ts: 7, app: 'kring', type: 'chat-message', actor: 'me',
      payload: { circleId: 'c', text: 'hi', kind: 'chat-message' },
    });
  });
  it('includes buttons only when present', () => {
    const withBtns = kringChatMessageEvent({ msgId: 'm', ts: 1, circleId: 'c', actor: 'bot', text: 't', buttons: [{ id: 'a', label: 'A' }] });
    expect(withBtns.payload.buttons).toEqual([{ id: 'a', label: 'A' }]);
    expect(kringChatMessageEvent({ msgId: 'm', ts: 1, circleId: 'c', actor: 'bot', text: 't', buttons: [] }).payload).not.toHaveProperty('buttons');
  });
  it('includes media only when present (media P1 — the local chip payload)', () => {
    const embed = { kind: 'media-card', pointer: { type: 'media', ref: 'urn:dec:item:x' }, snapshot: { type: 'media', id: 'x' }, stored: false };
    expect(kringChatMessageEvent({ msgId: 'm', ts: 1, circleId: 'c', actor: 'me', text: 't', media: embed }).payload.media).toBe(embed);
    expect(kringChatMessageEvent({ msgId: 'm', ts: 1, circleId: 'c', actor: 'me', text: 't' }).payload).not.toHaveProperty('media');
  });
});

describe('mediaForKringWire — the wire-boundary whitelist (media P1 fan-out)', () => {
  const fullEmbed = () => ({
    kind:      'media-card',
    appOrigin: 'basis',
    itemRef:   { app: 'basis', type: 'media', id: 'media-1' },
    pointer:   { type: 'media', ref: 'urn:dec:item:media-1' },
    snapshot:  {
      type: 'media', id: 'media-1', createdAt: '2026-07-09T00:00:00.000Z', createdBy: 'me',
      mime: 'image/jpeg', width: 640, height: 480, caption: 'hoi',
      source: { type: 'blob', ref: 'blob://k1', enc: { sealed: true, keyRef: 'urn:circle:c:content-key', format: 'fp1', bytes: 99, thumb: 'fp1:sealed-thumb' } },
    },
    issuedBy:  'me',
    stored:    false,
  });

  it('keeps exactly what the peer chip needs — pointer, itemRef, snapshot (incl. the sealed manifest line), issuedBy', () => {
    const wire = mediaForKringWire(fullEmbed());
    expect(wire).toEqual({
      kind:      'media-card',
      appOrigin: 'basis',
      itemRef:   { app: 'basis', type: 'media', id: 'media-1' },
      pointer:   { type: 'media', ref: 'urn:dec:item:media-1' },
      snapshot:  {
        type: 'media', id: 'media-1', createdAt: '2026-07-09T00:00:00.000Z', createdBy: 'me',
        mime: 'image/jpeg', width: 640, height: 480, caption: 'hoi',
        source: { type: 'blob', ref: 'blob://k1', enc: { sealed: true, keyRef: 'urn:circle:c:content-key', format: 'fp1', bytes: 99, thumb: 'fp1:sealed-thumb' } },
      },
      issuedBy:  'me',
    });
    // Sender-local bookkeeping never leaves the device.
    expect(wire).not.toHaveProperty('stored');
  });

  it('strips local-only fields at EVERY level (the stoop Phase-39 lesson pinned)', () => {
    const embed = fullEmbed();
    // Simulated future local-only strap-ons a lazy caller might leave on the embed.
    embed.localPath          = '/data/user/0/app/cache/photo.jpg';
    embed.dataUrl            = 'data:image/jpeg;base64,PLAINTEXTBYTES';
    embed.pointer.localBlobUrl = 'blob:http://localhost/123';
    embed.itemRef.devicePath = 'file:///tmp/photo.jpg';
    embed.snapshot.localFile = '/home/me/Pictures/photo.jpg';
    embed.snapshot.source.bucketCreds = 'AKIA-secret';
    const wire = mediaForKringWire(embed);
    const json = JSON.stringify(wire);
    expect(json).not.toContain('localPath');
    expect(json).not.toContain('/data/user/0');
    expect(json).not.toContain('dataUrl');
    expect(json).not.toContain('PLAINTEXTBYTES');
    expect(json).not.toContain('localBlobUrl');
    expect(json).not.toContain('devicePath');
    expect(json).not.toContain('localFile');
    expect(json).not.toContain('bucketCreds');
    expect(json).not.toContain('AKIA-secret');
  });

  it('absent fields stay absent (never null-filled) and non-media-card input maps to null', () => {
    const minimal = mediaForKringWire({ kind: 'media-card' });
    expect(minimal).toEqual({ kind: 'media-card' });
    expect(mediaForKringWire(null)).toBeNull();
    expect(mediaForKringWire('📷')).toBeNull();
    expect(mediaForKringWire([])).toBeNull();
    expect(mediaForKringWire({ kind: 'file-card', path: '/tmp/x' })).toBeNull();
  });
});

describe('broadcastKringFanOut', () => {
  const base = { circleId: 'c1', msgId: 'm1', text: 'hi', ts: 9 };

  const STATEMENT = { body: { hash: 'h1' }, sig: 'sig1' };
  const signOk = async () => STATEMENT;

  it('pending → maybe-received on a clean result, fanning the SIGNED statement via the RAW skill', async () => {
    const map = mapOf();
    const calls = [];
    const rawCallSkill = vi.fn(async (app, op, args) => { calls.push([app, op, args]); return {}; });
    const onChange = vi.fn();
    await broadcastKringFanOut({ ...base, rawCallSkill, deliveryStateMap: map, onChange, signStatement: signOk });
    expect(calls[0]).toEqual(['stoop', 'broadcastKringChatStatement', { groupId: 'c1', event: STATEMENT, msgId: 'm1', ts: 9 }]);
    expect(map.get('m1')).toBe('maybe-received');
    expect(onChange).toHaveBeenCalledTimes(2);   // pending + sent
  });

  it('NO signature (no rail / no circle key) is an honest delivery FAILURE — never a silent unsigned send', async () => {
    const map = mapOf();
    const calls = [];
    await broadcastKringFanOut({ ...base, rawCallSkill: async (...c) => { calls.push(c); return {}; }, deliveryStateMap: map });
    expect(calls).toHaveLength(0);              // nothing left the device
    expect(map.get('m1')).toBe('failed');       // the bubble says so
  });

  // (The media wire-whitelist moved into the rail's signEntry — pinned by the media DOM journey.)

  it('pending → undeliverable when every error is permanent (recipient-pubkey-unknown)', async () => {
    const map = mapOf();
    await broadcastKringFanOut({ ...base, signStatement: signOk, rawCallSkill: async () => ({ sent: 0, errors: [{ webid: 'x', reason: 'recipient-pubkey-unknown' }] }), deliveryStateMap: map });
    expect(map.get('m1')).toBe('undeliverable');   // retry can't help → no retry affordance
  });

  it('pending → failed when at least one error is transient (retryable)', async () => {
    const map = mapOf();
    await broadcastKringFanOut({ ...base, rawCallSkill: async () => ({ sent: 0, errors: [
      { webid: 'x', reason: 'recipient-pubkey-unknown' },   // permanent
      { webid: 'y', reason: 'send-timeout' },               // transient → whole fan-out stays retryable
    ] }), deliveryStateMap: map });
    expect(map.get('m1')).toBe('failed');
  });

  it('pending → failed on an {error} envelope and on a throw', async () => {
    const m1 = mapOf();
    await broadcastKringFanOut({ ...base, rawCallSkill: async () => ({ error: 'nope' }), deliveryStateMap: m1 });
    expect(m1.get('m1')).toBe('failed');
    const m2 = mapOf();
    await broadcastKringFanOut({ ...base, rawCallSkill: async () => { throw new Error('boom'); }, deliveryStateMap: m2 });
    expect(m2.get('m1')).toBe('failed');
  });

  it('is a no-op when rawCallSkill is missing (never marks pending)', async () => {
    const map = mapOf();
    await broadcastKringFanOut({ ...base, rawCallSkill: null, deliveryStateMap: map });
    expect(map.get('m1')).toBeNull();
  });
});

describe('classifyFanOut', () => {
  it('no errors → sent', () => {
    expect(classifyFanOut({})).toBe('maybe-received');
    expect(classifyFanOut({ sent: 3, errors: [] })).toBe('maybe-received');
  });
  it('whole-op {error} → failed (transient)', () => {
    expect(classifyFanOut({ error: 'chat-unavailable' })).toBe('failed');
  });
  it('all-permanent recipient errors → undeliverable', () => {
    expect(classifyFanOut({ sent: 0, errors: [
      { webid: 'a', reason: 'recipient-pubkey-unknown' },
      { webid: 'b', reason: 'recipient-pubkey-unknown' },
    ] })).toBe('undeliverable');
  });
  it('any transient recipient error → failed', () => {
    expect(classifyFanOut({ sent: 1, errors: [
      { webid: 'a', reason: 'recipient-pubkey-unknown' },
      { webid: 'b', reason: 'send-timeout' },
    ] })).toBe('failed');
    expect(classifyFanOut({ errors: [{ webid: 'a', reason: 'offline' }] })).toBe('failed');
  });
});
