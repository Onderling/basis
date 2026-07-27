/**
 * G13 step B — extra addresses are a property of the PORT, not of one adapter.
 *
 * A member presents a different address in every circle, so a device must answer at several at once. The
 * alias set, the public API and the replay rule therefore live in the base `Transport`; an adapter only
 * says HOW to bind one. Three separate implementations would be three subtly different answers to the same
 * question — and step C already showed what a gap between transports costs: messages routed to an address
 * nobody answers on the paths that had not caught up.
 */
import { describe, it, expect } from 'vitest';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { Transport } from '../src/transport/Transport.js';

const CIRCLE_X = 'anna@circle-x';
const CIRCLE_Y = 'anna@circle-y';

describe('the port contract', () => {
  it('a transport WITHOUT alias support says so instead of pretending', async () => {
    class Bare extends Transport { async _put() {} }
    const t = new Bare({ address: 'anna' });
    expect(t.supportsAliases).toBe(false);
    await expect(t.addAddress(CIRCLE_X)).resolves.toEqual({ ok: false, reason: 'aliases-unsupported' });
    // …and it does NOT claim the address, so a caller cannot be misled into routing there.
    expect(t.addresses).toEqual(['anna']);
  });

  it('the primary address is always already ours', async () => {
    class Bare extends Transport { async _put() {} }
    const t = new Bare({ address: 'anna' });
    await expect(t.addAddress('anna')).resolves.toEqual({ ok: true });
    expect(t.addresses).toEqual(['anna']);
  });

  it('junk is refused with a reason, not silently swallowed', async () => {
    const t = new InternalTransport(new InternalBus(), 'anna');
    for (const bad of [null, undefined, '', 42, {}]) {
      await expect(t.addAddress(bad)).resolves.toMatchObject({ ok: false, reason: 'invalid-address' });
    }
  });

  it('a failing bind reports failure but KEEPS the alias for the next connect', async () => {
    // A bind can fail simply because we are offline; the replay on reconnect is what should fix that, so
    // dropping the alias would turn a transient failure into a permanent one.
    class Flaky extends Transport {
      get supportsAliases() { return true; }
      async _bindAddress() { throw new Error('offline'); }
      async _put() {}
    }
    const t = new Flaky({ address: 'anna' });
    await expect(t.addAddress(CIRCLE_X)).resolves.toMatchObject({ ok: false, reason: 'offline' });
    expect(t.addresses).toEqual(['anna', CIRCLE_X]);
  });
});

describe('InternalTransport answers at its aliases', () => {
  it('a message to an alias arrives, and the primary still works', async () => {
    const bus = new InternalBus();
    const anna = new InternalTransport(bus, 'anna');
    const bram = new InternalTransport(bus, 'bram');
    const inbox = [];
    anna.on('envelope', (p) => inbox.push(p));
    await anna.connect(); await bram.connect();

    await anna.addAddress(CIRCLE_X);
    await bram.sendOneWay(CIRCLE_X, { text: 'to-my-circle-address' });
    await bram.sendOneWay('anna', { text: 'to-my-primary' });
    await new Promise((r) => setTimeout(r, 20));

    expect(JSON.stringify(inbox)).toContain('to-my-circle-address');
    expect(JSON.stringify(inbox)).toContain('to-my-primary');   // nothing taken away while senders migrate
    await anna.disconnect(); await bram.disconnect();
  });

  it('aliases survive a reconnect', async () => {
    const bus = new InternalBus();
    const anna = new InternalTransport(bus, 'anna');
    const bram = new InternalTransport(bus, 'bram');
    const inbox = [];
    anna.on('envelope', (p) => inbox.push(p));
    await anna.connect(); await bram.connect();
    await anna.addAddress(CIRCLE_X);

    await anna.disconnect();
    await anna.connect();                                        // a fresh binding, no memory of the last

    await bram.sendOneWay(CIRCLE_X, { text: 'after-reconnect' });
    await new Promise((r) => setTimeout(r, 20));
    expect(JSON.stringify(inbox)).toContain('after-reconnect');
    await anna.disconnect(); await bram.disconnect();
  });

  it('several circles at once', async () => {
    const bus = new InternalBus();
    const anna = new InternalTransport(bus, 'anna');
    const bram = new InternalTransport(bus, 'bram');
    const inbox = [];
    anna.on('envelope', (p) => inbox.push(p));
    await anna.connect(); await bram.connect();
    await anna.addAddress(CIRCLE_X);
    await anna.addAddress(CIRCLE_Y);
    expect(anna.addresses).toEqual(['anna', CIRCLE_X, CIRCLE_Y]);

    for (const a of [CIRCLE_X, CIRCLE_Y]) await bram.sendOneWay(a, { text: `hi-${a}` });
    await new Promise((r) => setTimeout(r, 20));
    expect(inbox).toHaveLength(2);
    await anna.disconnect(); await bram.disconnect();
  });

  it('disconnect stops answering at EVERY address, not just the primary', async () => {
    const bus = new InternalBus();
    const anna = new InternalTransport(bus, 'anna');
    await anna.connect();
    await anna.addAddress(CIRCLE_X);
    await anna.disconnect();
    // A leftover binding would route to a transport that believes it is offline.
    expect(bus.__peers?.has(CIRCLE_X)).toBe(false);
    expect(bus.__peers?.has('anna')).toBe(false);
  });

  it('removeAddress stops delivery immediately', async () => {
    const bus = new InternalBus();
    const anna = new InternalTransport(bus, 'anna');
    const bram = new InternalTransport(bus, 'bram');
    const inbox = [];
    anna.on('envelope', (p) => inbox.push(p));
    await anna.connect(); await bram.connect();
    await anna.addAddress(CIRCLE_X);
    anna.removeAddress(CIRCLE_X);

    await bram.sendOneWay(CIRCLE_X, { text: 'should-not-arrive' });
    await new Promise((r) => setTimeout(r, 20));
    expect(inbox).toHaveLength(0);
    expect(anna.addresses).toEqual(['anna']);
    await anna.disconnect(); await bram.disconnect();
  });
});
