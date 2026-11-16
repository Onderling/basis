/**
 * THE LAST ADMIN STEPPING DOWN IS TOLD, AND CHOOSES (Frits 2026-11-10: "admins should be able to step down at any
 * time. If they are the last one, they should be notified (maybe appoint someone, or let the app choose)").
 *
 * The confirm in front of a handover says both ways and names them on its two buttons: "Let the app choose" steps
 * down now (the circle passes to a member chosen from the log); "Appoint someone first" closes the question so the
 * admin can make someone admin on their row, then step down. One shared request, both shells' presenters paint it.
 */
import { describe, it, expect } from 'vitest';
import { roleControlFor, roleChangeConfirm, ROLE_CONTROL_KEYS } from '../../src/v2/circleRoleControl.js';

const t = (k, p) => (p?.name ? `${k}(${p.name})` : k);
const members = [{ webid: 'me', role: 'admin' }, { webid: 'bram', role: 'member' }];

describe('the last admin stepping down', () => {
  const control = roleControlFor({ members, member: members[0], myRef: 'me' });
  it('is a handover', () => expect(control.consequence).toBe('handover'));
  it('the confirm names both ways on its buttons', () => {
    const req = roleChangeConfirm({ control, name: 'Jij', t });
    expect(req.acceptLabel).toBe(ROLE_CONTROL_KEYS.handover_let_app_choose);
    expect(req.cancelLabel).toBe(ROLE_CONTROL_KEYS.handover_appoint_first);
    expect(req.message).toBe(`${ROLE_CONTROL_KEYS.confirm_handover}(Jij)`);
  });
  it('an ordinary demotion keeps the ordinary buttons', () => {
    const two = [{ webid: 'me', role: 'admin' }, { webid: 'cato', role: 'admin' }, { webid: 'bram', role: 'member' }];
    const req = roleChangeConfirm({ control: roleControlFor({ members: two, member: two[1], myRef: 'me' }), name: 'Cato', t });
    expect(req.acceptLabel).toBe('circle.confirm.accept');
  });
});
