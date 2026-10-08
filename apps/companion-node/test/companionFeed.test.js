/**
 * A person's agenda as a link — the companion's half, over a REAL relay + RelayTransport and its real HTTP route.
 *
 * The owner (a household bot) puts a file sealed to a key only the link carries; the companion keeps the ciphertext
 * under the hash of the link's id and nothing else; `GET /feed/<id>.<k>.ics` opens it with the key from the path. A
 * non-owner's put is refused; an unknown id, a wrong key and a dropped file are ONE identical 404; nothing at rest
 * holds the agenda, the id or the key; Caddy keeps no log of the path. A put takes a token the owner granted.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, AgentIdentity, Parts, Bootstrap } from '@onderling/core';
import { ownerDevice } from './support/ownerDevice.js';
import { grantAgendaFiles } from './support/grantAgendaFiles.js';
import { randomKey, sealForLink } from '@onderling/blob-gateway';
import { VaultMemory } from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { startCompanionNode } from '../src/index.js';
import { createFeedShelf, parseFeedPath, FEED_TOKEN } from '../src/feedShelf.js';
import { makeDevBlobBucket, makeFileBlobBucket } from '../src/mediaEdge.js';

const cleanups = [];
afterEach(async () => { while (cleanups.length) { try { await cleanups.pop()(); } catch { /* best-effort */ } } });

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Tandarts Bea\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
/** A link's halves, minted as the bot mints them (the bucket's one random-key minter). */
const newId = () => randomKey();
const sealed = (k, ics = ICS) => sealForLink(ics, k);

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
    const bucket = makeDevBlobBucket();
    const shelf = createFeedShelf({ bucket });
    expect(FEED_TOKEN.test(randomKey()), 'the minter and the shelf agree by construction').toBe(true);
    const id = newId(); const k = randomKey();
    expect(await shelf.put(id, sealed(k))).toEqual({ ok: true });
    expect(await shelf.open(id, k)).toBe(ICS);
    expect(await shelf.open(id, randomKey()), 'a wrong key').toBeNull();
    expect(await shelf.open(newId(), k), 'an unknown id').toBeNull();
    const atRest = JSON.stringify([...bucket.store.entries()]);
    expect(atRest).not.toContain('Tandarts');
    expect(atRest).not.toContain(id);
    expect(atRest).not.toContain(k);
    // a put is idempotent on the id: the newer file replaces the older
    await shelf.put(id, sealed(k, ICS.replace('Tandarts', 'Kapper')));
    expect(bucket.store.size).toBe(1);
    expect(await shelf.open(id, k)).toContain('Kapper');
    await shelf.drop(id);
    expect(await shelf.open(id, k), 'dropped').toBeNull();
    // not sealed, or not an id: refused
    expect((await shelf.put(id, ICS)).ok).toBe(false);
    expect((await shelf.put('short', sealed(k))).ok).toBe(false);
  });

  it('the file bucket on disk holds ciphertext only', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'feed-shelf-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const shelf = createFeedShelf({ bucket: makeFileBlobBucket(dir) });
    const id = newId(); const k = randomKey();
    await shelf.put(id, sealed(k));
    const disk = readdirSync(dir).map((f) => `${f}\n${readFileSync(join(dir, f), 'utf8')}`).join('\n');
    expect(disk).not.toContain('Tandarts');
    expect(disk).not.toContain(id);
    expect(disk).not.toContain(k);
    // a restart reads it back
    expect(await createFeedShelf({ bucket: makeFileBlobBucket(dir) }).open(id, k)).toBe(ICS);
  });

  it('the route\'s path: only <id>.<k>.ics', () => {
    expect(parseFeedPath('/feed/abc.def.ics')).toEqual({ id: 'abc', k: 'def' });
    expect(parseFeedPath('/feed/abc.ics')).toBeNull();
    expect(parseFeedPath('/feed/../x.y.ics')).toBeNull();
  });
});

describe('the companion serves the owner\'s agenda files', () => {
  it('the granted bot puts, the link opens it; an agent without the grant is refused; every miss is one identical 404', async () => {
    // the owner's device grants the bot (a node composed already claimed by that person's root)
    const root = Bootstrap.create().bootstrap;
    const ownersDevice = ownerDevice(root, 'phone');
    const host = await startCompanionNode({
      identityVault: new VaultMemory(),
      management: true, claimedOwner: { root: ownersDevice.delegation.by }, manageHttp: true,
      feeds: true, feedBucket: makeDevBlobBucket(),
    });
    cleanups.push(() => host.stop());
    const base = `http://127.0.0.1:${host.managePort}`;
    const get = async (path) => { const r = await fetch(`${base}${path}`); return { status: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), etag: r.headers.get('etag'), body: await r.text() }; };

    // before any put: the route answers the same 404 as any unknown path
    const id = newId(); const k = randomKey();
    const none = await get(`/feed/${id}.${k}.ics`);
    const nowhere = await get('/no-such-path');
    expect(none.status).toBe(404);
    expect(none.body).toBe(nowhere.body);

    // a put without the grant is refused, and leaves nothing
    const stranger = await device(host);
    await expect(stranger.invoke(host.agent.address, 'feed.put', { id, envelope: sealed(k) })).rejects.toThrow(/token/i);
    expect(await host.feeds.open(id, k)).toBeNull();

    // the granted bot's put; the link opens it
    const bot = await device(host);
    const tokens = await grantAgendaFiles(host, ownersDevice, bot);
    const put = { id, envelope: sealed(k) };
    expect(Parts.data(await bot.invoke(host.agent.address, 'feed.put', put, { token: tokens.put }))).toEqual({ ok: true });
    const hit = await get(`/feed/${id}.${k}.ics`);
    expect(hit.status).toBe(200);
    expect(hit.type).toMatch(/^text\/calendar/);
    expect(hit.cache).toBe('no-store');
    expect(hit.etag).toBeNull();
    expect(hit.body).toBe(ICS);

    // a wrong key, an unknown id: the very same 404 as nothing at all
    for (const miss of [`/feed/${id}.${randomKey()}.ics`, `/feed/${newId()}.${k}.ics`, `/feed/${id}.ics`, '/feed/']) {
      const r = await get(miss);
      expect(r.status, miss).toBe(404);
      expect(r.body, miss).toBe(nowhere.body);
    }

    // an agent without the grant cannot drop it; the bot can, and the link is dark
    await expect(stranger.invoke(host.agent.address, 'feed.drop', { id })).rejects.toThrow(/token/i);
    expect((await get(`/feed/${id}.${k}.ics`)).status).toBe(200);
    expect(Parts.data(await bot.invoke(host.agent.address, 'feed.drop', { id }, { token: tokens.drop }))).toEqual({ ok: true });
    expect((await get(`/feed/${id}.${k}.ics`)).body).toBe(nowhere.body);
  }, 30_000);
});

describe('Caddy in front of it keeps no log of the path', () => {
  // the path carries the key: the /feed handle skips the access log, in both front configs, for BOTH forms of the link —
  // `/feed/<node>/<id>.<k>.ics` to the relay (which forwards it to the node), `/feed/<id>.<k>.ics` to this companion
  /** The body of `handle /feed/* { … }`, nested blocks and all. */
  const feedHandle = (text) => {
    const at = text.indexOf('handle /feed/* {');
    if (at < 0) return '';
    let depth = 0;
    for (let i = text.indexOf('{', at); i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      if (text[i] === '}' && (depth -= 1) === 0) return text.slice(at, i + 1);
    }
    return '';
  };
  for (const rel of ['../../../deploy/roles/relay.caddy', '../../../deploy/caddy/Caddyfile']) {
    it(rel.split('/deploy/')[1], () => {
      const text = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
      const block = feedHandle(text);
      expect(block, 'a /feed handle').not.toBe('');
      expect(block).toMatch(/^\s*log_skip\s*$/m);
      // the relay's form: a node (an address) then the file, to the relay — matched before the companion's catch-all
      expect(block).toMatch(/@viaRelay path_regexp \^\/feed\/\[A-Za-z0-9_-\]\{43\}\/\[\^\/\]\+\$/);
      expect(block).toMatch(/route \{\s*reverse_proxy @viaRelay relay:8787\s*reverse_proxy companion:8790\s*\}/);
      // and no access log anywhere in the site
      expect(text).not.toMatch(/^\s*log\s*(\{|$)/m);
    });
  }
});
