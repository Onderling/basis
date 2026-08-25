// @vitest-environment happy-dom
//
// UI → op wiring for the admin panel's ROLE control: make a member an admin, or step an admin back
// down. Renders the REAL admin-panel renderer and drives the REAL confirm gate with a fake presenter,
// so what is asserted is the path a person actually walks — not a hand-built stand-in for it.
//
// Before this control the op had no way in at all: `setMemberRole` declares no slash command, so the
// only route to it was asking the assistant in words. Two halves matter here. The control is offered
// to an admin and nobody else — the op refuses a non-admin and every device's roster fold refuses it
// again, so this is a convenience, but painting an action a person cannot take is its own kind of lie.
// And the LAST admin stepping back is not an ordinary demotion: the fold hands the circle over rather
// than refusing it, so the confirmation has to say so before it happens.
import { describe, it, expect, vi } from 'vitest';
import { renderCircleAdminPanel } from '../../web/v2/circleAdminPanel.js';
import { roleChangeConfirm } from '../../src/v2/circleRoleControl.js';
import { runConfirmGate } from '../../src/v2/confirmGate.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

const circleId = 'buren';
const ann  = { webid: 'w-ann',  displayName: 'Ann',  role: 'admin' };
const bob  = { webid: 'w-bob',  handle: 'bob',  role: 'member' };
const cara = { webid: 'w-cara', handle: 'cara', role: 'member' };

/**
 * The dispatch circleApp.js's showAdmin onSetRole performs, verbatim: the op's own confirm gate in
 * front, then the same `callSkill('stoop', …)` its neighbours in this panel use. `present` stands in
 * for the web dialog and records what it was asked to show.
 */
function wire(rawCallSkill, { accept = true } = {}) {
  const shown = [];
  const present = vi.fn(async (request) => { shown.push(request); return accept; });
  const onSetRole = async (m, control) => {
    const name = m.displayName || m.handle || m.webid;
    await runConfirmGate({
      request: roleChangeConfirm({ control, name, t }),
      present,
      execute: async () => {
        await rawCallSkill('stoop', 'setMemberRole', {
          groupId: circleId, memberWebid: m.webid, role: control.role,
        });
      },
    });
  };
  return { onSetRole, shown, present };
}

const rowsOf = (el) => [...el.querySelectorAll('.cc-admin__member')];
const controlIn = (row) => row.querySelector('.cc-admin__member-role-set');

describe('circle admin panel — the role control appears for an admin, and only for an admin', () => {
  it('an admin sees it on every row, including their own', () => {
    const el = renderCircleAdminPanel(mount(), { t, members: [ann, bob, cara], viewerWebid: 'w-ann' });
    const rows = rowsOf(el);
    expect(rows.map((r) => controlIn(r)?.textContent)).toEqual([
      'circle.admin.make_member',   // Ann, an admin → step back
      'circle.admin.make_admin',    // bob
      'circle.admin.make_admin',    // cara
    ]);
  });

  it('a MEMBER sees no role control at all — the roster still lists everyone', () => {
    const el = renderCircleAdminPanel(mount(), { t, members: [ann, bob, cara], viewerWebid: 'w-bob' });
    expect(rowsOf(el)).toHaveLength(3);
    expect(el.querySelectorAll('.cc-admin__member-role-set')).toHaveLength(0);
    expect(el.querySelectorAll('.cc-admin__member-remove')).toHaveLength(3);   // the panel is otherwise intact
  });

  it('a panel with no viewer resolved yet paints none — absence refuses', () => {
    const el = renderCircleAdminPanel(mount(), { t, members: [ann, bob] });
    expect(el.querySelectorAll('.cc-admin__member-role-set')).toHaveLength(0);
  });
});

describe('circle admin panel — the control dispatches setMemberRole', () => {
  it('promotes the row that was clicked, with the op’s exact args', async () => {
    const rawCallSkill = vi.fn(async () => ({ ok: true }));
    const { onSetRole } = wire(rawCallSkill);
    const el = renderCircleAdminPanel(mount(), { t, members: [ann, bob, cara], viewerWebid: 'w-ann', onSetRole });

    controlIn(rowsOf(el)[2]).click();       // cara, not bob
    await vi.waitFor(() => expect(rawCallSkill).toHaveBeenCalled());
    expect(rawCallSkill).toHaveBeenCalledWith('stoop', 'setMemberRole', {
      groupId: circleId, memberWebid: 'w-cara', role: 'admin',
    });
  });

  it('steps an admin back down — the same op, the other way', async () => {
    const rawCallSkill = vi.fn(async () => ({ ok: true }));
    const { onSetRole } = wire(rawCallSkill);
    const members = [ann, { ...bob, role: 'admin' }, cara];
    const el = renderCircleAdminPanel(mount(), { t, members, viewerWebid: 'w-ann', onSetRole });

    controlIn(rowsOf(el)[1]).click();
    await vi.waitFor(() => expect(rawCallSkill).toHaveBeenCalled());
    expect(rawCallSkill).toHaveBeenCalledWith('stoop', 'setMemberRole', {
      groupId: circleId, memberWebid: 'w-bob', role: 'member',
    });
  });

  it('CANCELLING the confirmation dispatches nothing', async () => {
    const rawCallSkill = vi.fn(async () => ({ ok: true }));
    const { onSetRole, present } = wire(rawCallSkill, { accept: false });
    const el = renderCircleAdminPanel(mount(), { t, members: [ann, bob], viewerWebid: 'w-ann', onSetRole });

    controlIn(rowsOf(el)[1]).click();
    await vi.waitFor(() => expect(present).toHaveBeenCalled());
    expect(rawCallSkill).not.toHaveBeenCalled();
  });
});

describe('circle admin panel — the last admin is told the circle changes hands', () => {
  it('stepping back as the ONLY admin warns about the handover', async () => {
    const rawCallSkill = vi.fn(async () => ({ ok: true }));
    const { onSetRole, shown } = wire(rawCallSkill);
    const el = renderCircleAdminPanel(mount(), { t, members: [ann, bob, cara], viewerWebid: 'w-ann', onSetRole });

    expect(controlIn(rowsOf(el)[0]).dataset.consequence).toBe('handover');
    controlIn(rowsOf(el)[0]).click();
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].message).toBe('circle.admin.role_confirm.handover');
    expect(shown[0].severity).toBe('warn');          // the manifest's own declaration
    // …and it never names the successor: which member the fold appoints is derived from the log.
    expect(shown[0].message).not.toContain('w-bob');
    expect(shown[0].message).not.toContain('w-cara');
  });

  it('an ORDINARY demotion does not — another admin remains, nothing is handed over', async () => {
    const rawCallSkill = vi.fn(async () => ({ ok: true }));
    const { onSetRole, shown } = wire(rawCallSkill);
    const members = [ann, { ...bob, role: 'admin' }, cara];
    const el = renderCircleAdminPanel(mount(), { t, members, viewerWebid: 'w-ann', onSetRole });

    expect(controlIn(rowsOf(el)[1]).dataset.consequence).toBe('plain');
    controlIn(rowsOf(el)[1]).click();
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].message).toBe('circle.admin.role_confirm.demote');
  });

  it('the last admin ALONE is told it cannot take effect, not that it hands over', async () => {
    const rawCallSkill = vi.fn(async () => ({ ok: true }));
    const { onSetRole, shown } = wire(rawCallSkill);
    const el = renderCircleAdminPanel(mount(), { t, members: [ann], viewerWebid: 'w-ann', onSetRole });

    expect(controlIn(rowsOf(el)[0]).dataset.consequence).toBe('no-one-else');
    controlIn(rowsOf(el)[0]).click();
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].message).toBe('circle.admin.role_confirm.no_one_else');
  });

  it('a promotion is confirmed too — the op declares one gate for both directions', async () => {
    const rawCallSkill = vi.fn(async () => ({ ok: true }));
    const { onSetRole, shown } = wire(rawCallSkill);
    const el = renderCircleAdminPanel(mount(), { t, members: [ann, bob], viewerWebid: 'w-ann', onSetRole });

    controlIn(rowsOf(el)[1]).click();
    await vi.waitFor(() => expect(shown).toHaveLength(1));
    expect(shown[0].message).toBe('circle.admin.role_confirm.promote');
  });
});
