import { describe, it, expect } from 'vitest';
import {
  normalizeCircleMembers, circleMemberCount,
  memberFrom, memberToChatItem, memberToViewAs, memberRulesStatus,
} from '../src/circleMembers.js';

describe('normalizeCircleMembers', () => {
  it('maps the raw stoop skill shape { members: [{ webid, handle, displayName }] }', () => {
    const out = normalizeCircleMembers({
      groupId: 'g1',
      members: [
        { webid: 'did:anne', handle: '@anne', displayName: 'Anne de Vries', role: 'admin' },
        { webid: 'did:bob', handle: '@bob', displayName: null },
      ],
    });
    // `realName` is RELEASE-sourced now: a raw `displayName` (the local display cache) surfaces
    // only as `ownDisplayName`, usable for the viewer's own row alone — revealing is the
    // discloser's act, and these rows released nothing.
    expect(out).toEqual([
      { id: 'did:anne', handle: '@anne', realName: null, released: false, ownDisplayName: 'Anne de Vries' },
      { id: 'did:bob', handle: '@bob', realName: null, released: false, ownDisplayName: null },
    ]);
  });

  it('maps the chat-reshaped shape { items: [{ id, webid, label, handle }] }', () => {
    const out = normalizeCircleMembers({
      items: [
        { id: 'did:anne', webid: 'did:anne', label: 'Anne de Vries', handle: '@anne', role: 'member' },
        { id: 'did:carol', webid: 'did:carol', label: '@carol', handle: '@carol' }, // label == handle → no real name
      ],
    });
    expect(out[0]).toEqual({ id: 'did:anne', handle: '@anne', realName: null, released: false, ownDisplayName: 'Anne de Vries' });
    expect(out[1]).toEqual({ id: 'did:carol', handle: '@carol', realName: null, released: false, ownDisplayName: null });
  });

  it('surfaces a RELEASED name — the member\'s own per-circle disclosure — as realName', () => {
    const out = normalizeCircleMembers({
      members: [{ webid: 'did:anne', personaProperties: { realName: 'Anne de Vries' } }],
    });
    expect(out[0].realName).toBe('Anne de Vries');
    expect(out[0].released).toBe(true);
  });

  it('tolerates an empty / nullish / malformed result', () => {
    expect(normalizeCircleMembers(null)).toEqual([]);
    expect(normalizeCircleMembers({})).toEqual([]);
    expect(normalizeCircleMembers({ members: [null, 42, { webid: null }] })).toEqual([]);
  });

  it('accepts a bare array of members too', () => {
    expect(normalizeCircleMembers([{ webid: 'x', handle: '@x' }])).toHaveLength(1);
  });

  it('circleMemberCount counts normalised members', () => {
    expect(circleMemberCount({ members: [{ webid: 'a' }, { webid: 'b' }, { webid: null }] })).toBe(2);
    expect(circleMemberCount(null)).toBe(0);
  });
});

describe('canonical Member projections', () => {
  it('both roster shapes → IDENTICAL canonical Member (shape 1 ≡ shape 2)', () => {
    // shape 1 — raw stoop roster row
    const fromRaw = memberFrom({ webid: 'did:anne', handle: '@anne', displayName: 'Anne de Vries', role: 'admin' });
    // shape 2 — chat-shell item (displayName COLLAPSED into label)
    const fromItem = memberFrom({ id: 'did:anne', type: 'member', webid: 'did:anne', label: 'Anne de Vries', handle: '@anne', role: 'admin' });
    expect(fromRaw).toEqual(fromItem);
    expect(fromRaw).toEqual({
      webid: 'did:anne', handle: '@anne', displayName: 'Anne de Vries', role: 'admin',
      personaProperties: null,
    });
  });

  it('un-collapses label only when distinct from handle/webid', () => {
    // label == handle → no real name recovered
    expect(memberFrom({ id: 'did:carol', webid: 'did:carol', label: '@carol', handle: '@carol' }).displayName).toBeNull();
    // label == webid (no handle) → no real name recovered
    expect(memberFrom({ id: 'did:dan', webid: 'did:dan', label: 'did:dan' }).displayName).toBeNull();
  });

  it('memberToChatItem(memberFrom(row)) is BYTE-IDENTICAL to the old realAgent hand-reshape', () => {
    const oldReshape = (m) => ({
      id: m.webid, type: 'member', webid: m.webid,
      label: m.displayName ?? m.handle ?? m.webid,
      handle: m.handle ?? null, role: m.role ?? 'member',
      ...(m.circleAddress ? { circleAddress: m.circleAddress } : {}),
    });
    const rows = [
      { webid: 'did:anne', handle: '@anne', displayName: 'Anne de Vries', role: 'admin', sealingPublicKey: 'k', circleAddress: 'addr-1' },
      { webid: 'did:bob', handle: '@bob', displayName: null },            // label falls back to handle
      { webid: 'did:eve', displayName: 'Eve', role: 'member' },           // no handle
      { webid: 'did:zed' },                                               // label falls back to webid; no circleAddress key
      { webid: 'did:x', handle: '@x', circleAddress: '' },                // empty circleAddress → key omitted
    ];
    for (const row of rows) {
      expect(memberToChatItem(memberFrom(row))).toEqual(oldReshape(row));
      // key order + presence must match exactly, not just deep-equal
      expect(Object.keys(memberToChatItem(memberFrom(row)))).toEqual(Object.keys(oldReshape(row)));
    }
  });

  it('memberToViewAs(memberFrom(row)) reproduces normalizeCircleMembers row-for-row', () => {
    const results = [
      { members: [
        { webid: 'did:anne', handle: '@anne', displayName: 'Anne de Vries', role: 'admin' },
        { webid: 'did:bob', handle: '@bob', displayName: null },
        { webid: 'did:c', reveals: ['did:bob'] },
      ] },
      { items: [
        { id: 'did:anne', webid: 'did:anne', label: 'Anne de Vries', handle: '@anne', role: 'member' },
        { id: 'did:carol', webid: 'did:carol', label: '@carol', handle: '@carol' },
      ] },
    ];
    for (const res of results) {
      const list = Array.isArray(res.members) ? res.members : res.items;
      const viaProjectors = list.map((m) => memberToViewAs(memberFrom(m)));
      expect(normalizeCircleMembers(res)).toEqual(viaProjectors);
    }
  });

  it('chat-item round-trips through the Member for the fields it carries', () => {
    const item = { id: 'did:anne', type: 'member', webid: 'did:anne', label: 'Anne de Vries', handle: '@anne', role: 'admin', circleAddress: 'addr-1' };
    expect(memberToChatItem(memberFrom(item))).toEqual(item);
  });
});

describe('memberRulesStatus — the member-card rules line (one compute, both shells paint)', () => {
  it('no recorded acceptance → null (ungated circles, founders, pre-gate members: silence, not blame)', () => {
    expect(memberRulesStatus({ webid: 'w' })).toBeNull();
    expect(memberRulesStatus({ webid: 'w', rulesCurrentVersion: '2' })).toBeNull();
    expect(memberRulesStatus(null)).toBeNull();
  });

  it('accepted the current version → not stale', () => {
    expect(memberRulesStatus({ rulesAccepted: '2', rulesCurrentVersion: '2' }))
      .toEqual({ accepted: '2', current: '2', stale: false });
  });

  it('accepted an older version → stale, both versions carried for "accepted v1, current v2"', () => {
    expect(memberRulesStatus({ rulesAccepted: '1', rulesCurrentVersion: '3' }))
      .toEqual({ accepted: '1', current: '3', stale: true });
  });

  it('current version unknown on the row → shown as accepted, never guessed stale', () => {
    expect(memberRulesStatus({ rulesAccepted: '1' }))
      .toEqual({ accepted: '1', current: null, stale: false });
  });

  it('rides the normalised member: roster row → memberToViewAs carries the computed `rules`', () => {
    const [viewAs] = normalizeCircleMembers({ members: [
      { webid: 'w1', handle: 'ann', rulesAccepted: '1', rulesCurrentVersion: '2' },
    ] });
    expect(viewAs.rules).toEqual({ accepted: '1', current: '2', stale: true });
    // And a row without the stamps stays byte-identical — no phantom key on ungated circles.
    const [plain] = normalizeCircleMembers({ members: [{ webid: 'w2', handle: 'bob' }] });
    expect('rules' in plain).toBe(false);
  });
});
