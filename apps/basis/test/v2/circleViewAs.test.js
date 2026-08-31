import { describe, it, expect } from 'vitest';
import { VIEWER_KINDS, viewAsDirectory, revealedMemberLabel } from '../../src/v2/circleViewAs.js';

// `realName` is RELEASE-sourced (the member's own per-circle disclosure); `released` states the
// fact. Carol has a name in her local display cache (`ownDisplayName`) but released nothing —
// revealing is the discloser's act, so nobody but Carol may see it.
const members = [
  { id: 'me',    handle: 'Owl',   realName: 'Frits', released: true },
  { id: 'bob',   handle: 'Fox',   realName: 'Bob',   released: true },
  { id: 'carol', handle: 'Heron', realName: null,    released: false, ownDisplayName: 'Carol' },
];

describe('viewAsDirectory', () => {
  it('open policy: a member viewer sees every RELEASED real name', () => {
    const rows = viewAsDirectory({ members, viewer: { id: 'me', kind: 'member' }, policy: 'open' });
    // Openness widens who may see a release — it never conjures a name nobody disclosed, so
    // Carol (released nothing) still shows her handle even in an open circle.
    expect(rows.map((r) => r.displayName)).toEqual(['Frits', 'Bob', 'Heron']);
  });

  it('pairwise: a member sees self + members who RELEASED their name here', () => {
    const rows = viewAsDirectory({ members, viewer: { id: 'me', kind: 'member' }, policy: 'pairwise' });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.me.displayName).toBe('Frits');   // self
    expect(byId.me.self).toBe(true);
    expect(byId.bob.displayName).toBe('Bob');    // bob released his name to this circle
    expect(byId.bob.revealed).toBe(true);
    expect(byId.carol.displayName).toBe('Heron'); // carol released nothing → handle
    expect(byId.carol.revealed).toBe(false);
  });

  it("your OWN row falls back to your local display cache — you always see yourself", () => {
    const rows = viewAsDirectory({ members, viewer: { id: 'carol', kind: 'member' }, policy: 'pairwise' });
    const carol = rows.find((r) => r.id === 'carol');
    expect(carol.displayName).toBe('Carol');   // her own device holds her name, released or not
    expect(carol.self).toBe(true);
  });

  it('stranger sees only handles, even under open policy', () => {
    const rows = viewAsDirectory({ members, viewer: { kind: 'stranger' }, policy: 'open' });
    expect(rows.map((r) => r.displayName)).toEqual(['Owl', 'Fox', 'Heron']);
    expect(rows.every((r) => !r.revealed)).toBe(true);
  });

  it('agent sees only handles (openness is member-to-member)', () => {
    const rows = viewAsDirectory({ members, viewer: { id: 'some-agent', kind: 'agent' }, policy: 'open' });
    expect(rows.map((r) => r.displayName)).toEqual(['Owl', 'Fox', 'Heron']);
  });

  it('falls back to handle then id when a name is missing', () => {
    const rows = viewAsDirectory({
      members: [{ id: 'x' }, { id: 'y', handle: 'Jay' }],
      viewer: { kind: 'stranger' },
      policy: 'pairwise',
    });
    expect(rows[0].displayName).toBe('x');   // no handle, no realName → id
    expect(rows[1].displayName).toBe('Jay');
  });

  it('unknown viewer kind defaults to member; tolerates empty/missing input', () => {
    expect(VIEWER_KINDS).toEqual(['member', 'stranger', 'agent']);
    expect(viewAsDirectory()).toEqual([]);
    const rows = viewAsDirectory({ members, viewer: { id: 'me', kind: 'bogus' }, policy: 'open' });
    // treated as member viewer — sees the released names (carol released none, so her row shows
    // the handle and is honestly not `revealed`)
    expect(rows.filter((r) => r.id !== 'carol').every((r) => r.revealed)).toBe(true);
    expect(rows.find((r) => r.id === 'carol').displayName).toBe('Heron');
  });
});

describe('the last resort when nobody has given a name', () => {
  // Live from 2026-08-31, when the invented default names went (`nieuwe-buur` and the creator row's
  // "me"). Before that a fresh circle always had SOMETHING to print, so this branch was only ever
  // reached with fixture ids like "bob" — and the first real circle after the removal showed its
  // founder as a 43-character key.
  const label = (m) => revealedMemberLabel(m, { viewerId: null, policy: 'pairwise' }).primary;

  it('shortens an opaque key to something a person can tell apart', () => {
    const key = 'PflwUn2aVLieLdb-DW-0VkmQH6ZMMq4WRRGlBolrrtw';
    expect(label({ id: key })).toBe('peer-PflwUn');
    expect(label({ id: key }).length, 'a row you can read at a glance').toBeLessThan(16);
  });

  it('leaves a webid alone — that IS a name someone chose', () => {
    expect(label({ id: 'webid:anne' })).toBe('webid:anne');
    expect(label({ id: 'https://ada.example/profile#me' })).toBe('https://ada.example/profile#me');
  });

  it('still prefers a handle, and never borrows an unreleased real name', () => {
    expect(label({ id: 'PflwUn2aVLieLdb-DW', handle: 'ada' })).toBe('@ada');
    expect(label({ id: 'PflwUn2aVLieLdb-DW', realName: 'Ada Lovelace' })).toBe('peer-PflwUn');
  });

  it('tolerates a missing id rather than painting "undefined"', () => {
    expect(label({})).toBe('');
  });
});
