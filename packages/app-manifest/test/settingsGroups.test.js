/**
 * `manifest.settingsGroups` — the person's settings behind the gear on Mij: groups of sections (each a door, switch,
 * control or fact; custody-guarded ones marked), then a door to the chooser of the person's circles. Validated here so
 * a shell can trust the declaration it paints from.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../src/index.js';

const base = {
  app: 'x', version: '0.0.1',
  operations: [{ id: 'me', verb: 'list', params: [], visibility: 'private', surfaces: { page: { kind: 'screen', route: 'mij', title: 'Me' } } }],
};
const errorsAt = (m) => (validateManifest(m).errors ?? []).filter((e) => String(e.path).startsWith('/settingsGroups'));
const good = () => ({ ...base, settingsGroups: [
  { id: 'appearance', labelKey: 'a.appearance', sections: [
    { id: 'theme', kind: 'control' }, { id: 'week-overview', kind: 'switch' }, { id: 'privacy', kind: 'fact' },
    { id: 'availability', kind: 'door', target: { kind: 'nav', to: 'availability' } },
    { id: 'keys', kind: 'control', custody: true },
  ] },
  { id: 'per-circle', kind: 'door', labelKey: 'a.perCircle', target: { kind: 'nav', to: 'circleSettingsChooser' } },
] });

describe('settingsGroups', () => {
  it('accepts groups of door · switch · control · fact sections and the per-circle door', () => {
    expect(errorsAt(good())).toEqual([]);
  });
  it('must be an array', () => {
    expect(errorsAt({ ...base, settingsGroups: {} }).length).toBeGreaterThan(0);
  });
  it('refuses an unknown section kind', () => {
    const m = good(); m.settingsGroups[0].sections[0].kind = 'button';
    expect(errorsAt(m).some((e) => /kind/.test(e.message))).toBe(true);
  });
  it('refuses a section id declared twice, even across groups (a section lives in one place)', () => {
    const m = good(); m.settingsGroups.splice(1, 0, { id: 'more', labelKey: 'a.more', sections: [{ id: 'theme', kind: 'control' }] });
    expect(errorsAt(m).some((e) => /declared twice/.test(e.message))).toBe(true);
  });
  it('a door needs a nav target, and only a door has one', () => {
    const m = good(); delete m.settingsGroups[0].sections[3].target;
    expect(errorsAt(m).some((e) => /target/.test(e.message))).toBe(true);
    const n = good(); n.settingsGroups[0].sections[0].target = { kind: 'nav', to: 'x' };
    expect(errorsAt(n).some((e) => /target/.test(e.message))).toBe(true);
  });
  it('custody is a boolean when present', () => {
    const m = good(); m.settingsGroups[0].sections[4].custody = 'yes';
    expect(errorsAt(m).some((e) => /custody/.test(e.message))).toBe(true);
  });
  it('a group needs a label and at least one section', () => {
    const m = good(); m.settingsGroups[0].sections = [];
    expect(errorsAt(m).length).toBeGreaterThan(0);
    const n = good(); delete n.settingsGroups[0].labelKey;
    expect(errorsAt(n).length).toBeGreaterThan(0);
  });
  it('the per-circle row is a door to the circle chooser', () => {
    const m = good(); m.settingsGroups[1].target = { kind: 'nav', to: 'somewhereElse' };
    expect(errorsAt(m).some((e) => /circleSettingsChooser/.test(e.message))).toBe(true);
  });
});
