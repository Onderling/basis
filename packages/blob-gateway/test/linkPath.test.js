import { describe, it, expect } from 'vitest';
import { feedLinkPath, parseFeedLinkPath, LINK_TOKEN, LINK_NODE, randomKey } from '../src/index.js';

const NODE = 'A'.repeat(43);

describe('a link\'s path', () => {
  it('both forms round-trip', () => {
    const id = randomKey(); const k = randomKey();
    expect(LINK_TOKEN.test(id) && LINK_TOKEN.test(k), 'the minter and the grammar agree').toBe(true);
    expect(parseFeedLinkPath(feedLinkPath({ id, k }))).toEqual({ node: null, id, k });
    expect(parseFeedLinkPath(feedLinkPath({ node: NODE, id, k }))).toEqual({ node: NODE, id, k });
    expect(LINK_NODE.test(NODE)).toBe(true);
  });

  it('anything else is no link', () => {
    for (const p of ['/feed/abc.ics', '/feed/../x.y.ics', '/feed/short/x.y.ics', `/feed/${NODE}/x.ics`, `/feed/${NODE}/a/x.y.ics`,
      `/feed/${'A'.repeat(44)}/x.y.ics`, `/feed/${NODE.slice(1)}=/x.y.ics`, '/feedx/a.b.ics', '', null]) {
      expect(parseFeedLinkPath(p), String(p)).toBeNull();
    }
  });
});
