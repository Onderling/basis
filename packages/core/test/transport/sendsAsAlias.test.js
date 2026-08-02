/**
 * The port half of Decision 4 — an envelope may speak FROM one of this transport's extra addresses.
 *
 * `sendHello` already took `{ from }` (the G13 fix of 2026-07-30: answer as the address you were
 * dialled at, or a handshake to a per-circle address never completes). Every OTHER primitive still
 * stamped the primary, so the reply to a circle message named the person globally even though the
 * message it answered did not — and the auto-ACK did it without anyone asking.
 *
 * The validation rule is the one `sendHello` already had and is now shared: a claim is honoured only
 * if this transport actually holds that address. `_to` on an inbound envelope is attacker-influenced
 * and is one of the values passed here, so an unheld claim must never make us speak as it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Transport } from '../../src/transport/Transport.js';
import { P } from '../../src/Envelope.js';

class Recorder extends Transport {
  sent = [];
  get supportsAliases() { return true; }
  async _bindAddress() {}
  async _put(to, envelope) { this.sent.push({ to, envelope }); }
}

const ALIAS = 'per-circle-address-oosterpoort';

describe('an envelope can speak from an alias', () => {
  let tx;
  beforeEach(async () => {
    tx = new Recorder({ address: 'primary-address' });
    await tx.addAddress(ALIAS);
  });

  it('sendOneWay stamps the alias when asked', async () => {
    await tx.sendOneWay('peer', { hi: 1 }, { from: ALIAS });
    expect(tx.sent.at(-1).envelope._from).toBe(ALIAS);
  });

  it('publishOneWay, request and respond do too — one rule, not one per primitive', async () => {
    await tx.publishOneWay('peer', 'topic', {}, { from: ALIAS });
    expect(tx.sent.at(-1).envelope._from).toBe(ALIAS);
    tx.request('peer', {}, 50, { from: ALIAS }).catch(() => {});
    await Promise.resolve();
    expect(tx.sent.at(-1).envelope._from).toBe(ALIAS);
    await tx.respond('peer', 'some-id', {}, { from: ALIAS });
    expect(tx.sent.at(-1).envelope._from).toBe(ALIAS);
  });

  it('defaults to the primary when nothing is asked for', async () => {
    await tx.sendOneWay('peer', {});
    expect(tx.sent.at(-1).envelope._from).toBe('primary-address');
  });

  it('REFUSES a claim to an address it does not hold, and falls back to the primary', async () => {
    await tx.sendOneWay('peer', {}, { from: 'an-address-this-device-never-bound' });
    expect(tx.sent.at(-1).envelope._from).toBe('primary-address');
  });

  it('the auto-ACK answers AS the address that was dialled', async () => {
    // An AS envelope addressed to our alias: the ack must not name the primary, or the sender (and
    // the relay) learns that the per-circle address and the global one are the same device.
    tx._receive({ _p: P.AS, _id: 'as-1', _from: 'peer', _to: ALIAS, payload: {} });
    const ack = tx.sent.find((s) => s.envelope._p === P.AK);
    expect(ack.envelope._from).toBe(ALIAS);
    expect(ack.envelope._re).toBe('as-1');
  });

  it('the auto-ACK still answers as the primary for ordinary traffic', async () => {
    tx._receive({ _p: P.AS, _id: 'as-2', _from: 'peer', _to: 'primary-address', payload: {} });
    const ack = tx.sent.find((s) => s.envelope._re === 'as-2');
    expect(ack.envelope._from).toBe('primary-address');
  });
});
