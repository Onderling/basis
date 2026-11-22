/**
 * THE KEPT PICTURE ON THE WEB (phone parity, keptPicture.js): Today's landing paints through the shared rule with the
 * web's own "circles read" answer, and only a caught-up state is kept (Today's cache, the kept circles list). Reads the
 * source, as the shell-seam guard does.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '../../web/v2/circleApp.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the web follows the kept-picture rule', () => {
  it('Today: the landing paints through keptPictureView with caughtUp = the circles were read', () => {
    expect(src).toMatch(/keptPictureView\(\{ kept: Array\.isArray\(cached\) \? cached : null, live: blocks, caughtUp: _circlesKnown \}\)/);
    expect(src).toMatch(/circlesCache = await loadLauncherCircles\(\);\s*_circlesKnown = true;/);
  });
  it('only a caught-up state is kept: Today\'s cache and the kept circles list', () => {
    expect(src).toMatch(/if \(cacheKey && mayKeepPicture\(\{ caughtUp: _circlesKnown \}\)\) screenBlocksCache\.set/);
    expect(src).not.toMatch(/\n\s*if \(cacheKey\) screenBlocksCache\.set\(cacheKey, blocks\)/);
    expect(src).toMatch(/keptCirclesStore\.keep\([\s\S]{0,200}\{ caughtUp: _circlesKnown \}\)/);
  });
  it('the kept list is sealed and waits for the key, as on the phone', () => {
    expect(src).toMatch(/createKeptCircles\(sealedKeyValue\(globalThis\.localStorage, \{[^}]*strict: true, waitForKey: true \}\)\)/);
  });
});
