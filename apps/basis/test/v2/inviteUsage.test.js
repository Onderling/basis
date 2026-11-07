/**
 * THE OPEN INVITE KEEPS UP. A walk (2026-11-05) held the invite open while someone joined: "0 of 6 places used" after
 * 45 s, and nothing told the inviter. On the membership lane's signal an open invite re-reads its count and names each
 * newcomer, never by key.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readInviteUsage, joinedSince, memberIdsOf } from '../../src/v2/inviteUsage.js';

const KEY = 'zWOPwK1R5XsnsQe3vT0b7yHk2LmN9pQrS4tUvWxYz01';
const t = (k, v = {}) => (k === 'circle.invite.joined' ? `${v.name} is erbij gekomen.` : k === 'circle.reply.who_someone' ? 'iemand' : k);
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

describe('an open invite', () => {
  it('reads how much of the invite is used and who is in the circle now', async () => {
    const callSkill = async (app, op) => (op === 'getCurrentMembershipCode'
      ? { code: 'X', redemptionsUsed: 1, maxRedemptions: 6 }
      : { members: [{ webid: 'me' }, { webid: 'w-b', displayName: 'Tester B' }] });
    const u = await readInviteUsage({ callSkill, circleId: 'c' });
    expect(u).toMatchObject({ used: 1, max: 6 });
    expect(memberIdsOf(u.members)).toEqual(['me', 'w-b']);
  });

  it('names each newcomer since it opened — by name, else "iemand", never a key', () => {
    const now = [{ webid: 'me' }, { webid: 'w-b', displayName: 'Tester B' }, { webid: KEY }];
    expect(joinedSince(['me'], now, t)).toEqual(['Tester B is erbij gekomen.', 'iemand is erbij gekomen.']);
    expect(joinedSince(['me', 'w-b', KEY], now, t)).toEqual([]);
  });

  it('both shells refresh an open invite on their membership signal', () => {
    const web = read('../../web/v2/circleApp.js');
    const mobile = read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js');
    const hook = web.slice(web.indexOf('async function circlesChangedUnderneath'));
    expect(/refreshOpenInvite\(\)/.test(hook.slice(0, 300))).toBe(true);
    expect(/joinedSince\(/.test(web) && /readInviteUsage\(/.test(web)).toBe(true);
    expect(/joinedSince\(\s*cur\.before/.test(mobile) && /\}, \[circles\]\);/.test(mobile)).toBe(true);
  });

  // Measured on the Samsung (2026-11-06): the admin's OWN admission of a joiner is a local write, so the membership
  // lane's signal never fired and the open invite stayed at "0 of 6" while the joiner was in. The admit hook nudges it.
  it('the admin\'s own admission nudges an open invite (the lane signal never fires for a local write)', () => {
    const web = read('../../web/v2/circleApp.js');
    const chat = read('../../../basis-mobile/src/screens/ChatScreen.js');
    expect(/onAdmitted:\s*\(a\)\s*=>\s*\{\s*refreshOpenInvite\(\)/.test(web)).toBe(true);
    expect(/onAdmitted:\s*\(a\)\s*=>\s*\{\s*onCirclesChanged\?\.\(\)/.test(chat)).toBe(true);
  });
});
