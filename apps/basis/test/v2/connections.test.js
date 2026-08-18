/**
 * The connections surface — the pairing projection both shells paint.
 *
 * The pins here are the product promises, not the plumbing: the DO menu comes from the manifest
 * (no second declaration), the acts that would let a connection escalate past its own boundary are
 * ABSENT from that menu rather than merely discouraged, an empty pick creates nothing, and the two
 * columns a person reads say something honest when a connection cannot read at all.
 */
import { describe, it, expect } from 'vitest';
import {
  connectionOpChoices, connectionSectionChoices, compileConnectionGrant, connectionRows,
  DEVICE_SECTION,
} from '../../src/v2/connections.js';

const MANIFESTS = [
  { appId: 'params', operations: [{ id: 'set-param', title: 'Instelling wijzigen' }, { id: 'get-param' }] },
  { appId: 'household', operations: [
    { id: 'addTask', title: 'Taak toevoegen' },
    { id: 'revealOwnerPhrase' }, { id: 'enrollDevice' }, { id: 'revokeDevice' },
    { id: 'grantSurface' }, { id: 'revokeSurface' }, { id: 'listSurfaceGrants' },
  ] },
];

describe('the DO menu is the manifest, minus what would break the boundary', () => {
  it('offers the manifests own ops', () => {
    const ids = connectionOpChoices({ manifests: MANIFESTS }).map((r) => r.id);
    expect(ids).toContain('params.set-param');
    expect(ids).toContain('household.addTask');
  });

  it('WITHHOLDS the escalation acts — absent from the menu, so nothing can tick them', () => {
    const ids = connectionOpChoices({ manifests: MANIFESTS }).map((r) => r.id);
    for (const forbidden of [
      'household.revealOwnerPhrase',   // the account itself
      'household.enrollDevice',        // would make a DEVICE, which outranks a connection
      'household.revokeDevice',
      'household.grantSurface',        // a connection that can pair connections is not bounded
      'household.revokeSurface',
      'household.listSurfaceGrants',
    ]) expect(ids, `${forbidden} must not be grantable`).not.toContain(forbidden);
  });

  it('carries the manifest label where there is one, and falls back to the op id', () => {
    const byId = new Map(connectionOpChoices({ manifests: MANIFESTS }).map((r) => [r.id, r]));
    expect(byId.get('params.set-param').label).toBe('Instelling wijzigen');
    expect(byId.get('params.get-param').label).toBe('get-param');
  });
});

describe('the SEE menu is the circles, plus device settings', () => {
  it('lists the circles and always offers the device section', () => {
    const rows = connectionSectionChoices({ circles: [{ id: 'fam', name: 'Thuis' }] });
    expect(rows).toEqual([
      { id: 'fam', kind: 'circle', label: 'Thuis' },
      { id: DEVICE_SECTION, kind: 'device', label: null },
    ]);
  });
});

describe('compiling the two tick-lists', () => {
  it('turns picks into grantSurface args', () => {
    expect(compileConnectionGrant({
      viewPubKey: 'V', ops: ['params.set-param'], sections: ['fam', DEVICE_SECTION], label: 'tablet',
    })).toEqual({
      viewPubKey: 'V', ops: ['params.set-param'],
      reads: { circles: ['fam'], device: true }, label: 'tablet',
    });
  });

  it('acting-only is a real shape: no sections → reads null, and NO lane is written', () => {
    const args = compileConnectionGrant({ viewPubKey: 'V', ops: ['params.set-param'], sections: [] });
    expect(args.reads).toBe(null);
  });

  it('a pick that grants NOTHING creates nothing', () => {
    expect(compileConnectionGrant({ viewPubKey: 'V', ops: [], sections: [] })).toBe(null);
  });

  it('de-duplicates a doubled op rather than minting two tokens for it', () => {
    const args = compileConnectionGrant({ viewPubKey: 'V', ops: ['a.b', 'a.b'], sections: [] });
    expect(args.ops).toEqual(['a.b']);
  });
});

describe('the two columns a person actually reads', () => {
  it('names circles instead of showing ids, and counts the ops', () => {
    const [row] = connectionRows({
      surfaces: [{ viewPubKey: 'VVVVVVVVVVVV', label: 'tablet', ops: ['params.set-param'], reads: { circles: ['fam'], device: false } }],
      circles: [{ id: 'fam', name: 'Thuis' }],
    });
    expect(row.sees.circles).toEqual(['Thuis']);
    expect(row.opCount).toBe(1);
    expect(row.short).toBe('VVVVVVVV…');
  });

  it('a connection that cannot read says so honestly — sees is null, not an empty list', () => {
    const [row] = connectionRows({ surfaces: [{ viewPubKey: 'V', ops: ['a.b'], reads: null }] });
    expect(row.sees, 'an unreadable connection must not render as "0 sections"').toBe(null);
  });
});
