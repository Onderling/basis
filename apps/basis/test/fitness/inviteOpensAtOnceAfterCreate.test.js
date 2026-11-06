/**
 * AFTER CREATE, THE INVITE IS ON SCREEN AT ONCE. A screen recording on the Samsung (2026-11-06) showed the bare circle
 * list for ~2.75 s between the create wizard closing and the invite opening (it is built async); a tester's tap there
 * opened a circle and the invite then came over it. The launcher now opens the invite in a "being made" state the
 * moment the create lands; openCircleInvite fills it.
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const web = readFileSync(fileURLToPath(new URL('../../web/v2/circleApp.js', import.meta.url)), 'utf8');
const launcher = readFileSync(fileURLToPath(new URL('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js', import.meta.url)), 'utf8');

describe('the invite after a create', () => {
  it('opens at once in a pending state, before it is built', () => {
    expect(/setInviteFor\(\{\s*circleId:\s*gid,\s*pending:\s*true\s*\}\);\s*openCircleInvite\(gid\)/.test(launcher)).toBe(true);
  });
  it('says it is being made while pending', () => {
    expect(/inviteFor\?\.pending \?[\s\S]{0,200}circle\.invite\.making/.test(launcher)).toBe(true);
  });
  it('web\'s invite is on screen at once too, saying it is being made, before the code is built', () => {
    const fn = web.slice(web.indexOf('async function showCircleInvite'));
    expect(fn.indexOf("t('circle.invite.making')")).toBeGreaterThan(-1);
    expect(fn.indexOf("t('circle.invite.making')")).toBeLessThan(fn.indexOf('buildCircleInviteUri('));
  });
  // Web's create wizard ENDS on the invite (its result panel: "Circle created", the link, the code, Done), so web already
  // shows the new circle's invite after Create. Opening showCircleInvite on top of it (2026-11-06) put a second invite
  // over the first, and on a device with no relay the relay question over both: the browser tail went red on every
  // spec that creates a circle. One invite after Create, the wizard's own.
  it('web does not open a second invite over the create wizard\'s own invite', () => {
    const create = web.slice(web.indexOf('function openCreateCircleWizard'));
    expect(/showCircleInvite\(gid\)/.test(create.slice(0, 4000))).toBe(false);
  });
});
