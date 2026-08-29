// The advanced surface's projections — the "default places" rule made checkable:
// an op with no screen surface ALWAYS appears here, and the list is computed by the
// SAME coverage renderer the snapshot uses, so the two can never disagree.
import { describe, it, expect } from 'vitest';
import { advancedOpRows, advancedParamRows } from '../../src/v2/advancedSurface.js';
import { basisManifest } from '../../manifest.js';

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

describe('advancedParamRows', () => {
  it('reshapes the list-user-params reply; garbage in → empty out', () => {
    const rows = advancedParamRows({ ok: true, params: [{ key: 'a.b', scope: 'device', value: 5, default: 3, home: 'x' }] });
    expect(rows).toEqual([{ key: 'a.b', scope: 'device', value: 5, default: 3 }]);
    expect(advancedParamRows(null)).toEqual([]);
    expect(advancedParamRows({ ok: false })).toEqual([]);
  });
});
