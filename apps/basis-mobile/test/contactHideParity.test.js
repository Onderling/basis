/**
 * Hiding a contact (L106, Frits 2026-09-19) — web ≡ mobile ≡ box, from ONE source. The mark lives on the book row
 * (stoop `setContactHidden`), the roster splits through the shared `splitShownHidden`, the channel's two seams
 * (`isHidden` / `onReturned`) bring a hidden contact back when they write, and both screens speak the same four
 * locale keys. A shell that keeps its own hidden set, decides the split itself, or paints a marker of its own
 * wording is the drift this test exists for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const here = (p) => resolve(__dirname, p);
const read = (p) => readFileSync(here(p), 'utf8');

describe('hide a contact — parity', () => {
  const webHost       = read('../../basis/web/v2/circleApp.js');
  const webRoster     = read('../../basis/web/v2/contactsRoster.js');
  const webThread     = read('../../basis/web/v2/contactThread.js');
  const mobileBundle  = read('../src/core/agentBundle.js');
  const mobileRoster  = read('../src/screens/v2/ContactsScreen.js');
  const mobileThread  = read('../src/screens/v2/ContactThreadScreen.js');
  const box           = read('../../basis/bin/device-runner.mjs');

  it('every shell hands the channel who is hidden and what to do when they write again', () => {
    for (const src of [webHost, mobileBundle, box]) {
      expect(src).toMatch(/isHidden:/);
      expect(src).toMatch(/onReturned:/);
    }
  });
  it('the mark is the book\'s: every shell changes it through the ONE stoop op, never a set of its own', () => {
    for (const src of [webHost, mobileBundle, box]) expect(src).toMatch(/'setContactHidden'/);
    for (const src of [webHost, webRoster, webThread, mobileBundle, mobileRoster, mobileThread]) expect(src).not.toMatch(/hiddenContacts|hiddenSet|hiddenIds/);
  });
  it('both rosters split through the shared helper and fold the hidden rows under the same key', () => {
    for (const src of [webRoster, mobileRoster]) {
      expect(src).toMatch(/splitShownHidden/);
      expect(src).toMatch(/circle\.contacts\.hidden_fold/);
    }
  });
  it('both thread views offer Verbergen / Tonen from the same two keys, and paint the returned marker from the TURN that brought them back', () => {
    for (const src of [webThread, mobileThread]) {
      expect(src).toMatch(/circle\.contacts\.hide/);
      expect(src).toMatch(/circle\.contacts\.unhide/);
      // the words come from ONE shared choice (2026-09-24, L114): "verborgen", or "verwijderd" after a deletion —
      // decided from the turn's own mark and the row's deletion time, never by a shell of its own
      expect(src).toMatch(/returnedMarkerKey\(/);
    }
    // …and no shell composes marker text of its own: the mark rides the turn, the renderer names the key.
    for (const src of [webHost, mobileBundle, box]) expect(src).not.toMatch(/circle\.contacts\.returned_marker/);
  });
});
