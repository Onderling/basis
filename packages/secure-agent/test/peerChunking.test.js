/**
 * Chunking over the peer façade — a payload bigger than the ROUTE's envelope limit arrives whole,
 * and the app on either side never learns chunking exists.
 *
 * The property is proven at the real boundary: two secure agents over an InternalTransport whose
 * declared `maxEnvelopeBytes` is squeezed small, so a modest payload must chunk. The wire is spied
 * at `sendOneWay` — the ONE door every envelope leaves through — so the chunk count is measured on
 * what actually travelled, not inferred from the splitter's return value.
 */
import { describe, it, expect, vi } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '@onderling/core';
import { createSecureAgent } from '../src/createSecureAgent.js';
import { chunkPayloadForRoute, makeChunkReassembler, payloadOverRouteLimit } from '../src/peerChunking.js';

const until = async (pred, { timeout = 5000, step = 10 } = {}) => {
  const start = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - start >= timeout) return v;
    await new Promise((r) => setTimeout(r, step));
  }
};

/** An InternalTransport that declares a small envelope ceiling, the way NKN declares its 60 KB. */
class TinyLimitTransport extends InternalTransport {
  get maxEnvelopeBytes() { return 16 * 1024; }
}

describe('the splitter and the reassembler (pure)', () => {
  it('round-trips a payload through chunks; the last carries final + the json encoding marker', () => {
    const payload = { type: 'p2p-chat', subtype: 'file-share', file: { dataB64: 'x'.repeat(120_000) } };
    const parts = chunkPayloadForRoute(payload, 16 * 1024);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.at(-1).final).toBe(true);
    expect(parts.at(-1).meta).toEqual({ encoding: 'json' });
    expect(parts.slice(0, -1).every((c) => c.final === false && c.meta === undefined)).toBe(true);

    let got = null;
    const re = makeChunkReassembler({ onPayload: (w) => { got = w; } });
    for (const c of parts) expect(re({ _from: 'peer-a', payload: c })).toBe(true);
    expect(got).toEqual(payload);
  });

  it('a payload that fits the route needs no chunks, and a chunk is never re-chunked', () => {
    expect(chunkPayloadForRoute({ small: 'y' }, 16 * 1024)).toBe(null);
    expect(payloadOverRouteLimit({ type: 'bulk-chunk', data: 'z'.repeat(100_000) }, 16 * 1024)).toBe(null);
  });

  it('a transfer with a lost chunk is REFUSED whole, never delivered mutilated', () => {
    const parts = chunkPayloadForRoute({ big: 'x'.repeat(120_000) }, 16 * 1024);
    const delivered = [];
    const re = makeChunkReassembler({ onPayload: (w) => delivered.push(w) });
    for (const c of parts) {
      if (c.seq === 1) continue;                        // the lost chunk
      re({ _from: 'peer-a', payload: c });
    }
    expect(delivered).toEqual([]);
  });

  it('two senders using the same transferId cannot cross their streams', () => {
    const parts = chunkPayloadForRoute({ big: 'x'.repeat(60_000) }, 16 * 1024, { transferId: 'shared-id' });
    const delivered = [];
    const re = makeChunkReassembler({ onPayload: (w, env) => delivered.push(env._from) });
    // interleave the SAME chunks from two senders — each completes independently
    for (const c of parts) { re({ _from: 'peer-a', payload: c }); re({ _from: 'peer-b', payload: c }); }
    expect(delivered.sort()).toEqual(['peer-a', 'peer-b']);
  });

  it('a sender streaming endless non-final chunks hits the byte bound and the transfer is dropped', () => {
    const delivered = [];
    const re = makeChunkReassembler({ onPayload: (w) => delivered.push(w), maxTransferChars: 10_000 });
    for (let seq = 0; seq < 5; seq += 1) {
      re({ _from: 'peer-a', payload: { type: 'bulk-chunk', transferId: 'flood', seq, data: 'z'.repeat(4_000), final: false } });
    }
    // the final chunk of the now-dropped transfer starts a NEW entry with a gap → refused
    re({ _from: 'peer-a', payload: { type: 'bulk-chunk', transferId: 'flood', seq: 5, data: 'z', final: true, meta: { encoding: 'json' } } });
    expect(delivered).toEqual([]);
  });
});

describe('over two real secure agents (the façade path, sealed end to end)', () => {
  it('an over-limit payload arrives WHOLE at onPeerMessage; the wire carried only control-sized chunks', async () => {
    const bus = new InternalBus();
    const received = [];
    const receiver = await createSecureAgent({
      vault: new VaultMemory(), warnOnInsecure: false,
      onPeerMessage: (m) => received.push(m),
    });
    const sender = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });
    const rxTx = new TinyLimitTransport(bus, receiver.identity.pubKey);
    const txTx = new TinyLimitTransport(bus, sender.identity.pubKey);
    await receiver.addSecureTransport('relay', rxTx);
    await sender.addSecureTransport('relay', txTx);

    const wire = vi.spyOn(txTx, 'sendOneWay');
    const payload = { type: 'p2p-chat', subtype: 'file-share', file: { name: 'foto.jpg', dataB64: 'a'.repeat(80_000) } };
    const res = await sender.peer.sendTo(receiver.identity.pubKey, payload);

    expect(res?.chunked).toBe(true);
    expect(res.chunks).toBeGreaterThan(1);

    await until(() => received.some((m) => m?.payload?.subtype === 'file-share'));
    const whole = received.find((m) => m?.payload?.subtype === 'file-share');
    expect(whole, 'the reassembled payload reaches the app').toBeTruthy();
    expect(whole.payload).toEqual(payload);
    // the app never saw a chunk…
    expect(received.some((m) => m?.payload?.type === 'bulk-chunk')).toBe(false);
    // …and every wire envelope was a chunk of the declared transfer, none over-limit
    const wireChunks = wire.mock.calls.map(([, p]) => p).filter((p) => p?.type === 'bulk-chunk');
    expect(wireChunks.length).toBe(res.chunks);
    expect(new Set(wireChunks.map((c) => c.transferId)).size).toBe(1);
    expect(wireChunks.at(-1).final).toBe(true);
  });

  it('a chunked send REPORTS the delivery verdict — it never claims "sent" for a held transfer', async () => {
    // The 2026-05-23 lesson, one layer down: the non-chunked path returns sendOneWay's
    // {held, delivered, reason} and /send-file reads it to say what really happened. The chunked
    // path awaited each chunk and threw the answer away, so EVERY chunked send fell through to
    // "sent" — including one whose chunks the transport held. Found on a device walk (2026-09-03):
    // the phone never got the photo and the sender said "sent" four times.
    // NB the peer must be ROUTABLE — an unknown address is held above the chunker (already honest);
    // this pins the case where the route resolves and the TRANSPORT holds.
    const bus = new InternalBus();
    const receiver = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, onPeerMessage: () => {} });
    const sender = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });
    const txTx = new TinyLimitTransport(bus, sender.identity.pubKey);
    await receiver.addSecureTransport('relay', new TinyLimitTransport(bus, receiver.identity.pubKey));
    await sender.addSecureTransport('relay', txTx);
    // warm the route (the HI handshake) so the send reaches the chunker rather than the hold queue
    await sender.peer.sendTo(receiver.identity.pubKey, { subtype: 'plain', text: 'hi' });

    const held = { held: true, delivered: false, msgId: 'm', pending: 1, reason: 'peer-offline' };
    vi.spyOn(txTx, 'sendOneWay').mockResolvedValue(held);

    const res = await sender.peer.sendTo(receiver.identity.pubKey, {
      type: 'p2p-chat', subtype: 'file-share', file: { name: 'foto.jpg', dataB64: 'a'.repeat(80_000) },
    });

    expect(res?.chunked, 'still says HOW it travelled').toBe(true);
    expect(res.chunks, 'and how many parts').toBeGreaterThan(1);
    // …and now also WHETHER it arrived — the whole point.
    expect(res.held, 'a held transfer reports held').toBe(true);
    expect(res.delivered).toBe(false);
    expect(res.reason).toBe('peer-offline');
  });

  it('a chunked send whose parts all land reports delivered', async () => {
    const bus = new InternalBus();
    const receiver = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, onPeerMessage: () => {} });
    const sender = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });
    await receiver.addSecureTransport('relay', new TinyLimitTransport(bus, receiver.identity.pubKey));
    await sender.addSecureTransport('relay', new TinyLimitTransport(bus, sender.identity.pubKey));

    const res = await sender.peer.sendTo(receiver.identity.pubKey, {
      type: 'p2p-chat', subtype: 'file-share', file: { name: 'foto.jpg', dataB64: 'a'.repeat(80_000) },
    });
    expect(res?.chunked).toBe(true);
    expect(res.delivered, 'a transfer whose every chunk went out is delivered').toBe(true);
    expect(res.held).toBe(false);
  });

  it('a small payload still travels as ONE envelope — no chunk tax on ordinary traffic', async () => {
    const bus = new InternalBus();
    const received = [];
    const receiver = await createSecureAgent({
      vault: new VaultMemory(), warnOnInsecure: false,
      onPeerMessage: (m) => received.push(m),
    });
    const sender = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });
    const txTx = new TinyLimitTransport(bus, sender.identity.pubKey);
    await receiver.addSecureTransport('relay', new TinyLimitTransport(bus, receiver.identity.pubKey));
    await sender.addSecureTransport('relay', txTx);

    const wire = vi.spyOn(txTx, 'sendOneWay');
    await sender.peer.sendTo(receiver.identity.pubKey, { subtype: 'plain', text: 'hallo' });
    await until(() => received.some((m) => m?.payload?.subtype === 'plain'));
    expect(wire.mock.calls.map(([, p]) => p).filter((p) => p?.type === 'bulk-chunk')).toEqual([]);
  });
});
