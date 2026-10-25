/**
 * Noticeboard posts live in their circle's store, and its lane is their only carry. Both shells announce a landed post
 * through `setNoticeboardLandedHook`, neither registers the retired `circle-post` envelope, and the agent neither
 * copies a post into the circle store nor bridges one back: pinboard is handed the circles' stores (`hostCircles`)
 * and writes posts there itself. Shell files have no runtime coverage, so this reads the source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8');
const SHELLS = { web: read('../../web/v2/circleApp.js'), mobile: read('../../../basis-mobile/src/screens/ChatScreen.js') };

describe('one carry for noticeboard posts', () => {
  for (const [shell, src] of Object.entries(SHELLS)) {
    it(`${shell}: bridges a landed post through the agent hook and registers no circle-post envelope`, () => {
      expect(src).toMatch(/setNoticeboardLandedHook\?\.\(landedNoticeboardHandler\(/);
      expect(src).not.toMatch(/'circle-post'\s*:/);
    });
  }
  it('the agent no longer fans a circle-post envelope by hand, nor copies a post into the circle store', () => {
    const ra = read('../../src/core/agent/realAgent.js');
    expect(ra).not.toMatch(/subtype:\s*'circle-post'/);
    expect(ra).not.toMatch(/fanNoticeboardItem|toCircleStorePost/);
    expect(ra).toMatch(/hostCircles:\s*\{/);
  });
});
