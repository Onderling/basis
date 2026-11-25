/**
 * A PLAIN VALUE IN A SEALED MAP STORE IS NOT TAKEN AS CONTENT ON A DEVICE WHOSE KEY IS NEWER THAN THE RULE.
 *
 * `sealedPersist` opens every stored row with the content seal; a row that was never sealed opens "as itself" and
 * was handed on as content. That pass-through was kept for devices that stored rows before sealing existed. The
 * sealed key-value stores and the sealing backend refuse a plain value once the device's content key carries the rule
 * (`plainRefused` on the strategy): anyone who can write the storage could otherwise put words into a person's lists
 * that read as their own. The map stores now follow the same rule: on such a device a plain row is not handed on, it
 * is kept byte for byte (never deleted, never written over), and said once. On an older key it reads as before.
 */
import { describe, it, expect } from 'vitest';
import { sealedPersist } from '../src/sealedPersist.js';

function strategy({ plainRefused }) {
  return {
    plainRefused,
    seal: (t) => `sealed:${Buffer.from(t).toString('base64')}`,
    open: (t) => (t.startsWith('sealed:') ? Buffer.from(t.slice(7), 'base64').toString() : t),   // plain passes through
  };
}
function memoryAdapter(initial) {
  const a = { stored: new Map(initial) };
  a.load = async () => new Map(a.stored);
  a.save = async (m) => { a.stored = new Map(m); };
  a.scheduleSave = (m) => { a.stored = new Map(m); };
  a.flush = async (m) => { if (m) a.stored = new Map(m); };
  return a;
}
const SEALED = `sealed:${Buffer.from('{"title":"brood"}').toString('base64')}`;
const PLAIN = '{"title":"planted"}';

describe('sealedPersist and a plain row', () => {
  it('a key newer than the rule: the plain row is not content, and it is kept as it is', async () => {
    const said = [];
    const a = memoryAdapter([['mem://x/items/a', SEALED], ['mem://x/items/b', PLAIN]]);
    const p = sealedPersist(a, strategy({ plainRefused: true }), (m) => said.push(m));
    const m = await p.load();
    expect([...m.keys()]).toEqual(['mem://x/items/a']);
    await p.save(m);
    expect(a.stored.get('mem://x/items/b'), 'the plain row was written over or deleted').toBe(PLAIN);
    expect(said.some((l) => l.includes('mem://x/items/b'))).toBe(true);
    expect(said.join(' ')).not.toContain('planted');   // the key is said, never the content
  });

  it('an older key: a plain row reads as it did, and is sealed at the next save', async () => {
    const a = memoryAdapter([['mem://x/items/b', PLAIN]]);
    const p = sealedPersist(a, strategy({ plainRefused: false }));
    const m = await p.load();
    expect(m.get('mem://x/items/b')).toBe(PLAIN);
    await p.save(m);
    expect(a.stored.get('mem://x/items/b').startsWith('sealed:')).toBe(true);
  });
});
