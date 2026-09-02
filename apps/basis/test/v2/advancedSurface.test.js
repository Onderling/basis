// The advanced surface's projections — the "default places" rule made checkable:
// an op with no screen surface ALWAYS appears here, and the list is computed by the
// SAME coverage renderer the snapshot uses, so the two can never disagree.
import { describe, it, expect } from 'vitest';
import { advancedOpRows, advancedParamRows } from '../../src/v2/advancedSurface.js';
import { basisManifest } from '../../manifest.js';
import stoopManifest from '../../../stoop/manifest.js';
import { tasksManifest } from '../../../tasks-v0/manifest.js';
import { folioManifest } from '../../../folio/manifest.js';
import { calendarManifest } from '../../../calendar/manifest.js';
import { householdManifest } from '../../../household/manifest.js';
import { listsManifest } from '../../../lists/manifest.js';
import { agentsManifest } from '../../../agents/manifest.js';

const MANIFEST = {
  appId: 'demo',
  operations: [
    { id: 'hasScreen', verb: 'list', params: [], surfaces: { ui: { screen: 'x' } } },
    { id: 'bare', verb: 'submit', params: [], description: 'a bare op', surfaces: { chat: { hint: 'do the bare thing' } } },
    {
      id: 'needsArgs', verb: 'submit',
      params: [{ name: 'name', kind: 'string', required: true }, { name: 'note', kind: 'string' }],
      surfaces: { slash: { command: '/needs-args' } },
    },
    {
      id: 'hasPage', verb: 'set',
      params: [{ name: 'url', kind: 'string', required: true }],
      surfaces: { page: { kind: 'side-panel', title: 'Relay server', labelKey: 'circle.mydata.relay_set' } },
    },
  ],
};

describe('advancedOpRows', () => {
  it("the composed apps' long tail is SHELVED: 0 rows in `other`, and the snapshots are not rows", () => {
    // The 94-row sort (2026-09-02). `other` is where an op lands when nobody has decided about it —
    // the drawer of last resort must not open on the undecided, so the count is pinned at zero and
    // PRINTED on failure: the row names are the work list, not a mystery number.
    const manifests = [stoopManifest, tasksManifest, folioManifest, calendarManifest,
      householdManifest, listsManifest, agentsManifest];
    const rows = advancedOpRows({ manifests });
    const other = rows.filter((r) => r.group === 'other');
    expect(other.map((r) => `${r.app}:${r.op}`).join(' '), `\n${other.length} undecided op(s) on the Other shelf`).toBe('');
    // The three snapshot ops are substrate (`surfaces.internal`): callable, never listed.
    const names = new Set(rows.map((r) => `${r.app}:${r.op}`));
    for (const gone of ['tasks:getTaskSnapshot', 'folio:getFileSnapshot', 'calendar:getEventSnapshot']) {
      expect(names.has(gone), `${gone} must not be a drawer row`).toBe(false);
    }
    // …and every declared shelf is one the ordering knows, or the sort quietly dumps it at the end.
    for (const r of rows) {
      expect(['overview', 'identity', 'device', 'people', 'connectivity', 'diagnostics', 'help',
        'data', 'admin', 'compose']).toContain(r.group);
    }
  });

  it('lists exactly the ops WITHOUT a screen surface; run-vs-chat splits on required params', () => {
    const rows = advancedOpRows({ manifests: [MANIFEST] });
    expect(rows.map((r) => r.op)).toEqual(['bare', 'needsArgs']);
    const bare = rows.find((r) => r.op === 'bare');
    expect(bare).toMatchObject({ runnable: true, description: 'a bare op', slash: null });
    const needs = rows.find((r) => r.op === 'needsArgs');
    expect(needs).toMatchObject({ runnable: false, slash: '/needs-args', requiredParams: ['name'], via: 'form' });
  });
  it('an argument-taking op gets a FORM of its own on every shell — chat is a hint, never the only door', () => {
    // A device with no circle has no chat; an op that only points at chat is unreachable there. The row
    // carries the params the shell builds the form from, and says `form`.
    const rows = advancedOpRows({ manifests: [MANIFEST] });
    const needs = rows.find((r) => r.op === 'needsArgs');
    expect(needs.via).toBe('form');
    expect(needs.params.map((p) => p.name)).toEqual(['name', 'note']);
    // an op that DECLARES a page is a screen-having op and is not in this list at all (it has its place)
    expect(rows.find((r) => r.op === 'hasPage')).toBeUndefined();
  });

  it('the REAL basis manifest projects without error, and every row is genuinely screen-less', () => {
    const rows = advancedOpRows({ manifests: [basisManifest] });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const op = basisManifest.operations.find((o) => o.id === r.op);
      expect(!!(op.surfaces?.ui || op.surfaces?.page)).toBe(false);
    }
  });
});

describe('advancedOpRows — the app an op belongs to', () => {
  it("reads the manifest's `app` field (what the real manifests declare), so two apps' `listOpen` are two rows with two keys", () => {
    // Every real manifest says `app: 'stoop'`, not `appId`. Reading only `appId` made every row's app ''
    // — stoop and household both declaring `listOpen` collided as the same React key (a redbox on the
    // phone, W25) and Run dispatched to app ''.
    const rows = advancedOpRows({ manifests: [
      { app: 'stoop', operations: [{ id: 'listOpen', verb: 'list', params: [] }] },
      { app: 'household', operations: [{ id: 'listOpen', verb: 'list', params: [] }] },
    ] });
    expect(rows.map((r) => `${r.app}:${r.op}`).sort()).toEqual(['household:listOpen', 'stoop:listOpen']);
  });
});

describe('advancedParamRows', () => {
  it('reshapes the list-user-params reply; garbage in → empty out', () => {
    const rows = advancedParamRows({ ok: true, params: [{ key: 'a.b', scope: 'device', value: 5, default: 3, home: 'x' }] });
    expect(rows).toEqual([{ key: 'a.b', scope: 'device', value: 5, default: 3 }]);
    expect(advancedParamRows(null)).toEqual([]);
    expect(advancedParamRows({ ok: false })).toEqual([]);
  });
});
