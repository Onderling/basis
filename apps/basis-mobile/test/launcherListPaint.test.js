/**
 * The launcher says "No circles yet." only when that is TRUE.
 *
 * On a cold start the pinboard store hydrates after the agent bundle, so the launcher retries its load a few
 * times while the answer is empty. Between two tries `loading` is false and the list is still empty — and
 * the screen painted "No circles yet." in every gap, for an account that had a circle (found 2026-10-08 on a
 * real phone: the circle appeared only after the store caught up, seconds later). Web never shows this: it
 * paints its launcher only after the agent's boot and the first load have answered.
 *
 * Two halves, as `src/screens/**` cannot be rendered under vitest:
 *   1. THE DECISION — loading · empty · list · boot-failed, from the screen's own state.
 *   2. THE WIRING, as source text — the screen paints from that decision and settles only when the
 *      retry loop has an answer, so a deleted line cannot quietly bring the false empty state back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launcherListPaint } from '../src/screens/v2/launcherListPaint.js';

describe('launcherListPaint — the decision', () => {
  it('an empty answer BEFORE the retries have settled is still loading, not "no circles"', () => {
    expect(launcherListPaint({ loading: false, settled: false, count: 0 })).toBe('loading');
    expect(launcherListPaint({ loading: true, settled: false, count: 0 })).toBe('loading');
  });

  it('an empty answer after the retries gave up is the real empty state', () => {
    expect(launcherListPaint({ loading: false, settled: true, count: 0 })).toBe('empty');
  });

  it('circles on screen are never swapped out for the loading line (a reload repaints in place)', () => {
    expect(launcherListPaint({ loading: true, settled: false, count: 1 })).toBe('list');
    expect(launcherListPaint({ loading: true, settled: true, count: 2 })).toBe('list');
  });

  it('a failed boot is said, not painted as an empty account', () => {
    expect(launcherListPaint({ loading: false, settled: true, count: 0, bootError: 'x' })).toBe('boot-failed');
    expect(launcherListPaint({ loading: false, settled: false, count: 0, bootError: 'x' })).toBe('boot-failed');
  });
});

describe('launcherListPaint — the wiring', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../src/screens/v2/CircleLauncherScreen.js', import.meta.url)), 'utf8');

  it('the launcher paints from the decision', () => {
    expect(src).toMatch(/launcherListPaint\(\{[^}]*settled[^}]*\}\)/);
  });

  it('settles on the FIRST answer once the agent bundle exists — no boot retry', () => {
    // Instrumented on a real phone (2026-10-08): pinboard's store is loaded inside the agent's boot, which the bundle
    // awaits, so the first load WITH a bundle already answers; the only empty first answer is the bundle-not-yet one.
    expect(src).toMatch(/if \(resolveSkill\) \{ setLauncherSettled\(true\)/);
    expect(src).not.toMatch(/hydrates from AsyncStorage a beat AFTER the agent bundle/);
  });
});

// THE KEPT PICTURE (the cold start): before the list is read, the circles the person had last time are painted from the
// kept picture instead of the loading line; never once the list was read (an empty answer is then the truth), never
// over circles already on screen, never over a boot failure.
describe('the kept circles list stands in until the list is read', () => {
  it('not settled, nothing live, a kept picture: the kept list', () => {
    expect(launcherListPaint({ loading: true, settled: false, count: 0, keptCount: 3 })).toBe('kept');
    expect(launcherListPaint({ loading: false, settled: false, count: 0, keptCount: 3 })).toBe('kept');
  });
  it('settled: the live answer, also when it is empty', () => {
    expect(launcherListPaint({ loading: false, settled: true, count: 0, keptCount: 3 })).toBe('empty');
    expect(launcherListPaint({ loading: false, settled: true, count: 2, keptCount: 3 })).toBe('list');
  });
  it('live circles on screen win; a boot failure wins; no picture is the loading line as before', () => {
    expect(launcherListPaint({ loading: true, settled: false, count: 1, keptCount: 3 })).toBe('list');
    expect(launcherListPaint({ loading: false, settled: false, count: 0, keptCount: 3, bootError: 'x' })).toBe('boot-failed');
    expect(launcherListPaint({ loading: true, settled: false, count: 0, keptCount: 0 })).toBe('loading');
  });
});
