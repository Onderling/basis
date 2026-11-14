/**
 * A KEY EVENT'S FAN NEVER HOLDS ITS CALLER. Admitting a member writes the key file and appends the key event; the
 * event's fan to the newcomer cannot land before the newcomer's own join finishes (its per-circle address goes on the
 * relay in its post-join step, after the admission's reply). With the fan awaited inside the append, the admission's
 * reply waited on it and the joiner's redeem ran out ("the admin could not be reached"; found 2026-11-14 on a founder
 * phone in a pod-backed circle). The append records and signs, starts the fan, and returns; a fan that fails is said.
 */
import { describe, it, expect } from 'vitest';
import { makeKeyEventLogSink } from '../src/keyEventLogSink.js';

const EVENT = { groupId: 'c1', version: 2, recipients: ['pk-a', 'pk-b'] };
const base = (over = {}) => ({
  groupId: 'c1',
  resolveRecipientAddrs: async () => ['addr-b'],
  resolveRecipientWebids: async () => ['webid-b'],
  sendPeer: async () => ({ delivered: true }),
  emitStatement: async () => ({ body: { hash: 'h1' }, sig: 's' }),
  statementSubtype: 'circle-key-statement',
  ...over,
});

describe('a key event\'s fan never holds its caller', () => {
  it('the append returns while the fan to the newcomer is still pending', async () => {
    let started = false;
    const sink = makeKeyEventLogSink(base({ fanStatement: () => { started = true; return new Promise(() => {}); } }));
    const outcome = await Promise.race([
      sink.append(EVENT).then(() => 'returned'),
      new Promise((r) => { setTimeout(() => r('held'), 200); }),
    ]);
    expect(outcome).toBe('returned');
    expect(started, 'the fan was started').toBe(true);
  });

  it('a fan that fails is said, and the direct fan still runs without holding the caller', async () => {
    const failed = [];
    const direct = [];
    const sink = makeKeyEventLogSink(base({
      fanStatement: async () => { throw new Error('peer-unreachable'); },
      sendPeer: (addr) => { direct.push(addr); return new Promise(() => {}); },
      onFanFailed: (why) => { failed.push(why); },
    }));
    await sink.append(EVENT);
    await new Promise((r) => { setTimeout(r, 20); });
    expect(direct).toEqual(['addr-b']);
    expect(failed.length).toBe(1);
  });

  it('the event is recorded locally before the append returns', async () => {
    const recorded = [];
    const sink = makeKeyEventLogSink(base({ recordLocal: (e) => recorded.push(e.version), fanStatement: () => new Promise(() => {}) }));
    await sink.append(EVENT);
    expect(recorded).toEqual([2]);
  });
});
