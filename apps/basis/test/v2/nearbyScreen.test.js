/**
 * The Nearby screen controller (Nearby step E).
 *
 * Two properties carry the screen, and both are about honesty rather than rendering:
 *
 *   1. **it says what the device is doing, not what it asked for** — the case that matters is the
 *      disagreement, where a user believes they are hidden and is not;
 *   2. **proximity never implies access** (rule b) — every row's actions come from the ROSTER.
 *
 * Everything else here is lifecycle: opening announces, closing stops, and closing works even when the
 * caller is sloppy.
 */
import { describe, it, expect, vi } from 'vitest';
import { DISCOVERABILITY, createDiscoverabilityControl, Transport } from '@onderling/core';
import { createNearbyScreen } from '../../src/v2/nearbyScreen.js';

class Discovering extends Transport {
  get supportsDiscoverability() { return true; }
  async _applyDiscoverability(s) { return s; }
  async _put() {}
}
/** mDNS on an older binary: cannot browse without publishing. */
class AlwaysPublishes extends Transport {
  get supportsDiscoverability() { return true; }
  async _applyDiscoverability(s) { return s === DISCOVERABILITY.OFF ? s : DISCOVERABILITY.PUBLISH; }
  async _put() {}
}
const mk = (C) => new C({ address: 'a', identity: null });
const settle = () => new Promise((r) => setTimeout(r, 0));

function build({ transports = { ble: mk(Discovering) }, peers = [], ...rest } = {}) {
  let push = null;
  const control = createDiscoverabilityControl({ transports: () => transports });
  const screen = createNearbyScreen({
    control,
    subscribeToPeers: (fn) => { push = fn; return () => { push = null; }; },
    mySkills: () => ['fietsband plakken', 'soep maken'],
    myPseudonym: 'ik',
    t: (k) => k,
    ...rest,
  });
  return { screen, control, setPeers: (p) => push?.(p), peers };
}

const peer = (id, over = {}) => ({ pubKey: id, displayName: id, skills: [], ...over });

describe('visibility — what the device is actually doing', () => {
  it('open ⇒ visible; closed ⇒ hidden', async () => {
    const { screen } = build();
    expect(screen.visibility().publishing).toBe(false);

    screen.open();
    await settle();
    expect(screen.visibility()).toMatchObject({ publishing: true, degraded: false });

    screen.close();
    await settle();
    expect(screen.visibility().publishing).toBe(false);
  });

  it('THE CASE THAT MATTERS: asked to hide, still announcing ⇒ degraded', async () => {
    const { screen } = build({ transports: { mdns: mk(AlwaysPublishes) } });
    screen.open();
    await settle();
    screen.close();
    await settle();

    const v = screen.visibility();
    expect(v.publishing).toBe(true);    // the truth
    expect(v.degraded).toBe(true);      // …and it is flagged, not absorbed
    expect(v.requested).toBe('browse');
  });

  it('a device that cannot discover at all is UNAVAILABLE, not degraded', async () => {
    // No radio is an explanation, not a privacy warning. Conflating them trains people to ignore both.
    const { screen } = build({ transports: {} });
    screen.open();
    await settle();
    const v = screen.visibility();
    expect(v).toMatchObject({ unavailable: true, degraded: false, publishing: false });
  });

  it('the model carries visibility, so a renderer never has to ask twice', async () => {
    const { screen } = build();
    screen.open();
    await settle();
    expect(screen.model().visibility.publishing).toBe(true);
  });
});

describe('rule (b): proximity is not membership', () => {
  it('a stranger gets only consented-exchange actions, and is told why', async () => {
    const { screen, setPeers } = build({ isKnownMember: () => false, canInvite: () => true });
    screen.open();
    setPeers([peer('stranger')]);

    const [row] = screen.model().rows;
    expect(row.actions).toEqual(['invite-to-circle', 'request-join']);
    expect(row.actions).not.toContain('open-shared-circle');
    expect(row.isMember).toBe(false);
    expect(row.note).toBe('nearby-not-member');
  });

  it('a known member gets the open action — because the ROSTER said so, not the network', async () => {
    const { screen, setPeers } = build({ isKnownMember: (id) => id === 'known', canInvite: () => false });
    screen.open();
    setPeers([peer('known'), peer('stranger')]);

    const rows = screen.model().rows;
    expect(rows.find((r) => r.id === 'known').actions).toContain('open-shared-circle');
    expect(rows.find((r) => r.id === 'stranger').actions).not.toContain('open-shared-circle');
    expect(rows.find((r) => r.id === 'known').note).toBeNull();
  });

  it('no invite action when I admin nothing to invite into', async () => {
    const { screen, setPeers } = build({ canInvite: () => false });
    screen.open();
    setPeers([peer('x')]);
    expect(screen.model().rows[0].actions).toEqual(['request-join']);
  });

  it('actionsFor() answers for a single row', async () => {
    const { screen, setPeers } = build({ isKnownMember: (id) => id === 'known' });
    screen.open();
    setPeers([peer('known')]);
    expect(screen.actionsFor('known')).toMatchObject({ isMember: true });
    expect(screen.actionsFor('nobody')).toBeNull();
  });

  it('a roster that THROWS means not-a-member, and the screen still renders', async () => {
    // Deny-by-default. And the screen must survive: blanking the whole list because one lookup failed is
    // worse than showing strangers as strangers.
    const onError = vi.fn();
    const { screen, setPeers } = build({
      isKnownMember: () => { throw new Error('roster down'); }, onError,
    });
    screen.open();
    setPeers([peer('x')]);

    const [row] = screen.model().rows;
    expect(row.isMember).toBe(false);
    expect(row.actions).not.toContain('open-shared-circle');
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'isKnownMember');
  });
});

describe('lifecycle', () => {
  it('closing drops the peer list', async () => {
    const { screen, setPeers } = build();
    screen.open();
    setPeers([peer('a'), peer('b')]);
    expect(screen.model().rows).toHaveLength(2);

    screen.close();
    await settle();
    expect(screen.model().rows).toHaveLength(0);
  });

  it('close without open is safe, and does not announce', async () => {
    const { screen, control } = build();
    expect(() => screen.close()).not.toThrow();
    await settle();
    expect(control.isPublishing).toBe(false);
  });

  it('starts and stops the network watcher with the screen', async () => {
    const stop = vi.fn();
    const subscribeToNetwork = vi.fn(() => stop);
    const { screen } = build({ subscribeToNetwork });

    screen.open();
    expect(subscribeToNetwork).toHaveBeenCalledTimes(1);
    screen.close();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('notifies watchers when peers arrive', async () => {
    const seen = vi.fn();
    const { screen, setPeers } = build();
    screen.subscribe(seen);
    screen.open();
    setPeers([peer('a')]);
    expect(seen).toHaveBeenCalled();
    expect(seen.mock.calls.at(-1)[0].rows).toHaveLength(1);
  });

  it('unsubscribe stops delivery', async () => {
    const seen = vi.fn();
    const { screen, setPeers } = build();
    const off = screen.subscribe(seen);
    screen.open();
    off();
    seen.mockClear();
    setPeers([peer('a')]);
    expect(seen).not.toHaveBeenCalled();
  });

  it('a throwing watcher does not break the others', async () => {
    const good = vi.fn();
    const { screen, setPeers } = build();
    screen.subscribe(() => { throw new Error('bad render'); });
    screen.subscribe(good);
    screen.open();
    setPeers([peer('a')]);
    expect(good).toHaveBeenCalled();
  });

  it('the own-profile footer reflects published skills', async () => {
    const { screen } = build();
    screen.open();
    expect(screen.model().ownProfile.publishedSkills).toEqual(['fietsband plakken', 'soep maken']);
  });

  it('a throwing mySkills degrades to an empty profile rather than crashing the screen', async () => {
    const { screen } = build({ mySkills: () => { throw new Error('no store'); } });
    screen.open();
    expect(screen.model().ownProfile.publishedSkills).toEqual([]);
  });
});
