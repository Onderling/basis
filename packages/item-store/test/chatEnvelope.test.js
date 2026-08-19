/**
 * Connectivity Phase 2 — the ONE canonical kring chat Envelope + its
 * projections. These tests PIN byte-identity to the three hand-maintained
 * shapes the projectors replaced, so the collapse can't silently drift the
 * wire / render / catch-up shapes.
 */

import { describe, it, expect } from 'vitest';
import {
  KRING_CHAT_KIND,
  chatEnvelopeFromStoreItem,
  toEventLogItem,
  fromEventLogItem,
  toWireEnvelope,
  toWireRefEnvelope,
  fromWireRefEnvelope,
  isRefEnvelope,
} from '../src/index.js';

// ── The three shapes, reproduced inline as golden fixtures ────────────────
// Each mirrors exactly what the former hand-copy emitted.

function goldenOptimisticEvent({ msgId, ts, circleId, actor, text, buttons, scope, embeds, media, review, provenance, consent }) {
  return {
    id: msgId, ts, app: 'kring', type: 'chat-message', actor,
    payload: {
      circleId, text, kind: 'chat-message',
      ...(buttons?.length ? { buttons } : {}),
      ...(scope ? { scope } : {}),
      ...(embeds?.length ? { embeds } : {}),
      ...(media ? { media } : {}),
      ...(review ? { review } : {}),
      ...(provenance != null ? { provenance } : {}),
      ...(consent != null ? { consent } : {}),
    },
  };
}

function goldenReceivedEvent({ msgId, ts, circleId, actor, text, media }) {
  return {
    id: msgId, ts, app: 'kring', type: 'chat-message', actor,
    payload: {
      circleId, text, kind: 'chat-message',
      senderDisplay: actor,
      ...(media ? { media } : {}),
    },
  };
}

function goldenWire({ circleId, msgId, ts, text, fromActor, fromWebid, media }) {
  return {
    type: 'p2p-chat', subtype: 'kring-chat-message',
    circleId, msgId, ts, text, fromActor, fromWebid,
    ...(media ? { media } : {}),
  };
}

const MEDIA = {
  kind: 'media-card', pointer: { type: 'media', ref: 'urn:dec:item:m' },
  snapshot: { type: 'media', id: 'm', source: { type: 'blob', ref: 'blob://k', enc: { sealed: true } } },
};

describe('toEventLogItem — byte-identical to the 3 former hand-copies', () => {
  it('optimistic-local: no senderDisplay, carries local-only presentation fields in order', () => {
    const a = {
      msgId: 'm1', ts: 7, circleId: 'c', actor: 'me', text: 'hi',
      buttons: [{ id: 'a', label: 'A' }], scope: 'kring', embeds: [{ type: 'task', ref: 'r' }],
      media: MEDIA, review: { intro: 'x', points: [] }, provenance: { llmUsed: true }, consent: { ok: 1 },
    };
    expect(toEventLogItem(a)).toEqual(goldenOptimisticEvent(a));
    // key ORDER pinned (serialized) — the payload optional block must not reorder
    expect(JSON.stringify(toEventLogItem(a))).toBe(JSON.stringify(goldenOptimisticEvent(a)));
  });

  it('optimistic minimal: bare {circleId, text, kind}, no senderDisplay key at all', () => {
    const a = { msgId: 'm', ts: 1, circleId: 'c', actor: 'me', text: 'hi' };
    const out = toEventLogItem(a);
    expect(out).toEqual({ id: 'm', ts: 1, app: 'kring', type: 'chat-message', actor: 'me', payload: { circleId: 'c', text: 'hi', kind: 'chat-message' } });
    expect(out.payload).not.toHaveProperty('senderDisplay');
    expect(out.payload).not.toHaveProperty('media');
  });

  it('empty buttons / falsy scope stay absent (never null-filled)', () => {
    const out = toEventLogItem({ msgId: 'm', ts: 1, circleId: 'c', actor: 'b', text: 't', buttons: [], scope: undefined });
    expect(out.payload).not.toHaveProperty('buttons');
    expect(out.payload).not.toHaveProperty('scope');
  });

  it('received: senderDisplay present + media, byte-identical', () => {
    const a = { msgId: 'm2', ts: 9, circleId: 'c2', actor: 'bob', text: 'yo', senderDisplay: 'bob', media: MEDIA };
    expect(toEventLogItem(a)).toEqual(goldenReceivedEvent({ ...a }));
    expect(JSON.stringify(toEventLogItem(a))).toBe(JSON.stringify(goldenReceivedEvent({ ...a })));
  });

  it('received with a NULL actor: senderDisplay:null is still present (undefined sentinel, not null check)', () => {
    const out = toEventLogItem({ msgId: 'm', ts: 1, circleId: 'c', actor: null, text: 't', senderDisplay: null });
    expect(out.payload).toHaveProperty('senderDisplay', null);
  });

  it('rehydrate legacy: senderDisplay present, no media', () => {
    const a = { msgId: 'm3', ts: 3, circleId: 'c3', actor: 'ann', text: 'hoi', senderDisplay: 'ann' };
    expect(toEventLogItem(a)).toEqual({
      id: 'm3', ts: 3, app: 'kring', type: 'chat-message', actor: 'ann',
      payload: { circleId: 'c3', text: 'hoi', kind: 'chat-message', senderDisplay: 'ann' },
    });
  });
});

describe('toEventLogItem ↔ fromEventLogItem round-trip', () => {
  it('recovers the transferable fields (senderDisplay is a render echo, dropped)', () => {
    const env = { msgId: 'm1', ts: 7, circleId: 'c', actor: 'me', text: 'hi', media: MEDIA, scope: 'kring' };
    const back = fromEventLogItem(toEventLogItem(env));
    expect(back).toEqual({ msgId: 'm1', ts: 7, circleId: 'c', actor: 'me', text: 'hi', media: MEDIA, scope: 'kring' });
  });
  it('round-trips a bare message', () => {
    const env = { msgId: 'x', ts: 1, circleId: 'c', actor: 'a', text: 't' };
    expect(fromEventLogItem(toEventLogItem(env))).toEqual(env);
  });
});

describe('chatEnvelopeFromStoreItem (fromItem) — store item → wire/inbox envelope', () => {
  const storeItem = (source, extra = {}) => ({ id: source.msgId ?? 'auto', text: 'hoi', source, ...extra });

  it('lenient (getMessagesSince): full envelope with media', () => {
    const it = storeItem({ circleId: 'g1', msgId: 'a', ts: 100, fromActor: 'bob', media: MEDIA });
    expect(chatEnvelopeFromStoreItem(it, { groupId: 'g1', lenient: true })).toEqual({
      subtype: KRING_CHAT_KIND, circleId: 'g1', msgId: 'a', ts: 100, text: 'hoi', fromActor: 'bob', media: MEDIA,
    });
  });

  it('lenient: fromActor falls back to fromWebid; media absent stays absent', () => {
    const it = storeItem({ circleId: 'g1', msgId: 'a', ts: 100, fromWebid: 'https://id/bob' });
    const env = chatEnvelopeFromStoreItem(it, { groupId: 'g1', lenient: true });
    expect(env.fromActor).toBe('https://id/bob');
    expect(env).not.toHaveProperty('media');
  });

  it('lenient: msgId falls back to item.id, circleId falls back to groupId, text to empty', () => {
    const env = chatEnvelopeFromStoreItem({ id: 'itemid', text: undefined, source: { ts: 5 } }, { groupId: 'gX', lenient: true });
    expect(env).toEqual({ subtype: KRING_CHAT_KIND, circleId: 'gX', msgId: 'itemid', ts: 5, text: '', fromActor: null });
  });

  it('strict (rehydrate): valid item → envelope', () => {
    const it = storeItem({ circleId: 'g1', msgId: 'a', ts: 100, fromActor: 'bob', media: MEDIA });
    expect(chatEnvelopeFromStoreItem(it)).toEqual({
      subtype: KRING_CHAT_KIND, circleId: 'g1', msgId: 'a', ts: 100, text: 'hoi', fromActor: 'bob', media: MEDIA,
    });
  });

  it('strict: missing msgId / circleId / text → null (skipped)', () => {
    expect(chatEnvelopeFromStoreItem({ text: 'hoi', source: { circleId: 'g', ts: 1 } })).toBeNull();          // no msgId
    expect(chatEnvelopeFromStoreItem({ text: 'hoi', source: { msgId: 'a', ts: 1 } })).toBeNull();             // no circleId
    expect(chatEnvelopeFromStoreItem({ text: '', source: { msgId: 'a', circleId: 'g', ts: 1 } })).toBeNull(); // empty text
    expect(chatEnvelopeFromStoreItem(null)).toBeNull();
    expect(chatEnvelopeFromStoreItem({})).toBeNull();
  });

  it('strict: missing/invalid ts → Date.now() (never NaN)', () => {
    const env = chatEnvelopeFromStoreItem({ text: 'hoi', source: { msgId: 'a', circleId: 'g' } });
    expect(typeof env.ts).toBe('number');
    expect(Number.isFinite(env.ts)).toBe(true);
  });

  it('media guard: an array in source.media is rejected (uniform !Array guard)', () => {
    const env = chatEnvelopeFromStoreItem({ text: 'hoi', source: { msgId: 'a', circleId: 'g', ts: 1, media: [1, 2] } });
    expect(env).not.toHaveProperty('media');
  });
});

describe('toWireEnvelope (toWire) — canonical → fan-out wire', () => {
  it('byte-identical to the former broadcastCircleMessage literal (with media)', () => {
    const a = { circleId: 'c1', msgId: 'm1', ts: 9, text: 'hi', fromActor: 'me', fromWebid: 'https://id/me', media: MEDIA };
    expect(toWireEnvelope(a)).toEqual(goldenWire(a));
    expect(JSON.stringify(toWireEnvelope(a))).toBe(JSON.stringify(goldenWire(a)));
  });

  it('no media → legacy wire shape (no media key)', () => {
    const a = { circleId: 'c1', msgId: 'm1', ts: 9, text: 'hi', fromActor: 'me', fromWebid: 'me', media: null };
    const wire = toWireEnvelope(a);
    expect(wire).not.toHaveProperty('media');
    expect(wire).toEqual({ type: 'p2p-chat', subtype: 'kring-chat-message', circleId: 'c1', msgId: 'm1', ts: 9, text: 'hi', fromActor: 'me', fromWebid: 'me' });
  });

  it('local-only fields never ride the wire: only text + whitelisted media transfer', () => {
    // A media pointer is the ONLY structured extra allowed on the wire; the
    // render-only fields (review/provenance/consent/buttons) have no path here.
    const wire = toWireEnvelope({ circleId: 'c', msgId: 'm', ts: 1, text: 't', fromActor: 'a', fromWebid: 'a', media: MEDIA });
    const json = JSON.stringify(wire);
    expect(json).not.toContain('review');
    expect(json).not.toContain('provenance');
    expect(json).not.toContain('consent');
    expect(json).not.toContain('buttons');
  });
});

describe('store item → wire round-trip (fromItem then toWire)', () => {
  it('a persisted item projects back to a wire envelope carrying the same core fields + media', () => {
    const item = { id: 'a', text: 'hoi', source: { circleId: 'g1', msgId: 'a', ts: 100, fromActor: 'bob', media: MEDIA } };
    const env = chatEnvelopeFromStoreItem(item, { groupId: 'g1', lenient: true });
    const wire = toWireEnvelope({ circleId: env.circleId, msgId: env.msgId, ts: env.ts, text: env.text, fromActor: env.fromActor, fromWebid: env.fromActor, media: env.media });
    expect(wire).toMatchObject({ type: 'p2p-chat', subtype: 'kring-chat-message', circleId: 'g1', msgId: 'a', ts: 100, text: 'hoi', fromActor: 'bob', media: MEDIA });
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Connectivity Phase 2 (§2/§3) — the REF variant of the canonical Envelope.
 *
 * The canonical Envelope carries EITHER a `body` (the full text, `toWireEnvelope`)
 * OR a `ref` (a pod-row pointer, `toWireRefEnvelope`). A `pod-signal` fan writes
 * the message to the shared pod and fans the ref shape so peers pull the content
 * from the pod. `body`/`ref` are mutually exclusive by construction. This shape is
 * defined + tested now; the live send path degrades pod-signal to a full-body fan
 * until Phase 3 wires the real pod write.
 * ─────────────────────────────────────────────────────────────────────── */

function goldenRefWire({ circleId, msgId, ts, ref, fromActor, fromWebid, media }) {
  return {
    type: 'p2p-chat', subtype: 'kring-chat-message',
    circleId, msgId, ts, ref, fromActor, fromWebid,
    ...(media ? { media } : {}),
  };
}

describe('toWireRefEnvelope — the pod-signal ref projection', () => {
  const a = { circleId: 'g1', msgId: 'm1', ts: 100, ref: 'urn:pod:g1:row:42', fromActor: 'bob', fromWebid: 'bob' };

  it('is the sibling of toWireEnvelope with `text` replaced by `ref` (no body on the wire)', () => {
    const wire = toWireRefEnvelope(a);
    expect(wire).toEqual(goldenRefWire(a));
    expect(wire).not.toHaveProperty('text');
    expect(wire.ref).toBe('urn:pod:g1:row:42');
    expect(wire.subtype).toBe(KRING_CHAT_KIND);
  });

  it('carries a whitelisted media pointer when present (absent → no media key)', () => {
    expect(toWireRefEnvelope({ ...a, media: MEDIA })).toEqual(goldenRefWire({ ...a, media: MEDIA }));
    expect(toWireRefEnvelope(a)).not.toHaveProperty('media');
    // a non-object media is dropped (same guard as toWireEnvelope)
    expect(toWireRefEnvelope({ ...a, media: ['x'] })).not.toHaveProperty('media');
  });

  it('the ref body never leaks the text: the wire JSON contains the pointer, not content', () => {
    const wire = toWireRefEnvelope(a);
    expect(JSON.stringify(wire)).not.toContain('"text"');
  });
});

describe('toWireRefEnvelope ↔ fromWireRefEnvelope round-trip', () => {
  it('recovers the canonical ref fields byte-for-byte', () => {
    const a = { circleId: 'g1', msgId: 'm1', ts: 100, ref: 'urn:pod:g1:row:42', fromActor: 'bob', fromWebid: 'bob', media: MEDIA };
    expect(fromWireRefEnvelope(toWireRefEnvelope(a))).toEqual(a);
  });

  it('without media, the round-trip omits the media key', () => {
    const a = { circleId: 'g1', msgId: 'm1', ts: 100, ref: 'r', fromActor: 'bob', fromWebid: 'bob' };
    expect(fromWireRefEnvelope(toWireRefEnvelope(a))).toEqual(a);
  });

  it('fromWireRefEnvelope returns null for a non-ref (full-body) wire envelope', () => {
    const full = toWireEnvelope({ circleId: 'g1', msgId: 'm1', ts: 100, text: 'hoi', fromActor: 'bob', fromWebid: 'bob' });
    expect(fromWireRefEnvelope(full)).toBeNull();
    expect(fromWireRefEnvelope(null)).toBeNull();
    expect(fromWireRefEnvelope({})).toBeNull();
  });
});

describe('isRefEnvelope — discriminate the two wire variants', () => {
  it('true for a ref envelope, false for a full-body one', () => {
    const ref  = toWireRefEnvelope({ circleId: 'g', msgId: 'm', ts: 1, ref: 'r', fromActor: 'a', fromWebid: 'a' });
    const full = toWireEnvelope({ circleId: 'g', msgId: 'm', ts: 1, text: 't', fromActor: 'a', fromWebid: 'a' });
    expect(isRefEnvelope(ref)).toBe(true);
    expect(isRefEnvelope(full)).toBe(false);
    expect(isRefEnvelope(null)).toBe(false);
    expect(isRefEnvelope({ ref: '' })).toBe(false);
  });
});
