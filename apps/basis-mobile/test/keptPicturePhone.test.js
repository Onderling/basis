/**
 * THE KEPT PICTURE ON THE PHONE (the cold start, 2026-11-22): Today's kept blocks were replaced at ~3 s by a read made
 * before the circles were known ("nothing planned") until the real one landed at ~13 s, and that early read was written
 * back as the next start's picture; the circles list said "Loading" for ~6 s with no picture at all. Both now follow the
 * one shared rule (`keptPicture.js`). RN cannot render under Vitest, so this reads the source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '../src/screens/v2/CircleLauncherScreen.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe("Today's kept blocks stay until the circles are known", () => {
  it('a landing paints through the shared rule, with the caught-up answer of the circles list', () => {
    expect(src).toMatch(/keptPictureView\(\{ kept: vandaagKeptRef\.current, live: blocks, caughtUp \}\)/);
    expect(src).toMatch(/const caughtUp = launcherSettledRef\.current;/);
  });
  it("the head's own updates follow the same rule", () => {
    expect(src).toMatch(/keptPictureView\(\{ kept: vandaagKeptRef\.current, live: blocks, caughtUp: launcherSettledRef\.current \}\)/);
  });
  it('only a caught-up read is written back as the next picture', () => {
    expect(src).toMatch(/if \(cacheKey && mayKeepPicture\(\{ caughtUp \}\)\) screenBlocksCache\.set\(cacheKey, blocks\)/);
    expect(src).not.toMatch(/\n\s*if \(cacheKey\) screenBlocksCache\.set\(cacheKey, blocks\)/);
  });
});

describe('the circles list paints its kept picture until it is read', () => {
  it('the paint decision is told the kept list, and the kept tiles paint with the refreshing line', () => {
    expect(src).toMatch(/launcherListPaint\(\{[^}]*keptCount: keptCircles\?\.length \?\? 0 \}\)/);
    expect(src).toMatch(/listPaint === 'kept' \?/);
    expect(src).toMatch(/testID="circle-launcher-kept"/);
    // painted through the live list's own grouping: one order rule, so the live list replaces it in place
    expect(src).toMatch(/\{renderLauncherGroups\(keptCircles\.map\(/);
  });
  it('the kept list is sealed, read once the key is there, and only a caught-up list is kept', () => {
    expect(src).toMatch(/createKeptCircles\(sealedKeyValue\(AsyncStorage, \{[^}]*strict: true, waitForKey: true \}\)\)/);
    expect(src).toMatch(/keptCirclesStore\.keep\([^;]*\{ caughtUp: launcherSettled \}\)/);
  });
  it('a tap on a kept tile is remembered and opens the circle once the live list holds it', () => {
    expect(src).toMatch(/openCircle: \(c\) => \{ keptOpenRef\.current = c\.id; \}/);
    expect(src).toMatch(/if \(!id \|\| !launcherSettled\) return;/);
  });
});
