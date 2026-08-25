/**
 * The decision behind the roster's role control: who is offered it, which way it goes, and — the part
 * that is not obvious — what it will DO.
 *
 * A step-down is not one act. Since the roster fold answers a demotion that would empty the admin set
 * by handing the circle over rather than by refusing it, "make this admin a member again" can mean the
 * circle carries on unchanged, or that it changes hands, or that nothing happens at all because there
 * is nobody to hand it to. The person taking it has to be told which, before they take it — and a
 * shell that worked that out for itself would be a second answer to who runs the circle.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { roleControlFor, roleChangeConfirm, ROLE_CONTROL_KEYS } from '../../src/v2/circleRoleControl.js';

const ann  = { webid: 'w-ann',  displayName: 'Ann',  role: 'admin' };
const bob  = { webid: 'w-bob',  handle: 'bob',  role: 'member' };
const cara = { webid: 'w-cara', handle: 'cara', role: 'member' };
const t = (k) => k;

describe('who is offered the control', () => {
  it('an admin is offered it on another member’s row', () => {
    const c = roleControlFor({ members: [ann, bob], member: bob, myRef: 'w-ann' });
    expect(c).toMatchObject({ role: 'admin', labelKey: ROLE_CONTROL_KEYS.make_admin });
  });

  it('…and on their OWN row — stepping back is how someone stops running a circle', () => {
    const c = roleControlFor({ members: [ann, { ...bob, role: 'admin' }], member: ann, myRef: 'w-ann' });
    expect(c).toMatchObject({ role: 'member', labelKey: ROLE_CONTROL_KEYS.make_member });
  });

  it('a MEMBER is offered nothing — not on their own row, not on anyone else’s', () => {
    expect(roleControlFor({ members: [ann, bob], member: bob,  myRef: 'w-bob' })).toBeNull();
    expect(roleControlFor({ members: [ann, bob], member: ann,  myRef: 'w-bob' })).toBeNull();
    expect(roleControlFor({ members: [ann, bob], member: cara, myRef: 'w-bob' })).toBeNull();
  });

  it('an unknown viewer gets nothing — absence refuses, it does not fall through to a yes', () => {
    expect(roleControlFor({ members: [ann, bob], member: bob, myRef: '' })).toBeNull();
    expect(roleControlFor({ members: [ann, bob], member: bob })).toBeNull();
    expect(roleControlFor({ members: [ann, bob], member: bob, myRef: 'w-stranger' })).toBeNull();
  });

  it('a row with no identity gets nothing — there would be nothing to name in the op', () => {
    expect(roleControlFor({ members: [ann, bob], member: { role: 'member' }, myRef: 'w-ann' })).toBeNull();
    expect(roleControlFor({ members: [ann, bob], member: null, myRef: 'w-ann' })).toBeNull();
  });

  it('somebody who is not in this circle gets nothing — there is no role here to change', () => {
    expect(roleControlFor({ members: [ann, bob], member: cara, myRef: 'w-ann' })).toBeNull();
  });

  it('the role is read off the ROSTER row, not off the copy handed in', () => {
    // A stale row saying "member" must not turn a step-down into a promotion.
    const roster = [ann, { ...bob, role: 'admin' }];
    expect(roleControlFor({ members: roster, member: bob, myRef: 'w-ann' }).role).toBe('member');
  });
});

describe('what the step-back will DO — the three answers, told apart', () => {
  it('another admin remains → an ordinary demotion, and nothing about a handover is said', () => {
    const two = [ann, { ...bob, role: 'admin' }, cara];
    const c = roleControlFor({ members: two, member: bob, myRef: 'w-ann' });
    expect(c.consequence).toBe('plain');
    expect(c.confirmKey).toBe(ROLE_CONTROL_KEYS.confirm_demote);
    expect(c.noticeKey).toBe(ROLE_CONTROL_KEYS.notice_demoted);
  });

  it('THE LAST ADMIN, with others in the circle → the confirm says the circle changes hands', () => {
    const c = roleControlFor({ members: [ann, bob, cara], member: ann, myRef: 'w-ann' });
    expect(c.consequence).toBe('handover');
    expect(c.confirmKey).toBe(ROLE_CONTROL_KEYS.confirm_handover);
    expect(c.noticeKey).toBe(ROLE_CONTROL_KEYS.notice_handed_over);
  });

  it('…and never names WHO — that is derived from the log, and the control carries no candidate', () => {
    const c = roleControlFor({ members: [ann, bob, cara], member: ann, myRef: 'w-ann' });
    expect(Object.values(c).join(' ')).not.toContain('w-bob');
    expect(Object.values(c).join(' ')).not.toContain('w-cara');
    expect(c).toEqual({
      role: 'member',
      labelKey:   ROLE_CONTROL_KEYS.make_member,
      confirmKey: ROLE_CONTROL_KEYS.confirm_handover,
      noticeKey:  ROLE_CONTROL_KEYS.notice_handed_over,
      consequence: 'handover',
    });
  });

  it('the last admin ALONE in the circle → it cannot stand at all, and that is what is said', () => {
    const c = roleControlFor({ members: [ann], member: ann, myRef: 'w-ann' });
    expect(c.consequence).toBe('no-one-else');
    expect(c.confirmKey).toBe(ROLE_CONTROL_KEYS.confirm_no_one_else);
    expect(c.noticeKey).toBe(ROLE_CONTROL_KEYS.notice_no_one_else);
  });

  it('a promotion is never a handover, however few admins there are', () => {
    const c = roleControlFor({ members: [ann, bob], member: bob, myRef: 'w-ann' });
    expect(c.consequence).toBe('plain');
    expect(c.confirmKey).toBe(ROLE_CONTROL_KEYS.confirm_promote);
  });
});

describe('the confirmation comes from the op’s own declaration', () => {
  it('carries the manifest’s severity and the consequence THIS change has', () => {
    const control = roleControlFor({ members: [ann, bob, cara], member: ann, myRef: 'w-ann' });
    const req = roleChangeConfirm({ control, name: 'Ann', t });
    expect(req).toMatchObject({
      severity: 'warn',                       // declared in apps/stoop/manifest.js, not restated per shell
      opId: 'setMemberRole',
      message: ROLE_CONTROL_KEYS.confirm_handover,
      title: 'circle.confirm.title',
      acceptLabel: 'circle.confirm.accept',
      cancelLabel: 'circle.confirm.cancel',
    });
  });

  it('an ordinary demotion gets the ordinary message — the warning is not shown to everyone', () => {
    const control = roleControlFor({ members: [ann, { ...bob, role: 'admin' }], member: bob, myRef: 'w-ann' });
    expect(roleChangeConfirm({ control, name: 'bob', t }).message).toBe(ROLE_CONTROL_KEYS.confirm_demote);
  });

  it('no control ⇒ no confirmation to present', () => {
    expect(roleChangeConfirm({ control: null, t })).toBeNull();
  });
});
