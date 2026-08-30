/**
 * The DNS-SD seam — mostly one character.
 *
 * `dnsSdType` exists because our wire constant is `_onderling` and `bonjour-service` wants the type without
 * the leading underscore, adding `._tcp.local` itself. Getting it wrong publishes `__onderling._tcp`
 * flawlessly and nothing ever finds it: no throw, no log, just an empty room. That is worth a test even
 * though it is a `replace()`.
 *
 * The rest asserts the record SHAPE against a fake responder — the same reasoning, one level up: a peer
 * whose TXT lacks a pubKey, or whose address is unroutable, must be dropped rather than dialled.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { SERVICE_TYPE } from '../src/MdnsTransport.js';
import { createDnsSdDiscovery, dnsSdType } from '../src/mdnsDnsSdDiscovery.js';

/** A stand-in for the library: records what was published, and lets a test push discoveries. */
function fakeBonjour() {
  const published = [];
  const browsers = [];
  return {
    published,
    browsers,
    publish(cfg) { published.push(cfg); return { stop: vi.fn() }; },
    find(cfg) {
      const b = new EventEmitter();
      b.start = vi.fn();
      b.stop = vi.fn();
      b.cfg = cfg;
      browsers.push(b);
      return b;
    },
    destroy: vi.fn(),
  };
}

describe('dnsSdType — the underscore that decides whether anyone finds you', () => {
  it('strips the leading underscore our constant carries', () => {
    expect(dnsSdType('_onderling')).toBe('onderling');
  });

  it('is pinned to SERVICE_TYPE, so renaming the constant cannot silently desync the two', () => {
    expect(SERVICE_TYPE.startsWith('_')).toBe(true);
    expect(dnsSdType(SERVICE_TYPE)).toBe(SERVICE_TYPE.slice(1));
    expect(dnsSdType(SERVICE_TYPE).startsWith('_')).toBe(false);
  });

  it('leaves an already-stripped type alone', () => {
    expect(dnsSdType('onderling')).toBe('onderling');
  });
});

describe('advertise', () => {
  it('publishes the stripped type over tcp with pubKey in the TXT record', async () => {
    const bonjour = fakeBonjour();
    const d = createDnsSdDiscovery({ bonjour });
    await d.advertise({ serviceType: SERVICE_TYPE, serviceName: 'dw-laptop', port: 51234, txt: { pubKey: 'KEY-A' } });

    expect(bonjour.published).toHaveLength(1);
    expect(bonjour.published[0]).toMatchObject({
      name: 'dw-laptop', type: 'onderling', protocol: 'tcp', port: 51234, txt: { pubKey: 'KEY-A' },
    });
  });

  it('returns a stop that unpublishes', async () => {
    const bonjour = fakeBonjour();
    const d = createDnsSdDiscovery({ bonjour });
    const stop = await d.advertise({ serviceType: SERVICE_TYPE, serviceName: 'x', port: 1, txt: { pubKey: 'K' } });
    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });
});

describe('browse', () => {
  const upWith = async (service) => {
    const bonjour = fakeBonjour();
    const d = createDnsSdDiscovery({ bonjour });
    const found = [];
    await d.browse({ serviceType: SERVICE_TYPE, onFound: (p) => found.push(p) });
    bonjour.browsers[0].emit('up', service);
    return found;
  };

  it('reports a well-formed peer', async () => {
    const found = await upWith({ addresses: ['192.168.1.44'], port: 51234, txt: { pubKey: 'KEY-B' } });
    expect(found).toEqual([{ host: '192.168.1.44', port: 51234, pubKey: 'KEY-B' }]);
  });

  it('prefers the IPv4 address — a v6 the interface cannot route is a hang, not a skip', async () => {
    const found = await upWith({ addresses: ['fe80::1', '10.0.0.9'], port: 8080, txt: { pubKey: 'KEY-C' } });
    expect(found[0].host).toBe('10.0.0.9');
  });

  it('ignores a record with no pubKey rather than guessing at it', async () => {
    expect(await upWith({ addresses: ['192.168.1.5'], port: 1234, txt: {} })).toEqual([]);
  });

  it('ignores a record with no reachable address or port', async () => {
    expect(await upWith({ addresses: [], port: 0, txt: { pubKey: 'KEY-D' } })).toEqual([]);
  });

  it('browses the stripped type over tcp', async () => {
    const bonjour = fakeBonjour();
    const d = createDnsSdDiscovery({ bonjour });
    await d.browse({ serviceType: SERVICE_TYPE, onFound: () => {} });
    expect(bonjour.browsers[0].cfg).toMatchObject({ type: 'onderling', protocol: 'tcp' });
  });

  it('reports a departure only when the record named a peer', async () => {
    const bonjour = fakeBonjour();
    const d = createDnsSdDiscovery({ bonjour });
    const lost = [];
    await d.browse({ serviceType: SERVICE_TYPE, onFound: () => {}, onLost: (p) => lost.push(p) });
    bonjour.browsers[0].emit('down', { txt: {} });
    bonjour.browsers[0].emit('down', { txt: { pubKey: 'KEY-E' } });
    expect(lost).toEqual([{ pubKey: 'KEY-E' }]);
  });
});
