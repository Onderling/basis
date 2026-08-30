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

  it('reports what the transport ACHIEVED, not what was asked', async () => {
    const discovery = createLoopbackDiscovery();
    const n = await startNearbyMdns({ identity: await identity(), discovery });
    expect(n.state).toMatchObject({ ok: true, requested: DISCOVERABILITY.BROWSE, degraded: false });
    await n.stop();
  });
});

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
