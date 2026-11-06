/**
 * THE CONTACTS HEADER'S BUTTONS STAY CLEAR OF THE AVATAR.
 *
 * On both test phones the second header button ("+ Add a bot") sat under the floating avatar top right, so nobody
 * could read what it added. The avatar is positioned absolutely (fab.js HEADER_AVATAR); a header row beside it keeps
 * the avatar's width free on its right, so its buttons wrap instead of hiding.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MOBILE = path.join(process.cwd(), '../basis-mobile/src/screens/v2');
const read = (f) => fs.readFileSync(path.join(MOBILE, f), 'utf8');

describe('the Contacts header next to the floating avatar', () => {
  it('fab.js declares the side clearance once', () => {
    expect(read('fab.js')).toMatch(/export const HEADER_AVATAR_SIDE_CLEARANCE = HEADER_AVATAR\.right \+ HEADER_AVATAR\.size/);
  });
  it('the Contacts head row keeps it free on the right', () => {
    const src = read('ContactsScreen.js');
    expect(src).toMatch(/head: \{[^}]*paddingRight: HEADER_AVATAR_SIDE_CLEARANCE/);
  });
});
