/**
 * A MEMBER'S ⋯ OFFERS NO ADMIN ITEMS; THE ADMIN PAGE READS AS THE MEMBERS LIST.
 *
 * A walk saw a non-admin's ⋯ with "Invite to this circle (Only an admin can invite)" greyed, and an entry called
 * "Admin". Ruled (sitting row 69, Fable): an entry reserved for admins is HIDDEN for a viewer known not to be one;
 * greyed only while the roster has not answered, so an admin never sees it vanish and come back. Settings stays (a
 * member proposes there). The admin page is the roster every member reads, so for a member it is called "Leden".
 */
import { describe, it, expect } from 'vitest';
import { gatedActions } from '../../src/v2/actionProjection.js';
import { basisManifest } from '../../manifest.js';

const ids = (isAdmin) => gatedActions(basisManifest, { isAdmin });
const entry = (isAdmin, id) => ids(isAdmin).find((a) => a.id === id);

describe('the circle ⋯ for each kind of viewer', () => {
  it('a known member sees no invite', () => {
    expect(entry(false, 'invite')).toBeUndefined();
  });
  it('while the roster has not answered, invite waits greyed', () => {
    expect(entry(null, 'invite')).toMatchObject({ disabled: true, reasonKey: 'circle.invite.admin_only' });
  });
  it('an admin gets invite as it is', () => {
    expect(entry(true, 'invite')?.disabled).toBeFalsy();
  });
  it('settings stays for a member', () => {
    expect(entry(false, 'settings')).toBeTruthy();
  });
  it('the admin page is "Leden" for a member and "Admin" for an admin', () => {
    expect(entry(false, 'admin')?.labelKey).toBe('circle.admin.members');
    expect(entry(true, 'admin')?.labelKey).toBe('circle.admin.title');
    expect(entry(null, 'admin')?.labelKey).toBe('circle.admin.title');
  });
});
