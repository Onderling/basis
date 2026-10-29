/**
 * "Never offer what doesn't work": a feature with no built surface is not a settings toggle and not an entry in the
 * composer's "+" (the circle settings offered Lijsten / Agenda / Notities, and the "+" offered "Nieuwe lijst", with
 * nothing anywhere to show a list — screen walk, 2026-10-22). One source: the tab definitions' `built` flag.
 */
import { describe, it, expect } from 'vitest';
import { offeredFeatures } from '../../src/v2/circleTabs.js';
import { attachEntriesFor } from '../../src/v2/attachEntries.js';

describe('offered features', () => {
  it('the settings toggles leave out features with no built surface', () => {
    const f = offeredFeatures();
    for (const gone of ['notes', 'calendar']) expect(f).not.toContain(gone);
    // lists have a surface again: the circle screen's lists block
    for (const kept of ['chat', 'noticeboard', 'tasks', 'lists', 'houseRules', 'memberDirectory']) expect(f).toContain(kept);
  });

  it("the '+' leaves out an entry whose op requires a feature with no surface", () => {
    const manifest = { operations: [
      { id: 'createList', requires: ['lists'], surfaces: { attach: { label: 'circle.attach.new_list', group: 'create' } } },
      { id: 'addTask', requires: ['tasks'], surfaces: { attach: { label: 'circle.attach.task', group: 'create' } } },
    ] };
    const ids = attachEntriesFor({ manifestsByOrigin: { x: manifest } }).map((e) => e.opId);
    expect(ids).toContain('addTask');
    expect(ids).not.toContain('createList');
  });

  it("the '+' offers making a list only where the circle's screen carries the lists block", () => {
    const manifest = { operations: [
      { id: 'createList', requires: ['lists'], surfaces: { attach: { label: 'circle.attach.new_list', group: 'create' } } },
    ] };
    expect(attachEntriesFor({ manifestsByOrigin: { x: manifest }, blockTypes: ['tasks'] }).map((e) => e.opId)).toEqual([]);
    expect(attachEntriesFor({ manifestsByOrigin: { x: manifest }, blockTypes: ['tasks', 'lists'] }).map((e) => e.opId)).toEqual(['createList']);
  });
});
