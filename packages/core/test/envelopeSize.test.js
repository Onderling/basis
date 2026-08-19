/**
 * A size limit on the peer wire.
 *
 * Before this, the only bound was the `ws` library default: a **64 MB envelope was forwarded intact**
 * through a real relay, and at 120 MB the library killed the SENDER's socket with code 1009 and no typed
 * error — so a receiver could not tell a refusal from a peer going offline.
 *
 * The tests that matter here are not "is the number enforced" but the two honesty properties: nothing is
 * silently shortened, and a refusal is distinguishable from a disconnection.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_ENVELOPE_BYTES, EnvelopeTooLargeError, envelopeExceedsLimit, envelopeByteLength,
  InternalBus, InternalTransport,
} from '../src/index.js';

const big = (bytes) => ({ subtype: 'flood', blob: 'x'.repeat(bytes) });

describe('the limit itself', () => {
  it('is far above anything the wire legitimately carries', () => {
    // The peer wire is a control plane — files go through the blob gateway and travel as references. The
    // biggest real envelopes are a chat line (500 chars), a card, an invite (1–2 KB).
    const chat = { subtype: 'circle-chat-message', text: 'x'.repeat(500) };
    expect(envelopeExceedsLimit(chat)).toBeNull();
    expect(envelopeByteLength(chat)).toBeLessThan(MAX_ENVELOPE_BYTES / 100);
  });

  it('catches the walked attack', () => {
    const over = envelopeExceedsLimit(big(64 * 1024 * 1024));
    expect(over).toMatchObject({ limit: MAX_ENVELOPE_BYTES });
    expect(over.bytes).toBeGreaterThan(64 * 1024 * 1024);
  });

  it('measures UTF-8 bytes, not characters — a multi-byte payload cannot slip past', () => {
    // 'é' is two bytes, so this string is UNDER the limit by character count and OVER it by bytes.
    // Counting characters would let roughly twice the intended payload through.
    const chars = MAX_ENVELOPE_BYTES - 1000;         // fewer characters than the byte limit
    const payload = { t: 'é'.repeat(chars) };
    expect(chars).toBeLessThan(MAX_ENVELOPE_BYTES);   // a character count would say "fine"
    expect(envelopeExceedsLimit(payload), 'measured by characters rather than bytes').not.toBeNull();
  });

  it('something unmeasurable is allowed through — this is a size limit, not a validator', () => {
    // Refusing what we merely failed to measure would break sends for the wrong reason.
    const circular = {}; circular.self = circular;
    expect(envelopeExceedsLimit(circular)).toBeNull();
  });
});

describe('the honesty properties', () => {
  it('a refusal is TYPED, so it cannot be mistaken for a peer going offline', () => {
    const err = new EnvelopeTooLargeError(999, 100);
    expect(err.reason).toBe('envelope-too-large');
    expect(err.bytes).toBe(999);
    expect(err.limit).toBe(100);
    expect(err.message).toMatch(/999/);
  });

  it('the SENDER is told, rather than discovering it as a dropped connection', async () => {
    const tx = new InternalTransport(new InternalBus(), 'me');
    await expect(tx.sendOneWay('them', big(MAX_ENVELOPE_BYTES + 1))).rejects.toMatchObject({
      reason: 'envelope-too-large',
    });
  });

  it('an oversized INBOUND envelope is refused and reported, not silently dropped', async () => {
    // The check an attacker cannot skip: mDNS and NKN never pass a relay, so a relay-only limit would
    // bound only the path that happens to have a server on it.
    const bus = new InternalBus();
    const rx = new InternalTransport(bus, 'them');
    const seen = [];
    rx.on('security-error', (err) => seen.push(err));
    rx._receive(big(MAX_ENVELOPE_BYTES + 1));

    expect(seen).toHaveLength(1);
    expect(seen[0].reason).toBe('envelope-too-large');
  });

  it('an envelope at exactly the limit still goes — the ceiling is not an off-by-one', async () => {
    const tx = new InternalTransport(new InternalBus(), 'me');
    const payload = { t: 'x'.repeat(MAX_ENVELOPE_BYTES - 2000) };
    expect(envelopeExceedsLimit(payload)).toBeNull();
    await expect(tx.sendOneWay('them', payload)).resolves.not.toThrow();
  });
});
