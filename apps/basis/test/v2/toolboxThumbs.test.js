/**
 * A toolbox's pictures, fetched BY THE BOX and handed on as bytes (ledger L1035; Fable's conditions, 2026-11-19): only
 * from the toolbox's own placed host (the egress stays one host per toolbox), only jpeg/png/webp judged by the first
 * bytes (never svg), at most ~15 kB each and 10 per reply, within a short time; anything else is left out and the row
 * stays. The shop's URL never travels on: a door never fetches a shop's picture itself.
 */
import { describe, it, expect } from 'vitest';
import { fetchThumbs, THUMB_MAX_BYTES } from '../../src/v2/toolboxClient.js';

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]);
const WEBP = Uint8Array.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), 7]);
const SVG = Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
const ENDPOINT = 'https://box.example:8443/a2a';

function fakeFetch(map, seen = []) {
  return async (url, init = {}) => {
    seen.push({ url: String(url), auth: init.headers?.authorization ?? init.headers?.Authorization ?? null });
    const body = map[String(url)];
    if (body === 'slow') return new Promise(() => {});
    if (!body) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  };
}
const item = (image) => ({ label: 'x', image });

describe('the box fetches a toolbox\'s pictures', () => {
  it('jpeg, png and webp from the toolbox\'s own host become bytes on the row; the URL goes', async () => {
    const seen = [];
    const fetch = fakeFetch({ 'https://box.example:8443/img/1.jpg': JPEG, 'https://box.example:8443/img/2.png': PNG, 'https://box.example:8443/img/3.webp': WEBP }, seen);
    const out = await fetchThumbs([item('https://box.example:8443/img/1.jpg'), item('https://box.example:8443/img/2.png'), item('https://box.example:8443/img/3.webp')], { endpoint: ENDPOINT, key: 'k', fetch });
    expect(out.map((x) => x.thumb?.mime)).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(Buffer.from(out[0].thumb.data, 'base64')).toEqual(Buffer.from(JPEG));
    expect(out.every((x) => x.image === null)).toBe(true);
    expect(seen.every((s) => s.auth === 'Bearer k')).toBe(true);
  });
  it('another host, svg or an unknown type, too large, slow, or past the tenth: left out, the row stays', async () => {
    const big = new Uint8Array(THUMB_MAX_BYTES + 1); big.set(JPEG);
    const seen = [];
    const fetch = fakeFetch({ 'https://box.example:8443/svg': SVG, 'https://box.example:8443/big.jpg': big, 'https://box.example:8443/slow.jpg': 'slow', 'https://box.example:8443/ok.jpg': JPEG }, seen);
    const rows = [item('https://shop.example/melk.jpg'), item('https://box.example:8443/svg'), item('https://box.example:8443/big.jpg'), item('https://box.example:8443/slow.jpg')];
    const out = await fetchThumbs(rows, { endpoint: ENDPOINT, key: 'k', fetch, timeoutMs: 50 });
    expect(out.map((x) => x.thumb ?? null)).toEqual([null, null, null, null]);
    expect(out.map((x) => x.label)).toEqual(['x', 'x', 'x', 'x']);
    expect(seen.some((s) => s.url.startsWith('https://shop.example'))).toBe(false);
    const many = Array.from({ length: 12 }, () => item('https://box.example:8443/ok.jpg'));
    const eleven = await fetchThumbs(many, { endpoint: ENDPOINT, key: 'k', fetch: fakeFetch({ 'https://box.example:8443/ok.jpg': JPEG }) });
    expect(eleven.filter((x) => x.thumb).length).toBe(10);
  });
});
