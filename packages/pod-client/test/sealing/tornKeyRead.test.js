/**
 * A TORN READ MUST NOT LOSE A MEMBER. Measured on a Community Solid Server (2026-11-15): a GET that overlapped another
 * writer's PUT returned the OLD body under the NEW ETag. A writer that built on it passed its If-Match and wrote back a
 * file without the other writer's member: every write conditional, no 412 swallowed, and still a lost update. The read
 * a key-file change builds on is now trusted only when two consecutive GETs agree on ETag and body; a pair that never
 * agrees writes nothing and says so (KEY_READ_TORN).
 */
import { describe, it, expect } from 'vitest';
import { createPodKeyStore } from '../../src/sealing/podKeyStore.js';
import { changeKeyResource } from '../../src/sealing/keyResourceWrite.js';

/** A pod with ETags and conditional writes; `tearNext(n)` makes the next n reads serve the PREVIOUS body under the CURRENT ETag;
 *  `tearEveryOther()` tears every second read for good (two reads in a row never agree). */
function fakePod() {
  let body = null; let prevBody = null; let n = 0; let tear = 0; let alternate = false; let flip = false; let revert = false;
  const etag = () => (body == null ? null : `"e${n}"`);
  return {
    tearNext(k = 1) { tear = k; },
    tearEveryOther() { alternate = true; },
    /** right after the next write, another writer's stale write puts the previous file back (once) */
    revertAfterNextWrite() { revert = true; },
    get stored() { return body == null ? null : JSON.parse(body); },
    async read() {
      if (body == null) throw Object.assign(new Error('nf'), { status: 404 });
      if (tear > 0 && prevBody != null) { tear -= 1; return { content: prevBody, etag: etag() }; }
      if (alternate && prevBody != null) { flip = !flip; if (flip) return { content: prevBody, etag: etag() }; }
      return { content: body, etag: etag() };
    },
    async write(_uri, payload, opts = {}) {
      if (opts.ifNoneMatch === '*' && body != null) throw Object.assign(new Error('412'), { status: 412 });
      if (opts.ifMatch && opts.ifMatch !== etag()) throw Object.assign(new Error('412'), { status: 412 });
      prevBody = body; body = payload; n += 1;
      if (revert) { revert = false; const b = prevBody; prevBody = body; body = b; n += 1; }
      return { uri: _uri };
    },
  };
}
const add = (who) => async (cur) => ((cur?.recipients ?? []).includes(who) ? null : { version: 1, recipients: [...(cur?.recipients ?? []), who] });

describe('a torn read under a key-file change', () => {
  it('the probe\'s trace: tab two reads the old body under the new ETag; both members still hold the key', async () => {
    const pod = fakePod();
    const one = createPodKeyStore({ podClient: pod, uri: 'https://pod.example/c/.keys/group.json' });
    const two = createPodKeyStore({ podClient: pod, uri: 'https://pod.example/c/.keys/group.json' });
    await changeKeyResource(one, add('founder'));
    await changeKeyResource(one, add('m0'));
    await changeKeyResource(one, add('m2'));      // the file now holds m2, under a new ETag
    pod.tearNext(1);                              // tab two's next GET overlaps that PUT: old body, new ETag
    await changeKeyResource(two, add('m1'));
    expect(pod.stored.recipients).toEqual(expect.arrayContaining(['founder', 'm0', 'm1', 'm2']));
  });

  it('a pair that never agrees writes nothing and says so', async () => {
    const pod = fakePod();
    const ks = createPodKeyStore({ podClient: pod, uri: 'https://pod.example/c/.keys/group.json' });
    await changeKeyResource(ks, add('founder'));
    await changeKeyResource(ks, add('m0'));
    const before = JSON.stringify(pod.stored);
    pod.tearEveryOther();
    await expect(changeKeyResource(ks, add('m1'))).rejects.toMatchObject({ code: 'KEY_READ_TORN' });
    expect(JSON.stringify(pod.stored), 'nothing written').toBe(before);
  });
  it('the verify after a write: its own change gone from the file is applied again', async () => {
    const pod = fakePod();
    const ks = createPodKeyStore({ podClient: pod, uri: 'https://pod.example/c/.keys/group.json' });
    await changeKeyResource(ks, add('founder'));
    pod.revertAfterNextWrite();
    await changeKeyResource(ks, add('m0'));
    expect(pod.stored.recipients).toEqual(expect.arrayContaining(['founder', 'm0']));
  });
});
