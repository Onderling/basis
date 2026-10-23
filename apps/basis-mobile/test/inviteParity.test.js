/**
 * The invite on the phone has what the web's has (web: test-browser/walk-invite-close-link.spec.js): a way out, the
 * link sent through the share sheet for someone not in the room, and an admin's Invite on Members — the ⋯ menu's own
 * invite act, not a second one. RN cannot render under Vitest, so this reads the source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '../src/screens/v2/CircleLauncherScreen.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the invite on the phone', () => {
  it('has a close button and sends the link through the share sheet', () => {
    expect(src).toMatch(/testID="invite-close"/);
    expect(src).toMatch(/testID="invite-send-link"[\s\S]{0,200}Share\.share\(\{ message: inviteFor\.uri \}\)/);
  });
  it('Members offers Invite to an admin, through the same onInvite the ⋯ menu uses', () => {
    expect(src).toMatch(/mandateViewer\.isAdmin && typeof onInvite === 'function'[\s\S]{0,200}testID="circle-members-invite"[\s\S]{0,120}onInvite\(\)/);
    expect(src).toMatch(/invite: onInvite/);
  });
});
