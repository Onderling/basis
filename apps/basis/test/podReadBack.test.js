/**
 * The pod read-back runs when a circle is opened and when the page or app comes back to the front, one read per circle
 * at a time, no timer.
 */
import { describe, it, expect, vi } from 'vitest';
import { createPodReadBack } from '../src/v2/podReadBack.js';
import { setActiveCircle } from '../src/v2/activeCircle.js';

describe('the pod read-back', () => {
  it('opening a circle reads that circle back', async () => {
    const catchUp = { catchUpCircle: vi.fn(async () => ({ ingested: 2 })) };
    const rb = createPodReadBack({ catchUp, listCircleIds: async () => [] });
    setActiveCircle('c-open');
    await new Promise((r) => { setTimeout(r, 0); });
    expect(catchUp.catchUpCircle).toHaveBeenCalledWith('c-open');
    rb.stop();
    setActiveCircle(null);
  });

  it('coming back to the front reads every live circle; one read per circle at a time', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const catchUp = { catchUpCircle: vi.fn(async () => { await gate; return { ingested: 1 }; }) };
    const rb = createPodReadBack({ catchUp, listCircleIds: async () => ['a', 'b'], subscribeOpened: null });
    const first = rb.onForeground();
    const second = rb.onCircleOpened('a');   // 'a' is already being read: joins it
    release();
    expect(await first).toEqual({ ingested: 2 });
    expect(await second).toEqual({ ingested: 1 });
    expect(catchUp.catchUpCircle.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
  });

  it('without a catch-up (no pod circles) it does nothing, and a failing read does not throw', async () => {
    const none = createPodReadBack({ catchUp: null, listCircleIds: async () => ['a'], subscribeOpened: null });
    expect(await none.onForeground()).toEqual({ ingested: 0 });
    const failing = createPodReadBack({ catchUp: { catchUpCircle: async () => { throw new Error('pod down'); } }, listCircleIds: async () => ['a'], subscribeOpened: null });
    expect(await failing.onForeground()).toEqual({ ingested: 0 });
  });
});
