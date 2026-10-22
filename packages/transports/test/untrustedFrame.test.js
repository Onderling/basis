/**
 * A frame is a peer's JSON: a prototype key in it refuses the frame (the transports parse every inbound frame with
 * `parseUntrustedJson`; this one is the exported decoder, the rest are pinned by the `untrusted-json` guard).
 */
import { describe, it, expect } from 'vitest';
import { decodeFrame } from '../src/NetworkTransport.js';

describe('decodeFrame', () => {
  it('reads an ordinary frame', () => {
    expect(decodeFrame('{"v":1,"kind":"a2a","to":"b","from":"a","envelope":{"_id":"1"}}')).toMatchObject({ to: 'b', from: 'a' });
  });
  it('refuses a frame carrying `__proto__`, at any depth', () => {
    expect(() => decodeFrame('{"v":1,"kind":"a2a","to":"b","from":"a","__proto__":{"x":1},"envelope":{"_id":"1"}}')).toThrow(/unsafe key/);
    expect(() => decodeFrame('{"v":1,"kind":"a2a","to":"b","from":"a","envelope":{"_id":"1","payload":{"constructor":{}}}}')).toThrow(/unsafe key/);
  });
});

describe('a refused frame is reported, not silent', () => {
  it('NetworkTransport: a prototype key → a `security-error` (and the throw still reaches the caller); malformed JSON → none', async () => {
    const { NetworkTransport } = await import('../src/NetworkTransport.js');
    const t = new NetworkTransport({ address: 'me', send: () => {} });
    const reported = [];
    t.on('security-error', (err) => reported.push(err.code));
    expect(() => t.receiveFrame('{"v":1,"kind":"a2a","to":"me","from":"x","__proto__":{"a":1},"envelope":{"_id":"1"}}')).toThrow(/unsafe key/);
    expect(() => t.receiveFrame('{not json')).toThrow();
    expect(reported).toEqual(['UNSAFE_JSON_KEY']);
  });
});
