/**
 * The last row of a list is never under the "+".
 *
 * The floating "+" sits bottom-right above the tab bar on every tab; lists ended flush with the screen, so their last
 * row lay under the button (seen on Vandaag, Nearby and My data). Every scrolling list under the "+" ends with
 * FAB_CLEARANCE of room. The web page and the phone are two numbers for one fact, so this pins their AGREEMENT: the
 * web `.cc-fab` sits where the phone's `FAB` sits, and the web page leaves the room the phone's lists leave.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FAB, FAB_CLEARANCE } from '../../src/screens/v2/fab.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const CSS = read('../../../basis/web/v2/circle.css');

/** The screens a tab with the "+" shows — each one's scrolling list must end with the clearance. */
const UNDER_THE_PLUS = [
  'CircleProfileScreen', 'CircleBlockedScreen', 'LogReportScreen', 'ShareMyContactScreen', 'CircleAdvancedScreen',
  'SharedWithMeScreen', 'CircleMyDataScreen', 'CircleAvailabilityScreen', 'ContactsScreen',
];

describe('the "+" and the room under it', () => {
  it('the web "+" sits where the phone\'s does', () => {
    const fab = CSS.match(/\.cc-fab\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(fab).toMatch(new RegExp(`bottom:\\s*${FAB.bottom}px`));
    expect(fab).toMatch(new RegExp(`width:\\s*${FAB.size}px`));
    expect(fab).toMatch(new RegExp(`height:\\s*${FAB.size}px`));
  });

  it('the web page leaves the room the phone\'s lists leave', () => {
    const page = CSS.match(/\.circle-page\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(page).toMatch(new RegExp(`padding:\\s*\\d+px\\s+\\d+px\\s+${FAB_CLEARANCE}px`));
  });

  it('every list under the "+" ends with the clearance, and the "+" is drawn from FAB', () => {
    for (const name of UNDER_THE_PLUS) {
      const src = read(`../../src/screens/v2/${name}.js`);
      expect(src.match(/<ScrollView\b[^>]*>/s)?.[0] ?? '', `${name}: its list ends under the "+"`).toMatch(/FAB_CLEARANCE/);
    }
    const launcher = read('../../src/screens/v2/CircleLauncherScreen.js');
    expect(launcher).toMatch(/bottom: FAB\.bottom, width: FAB\.size, height: FAB\.size/);
    expect((launcher.match(/paddingBottom: FAB_CLEARANCE/g) ?? []).length, 'Vandaag, the circle list and Nearby').toBeGreaterThanOrEqual(3);
  });
});
