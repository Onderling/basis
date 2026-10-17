/**
 * G13 step C — which address a circle fan actually sends to.
 *
 * The ladder is `circleAddress → pubKey → webid`, and it lives in ONE place so the two fan paths cannot
 * drift. Preferring the per-circle address is the whole of G13: until now every message to every circle
 * went to the member's single global signing key, so a relay saw one identity across all of them.
 *
 * The fallback REPORTING is not decoration. Step D — dropping the fallback — is the irreversible step, and
 * the only honest way to know it is safe is to have watched nobody use the old path. Without the report,
 * "is anyone still being reached the old way?" is unanswerable.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveMemberAddress, makeFallbackReporter, ADDRESS_VIA } from '../src/lib/memberAddress.js';

/**
 * Step C is GATED off by default: preferring the per-circle address only works once the RECIPIENT listens
 * on it, and step B covers `RelayTransport` only — `InternalTransport`/`NknTransport` have no aliases yet.
 * These cases pass the flag explicitly, which is what the shipped caller will do once B is complete.
 */
const ON = { preferCircleAddress: true };

const CIRCLE = 'oosterpoort';
const WEBID = 'https://id.example/bram';
const PUBKEY = 'pk-bram-global';
const CIRCLE_ADDR = 'addr-bram-in-oosterpoort';

describe('the address ladder', () => {
  it('prefers the PER-CIRCLE address when the roster has one', async () => {
    const r = await resolveMemberAddress(
      { webid: WEBID, pubKey: PUBKEY, circleAddress: CIRCLE_ADDR }, { circleId: CIRCLE, ...ON },
    );
    expect(r).toMatchObject({ addr: CIRCLE_ADDR, via: ADDRESS_VIA.CIRCLE, webid: WEBID });
    // The global key is present and deliberately NOT used — that is the entire point of G13.
    expect(r.addr).not.toBe(PUBKEY);
  });

  it('returns the member\'s FULL proven address set as `addrs`, primary first', async () => {
    // A member can hold a set of proven per-circle addresses (a second device, a restored profile).
    // `addr` stays the primary for every single-address caller; `addrs` is what the fan tries in order.
    const SECOND = 'addr-bram-second-device';
    const r = await resolveMemberAddress(
      { webid: WEBID, pubKey: PUBKEY, circleAddress: CIRCLE_ADDR, circleAddresses: [CIRCLE_ADDR, SECOND] },
      { circleId: CIRCLE, ...ON },
    );
    expect(r.addr).toBe(CIRCLE_ADDR);
    expect(r.addrs).toEqual([CIRCLE_ADDR, SECOND]);
    expect(r.via).toBe(ADDRESS_VIA.CIRCLE);
  });

  it('a single-address row yields a one-element set — the shapes stay interchangeable', async () => {
    const r = await resolveMemberAddress(
      { webid: WEBID, pubKey: PUBKEY, circleAddress: CIRCLE_ADDR }, { circleId: CIRCLE, ...ON },
    );
    expect(r.addrs).toEqual([CIRCLE_ADDR]);
  });

  it('a row carrying only the plural field still routes on the circle rung', async () => {
    const r = await resolveMemberAddress(
      { webid: WEBID, pubKey: PUBKEY, circleAddresses: [CIRCLE_ADDR] }, { circleId: CIRCLE, ...ON },
    );
    expect(r).toMatchObject({ addr: CIRCLE_ADDR, via: ADDRESS_VIA.CIRCLE });
    expect(r.addrs).toEqual([CIRCLE_ADDR]);
  });

  it('with the gate OFF (today) the circle address is ignored — B is not finished', async () => {
    // The gate exists because basis's real-agent tests went red: preferring an address nobody listens on
    // silently stops delivery. Off is the shipped default until every transport registers aliases.
    const r = await resolveMemberAddress(
      { webid: WEBID, pubKey: PUBKEY, circleAddress: CIRCLE_ADDR }, { circleId: CIRCLE },
    );
    expect(r).toMatchObject({ addr: PUBKEY, via: ADDRESS_VIA.PUBKEY });
  });

  it('falls back to the global pubKey when there is no circle address', async () => {
    const r = await resolveMemberAddress({ webid: WEBID, pubKey: PUBKEY }, { circleId: CIRCLE, ...ON });
    expect(r).toMatchObject({ addr: PUBKEY, via: ADDRESS_VIA.PUBKEY });
  });

  it('asks the MemberMap when the roster row is lossy', async () => {
    const resolveByWebid = vi.fn(async () => ({ pubKey: PUBKEY }));
    const r = await resolveMemberAddress({ webid: WEBID }, { circleId: CIRCLE, resolveByWebid, ...ON });
    expect(r.addr).toBe(PUBKEY);
    expect(resolveByWebid).toHaveBeenCalledWith(WEBID);
  });

  it('falls back to the webid last — basis binds webid to the chat pubKey', async () => {
    const r = await resolveMemberAddress({ webid: WEBID }, { circleId: CIRCLE, ...ON });
    expect(r).toMatchObject({ addr: WEBID, via: ADDRESS_VIA.WEBID });
  });

  it('a bare string member still resolves', async () => {
    const r = await resolveMemberAddress(WEBID, { circleId: CIRCLE, ...ON });
    expect(r).toMatchObject({ addr: WEBID, via: ADDRESS_VIA.WEBID });
  });

  it('a member with nothing routable resolves to nothing rather than throwing', async () => {
    for (const bad of [null, undefined, {}, 42]) {
      await expect(resolveMemberAddress(bad, { circleId: CIRCLE, ...ON })).resolves.toMatchObject({ addr: null, via: null });
    }
  });

  it('a MemberMap that throws degrades to the webid instead of failing the fan', async () => {
    const r = await resolveMemberAddress({ webid: WEBID }, {
      circleId: CIRCLE, ...ON, resolveByWebid: async () => { throw new Error('map down'); },
    });
    expect(r.addr).toBe(WEBID);
  });
});

describe('fallbacks are reported — this is how we learn step D is safe', () => {
  it('the circle address reports NOTHING — the good path is silent', async () => {
    const onFallback = vi.fn();
    await resolveMemberAddress({ webid: WEBID, circleAddress: CIRCLE_ADDR }, { circleId: CIRCLE, onFallback, ...ON });
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('each fallback reports its reason', async () => {
    const onFallback = vi.fn();
    await resolveMemberAddress({ webid: WEBID, pubKey: PUBKEY }, { circleId: CIRCLE, onFallback, ...ON });
    expect(onFallback).toHaveBeenCalledWith({ circleId: CIRCLE, webid: WEBID, via: ADDRESS_VIA.PUBKEY });

    onFallback.mockClear();
    await resolveMemberAddress({ webid: WEBID }, { circleId: CIRCLE, onFallback, ...ON });
    expect(onFallback).toHaveBeenCalledWith({ circleId: CIRCLE, webid: WEBID, via: ADDRESS_VIA.WEBID });
  });

  it('a throwing reporter never breaks a send', async () => {
    const r = await resolveMemberAddress({ webid: WEBID, pubKey: PUBKEY }, {
      circleId: CIRCLE, ...ON, onFallback: () => { throw new Error('log sink down'); },
    });
    expect(r.addr).toBe(PUBKEY);
  });
});

describe('the reporter dedupes, so the signal stays readable', () => {
  it('reports once per (circle, member, reason), not once per message', () => {
    const lines = [];
    const report = makeFallbackReporter((m) => lines.push(m));
    for (let i = 0; i < 50; i++) report({ circleId: CIRCLE, webid: WEBID, via: ADDRESS_VIA.PUBKEY });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(CIRCLE);
    expect(lines[0]).toContain('pubkey');
  });

  it('a different member, circle, or reason is its own line', () => {
    const lines = [];
    const report = makeFallbackReporter((m) => lines.push(m));
    report({ circleId: CIRCLE, webid: WEBID, via: ADDRESS_VIA.PUBKEY });
    report({ circleId: CIRCLE, webid: 'someone-else', via: ADDRESS_VIA.PUBKEY });
    report({ circleId: 'other-circle', webid: WEBID, via: ADDRESS_VIA.PUBKEY });
    report({ circleId: CIRCLE, webid: WEBID, via: ADDRESS_VIA.WEBID });
    expect(lines).toHaveLength(4);
  });

  it('the line says what it blocks, so nobody drops the fallback while it appears', () => {
    const lines = [];
    makeFallbackReporter((m) => lines.push(m))({ circleId: CIRCLE, webid: WEBID, via: ADDRESS_VIA.PUBKEY });
    expect(lines[0]).toMatch(/Step D/);
  });
});

describe('the per-user fallback setting (2026-07-28)', () => {
  const member = { webid: 'w', pubKey: 'PUBKEY' };

  it('with fallback OFF and no circle address, we are UNDELIVERABLE on purpose', async () => {
    // Better unreachable than routed over the one global key that lets a relay link your circles.
    const onFallback = vi.fn();
    const r = await resolveMemberAddress(member, {
      circleId: 'c1', preferCircleAddress: true, allowFallback: false, onFallback,
    });
    expect(r.addr).toBeNull();
    expect(r.via).toBe(ADDRESS_VIA.NONE);
    // The report still fires — it is the ONLY signal the setting is costing someone messages.
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ blocked: true, circleId: 'c1' }));
  });

  it('with fallback ON it behaves exactly as before', async () => {
    const r = await resolveMemberAddress(member, { preferCircleAddress: true, allowFallback: true });
    expect(r.addr).toBe('PUBKEY');
    expect(r.via).toBe(ADDRESS_VIA.PUBKEY);
  });

  it('the setting is irrelevant when a circle address exists', async () => {
    const r = await resolveMemberAddress({ ...member, circleAddress: 'CIRCLE' }, {
      preferCircleAddress: true, allowFallback: false,
    });
    expect(r.addr).toBe('CIRCLE');
  });

  it('and irrelevant while step C is off — otherwise it would just break sending', async () => {
    const r = await resolveMemberAddress(member, { preferCircleAddress: false, allowFallback: false });
    expect(r.addr).toBe('PUBKEY');
  });
});

describe('the reporter hands the STRUCTURED report to the offer (2026-07-28)', () => {
  it('onReport receives the raw info — including `blocked` — post-dedup', () => {
    const onReport = vi.fn();
    const reporter = makeFallbackReporter(() => {}, { onReport });
    reporter({ circleId: 'c1', webid: 'w1', via: 'blocked-by-setting', blocked: true });
    reporter({ circleId: 'c1', webid: 'w1', via: 'blocked-by-setting', blocked: true });   // dedup
    reporter({ circleId: 'c1', webid: 'w2', via: 'pubkey' });

    expect(onReport).toHaveBeenCalledTimes(2);
    // `blocked` survives — the console string drops it, and the offer needs exactly that field.
    expect(onReport.mock.calls[0][0]).toMatchObject({ blocked: true, webid: 'w1' });
    expect(onReport.mock.calls[1][0].blocked).toBeUndefined();
  });

  it('a throwing offer hook never breaks a send', () => {
    const reporter = makeFallbackReporter(() => {}, { onReport: () => { throw new Error('bad hook'); } });
    expect(() => reporter({ circleId: 'c', webid: 'w', via: 'pubkey' })).not.toThrow();
  });
});

