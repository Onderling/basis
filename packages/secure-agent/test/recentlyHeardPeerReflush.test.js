/**
 * A PEER I HEARD MOMENTS AGO WHOSE SOCKET MOVED. Anna heard Bram seconds ago; then his socket went away (his phone shut
 * down while another of his devices took his address) and a send to him found nobody to answer its HI — so it was
 * held, waiting for a presence signal. But the device that now holds his address has no reason to announce itself to
 * her, so that signal never comes. A peer heard within the window who then fails a HI is a socket that moved, not a
 * person who left: the hold re-flushes on the same short bounded back-off as a young address (never counted toward
 * the write-off), then waits for presence as any hold.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '@onderling/core';
import { createSecureAgent } from '../src/createSecureAgent.js';

const FAST = { firstSendTimeoutMs: 400, retryDelays: [] };
const BACKOFF = { recentlyHeardWindowMs: 10_000, youngAddressRetryMs: [300, 900, 1800] };

async function until(pred, { timeout = 1200, step = 25 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = pred(); if (v) return v; await new Promise((r) => setTimeout(r, step)); }
  return pred();
}

async function annaAndBram(annaOpts) {
  const bus = new InternalBus({ presenceAware: true });   // a socket that went away is unreachable, so the send is HELD
  const toAnna = []; const toBram = [];
  const anna = await createSecureAgent({ vault: new VaultMemory(), onPeerMessage: (m) => toAnna.push(m), warnOnInsecure: false, ...annaOpts });
  const bram = await createSecureAgent({ vault: new VaultMemory(), onPeerMessage: (m) => toBram.push(m), warnOnInsecure: false });
  const annaTx = new InternalTransport(bus, anna.identity.pubKey);
  const bramTx = new InternalTransport(bus, bram.identity.pubKey);
  await anna.addSecureTransport('relay', annaTx);
  await bram.addSecureTransport('relay', bramTx);
  // Bram speaks first: Anna has heard him
  await bram.peer.sendTo(anna.identity.pubKey, { subtype: 'note', text: 'hoi Anna', msgId: 'b1' }, FAST);
  await until(() => toAnna.some((m) => m.payload?.text === 'hoi Anna'));
  return { anna, bram, bramTx, toAnna, toBram };
}

describe('a peer heard moments ago, whose socket moved', () => {
  it('a send that finds nobody to answer is held — and re-flushed on the back-off, so it arrives once his socket is back', { timeout: 20_000 }, async () => {
    const { anna, bram, bramTx, toAnna, toBram } = await annaAndBram(BACKOFF);
    expect(toAnna.some((m) => m.payload?.text === 'hoi Anna'), 'Anna heard Bram').toBe(true);
    await bramTx.disconnect();   // his socket goes away, without a word
    const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'note', text: 'en jij?', msgId: 'a1' }, { ...FAST, guarantee: 'hold-forward' });
    await bramTx.connect();      // …and comes back (another device of his took the address) — silently
    expect(await until(() => toBram.some((m) => m.payload?.text === 'en jij?'), { timeout: 6000, step: 50 }), 'the held send never arrived').toBe(true);
    await anna.shutdown(); await bram.shutdown();
  });

  it('a peer NOT heard within the window gets no back-off: the hold waits for presence, as before', { timeout: 20_000 }, async () => {
    const { anna, bram, bramTx, toBram } = await annaAndBram({ ...BACKOFF, recentlyHeardWindowMs: 1 });
    await new Promise((res) => setTimeout(res, 20));   // Bram was heard, but longer ago than the window
    await bramTx.disconnect();
    const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'note', text: 'en jij?', msgId: 'a2' }, { ...FAST, guarantee: 'hold-forward' });
    expect(r.held).toBe(true);
    await bramTx.connect();
    await new Promise((res) => setTimeout(res, 4000));
    expect(toBram.some((m) => m.payload?.text === 'en jij?'), 'no re-flush without recent contact').toBe(false);
    expect(anna.heldFor(bram.identity.pubKey)).toBe(1);
    await anna.shutdown(); await bram.shutdown();
  });
});
