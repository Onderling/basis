// Tests for the no-relay-literal guard (scripts/lint-no-relay-literal.mjs): it flags the domain in any casing,
// leaves the placeholders and the fixture name alone, and the real tree is clean today.
import { describe, it, expect } from 'vitest';
import { RELAY_DOMAIN, relayLiteralHits, treeHits } from './lint-no-relay-literal.mjs';

describe('lint-no-relay-literal', () => {
  it('flags the domain in a URL, a hostname and another casing', () => {
    const text = [`const u = 'wss://${RELAY_DOMAIN}';`, 'ok line', `RELAY_DOMAIN=${RELAY_DOMAIN.toUpperCase()}`].join('\n');
    expect(relayLiteralHits(text).map((h) => h.line)).toEqual([1, 3]);
  });

  it('flags the regex-escaped form a test pattern writes', () => {
    const escaped = RELAY_DOMAIN.split('.').join('\\.');
    expect(relayLiteralHits(`assert.match(env, /wss:\\/\\/${escaped}/);`).length).toBe(1);
  });

  it('leaves the placeholder, the fixture name and the site alone', () => {
    const text = ["wss://<relay-domain>", "'wss://relay.test'", 'https://onderling.org/basis/', 'process.env.ONDERLING_RELAY_URL'].join('\n');
    expect(relayLiteralHits(text)).toEqual([]);
  });

  it('the tree names the domain nowhere', () => {
    expect(treeHits()).toEqual([]);
  });
});
