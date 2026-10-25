/**
 * The companion's nearby plugin — the two properties that make it a plugin, and the disclosure default.
 *
 * The default matters more than the mechanism here: a companion has no Nearby view, so the phone's rule
 * ("advertise only while someone is looking") has no meaning, and a node that announces itself permanently
 * is a presence beacon with a stable identifier. Frits decided browse-only on 2026-08-30, so it is asserted
 * rather than left to a reader of the source.
 */
import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { AgentIdentity, DISCOVERABILITY } from '@onderling/core';
import { createLoopbackDiscovery } from '@onderling/transports/mdns-node';
import { startNearbyMdns, normaliseNearbyOption } from '../src/nearbyMdns.js';

const throwawayVault = () => {
  const store = new Map();
  return { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } };
};
const identity = () => AgentIdentity.fromSeed(new Uint8Array(randomBytes(32)), throwawayVault());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('normaliseNearbyOption — what counts as "on"', () => {
  it('treats `true` as mdns on', () => expect(normaliseNearbyOption(true)).toEqual({ mdns: true }));
  it('passes an object through when mdns is set', () =>
    expect(normaliseNearbyOption({ mdns: true, label: 'laptop' })).toEqual({ mdns: true, label: 'laptop' }));
  it('is off for false, null and an object that does not ask for mdns', () => {
    expect(normaliseNearbyOption(false)).toBe(null);
    expect(normaliseNearbyOption(null)).toBe(null);
    expect(normaliseNearbyOption({ mdns: false })).toBe(null);
    expect(normaliseNearbyOption({})).toBe(null);
  });
});

describe('the disclosure default', () => {
  it('BROWSES, and does not announce, unless publishing is asked for', async () => {
    const discovery = createLoopbackDiscovery();
    const advertise = vi.spyOn(discovery, 'advertise');
    const n = await startNearbyMdns({ identity: await identity(), discovery });

    expect(n.state.effective).toBe(DISCOVERABILITY.BROWSE);
    expect(n.transport.isAdvertising).toBe(false);
    // The point of the default: nothing was published to the network at all.
    expect(advertise).not.toHaveBeenCalled();
    await n.stop();
  });

  it('announces only on an explicit publish, and says so', async () => {
    const discovery = createLoopbackDiscovery();
    const n = await startNearbyMdns({ identity: await identity(), opts: { publish: true }, discovery });

    expect(n.state.effective).toBe(DISCOVERABILITY.PUBLISH);
    expect(n.transport.isAdvertising).toBe(true);
    await n.stop();
  });

  it('a time-boxed announcement expires back to browse — never the other way', async () => {
    const discovery = createLoopbackDiscovery();
    const n = await startNearbyMdns({
      identity: await identity(), opts: { publish: true, publishFor: 40 }, discovery,
    });
    expect(n.transport.isAdvertising).toBe(true);

    await wait(140);
    expect(n.transport.isAdvertising).toBe(false);
    expect(n.state.effective).toBe(DISCOVERABILITY.BROWSE);
    await n.stop();
  });

  // A device that announces nothing keeps no door open: the radio's TCP listener closes when the publish window ends
  // (the household tablet's firewall opens this port to the home LAN, so the port must be shut while unlisted).
  it('the data port is closed once a time-boxed announcement expires — and open while it lasts', async () => {
    const discovery = createLoopbackDiscovery();
    const n = await startNearbyMdns({ identity: await identity(), opts: { publish: true, publishFor: 60, port: 45991 }, discovery });
    expect(await reachable(45991), 'open while announcing').toBe(true);
    await wait(180);
    expect(n.transport.isAdvertising).toBe(false);
    expect(await reachable(45991), 'closed once the window ended').toBe(false);
    await n.stop();
  });

  it('a browse-only node opens no data port at all', async () => {
    const discovery = createLoopbackDiscovery();
    const n = await startNearbyMdns({ identity: await identity(), opts: { port: 45992 }, discovery });
    expect(await reachable(45992)).toBe(false);
    await n.stop();
  });

  it('reports what the transport ACHIEVED, not what was asked', async () => {
    const discovery = createLoopbackDiscovery();
    const n = await startNearbyMdns({ identity: await identity(), discovery });
    expect(n.state).toMatchObject({ ok: true, requested: DISCOVERABILITY.BROWSE, degraded: false });
    await n.stop();
  });
});

/** Can a TCP client connect to this port on loopback (the door the firewall would open)? */
function reachable(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

describe('the peer source the nearby surface subscribes to', () => {
  it('surfaces another node on the same discovery as a nearby peer', async () => {
    const discovery = createLoopbackDiscovery();
    // The other side must ANNOUNCE for a browse-only node to find it — which is the shape in real life
    // too: the phone advertises while its Nearby view is open, the companion watches.
    const phoneish = await startNearbyMdns({ identity: await identity(), opts: { publish: true }, discovery });
    const laptop   = await startNearbyMdns({ identity: await identity(), discovery });

    const rows = [];
    const unsubscribe = laptop.nearbyPeers.subscribe((list) => rows.push(list));

    let seen = false;
    for (let i = 0; i < 60 && !seen; i++) {
      await wait(25);
      seen = rows.at(-1)?.some((p) => p.pubKey === phoneish.transport.address);
    }
    expect(seen).toBe(true);
    expect(rows.at(-1).find((p) => p.pubKey === phoneish.transport.address).source).toBe('mdns');

    unsubscribe();
    await laptop.stop();
    await phoneish.stop();
  });
});
