/**
 * Answer AS the address you were addressed to (G13) — the reason no message ever crossed.
 *
 * Per-circle addresses live in `Transport`'s alias set, and `sendHello` used to stamp the PRIMARY address
 * unconditionally. So a peer who dialled one of our circle addresses got a reply from our canonical address,
 * filed our key under that, and went on waiting for a key under the alias it had dialled — then timed out and
 * reported us offline while we were actively answering it. A handshake to a per-circle address could never
 * complete.
 *
 * Diagnosed on hardware 2026-07-30 from three facts that were all true at once: the phone received 9 HIs at
 * its circle address, sent 18 replies which the other side received, and the other side still said
 * *"peer w4WQscGR… did not respond with HI within 5000ms; they may be offline"*.
 *
 * The fix keeps the circle address as the identity on the wire end to end, so the peer never learns our
 * canonical address — the unlinkability the whole feature exists for. The rejected alternative (letting the
 * dialler credit a canonical-address reply to the alias) would also have worked and would have handed them
 * exactly the circle-address → identity link the design withholds.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Transport } from '../../src/transport/Transport.js';
import { REPLY_CODES } from '../../src/Envelope.js';

/** A Transport whose `_put` records what went out instead of sending it. */
class RecordingTransport extends Transport {
  constructor(opts) { super(opts); this.sent = []; }
  // Aliases are opt-in per adapter (the base returns false), and per-circle addressing only applies to an
  // adapter that has them — the relay. Opting in here is what makes this a test of the relay-shaped case.
  get supportsAliases() { return true; }
  async _put(to, envelope) { this.sent.push({ to, envelope }); }
}

const identity = { pubKey: 'pk-self', sign: async () => 'sig' };

describe('sendHello stamps the address it is told to answer as', () => {
  let tx;
  beforeEach(async () => {
    tx = new RecordingTransport({ identity, address: 'primary-addr' });
    await tx.addAddress('circle-addr-circle');
    await tx.addAddress('circle-addr-friends');
  });

  it('uses the alias when told to — the fix', async () => {
    await tx.sendHello('peer-1', { pubKey: 'pk-self' }, { from: 'circle-addr-circle' });
    expect(tx.sent.at(-1).envelope._from).toBe('circle-addr-circle');
  });

  it('still defaults to the primary address when not told', async () => {
    await tx.sendHello('peer-1', { pubKey: 'pk-self' });
    expect(tx.sent.at(-1).envelope._from).toBe('primary-addr');
  });

  it('the primary address is itself a valid thing to answer as', async () => {
    await tx.sendHello('peer-1', { pubKey: 'pk-self' }, { from: 'primary-addr' });
    expect(tx.sent.at(-1).envelope._from).toBe('primary-addr');
  });

  it('each circle answers as its OWN address — otherwise the circles are linkable', async () => {
    await tx.sendHello('peer-1', { pubKey: 'pk-self' }, { from: 'circle-addr-circle' });
    await tx.sendHello('peer-2', { pubKey: 'pk-self' }, { from: 'circle-addr-friends' });
    const froms = tx.sent.map((s) => s.envelope._from);
    expect(froms).toEqual(['circle-addr-circle', 'circle-addr-friends']);
    // …and neither leaked the canonical address, which is the property being protected.
    expect(froms).not.toContain('primary-addr');
  });
});

describe('an address we do not hold cannot be claimed', () => {
  // `_to` on an inbound envelope is attacker-influenced: a peer can address us at anything. Falling back to
  // the primary rather than echoing it means nobody can make us assert an address that is not ours.
  let tx;
  beforeEach(() => { tx = new RecordingTransport({ identity, address: 'primary-addr' }); });

  it('falls back to the primary for an unknown address — LOUDLY', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await tx.sendHello('peer-1', { pubKey: 'pk-self' }, { from: 'somebody-elses-address' });
      expect(tx.sent.at(-1).envelope._from).toBe('primary-addr');
      // Frits (review, 2026-07-30): the fallback is safe against hostile input, but a genuine wiring
      // mistake must not look like success — the warn is the trace.
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0][0])).toMatch(/does not hold/);
    } finally { warn.mockRestore(); }
  });

  it('an ordinary hello, and a held alias, warn about nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await tx.sendHello('peer-1', { pubKey: 'pk-self' });
      await tx.addAddress?.('circle-addr-circle');
      await tx.sendHello('peer-1', { pubKey: 'pk-self' }, { from: 'circle-addr-circle' });
      expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it('and for junk', async () => {
    for (const from of [null, undefined, '', 42, {}, []]) {
      await tx.sendHello('peer-1', { pubKey: 'pk-self' }, { from });
      expect(tx.sent.at(-1).envelope._from).toBe('primary-addr');
    }
  });

  it('an alias REMOVED is no longer claimable', async () => {
    await tx.addAddress('circle-addr-circle');
    await tx.sendHello('p', { pubKey: 'pk-self' }, { from: 'circle-addr-circle' });
    expect(tx.sent.at(-1).envelope._from).toBe('circle-addr-circle');

    await tx.removeAddress?.('circle-addr-circle');
    await tx.sendHello('p', { pubKey: 'pk-self' }, { from: 'circle-addr-circle' });
    expect(tx.sent.at(-1).envelope._from).toBe('primary-addr');
  });
});

describe('the reply-to atom, not an invented field', () => {
  it('an ordinary HI has no _re', async () => {
    const tx = new RecordingTransport({ identity, address: 'primary-addr' });
    await tx.sendHello('peer-1', { pubKey: 'pk-self' });
    expect(tx.sent.at(-1).envelope._re).toBeNull();
  });

  it('an HI carrying _re is NOT a reply code, so it cannot resolve a pending request', async () => {
    // The safety condition for reusing `_re` on a handshake: `_receive` resolves a pending promise only when
    // `REPLY_CODES.has(_p) && _re`, and HI is not in REPLY_CODES.
    const tx = new RecordingTransport({ identity, address: 'primary-addr' });
    await tx.sendHello('peer-1', { pubKey: 'pk-self' }, { re: 'someones-request' });
    expect(REPLY_CODES.has(tx.sent.at(-1).envelope._p)).toBe(false);
  });
});

describe('the envelope is otherwise unchanged', () => {
  it('still an HI carrying the payload, addressed to the peer', async () => {
    const tx = new RecordingTransport({ identity, address: 'primary-addr' });
    await tx.addAddress('circle-addr-circle');
    await tx.sendHello('peer-1', { pubKey: 'pk-self' }, { from: 'circle-addr-circle', re: 'their-env-id' });
    const { to, envelope } = tx.sent.at(-1);
    expect(to).toBe('peer-1');
    expect(envelope._to).toBe('peer-1');
    expect(envelope._p).toBe('HI');
    expect(envelope.payload).toMatchObject({ pubKey: 'pk-self' });
    // The reply-to atom carries "this answers that", so no payload flag is invented for it.
    expect(envelope._re).toBe('their-env-id');
  });
});
