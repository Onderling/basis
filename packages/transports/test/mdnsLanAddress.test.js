/**
 * The A record a companion publishes is the LAN's address, never a bridge's. bonjour-service answers the host's name with
 * every non-internal interface it finds; on a box with docker that includes 172.x bridges, and a phone that resolved the
 * companion dialled a bridge it cannot reach (the household tablet, 2026-10-26: `surface-go.local` → 172.19.0.1 while the
 * LAN address was 192.168.2.14). So the published address records are limited to the interface the default route leaves
 * by (the firewall's `lan_iface` rule), or the one an operator names.
 */
import { describe, it, expect, vi } from 'vitest';
import { createDnsSdDiscovery, defaultRouteInterface, lanAddressesOf } from '../src/mdnsDnsSdDiscovery.js';

const ROUTES = [
  'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
  'docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
  'wlp1s0\t00000000\t0102A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0',
  'wlp1s0\t0002A8C0\t00000000\t0001\t0\t0\t600\t00FFFFFF\t0\t0\t0',
].join('\n');

const IFACES = {
  lo:      [{ address: '127.0.0.1', family: 'IPv4', internal: true, mac: '00:00:00:00:00:00' }],
  docker0: [{ address: '172.17.0.1', family: 'IPv4', internal: false, mac: '02:42:aa:bb:cc:dd' }],
  'br-1a': [{ address: '172.19.0.1', family: 'IPv4', internal: false, mac: '02:42:aa:bb:cc:ee' }],
  wlp1s0:  [{ address: '192.168.2.14', family: 'IPv4', internal: false, mac: 'f0:1f:af:00:00:01' },
            { address: 'fe80::1', family: 'IPv6', internal: false, mac: 'f0:1f:af:00:00:01' }],
};

/** The library's service, as far as the addresses go: its records() answers every interface, like bonjour-service. */
function fakeBonjour() {
  const services = [];
  return {
    services,
    publish(cfg) {
      const all = Object.values(IFACES).flat().filter((a) => !a.internal);
      const svc = {
        cfg,
        stop: vi.fn(),
        records: () => [
          { type: 'SRV', name: 'x', data: { target: cfg.host, port: cfg.port } },
          ...all.map((a) => ({ type: a.family === 'IPv4' ? 'A' : 'AAAA', name: cfg.host, data: a.address })),
        ],
      };
      services.push(svc);
      return svc;
    },
    find() { return { on() {}, start() {}, stop() {} }; },
    destroy: vi.fn(),
  };
}

describe('the LAN interface', () => {
  it('is the one the default route leaves by', () => {
    expect(defaultRouteInterface(ROUTES)).toBe('wlp1s0');
    expect(defaultRouteInterface('Iface\tDestination\n')).toBeNull();
  });
  it('gives its own addresses only', () => {
    expect(lanAddressesOf(IFACES, 'wlp1s0')).toEqual(['192.168.2.14', 'fe80::1']);
    expect(lanAddressesOf(IFACES, 'nope')).toEqual([]);
  });
});

describe('advertise publishes the LAN address only', () => {
  it('the A record is the LAN interface\'s, never a docker bridge\'s', async () => {
    const bonjour = fakeBonjour();
    const d = createDnsSdDiscovery({ bonjour, hostname: () => 'surface-go', lanInterface: () => 'wlp1s0', interfaces: () => IFACES });
    await d.advertise({ serviceType: '_onderling', serviceName: 'n', port: 45210, txt: { pubKey: 'k' } });
    const recs = bonjour.services[0].records();
    expect(recs.filter((r) => r.type === 'A').map((r) => r.data)).toEqual(['192.168.2.14']);
    expect(recs.some((r) => /^172\./.test(String(r.data)))).toBe(false);
    expect(recs.some((r) => r.type === 'SRV')).toBe(true);   // the other records are untouched
  });

  it('with no LAN interface known, it still never publishes a bridge address', async () => {
    const bonjour = fakeBonjour();
    const d = createDnsSdDiscovery({ bonjour, hostname: () => 'h', lanInterface: () => null, interfaces: () => IFACES });
    await d.advertise({ serviceType: '_onderling', serviceName: 'n', port: 1, txt: { pubKey: 'k' } });
    const a = bonjour.services[0].records().filter((r) => r.type === 'A').map((r) => r.data);
    expect(a).toEqual(['192.168.2.14']);
  });
});
