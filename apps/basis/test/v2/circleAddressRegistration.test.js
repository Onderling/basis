/**
 * Scoped per-circle address registration (G13 step B's production half).
 *
 * The load-bearing test is J-R2, Frits' property: a relay only ever learns the addresses of circles that
 * ride IT. Register everything everywhere and the per-relay correlation concession silently becomes a
 * global one — each relay handed a linkage it could never observe on its own.
 */
import { describe, it, expect, vi } from 'vitest';
import { Transport } from '@onderling/core';
import { registerCircleAddresses, unregisterCircleAddresses } from '../../src/v2/circleAddressRegistration.js';

class FakeRelay extends Transport {
  bound = [];
  get supportsAliases() { return true; }
  async _bindAddress(a) { this.bound.push(a); }
  _unbindAddress(a) { this.bound = this.bound.filter((x) => x !== a); }
  async _put() {}
}
const mk = () => new FakeRelay({ address: 'me', identity: null });
const addr = (cid) => `addr-${cid}`;

/** A points mapping with the optional reverse view the scoper reads. */
function pointsMap(byUrl) {
  const fn = (url) => byUrl[url] ?? [];
  fn.pointsFor = (cid) => Object.entries(byUrl)
    .filter(([, cids]) => cids.includes(cid))
    .map(([url]) => ({ url }));
  return fn;
}

describe('J-R2 — the Frits property: a relay learns only its own circles', () => {
  it('a circle mapped to ANOTHER relay never registers here, even on the default', async () => {
    const r1 = mk();
    const points = pointsMap({ 'wss://r1': ['x'], 'wss://r2': ['y'] });
    const out = await registerCircleAddresses({
      transport: r1, relayUrl: 'wss://r1', defaultRelayUrl: 'wss://r1',
      circleIds: ['x', 'y'], circleAddressFor: addr, circlesForPoint: points,
    });
    expect(out.registered).toEqual(['x']);
    expect(out.skippedOffRelay).toEqual(['y']);        // y rides r2 — r1 must not learn its address
    expect(r1.addresses).not.toContain('addr-y');
  });

  it('…and the second relay sees only ITS circle — neither can link the two', async () => {
    const r2 = mk();
    const points = pointsMap({ 'wss://r1': ['x'], 'wss://r2': ['y'] });
    const out = await registerCircleAddresses({
      transport: r2, relayUrl: 'wss://r2', defaultRelayUrl: 'wss://r1',
      circleIds: ['x', 'y'], circleAddressFor: addr, circlesForPoint: points,
    });
    expect(out.registered).toEqual(['y']);
    expect(r2.addresses).not.toContain('addr-x');
  });

  it('an UNMAPPED circle falls to the default relay, and only there', async () => {
    const points = pointsMap({ 'wss://r2': ['y'] });   // x has no point recorded
    const def = mk();
    const outDef = await registerCircleAddresses({
      transport: def, relayUrl: 'wss://r1', defaultRelayUrl: 'wss://r1',
      circleIds: ['x', 'y'], circleAddressFor: addr, circlesForPoint: points,
    });
    expect(outDef.registered).toEqual(['x']);

    const other = mk();
    const outOther = await registerCircleAddresses({
      transport: other, relayUrl: 'wss://r3', defaultRelayUrl: 'wss://r1',
      circleIds: ['x'], circleAddressFor: addr, circlesForPoint: points,
    });
    expect(outOther.registered).toEqual([]);           // r3 hosts nothing of ours
  });

  it('no points store at all = the single-relay world: everything registers on the one socket', async () => {
    const r = mk();
    const out = await registerCircleAddresses({
      transport: r, relayUrl: 'wss://only', circleIds: ['x', 'y'], circleAddressFor: addr,
    });
    expect(out.registered.sort()).toEqual(['x', 'y']);
  });
});

describe('the mechanics', () => {
  it('a circle whose address cannot be derived is reported, not silently dropped', async () => {
    const out = await registerCircleAddresses({
      transport: mk(), relayUrl: 'wss://r', circleIds: ['x', 'y'],
      circleAddressFor: (cid) => (cid === 'x' ? 'addr-x' : null),
    });
    expect(out.registered).toEqual(['x']);
    expect(out.noAddress).toEqual(['y']);
  });

  it('one failing bind does not abort the rest, and reports', async () => {
    class Flaky extends FakeRelay {
      async _bindAddress(a) { if (a === 'addr-x') throw new Error('offline'); this.bound.push(a); }
    }
    const onError = vi.fn();
    const out = await registerCircleAddresses({
      transport: new Flaky({ address: 'me', identity: null }), relayUrl: 'wss://r',
      circleIds: ['x', 'y'], circleAddressFor: addr, onError,
    });
    // addAddress KEEPS a failed bind for replay (the port's rule), reporting not-ok.
    expect(out.registered).toEqual(['y']);
    expect(out.failed).toEqual(['x']);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'x');
  });

  it('is idempotent — re-running registers nothing twice', async () => {
    const r = mk();
    const args = { transport: r, relayUrl: 'wss://r', circleIds: ['x'], circleAddressFor: addr };
    await registerCircleAddresses(args);
    await registerCircleAddresses(args);
    expect(r.addresses.filter((a) => a === 'addr-x')).toHaveLength(1);
  });

  it('a transport without alias support is a clean no-op', async () => {
    class NoAlias extends Transport { async _put() {} }
    const out = await registerCircleAddresses({
      transport: new NoAlias({ address: 'me', identity: null }), relayUrl: 'wss://r',
      circleIds: ['x'], circleAddressFor: addr,
    });
    expect(out).toEqual({ registered: [], skippedOffRelay: [], noAddress: [], failed: [] });
  });

  it('J-R4 — moving a circle away unregisters it here, telling this relay nothing else', async () => {
    const r = mk();
    await registerCircleAddresses({ transport: r, relayUrl: 'wss://r', circleIds: ['x'], circleAddressFor: addr });
    expect(r.addresses).toContain('addr-x');

    const { removed } = await unregisterCircleAddresses({ transport: r, circleIds: ['x'], circleAddressFor: addr });
    expect(removed).toEqual(['x']);
    expect(r.addresses).not.toContain('addr-x');
  });
});

describe('a pod point is not a relay (2026-07-30, S4 pod walk)', () => {
  // Found where J-NP1 SUCCEEDING caused the failure: recording the circle's pod as a connection point
  // made `circleMappedAnywhere` treat the circle as living on some other relay, so its per-circle address
  // registered nowhere at all — skipped here as off-relay, and a pod cannot take a registration either.
  const DEFAULT_RELAY = 'ws://default:8787';

  function pointsView(pointsByCircle) {
    const fn = () => [];                                   // circlesFor(url) — unused by this path
    fn.pointsFor = (cid) => pointsByCircle[cid] ?? [];
    return fn;
  }

  it('a circle whose only point is a POD still registers on the default relay', async () => {
    const registered = [];
    const r = await registerCircleAddresses({
      transport: { supportsAliases: true, addAddress: async (a) => { registered.push(a); return { ok: true }; } },
      relayUrl: DEFAULT_RELAY,
      defaultRelayUrl: DEFAULT_RELAY,
      circleIds: ['podcircle'],
      circleAddressFor: () => 'podcircle@address',
      circlesForPoint: pointsView({
        podcircle: [{ url: 'https://pod.example/anna/', kind: 'pod' }],
      }),
    });
    expect(r.skippedOffRelay).toEqual([]);
    expect(registered).toEqual(['podcircle@address']);
  });

  it('…while a circle mapped to a different RELAY is still kept off this one', async () => {
    // The rule this helper exists for must survive the fix — that is the leak it prevents.
    const registered = [];
    const r = await registerCircleAddresses({
      transport: { supportsAliases: true, addAddress: async (a) => { registered.push(a); return { ok: true }; } },
      relayUrl: DEFAULT_RELAY,
      defaultRelayUrl: DEFAULT_RELAY,
      circleIds: ['elsewhere'],
      circleAddressFor: () => 'elsewhere@address',
      circlesForPoint: pointsView({
        elsewhere: [{ url: 'ws://other-relay:8787', kind: 'relay' }],
      }),
    });
    expect(r.skippedOffRelay).toEqual(['elsewhere']);
    expect(registered).toEqual([]);
  });

  it('a circle with BOTH a pod and another relay is still kept off — the relay is what counts', async () => {
    const registered = [];
    const r = await registerCircleAddresses({
      transport: { supportsAliases: true, addAddress: async (a) => { registered.push(a); return { ok: true }; } },
      relayUrl: DEFAULT_RELAY,
      defaultRelayUrl: DEFAULT_RELAY,
      circleIds: ['both'],
      circleAddressFor: () => 'both@address',
      circlesForPoint: pointsView({
        both: [{ url: 'https://pod.example/x/', kind: 'pod' }, { url: 'ws://other:8787', kind: 'relay' }],
      }),
    });
    expect(r.skippedOffRelay).toEqual(['both']);
    expect(registered).toEqual([]);
  });
});
