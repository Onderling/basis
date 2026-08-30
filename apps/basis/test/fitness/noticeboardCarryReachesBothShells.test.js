/**
 * Noticeboard posts have ONE carry (the circle store + task lane). Both shells must bridge a landed post
 * into stoop's index through `setNoticeboardLandedHook`, and neither may still register the retired
 * `circle-post` envelope — a second carry is exactly the drift this replaced (W1). Shell files have no
 * runtime coverage, so this reads the source.
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
  it('the agent no longer fans a circle-post envelope by hand', () => {
    expect(read('../../src/core/agent/realAgent.js')).not.toMatch(/subtype:\s*'circle-post'/);
  });
});
