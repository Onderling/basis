import { describe, it, expect } from 'vitest';
import { podStorageBackend } from '../src/sealing/podStorageBackend.js';

// A circle's message rows live under the CIRCLE's container, which may sit on another person's pod. A client's own
// pod root is the wrong base for them: the founder would write outside the container it granted, and a member would
// look for the row on their own pod.
function fakeClient() {
  const m = new Map();
  return {
    m,
    write: async (uri, body) => { m.set(uri, body); },
    read: async (uri) => { if (!m.has(uri)) { const e = new Error('nf'); e.code = 'NOT_FOUND'; throw e; } return { content: m.get(uri) }; },
    list: async (prefix) => [...m.keys()].filter((k) => k.startsWith(prefix)).map((uri) => ({ uri })),
  };
}
const BASE = 'https://ann.pod/circles/c1/';

describe('podStorageBackend with a base', () => {
  it('puts and gets a relative ref under the base', async () => {
    const c = fakeClient();
    const b = podStorageBackend(c, { base: BASE });
    await b.put('c1/0001-m1', 'X');
    expect([...c.m.keys()]).toEqual([`${BASE}c1/0001-m1`]);
    expect(await b.get('c1/0001-m1')).toBe('X');
  });

  it('lists under the base and hands back refs relative to it', async () => {
    const c = fakeClient();
    const b = podStorageBackend(c, { base: BASE });
    await b.put('c1/0001-m1', 'X');
    expect(await b.list('c1/')).toEqual(['c1/0001-m1']);
  });

  it('leaves an absolute ref alone', async () => {
    const c = fakeClient();
    const b = podStorageBackend(c, { base: BASE });
    await b.put('https://other.pod/x', 'Y');
    expect(c.m.has('https://other.pod/x')).toBe(true);
  });

  it('a base on any absolute scheme is honoured (an in-memory pod is pseudo-pod://), not silently dropped', async () => {
    const c = fakeClient();
    const b = podStorageBackend(c, { base: 'pseudo-pod://central/circles/c1' });
    await b.put('c1/0001-m1', 'X');
    expect([...c.m.keys()]).toEqual(['pseudo-pod://central/circles/c1/c1/0001-m1']);
    expect(await b.list('c1/')).toEqual(['c1/0001-m1']);
  });

  it('lists through a client shaped like PodClient ({container, entries}), not only a bare array', async () => {
    const c = fakeClient();
    const real = { ...c, list: async (prefix) => ({ container: prefix, entries: await c.list(prefix) }) };
    const b = podStorageBackend(real, { base: BASE });
    await b.put('c1/0001-m1', 'X');
    expect(await b.list('c1/')).toEqual(['c1/0001-m1']);
  });

  it('without a base nothing changes', async () => {
    const c = fakeClient();
    const b = podStorageBackend(c);
    await b.put('c1/0001-m1', 'X');
    expect([...c.m.keys()]).toEqual(['c1/0001-m1']);
  });
});
