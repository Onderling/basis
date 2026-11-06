/**
 * A MESSAGE THAT ALREADY LANDED LANDS ONCE — ALSO AFTER A RESTART. A frame can reach a device twice: a sender re-sends
 * after a lost acknowledgement, a hold-forward flush replays, a relay hands a frame on. The receiver used to collapse
 * repeats only for chat turns and only in memory, so after a restart a repeat landed again, and acts and fans had no
 * check at all. The secure agent now asks one injected record of what it has taken (`seenInbound`) before any handler,
 * and writes to it only after the handler accepted, so a frame that was refused or that failed stays retryable.
 */
import { describe, it, expect } from 'vitest';
import { createSecureAgent } from '../src/createSecureAgent.js';
import { VaultMemory } from '@onderling/vault';

function fakeTransport() {
  const handlers = {};
  return {
    address: 'fake.addr',
    useSecurityLayer() { /* not under test */ },
    on(evt, fn) { handlers[evt] = fn; },
    async connect() { /* no-op */ },
    async disconnect() { /* no-op */ },
    async sendHello() { /* the answer is not under test */ },
    async sendOneWay() { return { ok: true }; },
    async inbound(env) { await handlers.envelope?.(env); },
  };
}

/** What a device keeps across a restart: the record outlives the agent that wrote it. */
function durableRecord() {
  const keys = new Set();
  return { keys, seenInbound: { has: (k) => keys.has(k), add: (k) => { keys.add(k); } } };
}

async function boot({ seenInbound, onPeerMessage }) {
  const tx = fakeTransport();
  const sa = await createSecureAgent({ vault: new VaultMemory(), onPeerMessage, seenInbound });
  await sa.addSecureTransport('relay', tx);
  return { sa, tx };
}

const chatTurn = { type: 'message', parts: [{ type: 'DataPart', data: { subtype: 'chat-message', body: 'hoi', nonce: 'turn-1' } }] };
const act = { subtype: 'spine-act', msgId: 'act-1' };
const fan = { subtype: 'membership-broadcast', msgId: 'mem:abc' };

describe('a message that already landed lands once, across a restart', () => {
  for (const [name, payload] of [['a chat turn', chatTurn], ['an act', act], ['a fan', fan]]) {
    it(`${name}: delivered, the device restarts, delivered again → handed to the app once`, async () => {
      const record = durableRecord();
      const seen = [];
      const first = await boot({ seenInbound: record.seenInbound, onPeerMessage: (env) => { seen.push(env.payload); } });
      await first.tx.inbound({ _from: 'anna', _id: 'frame-1', _p: 'OW', payload });
      await first.sa.shutdown?.();

      const second = await boot({ seenInbound: record.seenInbound, onPeerMessage: (env) => { seen.push(env.payload); } });
      await second.tx.inbound({ _from: 'anna', _id: 'frame-2', _p: 'OW', payload });
      await second.sa.shutdown?.();

      expect(seen.length, 'the repeat reached the app again after the restart').toBe(1);
    });
  }

  it('the same id from ANOTHER sender is its own message', async () => {
    const record = durableRecord();
    const seen = [];
    const { sa, tx } = await boot({ seenInbound: record.seenInbound, onPeerMessage: (env) => { seen.push(env._from ?? env.from); } });
    await tx.inbound({ _from: 'anna', _id: 'f1', _p: 'OW', payload: fan });
    await tx.inbound({ _from: 'bram', _id: 'f2', _p: 'OW', payload: fan });
    await sa.shutdown?.();
    expect(seen).toEqual(['anna', 'bram']);
  });

  it('a frame the handler did not accept is not recorded — its retry lands', async () => {
    const record = durableRecord();
    const seen = [];
    let accept = false;
    const { sa, tx } = await boot({
      seenInbound: record.seenInbound,
      onPeerMessage: async (env) => {
        seen.push(env.payload.msgId);
        if (!accept) return { refused: true };
        return undefined;
      },
    });
    await tx.inbound({ _from: 'anna', _id: 'f1', _p: 'OW', payload: act });   // refused: not recorded
    accept = true;
    await tx.inbound({ _from: 'anna', _id: 'f2', _p: 'OW', payload: act });   // the retry is handed on and accepted
    await tx.inbound({ _from: 'anna', _id: 'f3', _p: 'OW', payload: act });   // a repeat of an accepted one is not
    await sa.shutdown?.();
    expect(seen).toEqual(['act-1', 'act-1']);
  });

  it('a handler that throws or rejects leaves the frame retryable', async () => {
    const record = durableRecord();
    let n = 0;
    const { sa, tx } = await boot({
      seenInbound: record.seenInbound,
      onPeerMessage: async () => { n += 1; if (n === 1) throw new Error('crashed mid-handle'); },
    });
    await tx.inbound({ _from: 'anna', _id: 'f1', _p: 'OW', payload: act });
    await tx.inbound({ _from: 'anna', _id: 'f2', _p: 'OW', payload: act });
    await sa.shutdown?.();
    expect(n).toBe(2);
  });

  it('a frame with no id is never deduped (a greeting, a ping)', async () => {
    const record = durableRecord();
    const seen = [];
    const { sa, tx } = await boot({ seenInbound: record.seenInbound, onPeerMessage: (env) => { seen.push(env.payload.subtype); } });
    await tx.inbound({ _from: 'anna', _id: 'f1', _p: 'OW', payload: { subtype: 'ping' } });
    await tx.inbound({ _from: 'anna', _id: 'f2', _p: 'OW', payload: { subtype: 'ping' } });
    await sa.shutdown?.();
    expect(seen).toEqual(['ping', 'ping']);
    expect(record.keys.size).toBe(0);
  });
});
