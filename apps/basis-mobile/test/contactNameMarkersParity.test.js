/**
 * TELLING CONTACTS APART (L116, 2026-09-23) — web ≡ mobile, from ONE source. Since the book reads the roster a
 * contact is named by what THEY said, so one can take another's name and a rename arrives unannounced. Both
 * markers are projection rules in `contactsSource.js` (`markLookalikes` / `markRenames` + the per-device name
 * store), applied inside the ONE shared Contacten read — so a shell that marks rows for itself, or keeps its own
 * memory of what it painted, is the drift this pins.
 *
 * …and TAKING A DISCLOSURE BACK (L115): the action on a circle that discloses nothing but still holds something
 * on the lane, and the word that follows the act when every toggle is off.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const here = (p) => resolve(__dirname, p);
const read = (p) => readFileSync(here(p), 'utf8');

describe('the name markers on Contacten — parity', () => {
  const shared    = read('../../basis/src/v2/contactsSource.js');
  const webHost   = read('../../basis/web/v2/circleApp.js');
  const webRoster = read('../../basis/web/v2/contactsRoster.js');
  const launcher  = read('../src/screens/v2/CircleLauncherScreen.js');
  const roster    = read('../src/screens/v2/ContactsScreen.js');

  it('the rules live once, in the shared read — no shell marks rows itself', () => {
    expect(shared).toMatch(/export function markLookalikes\(/);
    expect(shared).toMatch(/export function markRenames\(/);
    expect(shared).toMatch(/export function makeContactNameStore\(/);
    for (const src of [webRoster, roster]) {
      expect(src, 'a shell PAINTS the markers').toMatch(/lookalike/);
      expect(src).toMatch(/wasName/);
      expect(src, 'and computes neither').not.toMatch(/markLookalikes\(|markRenames\(/);
    }
  });
  it('both hosts keep the per-device memory through the shared store and hand it to the one read', () => {
    for (const src of [webHost, launcher, roster]) expect(src).toMatch(/makeContactNameStore\(/);
    for (const src of [webHost, launcher, roster]) expect(src).toMatch(/loadContactRoster\(\{[^}]*names/s);
  });
  it('opening a thread acknowledges the rename on both shells', () => {
    for (const src of [webHost, launcher]) expect(src).toMatch(/contactNames\.seen\(/);
  });
  it('both rosters say it with the same two keys', () => {
    for (const src of [webRoster, roster]) expect(src).toMatch(/circle\.contacts\.was_named\b/);
    expect(webRoster).toMatch(/circle\.contacts\.lookalike_hint\b/);
  });
});

describe('taking a disclosure back (L115) — parity', () => {
  const model   = read('../../basis/src/v2/personaView.js');
  const loader  = read('../../basis/src/v2/mijLoader.js');
  const webMij  = read('../../basis/web/v2/circleMij.js');
  const webAbout = read('../../basis/web/v2/circleAboutMe.js');
  const mobMij  = read('../src/screens/v2/CircleMijScreen.js');
  const mobAbout = read('../src/screens/v2/CircleAboutMeScreen.js');

  it('the rule is the shared model\'s, fed by what the LANE holds', () => {
    expect(model).toMatch(/canWithdraw/);
    expect(loader, 'the loader reads my own roster row').toMatch(/sharedOnLane/);
  });
  it('both Mij surfaces offer it, with the same two keys', () => {
    for (const src of [webMij, mobMij]) {
      expect(src).toMatch(/canWithdraw/);
      expect(src).toMatch(/circle\.mij\.stop_sharing\b/);
      expect(src).toMatch(/circle\.mij\.stopped_sharing\b/);
    }
  });
  it('both About-me surfaces say "stop" when every toggle is off — the word follows the act', () => {
    for (const src of [webAbout, mobAbout]) {
      expect(src).toMatch(/r\.enabled/);
      expect(src).toMatch(/circle\.mij\.stop_sharing\b/);
    }
  });
});
