/**
 * A person's agenda link, served THROUGH THE RELAY by a companion that has no public port — over a REAL relay (its
 * HTTP server, its seat) and a REAL companion (`startCompanionNode`, gate on).
 *
 * The owner's device puts a sealed file; the link is built from the companion's CARD (its address and where it
 * serves); a calendar app's GET at the relay opens it; the companion away → the relay's one 404; the relay's log names
 * nothing of the link. And `feed.serve` is the ONE public op on the companion: a stranger reaches it, and every other
 * op the companion registers refuses that same stranger.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Agent, AgentIdentity, Parts, Bootstrap } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { startRelay } from '@onderling/relay';
import { randomKey, sealForLink, feedLinkPath } from '@onderling/blob-gateway';
import { decodeContactCard } from '../../stoop/src/lib/contactCard.js';
import { ownerDevice } from './support/ownerDevice.js';
import { startCompanionNode, FEED_SERVE_OP } from '../src/index.js';
import { makeDevBlobBucket } from '../src/mediaEdge.js';

const cleanups = [];
afterEach(async () => { while (cleanups.length) { try { await cleanups.pop()(); } catch { /* best-effort */ } } vi.restoreAllMocks(); });

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x\r\nSUMMARY:Tandarts Bea\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function stranger(relayUrl, nodeAddress) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({ identity: id, transport: new RelayTransport({ relayUrl, identity: id }), label: 'stranger' });
  await agent.start();
  await agent.hello(nodeAddress);
  cleanups.push(() => agent.stop?.());
  return agent;
}

async function companionOnRelay(extra = {}) {
  const relay = await startRelay({ port: 0, host: '127.0.0.1', log: true, feeds: { missFloorMs: 0 } });
  cleanups.push(() => relay.stop());
  const relayUrl = `ws://127.0.0.1:${relay.port}`;
  const owners = ownerDevice(Bootstrap.create().bootstrap, 'household-bot');
  const host = await startCompanionNode({
    relayUrl, identityVault: new VaultMemory(),
    management: true, claimedOwner: { root: owners.delegation.by },
    feeds: true, feedBucket: makeDevBlobBucket(), ...extra,
  });
  cleanups.push(() => host.stop());
  await wait(200);
  return { relay, relayUrl, host, owners };
}

describe('the companion\'s links, through the relay', () => {
  it('the link built from the companion\'s card opens at the relay; away → the 404; the relay logs nothing of it', async () => {
    const lines = []; let capturing = false;
    for (const m of ['log', 'info', 'warn', 'error', 'debug']) vi.spyOn(console, m).mockImplementation((...a) => { if (capturing) lines.push(a.map(String).join(' ')); });
    const { relay, relayUrl, host, owners } = await companionOnRelay();

    // the card: its address, its relay, and where its links are served — the relay's public form of the URL it dials
    const card = decodeContactCard(host.card.slice('onderling-contact://'.length));
    expect(card.peerAddr).toBe(host.agent.address);
    expect(card.relays).toEqual([relayUrl]);
    expect(card.serves).toBe(`http://127.0.0.1:${relay.port}`);

    // the owner's device puts a person's file
    const id = randomKey(); const k = randomKey();
    const bot = await stranger(relayUrl, host.agent.address);
    const put = { id, envelope: sealForLink(ICS, k) };
    expect(Parts.data(await bot.invoke(host.agent.address, 'feed.put', { ...put, auth: owners.auth(host.agent.address, 'feed.put', put) }))).toEqual({ ok: true });

    capturing = true;
    const link = `${card.serves}${feedLinkPath({ node: card.peerAddr, id, k })}`;
    const r = await fetch(link);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/calendar/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('etag')).toBeNull();
    expect(await r.text()).toBe(ICS);
    const wrong = await fetch(`${card.serves}${feedLinkPath({ node: card.peerAddr, id, k: randomKey() })}`);
    expect(wrong.status).toBe(404);
    const missBody = await wrong.text();
    capturing = false;

    // the companion away: the relay's same 404
    await host.stop();
    await wait(200);
    capturing = true;
    const away = await fetch(link);
    expect(away.status).toBe(404);
    expect(await away.text()).toBe(missBody);
    capturing = false;

    const log = lines.join('\n');
    for (const secret of [id, k, host.agent.address, host.agent.address.slice(0, 12)]) expect(log).not.toContain(secret);
  }, 30_000);

  it('a node that dials its relay by an inside name says its public address on the card', async () => {
    const { host } = await companionOnRelay({ publicUrl: 'https://relay.example.org/' });
    const card = decodeContactCard(host.card.slice('onderling-contact://'.length));
    expect(card.serves).toBe('https://relay.example.org');
    expect(card.relays).toEqual(['wss://relay.example.org']);
  }, 30_000);
});

describe('feed.serve is the ONE public op on the companion', () => {
  it('declared so, and the only one; a stranger reaches it — and every other op refuses that stranger', async () => {
    // everything on that the shipped boot can turn on, the gate included, so every op the node can have is here
    const { relayUrl, host, owners } = await companionOnRelay({ manageHttp: true, inbox: true, inboxOwnerPubKey: 'x'.repeat(43), gate: true });
    const skills = host.agent.skills.all();
    const pub = skills.filter((s) => s.visibility === 'public').map((s) => s.id);
    expect(pub, 'exactly one public op').toEqual([FEED_SERVE_OP]);
    const serve = skills.find((s) => s.id === FEED_SERVE_OP);
    expect(serve.policy, 'no token, no admission: the link\'s key is the capability').toBe('always-allow');

    const id = randomKey(); const k = randomKey();
    const put = { id, envelope: sealForLink(ICS, k) };
    const bot = await stranger(relayUrl, host.agent.address);
    expect(Parts.data(await bot.invoke(host.agent.address, 'feed.put', { ...put, auth: owners.auth(host.agent.address, 'feed.put', put) }))).toEqual({ ok: true });

    const someone = await stranger(relayUrl, host.agent.address);
    // the link's halves open the file; every failure is the one miss
    expect(Parts.data(await someone.invoke(host.agent.address, FEED_SERVE_OP, { id, k }))).toEqual({ ok: true, ics: ICS });
    const misses = [{ id, k: randomKey() }, { id: randomKey(), k }, {}, { id: 3, k: null }];
    for (const m of misses) expect(Parts.data(await someone.invoke(host.agent.address, FEED_SERVE_OP, m)), JSON.stringify(m)).toEqual({ ok: false });

    // every other op the node registered: the same stranger, holding nothing, gets nothing
    const others = skills.map((s) => s.id).filter((op) => op !== FEED_SERVE_OP);
    expect(others.length).toBeGreaterThan(10);
    const reached = [];
    for (const op of others) {
      let out;
      try { out = Parts.data(await someone.invoke(host.agent.address, op, {}, { timeout: 5_000 })); } catch { continue; }   // refused by the gate
      const refused = out && typeof out === 'object' && (out.ok === false || out.error != null);
      if (!refused) reached.push(`${op} → ${JSON.stringify(out)?.slice(0, 80)}`);
    }
    expect(reached, 'ops a stranger reached').toEqual([]);
  }, 60_000);
});
