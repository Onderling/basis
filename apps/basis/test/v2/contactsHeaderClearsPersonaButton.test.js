// @reads-source: this test reads source as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
/**
 * THE CONTACTS HEADER'S BUTTONS STAY CLEAR OF THE AVATAR.
 *
 * On both test phones the second header button ("+ Add a bot") sat under the floating avatar top right, so nobody
 * could read what it added. The avatar is positioned absolutely (fab.js PERSONA_BUTTON); a header row beside it keeps
 * the avatar's width free on its right, so its buttons wrap instead of hiding.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MOBILE = path.join(process.cwd(), '../basis-mobile/src/screens/v2');
const read = (f) => fs.readFileSync(path.join(MOBILE, f), 'utf8');

describe('the Contacts header next to the floating avatar', () => {
  it('fab.js declares the side clearance once', () => {
    // the persona button and, left of it, the settings button
    expect(read('fab.js')).toMatch(/export const PERSONA_BUTTON_SIDE_CLEARANCE = PERSONA_BUTTON\.right \+ 2 \* PERSONA_BUTTON\.size \+ SETTINGS_BUTTON_GAP/);
  });
  it('the Contacts head row keeps it free on the right', () => {
    const src = read('ContactsScreen.js');
    expect(src).toMatch(/head: \{[^}]*paddingRight: PERSONA_BUTTON_SIDE_CLEARANCE/);
  });
});
