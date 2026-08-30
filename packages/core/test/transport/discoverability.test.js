/**
 * Discoverability — the three states, the port property, and the aggregate (Nearby step A).
 *
 * The property under test throughout is HONESTY: the surface must never report a device as less exposed
 * than it is. Every case below is a way that could go wrong.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  DISCOVERABILITY, isDiscoverability, normalizeDiscoverability,
  publishes, browses, maxExposure, createDiscoverabilityControl, Transport,
} from '../../src/index.js';

/** A transport that discovers and does exactly what it is told. */
class Discovering extends Transport {
  applied = [];
  get supportsDiscoverability() { return true; }
  async _applyDiscoverability(state) { this.applied.push(state); return state; }
  async _put() {}
}

/** A transport that cannot go browse-only — mDNS's real limitation today. */
class AlwaysPublishes extends Transport {
  get supportsDiscoverability() { return true; }
  async _applyDiscoverability(state) {
    return state === DISCOVERABILITY.OFF ? DISCOVERABILITY.OFF : DISCOVERABILITY.PUBLISH;
  }
  async _put() {}
}

class Broken extends Transport {
  get supportsDiscoverability() { return true; }
  async _applyDiscoverability() { throw new Error('radio on fire'); }
  async _put() {}
}

/** A relay: carries traffic, discovers nothing. */
class NonDiscovering extends Transport {
  async _put() {}
}

const mk = (Cls) => new Cls({ address: 'a', identity: null });

describe('the vocabulary', () => {
  it('accepts exactly the three states', () => {
    expect(isDiscoverability('off')).toBe(true);
    expect(isDiscoverability('browse')).toBe(true);
    expect(isDiscoverability('browse+publish')).toBe(true);
    expect(isDiscoverability('publish')).toBe(false);   // deliberately not a state
    expect(isDiscoverability(undefined)).toBe(false);
  });

  it('normalizes an unknown value to OFF and says it did not recognise it', () => {
    const r = normalizeDiscoverability('discoverable-ish');
    expect(r).toEqual({ ok: false, value: 'off', reason: 'unknown-discoverability' });
  });

  it('splits the two questions: who announces, who listens', () => {
    expect(publishes(DISCOVERABILITY.PUBLISH)).toBe(true);
    expect(publishes(DISCOVERABILITY.BROWSE)).toBe(false);
    expect(browses(DISCOVERABILITY.BROWSE)).toBe(true);
    expect(browses(DISCOVERABILITY.OFF)).toBe(false);
  });

  it('maxExposure picks the more exposed of two, in either argument order', () => {
    expect(maxExposure('off', 'browse')).toBe('browse');
    expect(maxExposure('browse', 'off')).toBe('browse');
    expect(maxExposure('browse', 'browse+publish')).toBe('browse+publish');
    expect(maxExposure('browse+publish', 'browse')).toBe('browse+publish');
    expect(maxExposure('nonsense', 'browse')).toBe('browse');
    expect(maxExposure('nonsense', 'rubbish')).toBe('off');
  });
});

describe('the port property', () => {
  it('starts off — a transport is not discovering until asked', () => {
    expect(mk(Discovering).discoverability).toBe('off');
    expect(mk(NonDiscovering).supportsDiscoverability).toBe(false);
  });

  it('applies a state and remembers it', async () => {
    const t = mk(Discovering);
    const r = await t.setDiscoverability(DISCOVERABILITY.BROWSE);
    expect(r).toMatchObject({ ok: true, requested: 'browse', effective: 'browse', degraded: false });
    expect(t.discoverability).toBe('browse');
    expect(t.applied).toEqual(['browse']);
  });

  it('a non-discovering transport reports OFF, and is not treated as a failure', async () => {
    const t = mk(NonDiscovering);
    const r = await t.setDiscoverability(DISCOVERABILITY.PUBLISH);
    // ok:true — a relay declining to discover is not breakage. But `effective` is off: it is not part of
    // the answer to "am I visible", in either direction.
    expect(r).toMatchObject({ ok: true, effective: 'off', reason: 'discoverability-unsupported' });
  });

  it('an adapter that cannot comply reports the state it ACHIEVED, flagged degraded', async () => {
    const t = mk(AlwaysPublishes);
    const r = await t.setDiscoverability(DISCOVERABILITY.BROWSE);
    expect(r).toMatchObject({ requested: 'browse', effective: 'browse+publish', degraded: true });
    expect(t.discoverability).toBe('browse+publish');   // stored state is the truth, not the request
  });

  it('an unknown value is refused and changes nothing', async () => {
    const t = mk(Discovering);
    await t.setDiscoverability(DISCOVERABILITY.PUBLISH);
    const r = await t.setDiscoverability('invisible');
    expect(r).toMatchObject({ ok: false, reason: 'unknown-discoverability' });
    expect(t.discoverability).toBe('browse+publish');   // unchanged — a typo must not silently alter state
  });

  it('a THROWING apply assumes the worst rather than the request', async () => {
    const t = mk(Broken);
    const r = await t.setDiscoverability(DISCOVERABILITY.PUBLISH);
    expect(r.ok).toBe(false);
    expect(r.effective).toBe('browse+publish');
    expect(r.degraded).toBe(true);
  });

  it('after a failed attempt to go quiet, it does NOT claim to be quiet', async () => {
    // The dangerous direction: I was publishing, I asked to stop, stopping failed.
    class FailsToStop extends Transport {
      get supportsDiscoverability() { return true; }
      async _applyDiscoverability(state) {
        if (state === DISCOVERABILITY.PUBLISH) return state;
        throw new Error('cannot stop');
      }
      async _put() {}
    }
    const t = mk(FailsToStop);
    await t.setDiscoverability(DISCOVERABILITY.PUBLISH);
    const r = await t.setDiscoverability(DISCOVERABILITY.OFF);
    expect(r.effective).toBe('browse+publish');
    expect(t.discoverability).toBe('browse+publish');
  });
});

describe('the surface (aggregate over transports)', () => {
  it('with no discovering transports it is genuinely off', async () => {
    const c = createDiscoverabilityControl({ transports: () => ({ relay: mk(NonDiscovering) }) });
    const r = await c.set(DISCOVERABILITY.PUBLISH);
    expect(r.effective).toBe('off');
    expect(c.isPublishing).toBe(false);
  });

  it('THE OTHER DIRECTION: less exposed than asked is a shortfall, NOT a degradation', async () => {
    // A laptop with no mDNS and no BLE asking to be discoverable is not a privacy failure — it is a device
    // that cannot do the thing. Warning about it trains people to ignore the warning that matters.
    const onDegraded = vi.fn();
    const c = createDiscoverabilityControl({ transports: () => ({}), onDegraded });
    const r = await c.set(DISCOVERABILITY.PUBLISH);
    expect(r).toMatchObject({ degraded: false, shortfall: true, effective: 'off' });
    expect(onDegraded).not.toHaveBeenCalled();
  });

  it('THE RULE: one transport that cannot go quiet makes the whole surface say so', async () => {
    const ble  = mk(Discovering);
    const mdns = mk(AlwaysPublishes);
    const onDegraded = vi.fn();
    const c = createDiscoverabilityControl({ transports: () => ({ ble, mdns }), onDegraded });

    const r = await c.set(DISCOVERABILITY.BROWSE);

    expect(r.requested).toBe('browse');
    expect(r.effective).toBe('browse+publish');   // NOT 'browse' — the honest answer
    expect(r.degraded).toBe(true);
    expect(c.isPublishing).toBe(true);
    expect(onDegraded).toHaveBeenCalledTimes(1);
    // and it names WHICH transport disagreed, so a UI can say more than "something".
    expect(r.perTransport.find((p) => p.name === 'mdns').effective).toBe('browse+publish');
    expect(r.perTransport.find((p) => p.name === 'ble').effective).toBe('browse');
  });

  it('keeps requested and effective separate, so a UI can show both', async () => {
    const c = createDiscoverabilityControl({ transports: () => ({ mdns: mk(AlwaysPublishes) }) });
    await c.set(DISCOVERABILITY.BROWSE);
    expect(c.requested).toBe('browse');
    expect(c.state).toBe('browse+publish');
  });

  it('one transport throwing does not stop the others being quieted', async () => {
    const ble = mk(Discovering);
    const c = createDiscoverabilityControl({ transports: () => ({ ble, bad: mk(Broken) }) });
    const r = await c.set(DISCOVERABILITY.OFF);
    expect(ble.applied).toEqual(['off']);            // the healthy one still went quiet
    expect(r.perTransport.find((p) => p.name === 'bad').ok).toBe(false);
    expect(r.effective).toBe('off');                 // the broken one's last-known was off too
  });

  it('re-reads transports each call, so one built later is picked up', async () => {
    let ble = null;
    const c = createDiscoverabilityControl({ transports: () => ({ ble }) });
    await c.set(DISCOVERABILITY.PUBLISH);
    expect(c.state).toBe('off');

    ble = mk(Discovering);
    await c.set(DISCOVERABILITY.PUBLISH);
    expect(c.state).toBe('browse+publish');
  });

  it('an unknown state is coerced to off rather than left as-is', async () => {
    const ble = mk(Discovering);
    const c = createDiscoverabilityControl({ transports: () => ({ ble }) });
    await c.set(DISCOVERABILITY.PUBLISH);
    await c.set('sort-of-visible');
    expect(ble.applied).toEqual(['browse+publish', 'off']);
    expect(c.isPublishing).toBe(false);
  });

  it('a throwing onDegraded callback cannot break the surface', async () => {
    const c = createDiscoverabilityControl({
      transports: () => ({ mdns: mk(AlwaysPublishes) }),
      onDegraded: () => { throw new Error('bad listener'); },
    });
    await expect(c.set(DISCOVERABILITY.BROWSE)).resolves.toMatchObject({ degraded: true });
  });

  it('report() is a copy — a caller cannot mutate the surface state', async () => {
    const c = createDiscoverabilityControl({ transports: () => ({ ble: mk(Discovering) }) });
    await c.set(DISCOVERABILITY.PUBLISH);
    const r = c.report();
    r.effective = 'off';
    r.perTransport[0].effective = 'off';
    expect(c.state).toBe('browse+publish');
    expect(c.report().perTransport[0].effective).toBe('browse+publish');
  });

  it('requires a transports FUNCTION, not a snapshot', () => {
    expect(() => createDiscoverabilityControl({ transports: { ble: null } })).toThrow(TypeError);
  });
});

describe('reannounce (Nearby step C)', () => {
  /** An adapter whose apply SHORT-CIRCUITS, like mDNS's connect() does on `#started`. */
  class ShortCircuiting extends Transport {
    starts = 0;
    stops  = 0;
    #on = false;
    get supportsDiscoverability() { return true; }
    async _applyDiscoverability(state) {
      if (state === DISCOVERABILITY.OFF) { if (this.#on) { this.stops++; this.#on = false; } return state; }
      if (!this.#on) { this.starts++; this.#on = true; }   // ← the short-circuit
      return DISCOVERABILITY.PUBLISH;
    }
    async _reannounce(state) {
      await this._applyDiscoverability(DISCOVERABILITY.OFF);
      return this._applyDiscoverability(state);
    }
    async _put() {}
  }

  it('THE BUG IT FIXES: re-applying the same state does nothing, re-announcing restarts', async () => {
    const t = mk(ShortCircuiting);
    await t.setDiscoverability(DISCOVERABILITY.PUBLISH);
    expect(t.starts).toBe(1);

    await t.setDiscoverability(DISCOVERABILITY.PUBLISH);   // a Wi-Fi switch would leave us here: invisible
    expect(t.starts).toBe(1);

    await t.reannounce();
    expect(t.starts).toBe(2);
    expect(t.stops).toBe(1);
  });

  it('does NOT announce a transport that is resting off', async () => {
    // The dangerous direction: a network event must never make an invisible device visible.
    const t = mk(ShortCircuiting);
    const r = await t.reannounce();
    expect(r).toMatchObject({ ok: true, effective: 'off', reason: 'not-discovering' });
    expect(t.starts).toBe(0);
  });

  it('a non-discovering transport is a no-op', async () => {
    const r = await mk(NonDiscovering).reannounce();
    expect(r).toMatchObject({ ok: true, effective: 'off' });
  });

  it('a failed re-announce keeps reporting the exposed state, not a clean restart', async () => {
    class FailsToRestart extends ShortCircuiting {
      async _reannounce() { throw new Error('interface gone'); }
    }
    const t = mk(FailsToRestart);
    await t.setDiscoverability(DISCOVERABILITY.PUBLISH);
    const r = await t.reannounce();
    expect(r).toMatchObject({ ok: false, effective: 'browse+publish' });
    expect(t.discoverability).toBe('browse+publish');
  });

  it('the surface re-announces every transport without changing the requested state', async () => {
    const a = mk(ShortCircuiting);
    const b = mk(ShortCircuiting);
    const c = createDiscoverabilityControl({ transports: () => ({ a, b }) });
    await c.set(DISCOVERABILITY.PUBLISH);

    const r = await c.reannounce();
    expect(a.starts).toBe(2);
    expect(b.starts).toBe(2);
    expect(r.requested).toBe('browse+publish');   // unchanged
    expect(c.state).toBe('browse+publish');
  });

  it('the surface re-announcing while resting off leaves everything off', async () => {
    const a = mk(ShortCircuiting);
    const c = createDiscoverabilityControl({ transports: () => ({ a }) });
    await c.set(DISCOVERABILITY.OFF);
    await c.reannounce();
    expect(a.starts).toBe(0);
    expect(c.isPublishing).toBe(false);
  });

  it('one transport failing to re-announce does not stop the others', async () => {
    class Bad extends Transport {
      get supportsDiscoverability() { return true; }
      async _applyDiscoverability(s) { return s; }
      async _reannounce() { throw new Error('nope'); }
      async _put() {}
    }
    const good = mk(ShortCircuiting);
    // Hoisted deliberately: `transports` is called on EVERY operation, so constructing inline would hand
    // out a fresh instance each time and nothing would ever be in the state the previous call set.
    const bad = mk(Bad);
    const c = createDiscoverabilityControl({ transports: () => ({ good, bad }) });
    await c.set(DISCOVERABILITY.PUBLISH);
    const r = await c.reannounce();
    expect(good.starts).toBe(2);
    expect(r.perTransport.find((p) => p.name === 'bad').ok).toBe(false);
  });
});


describe('a transport that lands late (settle + subscribe)', () => {
  it('settle() re-applies what was asked once a transport exists', async () => {
    // The phone's mDNS is built seconds into boot; the Nearby screen already asked to be announced and was
    // told "nothing can discover". That answer must not outlive the transport's arrival.
    const named = {};
    const c = createDiscoverabilityControl({ transports: () => named });
    expect(await c.set(DISCOVERABILITY.PUBLISH)).toMatchObject({ effective: 'off', shortfall: true });

    const mdns = mk(Discovering);
    named.mdns = mdns;
    const r = await c.settle();
    expect(r).toMatchObject({ requested: 'browse+publish', effective: 'browse+publish', shortfall: false });
    expect(mdns.applied).toEqual(['browse+publish']);
    expect(c.isPublishing).toBe(true);
  });

  it('settle() with nothing ever asked only READS — it does not invent a request', async () => {
    const named = {};
    const c = createDiscoverabilityControl({ transports: () => named });
    const mdns = mk(Discovering);
    await mdns.setDiscoverability(DISCOVERABILITY.BROWSE);   // the builder's resting state
    named.mdns = mdns;
    const r = await c.settle();
    expect(mdns.applied).toEqual(['browse']);                 // nothing re-applied by the control
    expect(r).toMatchObject({ requested: 'off', effective: 'browse' });
  });

  it('settle() re-applies an explicit OFF too — "asked to hide" is not "never asked"', async () => {
    const named = {};
    const c = createDiscoverabilityControl({ transports: () => named });
    await c.set(DISCOVERABILITY.OFF);
    const mdns = mk(Discovering);
    await mdns.setDiscoverability(DISCOVERABILITY.PUBLISH);
    named.mdns = mdns;
    await c.settle();
    expect(mdns.applied).toEqual(['browse+publish', 'off']);
    expect(c.isPublishing).toBe(false);
  });

  it('subscribe() hears every report and stops on unsubscribe', async () => {
    const named = { mdns: mk(Discovering) };
    const c = createDiscoverabilityControl({ transports: () => named });
    const seen = [];
    const off = c.subscribe((r) => seen.push(r.effective));
    await c.set(DISCOVERABILITY.PUBLISH);
    c.refresh();
    await c.reannounce();
    await c.settle();
    expect(seen).toEqual(['browse+publish', 'browse+publish', 'browse+publish', 'browse+publish']);
    off();
    await c.set(DISCOVERABILITY.OFF);
    expect(seen).toHaveLength(4);
    expect(c.subscribe(null)).toBeTypeOf('function');   // a non-function subscriber is a no-op, not a throw
  });

  it('a throwing subscriber never breaks the surface or its siblings', async () => {
    const c = createDiscoverabilityControl({ transports: () => ({ mdns: mk(Discovering) }) });
    const good = vi.fn();
    c.subscribe(() => { throw new Error('bad listener'); });
    c.subscribe(good);
    await expect(c.set(DISCOVERABILITY.BROWSE)).resolves.toMatchObject({ effective: 'browse' });
    expect(good).toHaveBeenCalledTimes(1);
  });
});
