import { describe, it, expect } from 'vitest';
import { VIEWER_KINDS, viewAsDirectory } from '../../src/v2/circleViewAs.js';

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
