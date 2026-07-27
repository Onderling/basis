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

describe('supportedActions — do not offer what the host cannot do', () => {
  it('withholds an action this host cannot service', async () => {
    // `request-join` needs the ask/invite exchange (Nearby F + H). Offering a button that quietly does
    // nothing is worse than an absent one: it teaches people the app is broken rather than incomplete.
    const { screen, setPeers } = build({
      canInvite: () => true,
      supportedActions: ['invite-to-circle', 'open-shared-circle'],
    });
    screen.open();
    setPeers([peer('stranger')]);

    const [row] = screen.model().rows;
    expect(row.actions).toEqual(['invite-to-circle']);
    expect(row.actions).not.toContain('request-join');
  });

  it('but the stranger NOTE survives — withholding a button must not hide the relationship', async () => {
    const { screen, setPeers } = build({ supportedActions: [] });
    screen.open();
    setPeers([peer('stranger')]);

    const [row] = screen.model().rows;
    expect(row.actions).toEqual([]);
    expect(row.note).toBe('nearby-not-member');
    expect(row.isMember).toBe(false);
  });

  it('omitting supportedActions offers everything (unchanged default)', async () => {
    const { screen, setPeers } = build({ canInvite: () => true });
    screen.open();
    setPeers([peer('x')]);
    expect(screen.model().rows[0].actions).toEqual(['invite-to-circle', 'request-join']);
  });

  it('a supported action still requires the entitlement — it filters, it does not grant', async () => {
    // Declaring you can open a shared circle does not make a stranger a member.
    const { screen, setPeers } = build({
      isKnownMember: () => false,
      supportedActions: ['open-shared-circle', 'request-join'],
    });
    screen.open();
    setPeers([peer('stranger')]);
    expect(screen.model().rows[0].actions).toEqual(['request-join']);
  });
});

describe('asks in the room (step F)', () => {
  const T0 = 1_700_000_000_000;
  const drivers = (tags) => async () => Object.fromEntries(
    tags.map((tag) => [tag, { kind: 'offering', text: `ik kan ${tag}`, tags: [tag] }]),
  );
  const anAsk = (over = {}) => Object.freeze({
    id: 'ask-1', text: 'anyone got a bike pump?', tags: ['fiets'],
    from: 'room-1', createdAt: T0, expiresAt: T0 + 60_000, ...over,
  });

  function withAsks({ getDrivers, nowMs = T0, ...rest } = {}) {
    let pushAsk = null;
    const control = createDiscoverabilityControl({ transports: () => ({ ble: mk(Discovering) }) });
    const screen = createNearbyScreen({
      control,
      subscribeToAsks: (fn) => { pushAsk = fn; return () => { pushAsk = null; }; },
      getDrivers, now: () => nowMs, t: (k) => k, ...rest,
    });
    return { screen, ask: (a) => pushAsk?.(a) };
  }

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('an incoming ask appears, matched on MY device', async () => {
    const { screen, ask } = withAsks({ getDrivers: drivers(['fiets']) });
    screen.open();
    ask(anAsk());
    await flush();

    const [row] = screen.model().asks;
    expect(row.ask.text).toBe('anyone got a bike pump?');
    expect(row.resonant).toBe(true);
    expect(row.reason).toContain('fiets');
    expect(row.actions).toEqual(['answer-ask', 'dismiss-ask']);
    expect(row.note).toBe('answer-is-disclosure');
  });

  it('a non-matching ask still SHOWS — the room is not filtered to my interests', async () => {
    // Hiding asks I do not match would make the room a recommender, and would also leak my drivers into
    // what I can see. Everyone hears the question; only matching is private.
    const { screen, ask } = withAsks({ getDrivers: drivers(['tuinieren']) });
    screen.open();
    ask(anAsk());
    await flush();

    const [row] = screen.model().asks;
    expect(row.resonant).toBe(false);
    expect(row.reason).toBeNull();
    expect(row.actions).toEqual(['answer-ask', 'dismiss-ask']);   // I can still answer
  });

  it('with no drivers configured, asks show and simply never resonate', async () => {
    const { screen, ask } = withAsks({ getDrivers: null });
    screen.open();
    ask(anAsk());
    await flush();
    expect(screen.model().asks[0]).toMatchObject({ resonant: false, reason: null });
  });

  it('an EXPIRED ask never enters the room', async () => {
    const { screen, ask } = withAsks({ getDrivers: drivers(['fiets']), nowMs: T0 + 120_000 });
    screen.open();
    ask(anAsk());
    await flush();
    expect(screen.model().asks).toEqual([]);
  });

  it('newest first', async () => {
    const { screen, ask } = withAsks({ getDrivers: null });
    screen.open();
    ask(anAsk({ id: 'old', createdAt: T0 - 1_000 }));
    ask(anAsk({ id: 'new', createdAt: T0 }));
    await flush();
    expect(screen.model().asks.map((a) => a.ask.id)).toEqual(['new', 'old']);
  });

  it('closing the room DROPS the asks', async () => {
    // A closed screen holding what strangers needed is a quiet record of where someone has been.
    const { screen, ask } = withAsks({ getDrivers: null });
    screen.open();
    ask(anAsk());
    await flush();
    expect(screen.model().asks).toHaveLength(1);

    screen.close();
    expect(screen.model().asks).toEqual([]);
  });

  it('a failing driver read leaves the ask visible but unmatched', async () => {
    const onError = vi.fn();
    const { screen, ask } = withAsks({
      getDrivers: async () => { throw new Error('vault locked'); }, onError,
    });
    screen.open();
    ask(anAsk());
    await flush();
    // The matcher swallows its own failures, so the ask lands unmatched rather than vanishing.
    expect(screen.model().asks[0]).toMatchObject({ resonant: false });
  });

  it('no ask source ⇒ an empty ask list, not a crash', () => {
    const { screen } = build();
    screen.open();
    expect(screen.model().asks).toEqual([]);
  });
});

