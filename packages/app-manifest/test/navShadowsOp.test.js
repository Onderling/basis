/**
 * A GUI button, a tab and a slash command for the same ACT target the same op; a nav target is only for a view no op
 * backs (Frits, 2026-10-09: "buttons and slash commands sharing the same route is a fundamental part of the
 * architecture"). Strict validation refuses a nav `to` that names an op — the Me Scan button as a `nav: scan` beside the
 * `scanQr` op (`/scan-qr`) was the worked example.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../src/index.js';

const base = {
  app: 'x', version: '0.0.1', itemTypes: [],
  operations: [
    { id: 'scanQr', verb: 'list', params: [], surfaces: { slash: { command: '/scan-qr' } } },
    { id: 'me', verb: 'list', params: [], surfaces: { page: { kind: 'screen', route: 'mij', title: 'Me' } } },
  ],
};
const shadow = (m) => (validateManifest(m, { strict: true }).errors ?? []).filter((e) => e.code === 'nav-shadows-op');

describe('a nav target never stands in for an op', () => {
  it('nav "scan" beside the scanQr op is red, with the message that says what to do', () => {
    const errs = shadow({ ...base, meActions: [{ id: 'scan', labelKey: 'k', target: { kind: 'nav', to: 'scan' } }] });
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toMatch(/an op performs this; target the op/);
  });
  it('the same act targeting the op is green', () => {
    expect(shadow({ ...base, meActions: [{ id: 'scan', labelKey: 'k', target: { kind: 'op', opId: 'scanQr' } }] })).toEqual([]);
  });
  it('a nav to a VIEW no op backs is green (tabs, actions, meActions alike)', () => {
    expect(shadow({ ...base,
      tabs: [{ id: 'circles', labelKey: 'k', target: { kind: 'nav', to: 'circles' } }],
      meActions: [{ id: 'share-contact', labelKey: 'k', target: { kind: 'nav', to: 'shareContact' } }],
    })).toEqual([]);
  });
  it('only under strict', () => {
    const m = { ...base, meActions: [{ id: 'scan', labelKey: 'k', target: { kind: 'nav', to: 'scan' } }] };
    expect((validateManifest(m).errors ?? []).filter((e) => e.code === 'nav-shadows-op')).toEqual([]);
  });
});
