/**
 * ONE RULE ANSWERS "IS THIS THE HOME NETWORK, NEVER THE INTERNET?": core's `homeNetworkKind` / `isHomeNetworkHost`.
 * The relay uses it whole (which names a relay may take from a connection's Host, and which a plain `ws:` relay address
 * may name); the toolbox page (`privateHomeHost`, toolboxes.js: where a page may be served over plain http) uses it
 * minus the kinds it declares in one place. This test pins that narrowing: the page differs from the relay only on a
 * host of a declared kind, so a change to either that widens or narrows it is red here, and has to be decided on purpose.
 *
 * @guard the relay's and the toolbox page's home-network rules differ only where this file declares it
 */
import { describe, it, expect } from 'vitest';
import { isHomeNetworkHost, homeNetworkKind } from '@onderling/core';
import { privateHomeHost } from '../../src/v2/toolboxes.js';

// the kinds the toolbox page leaves out, with their reason in toolboxes.js (PAGE_NOT_OVER_HTTP)
const PAGE_LEAVES_OUT = ['shared', 'loopback', 'single-label'];

// [host, kind]: the relay takes every host of a kind; the page every host of a kind it does not leave out
const CASES = [
  ['10.0.0.5', 'private'], ['172.16.0.1', 'private'], ['172.31.255.255', 'private'], ['192.168.1.20', 'private'],
  ['[fd00::1]', 'private'], ['169.254.10.1', 'link-local'], ['[fe80::1]', 'link-local'],
  ['box.local', 'local-name'], ['relay', 'single-label'],
  ['100.64.0.1', 'shared'], ['127.0.0.1', 'loopback'], ['localhost', 'loopback'], ['[::1]', 'loopback'],
  ['8.8.8.8', null], ['172.32.0.1', null], ['192.169.0.1', null], ['relay.test', null], ['example.com', null],
  ['300.1.1.1', null], ['', null],
];

describe('the one home-network rule and the toolbox page narrowing', () => {
  for (const [host, kind] of CASES) {
    const page = kind !== null && !PAGE_LEAVES_OUT.includes(kind);
    it(`${host || '(empty)'}: ${kind ?? 'not the home network'}, relay ${kind !== null}, toolbox page ${page}`, () => {
      expect(homeNetworkKind(host), 'the kind').toBe(kind);
      expect(isHomeNetworkHost(host), 'the relay rule').toBe(kind !== null);
      expect(privateHomeHost(host), 'the toolbox page rule').toBe(page);
    });
  }
  it('the page differs from the relay only on the declared kinds (a new difference is a choice, made above)', () => {
    const differ = CASES.filter(([h]) => isHomeNetworkHost(h) !== privateHomeHost(h)).map(([h]) => h);
    expect(differ).toEqual(['relay', '100.64.0.1', '127.0.0.1', 'localhost', '[::1]']);
  });
});
