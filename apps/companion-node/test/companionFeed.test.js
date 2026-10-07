/**
 * A person's agenda as a link — the companion's half, over a REAL relay + RelayTransport and its real HTTP route.
 *
 * The owner (a household bot) puts a file sealed to a key only the link carries; the companion keeps the ciphertext
 * under the hash of the link's id and nothing else; `GET /feed/<id>.<k>.ics` opens it with the key from the path. A
 * non-owner's put is refused; an unknown id, a wrong key and a dropped file are ONE identical 404; nothing at rest
 * holds the agenda, the id or the key; Caddy keeps no log of the path.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, AgentIdentity, Parts, generateTunnelKey, sealTunnelOW } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { startCompanionNode } from '../src/index.js';
import { createFeedShelf, MemoryFeedStore, FileFeedStore, parseFeedPath } from '../src/feedShelf.js';

const cleanups = [];
afterEach(async () => { while (cleanups.length) { try { await cleanups.pop()(); } catch { /* best-effort */ } } });

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Tandarts Bea\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
/** A link's id (random, base64url like the key). */
const newId = () => generateTunnelKey().slice(0, 32);
const sealed = (k, ics = ICS) => sealTunnelOW({ key: k, innerOW: { ics } });

async function device(host, identity) {
  const id = identity ?? await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({ identity: id, transport: new RelayTransport({ relayUrl: host.relayUrl, identity: id }), label: 'device' });
  await agent.start();
  await agent.hello(host.agent.address);
  cleanups.push(() => agent.stop?.());
  return agent;
}

describe('the feed shelf', () => {
  it('opens with the link\'s key only; every miss is the same null; nothing at rest names the agenda, the id or the key', async () => {
    const store = new MemoryFeedStore();
    const shelf = createFeedShelf({ store });
    const id = newId(); const k = generateTunnelKey();
    expect(await shelf.put(id, sealed(k))).toEqual({ ok: true });
    expect(await shelf.open(id, k)).toBe(ICS);
    expect(await shelf.open(id, generateTunnelKey()), 'a wrong key').toBeNull();
    expect(await shelf.open(newId(), k), 'an unknown id').toBeNull();
    const atRest = JSON.stringify(await store.all());
    expect(atRest).not.toContain('Tandarts');
    expect(atRest).not.toContain(id);
    expect(atRest).not.toContain(k);
    // a put is idempotent on the id: the newer file replaces the older
    await shelf.put(id, sealed(k, ICS.replace('Tandarts', 'Kapper')));
    expect(await shelf.count()).toBe(1);
    expect(await shelf.open(id, k)).toContain('Kapper');
    await shelf.drop(id);
    expect(await shelf.open(id, k), 'dropped').toBeNull();
    // not sealed, or not an id: refused
    expect((await shelf.put(id, { ics: ICS })).ok).toBe(false);
    expect((await shelf.put('short', sealed(k))).ok).toBe(false);
  });

  it('the file on disk holds ciphertext only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'feed-shelf-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const shelf = createFeedShelf({ store: new FileFeedStore(join(dir, 'feeds.json')) });
    const id = newId(); const k = generateTunnelKey();
    await shelf.put(id, sealed(k));
    const disk = readFileSync(join(dir, 'feeds.json'), 'utf8');
    expect(disk).not.toContain('Tandarts');
    expect(disk).not.toContain(id);
    expect(disk).not.toContain(k);
    // a restart reads it back
    expect(await createFeedShelf({ store: new FileFeedStore(join(dir, 'feeds.json')) }).open(id, k)).toBe(ICS);
  });

  it('the route\'s path: only <id>.<k>.ics', () => {
    expect(parseFeedPath('/feed/abc.def.ics')).toEqual({ id: 'abc', k: 'def' });
    expect(parseFeedPath('/feed/abc.ics')).toBeNull();
    expect(parseFeedPath('/feed/../x.y.ics')).toBeNull();
  });
});

describe('the companion serves the owner\'s agenda files', () => {
  it('the owner puts, the link opens it; a non-owner is refused; every miss is one identical 404', async () => {
    const owner = await AgentIdentity.generate(new VaultMemory());
    const host = await startCompanionNode({
      identityVault: new VaultMemory(), gate: false,
      management: true, managementOwnerPubKey: owner.pubKey, manageHttp: true,
      feeds: true, feedStore: new MemoryFeedStore(),
    });
    cleanups.push(() => host.stop());
    const base = `http://127.0.0.1:${host.managePort}`;
    const get = async (path) => { const r = await fetch(`${base}${path}`); return { status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), etag: r.headers.get('etag'), body: await r.text() }; };

    // before any put: the route answers the same 404 as any unknown path
    const id = newId(); const k = generateTunnelKey();
    const none = await get(`/feed/${id}.${k}.ics`);
    const nowhere = await get('/no-such-path');
    expect(none.status).toBe(404);
    expect(none.body).toBe(nowhere.body);

    // a non-owner's put is refused, and leaves nothing
    const stranger = await device(host);
    const refused = Parts.data(await stranger.invoke(host.agent.address, 'feed.put', { id, blob: sealed(k) }));
    expect(refused).toEqual({ ok: false, error: 'forbidden' });
    expect(await host.feeds.count()).toBe(0);

    // the owner's put; the link opens it
    const bot = await device(host, owner);
    expect(Parts.data(await bot.invoke(host.agent.address, 'feed.put', { id, blob: sealed(k) }))).toEqual({ ok: true });
    const hit = await get(`/feed/${id}.${k}.ics`);
    expect(hit.status).toBe(200);
    expect(hit.type).toMatch(/^text\/calendar/);
    expect(hit.cache).toBe('no-store');
    expect(hit.etag).toBeNull();
    expect(hit.body).toBe(ICS);

    // a wrong key, an unknown id: the very same 404 as nothing at all
    for (const miss of [`/feed/${id}.${generateTunnelKey()}.ics`, `/feed/${newId()}.${k}.ics`, `/feed/${id}.ics`, '/feed/']) {
      const r = await get(miss);
      expect(r.status, miss).toBe(404);
      expect(r.body, miss).toBe(nowhere.body);
    }

    // a non-owner cannot drop it; the owner can, and the link is dark
    expect(Parts.data(await stranger.invoke(host.agent.address, 'feed.drop', { id }))).toEqual({ ok: false, error: 'forbidden' });
    expect((await get(`/feed/${id}.${k}.ics`)).status).toBe(200);
    expect(Parts.data(await bot.invoke(host.agent.address, 'feed.drop', { id }))).toEqual({ ok: true });
    expect((await get(`/feed/${id}.${k}.ics`)).body).toBe(nowhere.body);
  }, 30_000);
});

describe('Caddy in front of it keeps no log of the path', () => {
  // the path carries the key: the /feed handle skips the access log, in both front configs, and goes to the companion
  for (const rel of ['../../../deploy/roles/relay.caddy', '../../../deploy/caddy/Caddyfile']) {
    it(rel.split('/deploy/')[1], () => {
      const text = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
      const block = /handle \/feed\/\* \{([^}]*)\}/.exec(text)?.[1] ?? '';
      expect(block, 'a /feed handle').not.toBe('');
      expect(block).toMatch(/\blog_skip\b/);
      expect(block).toMatch(/reverse_proxy companion:8790/);
    });
  }
});
