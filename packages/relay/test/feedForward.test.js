/**
 * The relay serves a person's agenda link by forwarding it to the node that holds the file — over a REAL relay, a REAL
 * node on a RelayTransport answering `feed.serve`, and the relay's real HTTP server.
 *
 * A link opens; the node away, a node nobody knows, a node that does not parse, a wrong key — the one 404, the same
 * body; nothing of the link (id, key, node) reaches the relay's log, even with its log on; a refresh storm on one link
 * asks the node once; misses take the same time whether the node is there or not.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import { Agent, AgentIdentity, Parts, allowSender } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { randomKey } from '@onderling/blob-gateway';
import { startRelay } from '../src/server.js';
import { mountFeedForward, FEED_MISS_BODY } from '../src/feedForward.js';

const cleanups = [];
afterEach(async () => { while (cleanups.length) { try { await cleanups.pop()(); } catch { /* best-effort */ } } vi.restoreAllMocks(); });

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Tandarts Bea\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const NOBODY = 'B'.repeat(43);

/** A node holding one file: `feed.serve` answers `{ok, ics}` for the right id + key and one miss otherwise. */
async function node(relayUrl, { id, k }) {
  const identity = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({ identity, transport: new RelayTransport({ relayUrl, identity }), label: 'node' });
  const asked = [];
  agent.register('feed.serve', async ({ parts }) => {
    const a = Parts.data(parts) ?? {};
    asked.push(a);
    await new Promise((r) => { setTimeout(r, 50); });
    return a.id === id && a.k === k ? { ok: true, ics: ICS } : { ok: false };
  }, { visibility: 'public', policy: 'always-allow' });
  agent.security.setSenderAuthorizer(() => allowSender('test'));
  await agent.start();
  cleanups.push(() => agent.stop());
  // registered at the relay (its session live) before anyone fetches
  for (let i = 0; i < 100 && !agent.transport?.connected; i += 1) await new Promise((r) => { setTimeout(r, 20); });
  await new Promise((r) => { setTimeout(r, 100); });
  return { agent, address: agent.address, asked };
}

async function get(base, path) {
  const t0 = Date.now();
  const r = await fetch(`${base}${path}`);
  return { status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), sniff: r.headers.get('x-content-type-options'), etag: r.headers.get('etag'), body: await r.text(), ms: Date.now() - t0 };
}

describe('the relay forwards a link to the node that holds it', () => {
  it('a link opens; away, unknown, unparseable, wrong key — one 404; the log never names the link', async () => {
    // the relay's log, ON, while it serves links (a node's own coming and going is logged by the relay as ever — by
    // its short address, at connect and disconnect; what is pinned here is that SERVING a link adds nothing)
    const lines = []; let capturing = false;
    for (const m of ['log', 'info', 'warn', 'error', 'debug']) vi.spyOn(console, m).mockImplementation((...a) => { if (capturing) lines.push(a.map(String).join(' ')); });
    const relay = await startRelay({ port: 0, host: '127.0.0.1', log: true, feeds: { missFloorMs: 0 } });
    cleanups.push(() => relay.stop());
    const base = `http://127.0.0.1:${relay.port}`;
    const id = randomKey(); const k = randomKey();
    const n = await node(`ws://127.0.0.1:${relay.port}`, { id, k });

    capturing = true;
    const hit = await get(base, `/feed/${n.address}/${id}.${k}.ics`);
    expect(hit.status, hit.body).toBe(200);
    expect(hit.type).toMatch(/^text\/calendar/);
    expect(hit.cache).toBe('no-store');
    expect(hit.sniff).toBe('nosniff');
    expect(hit.etag).toBeNull();
    expect(hit.body).toBe(ICS);

    const junk = await get(base, '/feed/junk');
    expect(junk.status).toBe(404);
    expect(junk.body).toBe(FEED_MISS_BODY);
    for (const miss of [
      `/feed/${n.address}/${id}.${randomKey()}.ics`,         // a wrong key
      `/feed/${n.address}/${randomKey()}.${k}.ics`,          // an unknown id
      `/feed/${NOBODY}/${id}.${k}.ics`,                      // a node nobody knows
      `/feed/not-a-node/${id}.${k}.ics`,                     // a node that does not parse
      `/feed/${id}.${k}.ics`,                                // the companion's own form: not the relay's
    ]) {
      const r = await get(base, miss);
      expect(r.status, miss).toBe(404);
      expect(r.body, miss).toBe(junk.body);
      expect(r.cache, miss).toBe('no-store');
      expect(r.etag, miss).toBeNull();
    }

    // the node away: the same 404
    capturing = false;
    await n.agent.stop();
    await new Promise((r) => { setTimeout(r, 200); });
    capturing = true;
    const away = await get(base, `/feed/${n.address}/${id}.${k}.ics`);
    expect(away.status).toBe(404);
    expect(away.body).toBe(junk.body);

    // the relay's log, on, never named the link: not its id, its key, nor the node (not even the node's short form)
    capturing = false;
    const log = lines.join('\n');
    for (const secret of [id, k, n.address, n.address.slice(0, 12)]) expect(log).not.toContain(secret);
  }, 30_000);

  it('a refresh storm on one link asks the node once; another key waits and asks for itself', async () => {
    const relay = await startRelay({ port: 0, host: '127.0.0.1', log: false, feeds: { missFloorMs: 0 } });
    cleanups.push(() => relay.stop());
    const base = `http://127.0.0.1:${relay.port}`;
    const id = randomKey(); const k = randomKey();
    const n = await node(`ws://127.0.0.1:${relay.port}`, { id, k });
    const storm = await Promise.all(Array.from({ length: 6 }, () => get(base, `/feed/${n.address}/${id}.${k}.ics`)));
    expect(storm.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    expect(n.asked.length, 'one ask for six identical requests').toBe(1);

    n.asked.length = 0;
    const [right, wrong] = await Promise.all([get(base, `/feed/${n.address}/${id}.${k}.ics`), get(base, `/feed/${n.address}/${id}.${randomKey()}.ics`)]);
    expect(right.status).toBe(200);
    expect(wrong.status, 'a request with another key never shares the right one\'s answer').toBe(404);
    expect(n.asked.length).toBe(2);
  }, 30_000);
});

describe('the forward\'s handler on its own', () => {
  async function mounted(o) {
    const server = http.createServer((req, res) => { res.writeHead(200); res.end('the relay'); });
    mountFeedForward(server, o);
    await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
    cleanups.push(() => new Promise((r) => { server.close(r); }));
    return `http://127.0.0.1:${server.address().port}`;
  }
  const NODE = 'A'.repeat(43);

  it('a node that does not parse is the miss before anything is asked; other paths are untouched', async () => {
    const serve = vi.fn(async () => ICS); const isPresent = vi.fn(() => true);
    const base = await mounted({ serve, isPresent, missFloorMs: 0 });
    for (const p of [`/feed/short/${randomKey()}.${randomKey()}.ics`, `/feed/${randomKey()}.${randomKey()}.ics`, `/feed/${NODE}/x.y.ics`, '/feed', '/feed/']) {
      const r = await get(base, p);
      expect(r.status, p).toBe(404);
      expect(r.body, p).toBe(FEED_MISS_BODY);
    }
    expect(serve).not.toHaveBeenCalled();
    expect(isPresent).not.toHaveBeenCalled();
    expect((await get(base, '/anything')).body).toBe('the relay');
    // not a GET: the miss too
    const post = await fetch(`${base}/feed/${NODE}/${randomKey()}.${randomKey()}.ics`, { method: 'POST' });
    expect(post.status).toBe(404);
    expect(serve).not.toHaveBeenCalled();
  });

  it('bounded (never retried), capped in flight, and a miss takes the floor whether the node is there or not', async () => {
    let calls = 0;
    const serve = vi.fn(() => { calls += 1; return new Promise(() => {}); });   // a node that never answers
    const present = new Set([NODE]);
    const base = await mounted({ serve, isPresent: (n) => present.has(n), timeoutMs: 300, missFloorMs: 400, maxInFlight: 1 });
    const slow = await get(base, `/feed/${NODE}/${randomKey()}.${randomKey()}.ics`);
    expect(slow.status).toBe(404);
    expect(calls, 'never retried').toBe(1);
    const away = await get(base, `/feed/${'C'.repeat(43)}/${randomKey()}.${randomKey()}.ics`);
    expect(away.status).toBe(404);
    expect(away.ms, 'away answers no sooner than the floor').toBeGreaterThanOrEqual(380);
    expect(calls, 'away: nothing asked').toBe(1);
    // the ceiling: with one serve hanging, a second file is a miss without an ask
    const hanging = get(base, `/feed/${NODE}/${randomKey()}.${randomKey()}.ics`);
    await new Promise((r) => { setTimeout(r, 50); });
    const capped = await get(base, `/feed/${NODE}/${randomKey()}.${randomKey()}.ics`);
    expect(capped.status).toBe(404);
    expect(calls).toBe(2);
    await hanging;
  }, 15_000);
});
