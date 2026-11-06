/**
 * REMOVING A MEMBER ASKS FIRST. The removeMember op declares `ui.confirm` (as setMemberRole does), and the shared
 * request carries who it is and what it does. A walk (2026-11-05) removed a member with one tap.
 */
import { describe, it, expect } from 'vitest';
import { removeMemberConfirm } from '../../src/v2/circleRoleControl.js';

describe('the removal confirm', () => {
  it('is the op\'s own declared confirm, naming the member', () => {
    const t = (k, v = {}) => (k === 'circle.admin.remove_member_confirm' ? `${v.name} uit deze kring verwijderen?` : k);
    const req = removeMemberConfirm({ name: 'Tester B', t });
    expect(req).toMatchObject({ severity: 'warn', opId: 'removeMember' });
    expect(JSON.stringify(req)).toContain('Tester B uit deze kring verwijderen?');
  });
});
