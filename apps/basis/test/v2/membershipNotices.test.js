import { describe, it, expect } from 'vitest';
import { AgentIdentity, signSpine } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { membershipNoticeFor, membershipNoticeRows, MEMBERSHIP_NOTICE_KEYS } from '../../src/v2/membershipNotices.js';
import { noticeWants } from '../../src/v2/noticeSettings.js';

// A role change is a fact of the circle, not a private message: when B becomes an admin, A and C should
// read it in the conversation too, not only B (walked 2026-09-14 — A saw a panel notice, C saw nothing,
// only B got a line). Decided 2026-09-15: everyone sees it. The line is still RENDERED from the one
// signed statement, never appended, so both shells paint it by construction.

const CIRCLE = 'g1';
const t = (key, args = {}) => `${key}${args.name ? `(${args.name})` : ''}`;

describe('membership notices — a role change is everyone\'s line', () => {
  it('the person it concerns reads "you are now an admin"; everyone else reads "<name> is now an admin"', async () => {
    const admin = await AgentIdentity.generate(new VaultMemory());
    const promote = signSpine(admin, { kind: 'role', circleId: CIRCLE, subject: 'webid:bee', payload: { role: 'admin' } }).body;
    const members = [{ webid: 'webid:bee', handle: 'bee' }];
    expect(membershipNoticeFor(promote, { viewerId: 'webid:bee', members })).toEqual({ notice: 'promoted' });
    expect(membershipNoticeFor(promote, { viewerId: 'webid:cee', members })).toEqual({ notice: 'memberPromoted', args: { name: '@bee' } });
    expect(membershipNoticeFor(promote, { viewerId: admin.pubKey, members })).toEqual({ notice: 'memberPromoted', args: { name: '@bee' } });
  });

  it('a demotion the same way, and a role statement about nobody known still names the ref honestly', async () => {
    const admin = await AgentIdentity.generate(new VaultMemory());
    const demote = signSpine(admin, { kind: 'role', circleId: CIRCLE, subject: 'webid:bee', payload: { role: 'member' } }).body;
    expect(membershipNoticeFor(demote, { viewerId: 'webid:bee' })).toEqual({ notice: 'demoted' });
    expect(membershipNoticeFor(demote, { viewerId: 'webid:cee' })).toEqual({ notice: 'memberDemoted', args: { name: 'webid:bee' } });
  });

  it('the rows: one line per statement for a bystander, keyed and translated, and the "promoted" setting hides it', async () => {
    const admin = await AgentIdentity.generate(new VaultMemory());
    const promote = signSpine(admin, { kind: 'role', circleId: CIRCLE, subject: 'webid:bee', payload: { role: 'admin' } });
    const events = [{ id: 'e1', ts: 10, type: 'membership', circleId: CIRCLE, payload: promote }];
    const rows = membershipNoticeRows({ events, circleId: CIRCLE, viewerId: 'webid:cee', members: [{ webid: 'webid:bee', handle: 'bee' }], t });
    expect(rows).toHaveLength(1);
    expect(rows[0].event.payload.text).toBe(`${MEMBERSHIP_NOTICE_KEYS.memberPromoted}(@bee)`);
    expect(rows[0].event.payload.notice).toBe('memberPromoted');
    const off = membershipNoticeRows({ events, circleId: CIRCLE, viewerId: 'webid:cee', t, wants: noticeWants({ override: { notices: { promoted: false } } }) });
    expect(off, 'a bystander\'s line follows the same setting as the person\'s own').toHaveLength(0);
  });
});
