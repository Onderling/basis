/**
 * Each self on its own sockets: with `relaysOf`, a persona's circle registers ONLY on the persona's relay sockets (with
 * the persona's person address beside it) and the default's circles only on the default's — the relay never sees one
 * socket holding two selves' addresses. Leaving takes a persona's circle off the persona's sockets.
 */
import { describe, it, expect } from 'vitest';
import { registerCircleAddressesOnRelays, unregisterCircleAddressesOnRelays } from '../../src/v2/circleAddressRegistration.js';

const port = (name, log) => ({
  supportsAliases: true,
  addAddress: async (address) => { log.push(`${name}+${address}`); return { ok: true }; },
  removeAddress: (address) => { log.push(`${name}-${address}`); },
});

describe('circle addresses per self', () => {
  it('a persona\'s circle on its own socket with its person address; the default\'s on the default\'s', async () => {
    const log = [];
    const def = { url: 'wss://r', primary: true, identity: 'A', port: port('A', log) };
    const per = { url: 'wss://r', primary: false, identity: 'B', port: port('B', log) };
    await registerCircleAddressesOnRelays({
      relays: [def], circleIds: ['x', 'y'],
      circleAddressFor: (c) => `addr-${c}`, circleAddressSignerFor: () => () => 'sig',
      alsoAddresses: [{ address: 'person-A', sign: () => 's' }],
      relaysOf: (c) => (c === 'y' ? [per] : null),
      alsoAddressesOf: () => [{ address: 'person-B', sign: () => 's' }],
      defaultRelayUrl: 'wss://r',
    });
    expect(log.filter((l) => l.startsWith('A'))).toEqual(expect.arrayContaining(['A+addr-x', 'A+person-A']));
    expect(log.filter((l) => l.startsWith('B'))).toEqual(expect.arrayContaining(['B+addr-y', 'B+person-B']));
    expect(log).not.toContain('A+addr-y');
    expect(log).not.toContain('B+addr-x');
    expect(log).not.toContain('B+person-A');
    expect(log).not.toContain('A+person-B');
  });
  it('without relaysOf: every circle on the given relays, as always', async () => {
    const log = [];
    await registerCircleAddressesOnRelays({
      relays: [{ url: 'wss://r', primary: true, port: port('A', log) }], circleIds: ['x', 'y'],
      circleAddressFor: (c) => `addr-${c}`, circleAddressSignerFor: () => () => 'sig', defaultRelayUrl: 'wss://r',
    });
    expect(log).toEqual(expect.arrayContaining(['A+addr-x', 'A+addr-y']));
  });
  it('leaving a persona\'s circle takes it off the persona\'s socket only', async () => {
    const log = [];
    const def = { url: 'wss://r', port: port('A', log) };
    const per = { url: 'wss://r', port: port('B', log) };
    await unregisterCircleAddressesOnRelays({ relays: [def], relaysOf: (c) => (c === 'y' ? [per] : null), circleIds: ['y'], circleAddressFor: (c) => `addr-${c}` });
    expect(log).toEqual(['B-addr-y']);
  });
});
