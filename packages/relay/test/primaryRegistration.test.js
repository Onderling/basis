/**
 * THE PRIMARY REGISTRATION (sync-policy §12, the DM half — Frits 2026-09-17, option (b)).
 *
 * A person's devices all register the same profile address, and until now the relay kept the LAST
 * registration — so a direct message landed on whichever device had reconnected last (the always-on box,
 * as a rule), never on the device the person chose. Now a client may register an address as PRIMARY:
 * the relay delivers to a primary socket while one is connected; a plain registration behind it stands
 * by and takes over only when the primary socket is gone. Without any primary the old rule holds (the
 * last plain registration wins), so a client from before the flag sees exactly what it always saw.
 *
 * What this does NOT do, stated: it orders the person's HONEST devices. A stolen device holds the
 * profile key and can register the address like any of them; nothing on a relay binds it to the
 * person's choice. That window (alpha plan W4) closes elsewhere — a per-contact channel, not here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startRelay } from '../src/server.js';
import { openClient, send, addr } from './helpers/provenClient.js';

const settle = () => new Promise((r) => setTimeout(r, 80));
async function waitFor(pred, ms = 1_500) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout (${ms}ms)`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
const ANNA = addr('anna-profile');
const BEA = addr('bea-profile');
const received = (ws) => ws.messages.filter((m) => m.type === 'message').map((m) => m.envelope.n);

describe('the primary registration', () => {
  let relay; let url; let bea;
  beforeEach(async () => {
    relay = await startRelay({ port: 0 });
    url = `ws://127.0.0.1:${relay.port}`;
    bea = await openClient(url);
    send(bea, { type: 'register', address: BEA });
    await waitFor(() => bea.messages.some((m) => m.type === 'registered'));
  });
  afterEach(async () => { bea.close(); await (relay.stop?.() ?? relay.close?.()); });
  const dm = async (n) => { send(bea, { type: 'send', to: ANNA, envelope: { subtype: 'dm', n } }); await settle(); };

  it('without a primary, the LAST plain registration wins — a client from before the flag sees no change', async () => {
    const phone = await openClient(url); send(phone, { type: 'register', address: ANNA });
    await waitFor(() => phone.messages.some((m) => m.type === 'registered'));
    const box = await openClient(url); send(box, { type: 'register', address: ANNA });
    await waitFor(() => box.messages.some((m) => m.type === 'registered'));
    await dm(1);
    expect(received(box)).toEqual([1]);
    expect(received(phone)).toEqual([]);
    phone.close(); box.close();
  });

  it('a PRIMARY registration keeps the address across a later plain one; the plain one stands by and takes over when the primary socket closes', async () => {
    const phone = await openClient(url); send(phone, { type: 'register', address: ANNA, primary: true });
    await waitFor(() => phone.messages.some((m) => m.type === 'registered'));
    const box = await openClient(url); send(box, { type: 'register', address: ANNA });
    await waitFor(() => box.messages.some((m) => m.type === 'registered'));
    await dm(1);
    expect(received(phone), 'the primary gets it, whoever registered last').toEqual([1]);
    expect(received(box)).toEqual([]);
    // the primary goes away → the standby takes over, live (no hold)
    phone.close(); await settle();
    await dm(2);
    expect(received(box), 'the standby took the address over').toEqual([2]);
    box.close();
  });

  it('a later PRIMARY registration takes the address from an earlier primary — the person changed their mind', async () => {
    const phone = await openClient(url); send(phone, { type: 'register', address: ANNA, primary: true });
    await waitFor(() => phone.messages.some((m) => m.type === 'registered'));
    const box = await openClient(url); send(box, { type: 'register', address: ANNA, primary: true });
    await waitFor(() => box.messages.some((m) => m.type === 'registered'));
    await dm(1);
    expect(received(box)).toEqual([1]);
    expect(received(phone)).toEqual([]);
    // …and the phone re-registering PLAINLY afterwards changes nothing while the box's primary socket lives
    send(phone, { type: 'register', address: ANNA });
    await waitFor(() => phone.messages.filter((m) => m.type === 'registered').length === 2);
    await dm(2);
    expect(received(box)).toEqual([1, 2]);
    phone.close(); box.close();
  });

  it('a standby that closes leaves the primary untouched; a primary that re-registers plainly steps down', async () => {
    const phone = await openClient(url); send(phone, { type: 'register', address: ANNA, primary: true });
    await waitFor(() => phone.messages.some((m) => m.type === 'registered'));
    const box = await openClient(url); send(box, { type: 'register', address: ANNA });
    await waitFor(() => box.messages.some((m) => m.type === 'registered'));
    box.close(); await settle();
    await dm(1);
    expect(received(phone)).toEqual([1]);
    // the phone steps down (the person made another device primary; this one re-registers plainly)
    const box2 = await openClient(url); send(box2, { type: 'register', address: ANNA });
    await waitFor(() => box2.messages.some((m) => m.type === 'registered'));
    send(phone, { type: 'register', address: ANNA, primary: false });
    await waitFor(() => phone.messages.filter((m) => m.type === 'registered').length === 2);
    await dm(2);
    expect(received(phone), 'no primary left → the last PLAIN registration wins again, and that is the step-down itself').toEqual([1, 2]);
    // …until the standby re-registers, or the device the person chose registers as primary
    send(box2, { type: 'register', address: ANNA, primary: true });
    await waitFor(() => box2.messages.filter((m) => m.type === 'registered').length === 2);
    await dm(3);
    expect(received(box2)).toEqual([3]);
    phone.close(); box2.close();
  });

  it('with nobody connected the message is HELD and drains to whoever registers — primary or not', async () => {
    await dm(1);
    const box = await openClient(url); send(box, { type: 'register', address: ANNA });
    await waitFor(() => received(box).length === 1);
    expect(received(box)).toEqual([1]);
    box.close();
  });
});
