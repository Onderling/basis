/**
 * The Nearby screen scrolls as ONE column. On the walk of 2026-10-26 (Frits's FP4) the peer list had its own scroller,
 * which took the whole height, and the sections under it (asked here · ask the room · circles open here · you here) sat
 * at the bottom edge, unreachable once there was more than a screen. The screen's root is the one ScrollView; nothing
 * inside it scrolls on its own. (Screens have no render harness here, so this reads the component's source.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../src/screens/v2/CircleLauncherScreen.js', import.meta.url)), 'utf8');

function nearbyScreenBody() {
  const start = SRC.indexOf('function NearbyScreen({');
  expect(start, 'NearbyScreen is defined').toBeGreaterThan(-1);
  const end = SRC.indexOf('\n}\n', start);
  return SRC.slice(start, end);
}

describe('the Nearby screen', () => {
  it('renders inside one ScrollView, and nothing in it scrolls on its own', () => {
    const body = nearbyScreenBody();
    const ret = body.slice(body.indexOf('  return ('));
    const firstTag = ret.match(/<([A-Z][A-Za-z.]*)/)?.[1];
    expect(firstTag, 'the root of the screen').toBe('ScrollView');
    expect((ret.match(/<ScrollView\b/g) ?? []).length, 'one scroller').toBe(1);
    expect(/<FlatList\b|<SectionList\b/.test(ret), 'no list that scrolls by itself').toBe(false);
  });
});
