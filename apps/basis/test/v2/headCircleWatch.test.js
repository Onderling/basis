/**
 * A HEAD HEARS OF A CIRCLE IT DOES NOT KNOW YET. Vandaag and Mij are heads kept current by the circles' changes; they
 * read over the circle list the shell holds. A circle that arrives while the page is shown — joined on another device,
 * through an offer, made by an op — changes items in a circle that list does not hold: the list is re-read FIRST, then
 * the head hears the change, so the new circle's items show without a reload.
 */
import { describe, it, expect } from 'vitest';
import { watchCircleChanges } from '../../src/v2/headCircleWatch.js';

const source = () => { const fns = new Set(); return { on: (fn) => { fns.add(fn); return () => fns.delete(fn); }, fire: (cid) => { for (const f of fns) f(cid, { origin: 'test' }); } }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('watchCircleChanges', () => {
  it('a change in a circle the list does not hold: the list is re-read, THEN the head hears it', async () => {
    const src = source(); const order = []; const known = new Set(['a']);
    const subscribe = watchCircleChanges({ onCircleChanged: src.on, knows: (cid) => known.has(cid), refresh: async () => { order.push('refresh'); known.add('b'); } });
    subscribe((cid) => order.push(`heard:${cid}:${known.has(cid)}`));
    src.fire('b'); await tick(); await tick();
    expect(order).toEqual(['refresh', 'heard:b:true']);
  });
  it('a change in a known circle is heard at once, nothing re-read', async () => {
    const src = source(); const order = [];
    const subscribe = watchCircleChanges({ onCircleChanged: src.on, knows: () => true, refresh: async () => order.push('refresh') });
    subscribe((cid) => order.push(`heard:${cid}`));
    src.fire('a');
    expect(order).toEqual(['heard:a']);
  });
  it('a refresh that fails still lets the head hear the change', async () => {
    const src = source(); const order = [];
    const subscribe = watchCircleChanges({ onCircleChanged: src.on, knows: () => false, refresh: async () => { throw new Error('offline'); } });
    subscribe((cid) => order.push(`heard:${cid}`));
    src.fire('z'); await tick(); await tick();
    expect(order).toEqual(['heard:z']);
  });
});
