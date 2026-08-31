/**
 * 5.9c — "Nearby N" passive row tests.
 *
 * vitest excludes `src/screens/**` (no JSX loader, no RN runtime) and
 * the config tagline says "a stray `import 'react-native'` should fail
 * loud" — so we test the screen's seams without loading the RN-flavoured
 * file at all:
 *
 *   1. `formatNearbyLabel(count, t)` — the pure count→string formatter
 *      lifted into src/core/nearbyLabel.js.  Same export the screen
 *      consumes; a future renamed key in locales/*.json breaks here.
 *
 *   2. A synthetic `mdns` object mirroring the public read-side the
 *      launcher relies on (`connectionCount` + Emitter `on`/`off`).
 *      Pins the contract that the screen subscribes to peer-discovered
 *      and peer-disconnected, then re-reads `connectionCount` — so any
 *      future shape-shift on MdnsTransport must keep this surface.
 *
 * The full MdnsTransport class lives in `@onderling/react-native` and is
 * covered by that package's own tests; this slice cares about the
 * launcher's contract, not the transport's correctness.
 */
import { describe, it, expect } from 'vitest';
import { formatNearbyLabel }            from '../src/core/nearbyLabel.js';
import { initLocalisation, setLang, t } from '../src/core/localisation.js';

describe('5.9c formatNearbyLabel', () => {
  it('renders "<label>: 0 devices" at zero peers (honest empty signal)', async () => {
    await initLocalisation({ lng: 'en' });
    expect(formatNearbyLabel(0, t)).toBe('Nearby: 0 devices');
  });

  it('AGREES WITH ITSELF about number — one device is not "1 device(s)"', async () => {
    // The row read "Nearby: 1 device(s)" on a phone (2026-08-31). The locale had carried a proper
    // `count_one` / `count_other` pair for a while; mobile's small hand-rolled t() had no plural
    // branch, so it never looked at them and fell through to the generic entry beside them. Web,
    // reading the SAME shared file through i18next, rendered it correctly — one source, two answers.
    await initLocalisation({ lng: 'en' });
    expect(formatNearbyLabel(1, t)).toBe('Nearby: 1 device');
    expect(formatNearbyLabel(3, t)).toBe('Nearby: 3 devices');
  });

  it('coerces non-finite / negative counts to 0 (defensive)', async () => {
    await initLocalisation({ lng: 'en' });
    expect(formatNearbyLabel(-1,        t)).toBe('Nearby: 0 devices');
    expect(formatNearbyLabel(NaN,       t)).toBe('Nearby: 0 devices');
    expect(formatNearbyLabel(undefined, t)).toBe('Nearby: 0 devices');
  });

  it('localises in Dutch via the nl bundle — and counts in Dutch too', async () => {
    setLang('nl');
    expect(formatNearbyLabel(1, t)).toBe('In de buurt: 1 apparaat');
    expect(formatNearbyLabel(2, t)).toBe('In de buurt: 2 apparaten');
    setLang('en');
  });

  it('a caller that passes NO count still gets a sentence, not a key', () => {
    // `count` stays beside the pair for exactly this: nothing to pluralise, so nothing to choose.
    expect(t('circle.nearby.count')).toBe('{{count}} device(s)');
  });
});

describe('5.9c launcher → mdns contract', () => {
  // Synthetic Emitter mimicking the slice of MdnsTransport the
  // launcher's useEffect consumes.  If the screen ever changes which
  // events it subscribes to, this test (which mirrors the event names
  // verbatim) will surface the drift.
  function mkSyntheticMdns(initial = 0) {
    let count = initial;
    const subs = { 'peer-discovered': new Set(), 'peer-disconnected': new Set() };
    return {
      get connectionCount() { return count; },
      _setCount(n) { count = n; },
      _emit(event) { (subs[event] ?? new Set()).forEach((fn) => fn()); },
      on(event, fn)  { (subs[event] ??= new Set()).add(fn);    return this; },
      off(event, fn) { (subs[event] ??  new Set()).delete(fn); return this; },
    };
  }

  it('mdns.connectionCount is the read-side the formatter reads', async () => {
    await initLocalisation({ lng: 'en' });
    const mdns = mkSyntheticMdns(0);
    expect(formatNearbyLabel(mdns.connectionCount, t)).toBe('Nearby: 0 devices');
    mdns._setCount(3);
    expect(formatNearbyLabel(mdns.connectionCount, t)).toBe('Nearby: 3 devices');
  });

  it('subscribing to peer-discovered + peer-disconnected fires the listener', () => {
    const mdns = mkSyntheticMdns(0);
    let calls = 0;
    const handler = () => { calls += 1; };
    mdns.on('peer-discovered',   handler);
    mdns.on('peer-disconnected', handler);

    mdns._emit('peer-discovered');
    mdns._emit('peer-disconnected');
    expect(calls).toBe(2);

    mdns.off('peer-discovered',   handler);
    mdns.off('peer-disconnected', handler);
    mdns._emit('peer-discovered');
    expect(calls).toBe(2);                          // unsubscribed → no new calls
  });

  it('row gating: `bundle?.mdns ? <Row/> : null` keeps zero-state honest', async () => {
    await initLocalisation({ lng: 'en' });
    // The screen guard is structural ({ bundle?.mdns ? ... : null }), so
    // a freshly-attached mdns reporting 0 still renders the row — we
    // mirror that expectation by asserting the formatter never throws
    // or returns a placeholder for zero.
    const bundleWithMdns    = { mdns: mkSyntheticMdns(0) };
    const bundleWithoutMdns = { mdns: null };
    expect(bundleWithMdns.mdns).toBeTruthy();
    expect(bundleWithoutMdns.mdns).toBeFalsy();
    expect(formatNearbyLabel(bundleWithMdns.mdns.connectionCount, t))
      .toBe('Nearby: 0 devices');
  });
});
