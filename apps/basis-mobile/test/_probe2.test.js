import { describe, it } from 'vitest';
import { initCirclePods, ensureCirclePod } from '../src/core/circlePods.js';
import { useTestContentSeal } from './support/contentSeal.js';
useTestContentSeal();
describe('probe', () => {
  it('dump', async () => {
    const m = new Map();
    const storage = { raw: m, getItem: async k=>m.has(k)?m.get(k):null, setItem: async (k,v)=>{m.set(k,String(v));}, removeItem: async k=>{m.delete(k);}, getAllKeys: async ()=>[...m.keys()] };
    initCirclePods(storage);
    await ensureCirclePod('circle-rn-seal', { storagePosture: 'p2' });
    for (const [k,v] of m) console.info('ROW', k, '=>', String(v).slice(0,150));
  }, 60000);
});
