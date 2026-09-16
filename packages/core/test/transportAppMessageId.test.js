/**
 * A transport remembers which APPLICATION message id rode each outgoing envelope, so a report that arrives later
 * naming the envelope (the relay's give-up) can be translated to the id the app keeps its delivery state under.
 */
import { describe, it, expect } from 'vitest';
import { Transport } from '../src/transport/Transport.js';

class Probe extends Transport {
  constructor() { super({ address: 'probe.addr' }); this.put = []; }
  async _put(to, envelope) { this.put.push({ to, envelope }); }
  async connect() {}
  async disconnect() {}
}

describe('appMessageIdFor', () => {
  it('maps the outgoing envelope id to the payload msgId; an id-less payload maps to nothing', async () => {
    const t = new Probe();
    await t.sendOneWay('peer', { msgId: 'm1', text: 'hoi' });
    await t.sendOneWay('peer', { text: 'no id' });
    const [withId, without] = t.put.map((p) => p.envelope);
    expect(withId._id).not.toBe('m1');
    expect(t.appMessageIdFor(withId._id)).toBe('m1');
    expect(t.appMessageIdFor(without._id)).toBe(null);
    expect(t.appMessageIdFor('never-sent')).toBe(null);
    expect(t.appMessageIdFor(null)).toBe(null);
  });

  it('is bounded — the oldest entry goes first, and the newest are always answerable', async () => {
    const t = new Probe();
    for (let i = 0; i < 2005; i++) await t.sendOneWay('peer', { msgId: `m${i}` });
    const first = t.put[0].envelope._id, last = t.put[t.put.length - 1].envelope._id;
    expect(t.appMessageIdFor(first)).toBe(null);
    expect(t.appMessageIdFor(last)).toBe('m2004');
  });
});
