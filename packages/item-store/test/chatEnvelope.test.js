/**
 * Connectivity Phase 2 — the ONE canonical circle chat Envelope + its
 * projections. These tests PIN byte-identity to the three hand-maintained
 * shapes the projectors replaced, so the collapse can't silently drift the
 * wire / render / catch-up shapes.
 */

import { describe, it, expect } from 'vitest';
import {
  CIRCLE_CHAT_KIND,
  toEventLogItem,
  fromEventLogItem,
  toWireEnvelope,
  toWireRefEnvelope,
  fromWireRefEnvelope,
  isRefEnvelope,
} from '../src/index.js';

// ── The three shapes, reproduced inline as golden fixtures ────────────────
// Each mirrors exactly what the former hand-copy emitted.

function goldenOptimisticEvent({ msgId, ts, circleId, actor, text, buttons, scope, embeds, card, review, provenance, consent }) {
  return {
    id: msgId, ts, app: 'circle', type: 'chat-message', actor,
    payload: {
      circleId, text, kind: 'chat-message',
      ...(buttons?.length ? { buttons } : {}),
      ...(scope ? { scope } : {}),
      ...(embeds?.length ? { embeds } : {}),
      ...(card ? { card } : {}),
      ...(review ? { review } : {}),
      ...(provenance != null ? { provenance } : {}),
      ...(consent != null ? { consent } : {}),
    },
  };
}

function goldenReceivedEvent({ msgId, ts, circleId, actor, text, card }) {
  return {
    id: msgId, ts, app: 'circle', type: 'chat-message', actor,
    payload: {
      circleId, text, kind: 'chat-message',
      senderDisplay: actor,
      ...(card ? { card } : {}),
    },
  };
}

function goldenWire({ circleId, msgId, ts, text, fromActor, fromWebid, card }) {
  return {
    type: 'p2p-chat', subtype: 'circle-chat-message',
    circleId, msgId, ts, text, fromActor, fromWebid,
    ...(card ? { card } : {}),
  };
}

const CARD = {
  kind: 'media-card', pointer: { type: 'media', ref: 'urn:dec:item:m' },
  snapshot: { type: 'media', id: 'm', source: { type: 'blob', ref: 'blob://k', enc: { sealed: true } } },
};

describe('toEventLogItem — byte-identical to the 3 former hand-copies', () => {
  it('optimistic-local: no senderDisplay, carries local-only presentation fields in order', () => {
    const a = {
      msgId: 'm1', ts: 7, circleId: 'c', actor: 'me', text: 'hi',
      buttons: [{ id: 'a', label: 'A' }], scope: 'circle', embeds: [{ type: 'task', ref: 'r' }],
      card: CARD, review: { intro: 'x', points: [] }, provenance: { llmUsed: true }, consent: { ok: 1 },
    };
    expect(toEventLogItem(a)).toEqual(goldenOptimisticEvent(a));
    // key ORDER pinned (serialized) — the payload optional block must not reorder
    expect(JSON.stringify(toEventLogItem(a))).toBe(JSON.stringify(goldenOptimisticEvent(a)));
  });

  it('optimistic minimal: bare {circleId, text, kind}, no senderDisplay key at all', () => {
    const a = { msgId: 'm', ts: 1, circleId: 'c', actor: 'me', text: 'hi' };
    const out = toEventLogItem(a);
    expect(out).toEqual({ id: 'm', ts: 1, app: 'circle', type: 'chat-message', actor: 'me', payload: { circleId: 'c', text: 'hi', kind: 'chat-message' } });
    expect(out.payload).not.toHaveProperty('senderDisplay');
    expect(out.payload).not.toHaveProperty('card');
  });

  it('empty buttons / falsy scope stay absent (never null-filled)', () => {
    const out = toEventLogItem({ msgId: 'm', ts: 1, circleId: 'c', actor: 'b', text: 't', buttons: [], scope: undefined });
    expect(out.payload).not.toHaveProperty('buttons');
    expect(out.payload).not.toHaveProperty('scope');
  });

  it('received: senderDisplay present + card, byte-identical', () => {
    const a = { msgId: 'm2', ts: 9, circleId: 'c2', actor: 'bob', text: 'yo', senderDisplay: 'bob', card: CARD };
    expect(toEventLogItem(a)).toEqual(goldenReceivedEvent({ ...a }));
    expect(JSON.stringify(toEventLogItem(a))).toBe(JSON.stringify(goldenReceivedEvent({ ...a })));
  });

  it('received with a NULL actor: senderDisplay:null is still present (undefined sentinel, not null check)', () => {
    const out = toEventLogItem({ msgId: 'm', ts: 1, circleId: 'c', actor: null, text: 't', senderDisplay: null });
    expect(out.payload).toHaveProperty('senderDisplay', null);
  });

  it('rehydrate legacy: senderDisplay present, no card', () => {
    const a = { msgId: 'm3', ts: 3, circleId: 'c3', actor: 'ann', text: 'hoi', senderDisplay: 'ann' };
    expect(toEventLogItem(a)).toEqual({
      id: 'm3', ts: 3, app: 'circle', type: 'chat-message', actor: 'ann',
      payload: { circleId: 'c3', text: 'hoi', kind: 'chat-message', senderDisplay: 'ann' },
    });
  });
});

describe('toEventLogItem ↔ fromEventLogItem round-trip', () => {
  it('recovers the transferable fields (senderDisplay is a render echo, dropped)', () => {
    const env = { msgId: 'm1', ts: 7, circleId: 'c', actor: 'me', text: 'hi', card: CARD, scope: 'circle' };
    const back = fromEventLogItem(toEventLogItem(env));
    expect(back).toEqual({ msgId: 'm1', ts: 7, circleId: 'c', actor: 'me', text: 'hi', card: CARD, scope: 'circle' });
  });
  it('round-trips a bare message', () => {
    const env = { msgId: 'x', ts: 1, circleId: 'c', actor: 'a', text: 't' };
    expect(fromEventLogItem(toEventLogItem(env))).toEqual(env);
  });
});

describe('toWireEnvelope (toWire) — canonical → fan-out wire', () => {
  it('byte-identical to the former broadcastCircleMessage literal (with card)', () => {
    const a = { circleId: 'c1', msgId: 'm1', ts: 9, text: 'hi', fromActor: 'me', fromWebid: 'https://id/me', card: CARD };
    expect(toWireEnvelope(a)).toEqual(goldenWire(a));
    expect(JSON.stringify(toWireEnvelope(a))).toBe(JSON.stringify(goldenWire(a)));
  });

  it('no card → legacy wire shape (no card key)', () => {
    const a = { circleId: 'c1', msgId: 'm1', ts: 9, text: 'hi', fromActor: 'me', fromWebid: 'me', card: null };
    const wire = toWireEnvelope(a);
    expect(wire).not.toHaveProperty('card');
    expect(wire).toEqual({ type: 'p2p-chat', subtype: 'circle-chat-message', circleId: 'c1', msgId: 'm1', ts: 9, text: 'hi', fromActor: 'me', fromWebid: 'me' });
  });

  it('local-only fields never ride the wire: only text + whitelisted card transfer', () => {
    // A card pointer is the ONLY structured extra allowed on the wire; the
    // render-only fields (review/provenance/consent/buttons) have no path here.
    const wire = toWireEnvelope({ circleId: 'c', msgId: 'm', ts: 1, text: 't', fromActor: 'a', fromWebid: 'a', card: CARD });
    const json = JSON.stringify(wire);
    expect(json).not.toContain('review');
    expect(json).not.toContain('provenance');
    expect(json).not.toContain('consent');
    expect(json).not.toContain('buttons');
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

function goldenRefWire({ circleId, msgId, ts, ref, fromActor, fromWebid, card }) {
  return {
    type: 'p2p-chat', subtype: 'circle-chat-message',
    circleId, msgId, ts, ref, fromActor, fromWebid,
    ...(card ? { card } : {}),
  };
}

describe('toWireRefEnvelope — the pod-signal ref projection', () => {
  const a = { circleId: 'g1', msgId: 'm1', ts: 100, ref: 'urn:pod:g1:row:42', fromActor: 'bob', fromWebid: 'bob' };

  it('is the sibling of toWireEnvelope with `text` replaced by `ref` (no body on the wire)', () => {
    const wire = toWireRefEnvelope(a);
    expect(wire).toEqual(goldenRefWire(a));
    expect(wire).not.toHaveProperty('text');
    expect(wire.ref).toBe('urn:pod:g1:row:42');
    expect(wire.subtype).toBe(CIRCLE_CHAT_KIND);
  });

  it('carries a whitelisted card pointer when present (absent → no card key)', () => {
    expect(toWireRefEnvelope({ ...a, card: CARD })).toEqual(goldenRefWire({ ...a, card: CARD }));
    expect(toWireRefEnvelope(a)).not.toHaveProperty('card');
    // a non-object card is dropped (same guard as toWireEnvelope)
    expect(toWireRefEnvelope({ ...a, card: ['x'] })).not.toHaveProperty('card');
  });

  it('the ref body never leaks the text: the wire JSON contains the pointer, not content', () => {
    const wire = toWireRefEnvelope(a);
    expect(JSON.stringify(wire)).not.toContain('"text"');
  });
});

describe('toWireRefEnvelope ↔ fromWireRefEnvelope round-trip', () => {
  it('recovers the canonical ref fields byte-for-byte', () => {
    const a = { circleId: 'g1', msgId: 'm1', ts: 100, ref: 'urn:pod:g1:row:42', fromActor: 'bob', fromWebid: 'bob', card: CARD };
    expect(fromWireRefEnvelope(toWireRefEnvelope(a))).toEqual(a);
  });

  it('without card, the round-trip omits the card key', () => {
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
