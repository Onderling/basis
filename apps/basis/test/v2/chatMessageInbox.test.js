import { describe, it, expect, vi } from 'vitest';
import {
  createChatMessageInbox,
  isValidChatEnvelope,
} from '../../src/v2/chatMessageInbox.js';

function fakeEventLog() {
  const events = [];
  return { events, append: (e) => { events.push(e); } };
}

function envelope(over = {}) {
  return {
    subtype:   'circle-chat-message',
    circleId:  'g1',
    msgId:     'm1',
    text:      'Hoi circle!',
    ts:        1735_000_000_000,
    fromActor: 'webid:anne',
    ...over,
  };
}

const silentLogger = { warn: () => {}, info: () => {}, debug: () => {} };

describe('createChatMessageInbox · ε.1 single normalization gate', () => {
  it('throws when eventLog is missing', () => {
    expect(() => createChatMessageInbox({})).toThrow(/eventLog/);
  });

  /* ── validation ── */

  it('returns inserted + appends event on a valid envelope', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const r = await inbox.ingestChatMessage(envelope(), { source: 'receiver', fromPeerAddr: 'nkn-anne' });
    expect(r).toEqual({ result: 'inserted' });
    expect(eventLog.events).toHaveLength(1);
    const ev = eventLog.events[0];
    expect(ev.id).toBe('m1');
    expect(ev.ts).toBe(1735_000_000_000);
    expect(ev.app).toBe('circle');
    expect(ev.type).toBe('chat-message');
    expect(ev.actor).toBe('webid:anne');
    expect(ev.payload).toEqual({
      circleId: 'g1',
      text:     'Hoi circle!',
      kind:     'chat-message',
      // Arrival IS the evidence of reach: this envelope came over the circle fan-out, so the bubble may
      // say "whole circle". Without it both shells' badge fell through to "only you" on every received
      // message — the visibility chip claiming the opposite of the truth.
      scope:    'circle',
      senderDisplay: 'webid:anne',
    });
  });

  /* ── the embed card riding a message — any variant, not only a photo ── */

  it('lands an envelope card on payload.card (the receiver chip path)', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const card = {
      kind: 'media-card', pointer: { type: 'media', ref: 'urn:dec:item:m9' },
      snapshot: { type: 'media', id: 'm9', source: { type: 'blob', ref: 'blob://k', enc: { sealed: true, thumb: 'fp1:sealed' } } },
    };
    const r = await inbox.ingestChatMessage(envelope({ card }), { source: 'receiver', fromPeerAddr: 'nkn-anne' });
    expect(r).toEqual({ result: 'inserted' });
    expect(eventLog.events[0].payload.card).toEqual(card);
    // The rest of the payload is unchanged by the card ride-along.
    expect(eventLog.events[0].payload.text).toBe('Hoi circle!');
    expect(eventLog.events[0].payload.kind).toBe('chat-message');
  });

  it('accepts EVERY card variant, not only a photo — the receiver does not police the kinds', async () => {
    // The drop this pins: the gate used to insist on `media-card`, so an appointment that survived the
    // sender's per-variant whitelist was discarded here, on arrival, with nothing said. Which kinds may
    // travel is the SENDER's boundary to decide (`cardForCircleWire`); the receiver's job is to accept
    // a card-shaped thing and let the renderer paint whichever variant it is.
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const appointment = {
      kind: 'time-card', appOrigin: 'calendar',
      itemRef: { app: 'calendar', type: 'calendar-event', id: 'evt-2' },
      snapshot: { id: 'evt-2', type: 'calendar-event', title: 'Koffie', startAt: '2026-09-02T09:00:00.000Z' },
    };
    await inbox.ingestChatMessage(envelope({ card: appointment, msgId: 'm-time' }), { source: 'receiver' });
    expect(eventLog.events[0].payload.card).toEqual(appointment);
  });

  it('a NON-card object on the envelope is dropped, and the message still lands', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    await inbox.ingestChatMessage(envelope({ card: { kind: 'not-a-thing' }, msgId: 'm-junk' }), { source: 'receiver' });
    expect(eventLog.events[0].payload).not.toHaveProperty('card');
    expect(eventLog.events[0].payload.text).toBe('Hoi circle!');
  });

  it('an envelope WITHOUT a card appends a payload with NO card key (render pin)', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    await inbox.ingestChatMessage(envelope(), { source: 'receiver' });
    expect(eventLog.events[0].payload).not.toHaveProperty('card');
  });

  it('drops a malformed media field but keeps the MESSAGE (text still lands)', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const cases = ['📷 string', ['array'], { kind: 'file-card' }, 42];
    let n = 0;
    for (const media of cases) {
      const r = await inbox.ingestChatMessage(envelope({ msgId: `mm-${n += 1}`, media }), { source: 'receiver' });
      expect(r.result).toBe('inserted');
    }
    for (const ev of eventLog.events) {
      expect(ev.payload).not.toHaveProperty('media');
      expect(ev.payload.text).toBe('Hoi circle!');
    }
  });

  it('rejects (does not append) on malformed envelopes', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const cases = [
      null,
      { subtype: 'circle-chat-message', circleId: '',  msgId: 'm', text: 't', ts: 1 },
      { subtype: 'circle-chat-message', circleId: 'g', msgId: '',  text: 't', ts: 1 },
      { subtype: 'circle-chat-message', circleId: 'g', msgId: 'm', text: '',  ts: 1 },
      { subtype: 'circle-chat-message', circleId: 'g', msgId: 'm', text: 't', ts: 'x' },
      { subtype: 'something-else',     circleId: 'g', msgId: 'm', text: 't', ts: 1 },
    ];
    for (const c of cases) {
      const r = await inbox.ingestChatMessage(c, { source: 'receiver' });
      expect(r.result).toBe('rejected');
      expect(r.reason).toBe('malformed');
    }
    expect(eventLog.events).toHaveLength(0);
  });

  it('exposes isValidChatEnvelope as a named export', () => {
    expect(isValidChatEnvelope(envelope())).toBe(true);
    expect(isValidChatEnvelope(null)).toBeFalsy();
    expect(isValidChatEnvelope({ ...envelope(), subtype: 'nope' })).toBeFalsy();
  });

  /* ── dedup ── */

  it('returns deduped on second arrival with same msgId — only one append', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const r1 = await inbox.ingestChatMessage(envelope({ msgId: 'mX', text: 'first' }), { source: 'receiver' });
    const r2 = await inbox.ingestChatMessage(envelope({ msgId: 'mX', text: 'second' }), { source: 'receiver' });
    expect(r1.result).toBe('inserted');
    expect(r2.result).toBe('deduped');
    expect(eventLog.events).toHaveLength(1);
    expect(eventLog.events[0].payload.text).toBe('first');
  });

  it('dedupes across sources — receiver then rehydrator with same msgId', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const r1 = await inbox.ingestChatMessage(envelope({ msgId: 'mY' }), { source: 'receiver' });
    const r2 = await inbox.ingestChatMessage(envelope({ msgId: 'mY' }), { source: 'rehydrator' });
    expect(r1.result).toBe('inserted');
    expect(r2.result).toBe('deduped');
    expect(eventLog.events).toHaveLength(1);
  });

  it('dedupes across sources — rehydrator then receiver with same msgId', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    const r1 = await inbox.ingestChatMessage(envelope({ msgId: 'mZ' }), { source: 'rehydrator' });
    const r2 = await inbox.ingestChatMessage(envelope({ msgId: 'mZ' }), { source: 'receiver', fromPeerAddr: 'nkn' });
    expect(r1.result).toBe('inserted');
    expect(r2.result).toBe('deduped');
    expect(eventLog.events).toHaveLength(1);
  });

  it('LRU dedup evicts the oldest msgId once cap is exceeded', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, dedupCap: 2, logger: silentLogger });
    await inbox.ingestChatMessage(envelope({ msgId: 'A' }), { source: 'receiver' });
    await inbox.ingestChatMessage(envelope({ msgId: 'B' }), { source: 'receiver' });
    await inbox.ingestChatMessage(envelope({ msgId: 'C' }), { source: 'receiver' });   // evicts A
    const r = await inbox.ingestChatMessage(envelope({ msgId: 'A', text: 'replayed' }), { source: 'receiver' });
    expect(r.result).toBe('inserted');
    expect(eventLog.events.map((e) => e.id)).toEqual(['A', 'B', 'C', 'A']);
  });

  /* ── actor resolution ── */

  it('falls back to fromPeerAddr when payload.fromActor is missing', async () => {
    const eventLog = fakeEventLog();
    const inbox = createChatMessageInbox({ eventLog, logger: silentLogger });
    await inbox.ingestChatMessage(
      envelope({ msgId: 'mF', fromActor: null }),
      { source: 'receiver', fromPeerAddr: 'nkn-fallback' },
    );
    expect(eventLog.events[0].actor).toBe('nkn-fallback');
    expect(eventLog.events[0].payload.senderDisplay).toBe('nkn-fallback');
  });

  it('runs the constructor-level resolveActor by default', async () => {
    const eventLog = fakeEventLog();
    const resolveActor = vi.fn(() => 'Anne');
    const inbox = createChatMessageInbox({ eventLog, resolveActor, logger: silentLogger });
    await inbox.ingestChatMessage(envelope({ msgId: 'mR' }), { source: 'receiver', fromPeerAddr: 'nkn' });
    expect(resolveActor).toHaveBeenCalledTimes(1);
    expect(eventLog.events[0].actor).toBe('Anne');
    expect(eventLog.events[0].payload.senderDisplay).toBe('Anne');
  });

  /* ── self-authorship: my own messages, read back out of storage ── */

  describe('a message I wrote comes back as MINE', () => {
    const isSelfAuthored = (env) => env.fromActor === 'webid:me';

    it('stamps the local actor on a REHYDRATED own message (was: attributed to a stranger)', async () => {
      const eventLog = fakeEventLog();
      const inbox = createChatMessageInbox({ eventLog, isSelfAuthored, logger: silentLogger });
      await inbox.ingestChatMessage(
        envelope({ msgId: 'mine1', text: 'zie ik je zaterdag?', fromActor: 'webid:me' }),
        { source: 'rehydrator' },
      );
      expect(eventLog.events[0].actor).toBe('me');
    });

    it('renders IDENTICALLY to the live optimistic append — no sender name above my own bubble', async () => {
      const eventLog = fakeEventLog();
      const inbox = createChatMessageInbox({ eventLog, isSelfAuthored, logger: silentLogger });
      await inbox.ingestChatMessage(
        envelope({ msgId: 'mine2', fromActor: 'webid:me' }),
        { source: 'rehydrator' },
      );
      // `senderDisplay` ABSENT, exactly as `circleChatMessageEvent` omits it on the send path.
      expect(eventLog.events[0].payload).not.toHaveProperty('senderDisplay');
      expect(eventLog.events[0].payload.scope).toBe('circle');
    });

    it('covers the other restore paths too — pod replay and catch-up', async () => {
      const eventLog = fakeEventLog();
      const inbox = createChatMessageInbox({ eventLog, isSelfAuthored, logger: silentLogger });
      await inbox.ingestChatMessage(envelope({ msgId: 'mP1', fromActor: 'webid:me' }), { source: 'pod' });
      await inbox.ingestChatMessage(envelope({ msgId: 'mC1', fromActor: 'webid:me' }), { source: 'catchUp' });
      expect(eventLog.events.map((e) => e.actor)).toEqual(['me', 'me']);
    });

    it('leaves someone else\'s restored message attributed to them', async () => {
      const eventLog = fakeEventLog();
      const inbox = createChatMessageInbox({ eventLog, isSelfAuthored, logger: silentLogger });
      await inbox.ingestChatMessage(envelope({ msgId: 'mHers', fromActor: 'webid:anne' }), { source: 'rehydrator' });
      expect(eventLog.events[0].actor).toBe('webid:anne');
      expect(eventLog.events[0].payload.senderDisplay).toBe('webid:anne');
    });

    it('REFUSES to honour a live envelope claiming to be from me (that would render a peer\'s words as mine)', async () => {
      const eventLog = fakeEventLog();
      const inbox = createChatMessageInbox({ eventLog, isSelfAuthored, logger: silentLogger });
      await inbox.ingestChatMessage(
        envelope({ msgId: 'mSpoof', text: 'I agree with everything', fromActor: 'webid:me' }),
        { source: 'receiver', fromPeerAddr: 'nkn-mallory' },
      );
      expect(eventLog.events[0].actor).toBe('webid:me');   // attributed, never claimed as mine
      expect(eventLog.events[0].payload.senderDisplay).toBe('webid:me');
    });

    it('a throwing check degrades to the old attribution rather than to a wrong one', async () => {
      const eventLog = fakeEventLog();
      const inbox = createChatMessageInbox({
        eventLog, logger: silentLogger,
        isSelfAuthored: () => { throw new Error('identity unavailable'); },
      });
      await inbox.ingestChatMessage(envelope({ msgId: 'mBoom', fromActor: 'webid:me' }), { source: 'rehydrator' });
      expect(eventLog.events[0].actor).toBe('webid:me');
    });

    it('honours a custom localActor stamp', async () => {
      const eventLog = fakeEventLog();
      const inbox = createChatMessageInbox({ eventLog, isSelfAuthored, localActor: 'ik', logger: silentLogger });
      await inbox.ingestChatMessage(envelope({ msgId: 'mIk', fromActor: 'webid:me' }), { source: 'rehydrator' });
      expect(eventLog.events[0].actor).toBe('ik');
    });
  });

  it('runs the per-call resolveActor when provided (overrides constructor default)', async () => {
    const eventLog = fakeEventLog();
    const ctorActor = vi.fn(() => 'Default');
    const callActor = vi.fn(() => 'PerCall');
    const inbox = createChatMessageInbox({ eventLog, resolveActor: ctorActor, logger: silentLogger });
    await inbox.ingestChatMessage(
      envelope({ msgId: 'mP' }),
      { source: 'receiver', fromPeerAddr: 'nkn', resolveActor: callActor },
    );
    expect(ctorActor).not.toHaveBeenCalled();
    expect(callActor).toHaveBeenCalledTimes(1);
    expect(eventLog.events[0].actor).toBe('PerCall');
  });

  /* ── ingest verdicts ── */

  it('calls ingest first, then appends to eventLog when ingest is OK', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => ({ ok: true, itemId: 'item-1' }));
    const inbox = createChatMessageInbox({ eventLog, ingest, logger: silentLogger });
    const r = await inbox.ingestChatMessage(envelope({ msgId: 'mA' }), { source: 'receiver', fromPeerAddr: 'nkn' });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(ingest.mock.calls[0][0].msgId).toBe('mA');
    expect(ingest.mock.calls[0][1]).toBe('nkn');
    expect(r.result).toBe('inserted');
    expect(eventLog.events).toHaveLength(1);
  });

  it('returns evicted (no append) when ingest reports evicted', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => ({ evicted: true }));
    const inbox = createChatMessageInbox({ eventLog, ingest, logger: silentLogger });
    const r = await inbox.ingestChatMessage(envelope({ msgId: 'mE' }), { source: 'receiver' });
    expect(r.result).toBe('evicted');
    expect(eventLog.events).toHaveLength(0);
  });

  it('returns muted (no append) when ingest reports muted', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => ({ muted: true }));
    const inbox = createChatMessageInbox({ eventLog, ingest, logger: silentLogger });
    const r = await inbox.ingestChatMessage(envelope({ msgId: 'mM' }), { source: 'receiver' });
    expect(r.result).toBe('muted');
    expect(eventLog.events).toHaveLength(0);
  });

  it('returns deduped (no append) when ingest reports already-stored deduped', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => ({ deduped: true }));
    const inbox = createChatMessageInbox({ eventLog, ingest, logger: silentLogger });
    const r = await inbox.ingestChatMessage(envelope({ msgId: 'mD' }), { source: 'receiver' });
    expect(r.result).toBe('deduped');
    expect(eventLog.events).toHaveLength(0);
  });

  it('returns rejected (no append) when ingest returns an error', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => ({ error: 'storage down' }));
    const inbox = createChatMessageInbox({ eventLog, ingest, logger: silentLogger });
    const r = await inbox.ingestChatMessage(envelope({ msgId: 'mErr' }), { source: 'receiver' });
    expect(r.result).toBe('rejected');
    expect(r.reason).toBe('ingest-error');
    expect(eventLog.events).toHaveLength(0);
  });

  it('falls back to local-only append (still inserted) when ingest throws', async () => {
    const eventLog = fakeEventLog();
    const ingest = vi.fn(async () => { throw new Error('callSkill down'); });
    const inbox = createChatMessageInbox({ eventLog, ingest, logger: silentLogger });
    const r = await inbox.ingestChatMessage(envelope({ msgId: 'mT' }), { source: 'receiver' });
    expect(r.result).toBe('inserted');
    expect(eventLog.events).toHaveLength(1);
  });

  /* ── source tag ── */

  it('passes the source through to the info logger so telemetry can split paths', async () => {
    const eventLog = fakeEventLog();
    const info = vi.fn();
    const inbox = createChatMessageInbox({
      eventLog,
      logger: { warn: () => {}, info, debug: () => {} },
    });
    await inbox.ingestChatMessage(envelope({ msgId: 'mS1' }), { source: 'receiver', fromPeerAddr: 'nkn' });
    await inbox.ingestChatMessage(envelope({ msgId: 'mS2' }), { source: 'rehydrator' });
    const sources = info.mock.calls.map((c) => c.find((s) => typeof s === 'string' && s.startsWith('source=')));
    expect(sources).toEqual(['source=receiver', 'source=rehydrator']);
  });
});
