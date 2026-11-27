/**
 * "Never offer what doesn't work": a feature with no built surface is not a settings toggle and not an entry in the
 * composer's "+" (the circle settings offered Lijsten / Agenda / Notities, and the "+" offered "Nieuwe lijst", with
 * nothing anywhere to show a list — screen walk, 2026-10-22). One source: the tab definitions' `built` flag.
 */
import { describe, it, expect } from 'vitest';
import { offeredFeatures, FEATURE_SURFACE_ACTION } from '../../src/v2/circleTabs.js';
import { isAlphaAction } from '../../src/v2/alphaSurface.js';
import { attachEntriesFor } from '../../src/v2/attachEntries.js';

describe('offered features', () => {
  it('the settings toggles leave out features with no built surface', () => {
    const f = offeredFeatures();
    for (const gone of ['notes', 'calendar']) expect(f).not.toContain(gone);
    // lists have a surface: the circle's Lists tab
    for (const kept of ['chat', 'noticeboard', 'tasks', 'lists', 'memberDirectory']) expect(f).toContain(kept);
  });

  it('a feature whose surface is a circle-menu action is offered exactly when that action is: the switch and the menu hide together', () => {
    // House rules has no tab: its surface is the circle menu's "rules" action. Hidden for the alpha (raw on the phone,
    // 2026-11-27), a switch for it would turn on something nobody can open. Reinstating the action brings both back.
    for (const [feature, action] of Object.entries(FEATURE_SURFACE_ACTION)) {
      expect(offeredFeatures().includes(feature), `${feature}'s switch follows the "${action}" action`).toBe(isAlphaAction(action));
    }
    expect(FEATURE_SURFACE_ACTION.houseRules).toBe('rules');
    expect(offeredFeatures()).not.toContain('houseRules');
  });

  it("the '+' leaves out an entry whose op requires a feature with no surface", () => {
    const manifest = { operations: [
      { id: 'createNote', requires: ['notes'], surfaces: { attach: { label: 'circle.attach.note', group: 'create' } } },
      { id: 'addTask', requires: ['tasks'], surfaces: { attach: { label: 'circle.attach.task', group: 'create' } } },
    ] };
    const ids = attachEntriesFor({ manifestsByOrigin: { x: manifest } }).map((e) => e.opId);
    expect(ids).toContain('addTask');
    expect(ids).not.toContain('createNote');
  });

  it("the '+' offers making a list wherever lists are on: their surface is the circle's Lists tab, not a block", () => {
    const manifest = { operations: [
      { id: 'createList', requires: ['lists'], surfaces: { attach: { label: 'circle.attach.new_list', group: 'create' } } },
    ] };
    expect(attachEntriesFor({ manifestsByOrigin: { x: manifest } }).map((e) => e.opId)).toEqual(['createList']);
  });
});
