// @vitest-environment happy-dom
//
// UI → op wiring for the admin "remove member" action. Renders the REAL admin-panel renderer
// (renderCircleAdminPanel) and asserts that clicking a member's "remove" button dispatches the
// production removal op — `callSkill('stoop', 'removeMember', { groupId, memberWebid, memberStableId })`
// — with the exact args circleApp.js's showAdmin onRemove sends. This is the surface half of the no-pod
// key-rotation trigger: this op is what ultimately drives the control-agent rotation + key-event fan
// (proven end-to-end over real agents in appNoPodKeyRotationRealRemove.test.js). No browser, no circleApp
// boot — just the renderer + the dispatch contract.
import { describe, it, expect, vi } from 'vitest';
import { renderCircleAdminPanel } from '../../web/v2/circleAdminPanel.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

describe('circle admin panel — remove member → removeMember op', () => {
  const circleId = 'buren';
  const members = [
    { webid: 'w-admin', displayName: 'Ann', role: 'admin', stableId: 's-admin' },
    { webid: 'w-bob', handle: 'bob', role: 'member', stableId: 's-bob' },
    { webid: 'w-cara', handle: 'cara', role: 'member', stableId: 's-cara' },
  ];

  // The dispatch circleApp.js's showAdmin onRemove performs, verbatim (the op-id + args shape).
  const dispatchRemove = (rawCallSkill) => (m) =>
    rawCallSkill('stoop', 'removeMember', { groupId: circleId, memberWebid: m.webid, memberStableId: m.stableId });

  it('clicking remove dispatches removeMember with the clicked member’s webid + stableId', () => {
    const rawCallSkill = vi.fn(async () => ({ ok: true }));
    const el = renderCircleAdminPanel(mount(), { t, members, viewerWebid: 'w-admin', onRemove: dispatchRemove(rawCallSkill) });   // as the ADMIN

    // Click the remove button on the SECOND member (Bob) — not the admin, not Cara.
    const rows = el.querySelectorAll('.cc-admin__member');
    expect(rows).toHaveLength(3);
    rows[1].querySelector('.cc-admin__member-remove').click();

    expect(rawCallSkill).toHaveBeenCalledTimes(1);
    expect(rawCallSkill).toHaveBeenCalledWith('stoop', 'removeMember', {
      groupId: circleId, memberWebid: 'w-bob', memberStableId: 's-bob',
    });
  });

  it('routes the op to the exact row clicked (Cara, not Bob)', () => {
    const rawCallSkill = vi.fn(async () => ({ ok: true }));
    const el = renderCircleAdminPanel(mount(), { t, members, viewerWebid: 'w-admin', onRemove: dispatchRemove(rawCallSkill) });   // as the ADMIN
    el.querySelectorAll('.cc-admin__member')[2].querySelector('.cc-admin__member-remove').click();
    expect(rawCallSkill).toHaveBeenCalledWith('stoop', 'removeMember', {
      groupId: circleId, memberWebid: 'w-cara', memberStableId: 's-cara',
    });
  });
});
