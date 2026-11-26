/**
 * TWO RULES ANSWER "IS THIS THE HOME NETWORK, NEVER THE INTERNET?": the relay's (`isPrivateRelayName`, core: which
 * names a relay may take from a connection's Host, and which a plain `ws:` relay address may name) and the toolbox
 * page's (`privateHomeHost`, toolboxes.js: where a toolbox page may be served over plain http). Until one rule is left,
 * this test pins where they AGREE and names every place they DIFFER, so a change to one that widens or narrows it
 * without the other is red here, and has to be decided on purpose.
 *
 * @guard the relay's and the toolbox page's home-network rules differ only where this file declares it
 */
import { describe, it, expect } from 'vitest';
import { isPrivateRelayName } from '@onderling/core';
import { privateHomeHost } from '../../src/v2/toolboxes.js';

// [host, relay rule, toolbox rule]: where they agree both are the same; every row where they differ is declared
const CASES = [
  // both: the private IPv4 ranges
  ['10.0.0.5', true, true], ['172.16.0.1', true, true], ['172.31.255.255', true, true], ['192.168.1.20', true, true],
  // neither: public addresses and names, malformed numbers
  ['8.8.8.8', false, false], ['172.32.0.1', false, false], ['192.169.0.1', false, false], ['relay.test', false, false],
  ['example.com', false, false], ['300.1.1.1', false, false], ['', false, false],
  // DIFFER: the relay's wider set (loopback, link-local, the shared range of carrier NAT and Tailscale, a single-label
  // name such as a compose service, private IPv6); the toolbox page takes `localhost`/127.0.0.1 in its own line before
  // this rule, not here
  ['127.0.0.1', true, false], ['localhost', true, false], ['169.254.10.1', true, false], ['100.64.0.1', true, false],
  ['relay', true, false], ['[fd00::1]', true, false], ['[fe80::1]', true, false], ['[::1]', true, false],
  // DIFFER: a `.local` name (mDNS) is the toolbox page's only; a relay address `ws://name.local` is refused today
  ['box.local', false, true],
];

describe('the two home-network rules', () => {
  for (const [host, relay, toolbox] of CASES) {
    it(`${host || '(empty)'}: relay ${relay}, toolbox page ${toolbox}`, () => {
      expect(isPrivateRelayName(host), 'the relay rule').toBe(relay);
      expect(privateHomeHost(host), 'the toolbox page rule').toBe(toolbox);
    });
  }
  it('the differences are exactly the declared ones (a new difference is added above on purpose)', () => {
    const differ = CASES.filter(([, r, t]) => r !== t).map(([h]) => h);
    expect(differ).toEqual(['127.0.0.1', 'localhost', '169.254.10.1', '100.64.0.1', 'relay', '[fd00::1]', '[fe80::1]', '[::1]', 'box.local']);
  });
});
