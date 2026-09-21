/**
 * Unread on Contacten (2026-09-21) — web ≡ mobile, from ONE source: both shells build the map through the shared
 * `buildContactUnread` over the channel's `rehydrateAll`, keep the seen-marks through the shared `makeContactSeenStore`
 * (localStorage / AsyncStorage), sum it on the tab through `totalUnread`, and speak the same two keys. A shell that
 * counts for itself, or keeps its own seen-marks, is the drift this pins.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const here = (p) => resolve(__dirname, p);
const read = (p) => readFileSync(here(p), 'utf8');

describe('unread on Contacten — parity', () => {
  const webHost   = read('../../basis/web/v2/circleApp.js');
  const webRoster = read('../../basis/web/v2/contactsRoster.js');
  const webTabs   = read('../../basis/web/v2/circleTabBar.js');
  const launcher  = read('../src/screens/v2/CircleLauncherScreen.js');
  const roster    = read('../src/screens/v2/ContactsScreen.js');
  const tabs      = read('../src/screens/v2/CircleTabBar.js');
  const thread    = read('../src/screens/v2/ContactThreadScreen.js');

  it('both hosts build the map, keep the marks and sum the tab through the shared module', () => {
    for (const src of [webHost, launcher]) {
      expect(src).toMatch(/buildContactUnread\(/);
      expect(src).toMatch(/makeContactSeenStore\(/);
      expect(src).toMatch(/totalUnread\(/);
      expect(src).toMatch(/rehydrateAll/);
    }
  });
  it('both rosters show the count under the same key; both tab bars take `badges`', () => {
    for (const src of [webRoster, roster]) expect(src).toMatch(/circle\.contacts\.unread\b/);
    for (const src of [webTabs, tabs]) { expect(src).toMatch(/badges/); expect(src).toMatch(/circle\.contacts\.unread_tab/); }
  });
  it('opening a thread, and every inbound while it is open, moves the seen-mark on both shells', () => {
    expect(webHost).toMatch(/contactSeen\.mark\(/);
    expect(launcher).toMatch(/contactSeen\.mark\(/);
    expect(thread).toMatch(/onRead/);
  });
});
