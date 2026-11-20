/**
 * The last row of a list is never under the "+".
 *
 * The "+" is docked in the tab bar now (manifest `plus`); opened, its round buttons sit above the bar, and lists ended
 * flush with the screen would lay their last row under them (seen on Vandaag, Nearby and My data with the old floating
 * "+"). Every scrolling list ends with FAB_CLEARANCE of room. The web page and the phone are two numbers for one fact,
 * so this pins their AGREEMENT: the web's round buttons are the size the phone's are, and the web page leaves the room
 * the phone's lists leave.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FAB, FAB_CLEARANCE } from '../../src/screens/v2/fab.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const CSS = read('../../../basis/web/v2/circle.css');

/** The screens a tab with the "+" shows — each one's scrolling list must end with the clearance. */
const UNDER_THE_PLUS = [
  'CircleBlockedScreen', 'LogReportScreen', 'ShareMyContactScreen', 'CircleAdvancedScreen',
  'SharedWithMeScreen', 'CircleMyDataScreen', 'CircleAvailabilityScreen', 'ContactsScreen',
];

describe('the "+" and the room under it', () => {
  it('the web\'s round buttons are the size the phone\'s are', () => {
    const fab = CSS.match(/\.circle-plusdial__btn\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(fab).toMatch(new RegExp(`width:\\s*${FAB.size}px`));
    expect(fab).toMatch(new RegExp(`height:\\s*${FAB.size}px`));
  });

  it('the web page leaves the room the phone\'s lists leave', () => {
    const page = CSS.match(/\.circle-page\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(page).toMatch(new RegExp(`padding:\\s*\\d+px\\s+\\d+px\\s+${FAB_CLEARANCE}px`));
  });

  it('every list under the "+" ends with the clearance, and its round buttons are drawn from FAB', () => {
    for (const name of UNDER_THE_PLUS) {
      const src = read(`../../src/screens/v2/${name}.js`);
      expect(src.match(/<ScrollView\b[^>]*>/s)?.[0] ?? '', `${name}: its list ends under the "+"`).toMatch(/FAB_CLEARANCE/);
    }
    const launcher = read('../../src/screens/v2/CircleLauncherScreen.js');
    const bar = read('../../src/screens/v2/CircleTabBar.js');
    expect(bar, 'the round buttons sit FAB.bottom above the frame\'s foot').toMatch(/bottom: FAB\.bottom/);
    expect(bar).toMatch(/width: FAB\.size, height: FAB\.size/);
    expect((launcher.match(/paddingBottom: FAB_CLEARANCE/g) ?? []).length, 'Vandaag, the circle list and Nearby').toBeGreaterThanOrEqual(3);
  });
});
