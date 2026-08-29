import { describe, it, expect } from 'vitest';
import { NOTICE_KINDS, wantsNotice, noticeWants, normalizeNotices, normalizeNoticeOverride, noticeRows, noticeOverrideRows } from '../../src/v2/noticeSettings.js';
import { normalizeCirclePolicy, normalizeMemberOverride, mergeMemberOverride } from '../../src/v2/circlePolicy.js';
import { chatRows } from '../../src/v2/circleStream.js';
import { MEMBERSHIP_NOTICE_KEYS } from '../../src/v2/membershipNotices.js';
import { GOVERNANCE_NOTICE_KEYS } from '../../src/v2/governanceNotices.js';

const t = (k, a = {}) => `${k}${a.action ? `:${a.action}` : ''}`;
const membership = (id, body, ts = 100) => ({
  id: `membership:${id}`, ts, app: 'basis', type: 'membership', circleId: 'k1',
  payload: { body: { kind: body.kind, subject: body.subject, author: body.author, payload: body.payload ?? {} }, sig: 'x' },
});
const proposal = (id, { author = 'admin', authorRef = 'webid:admin', action = 'removeMember' } = {}, ts = 100) => ({
  id: `governance:${id}`, ts, app: 'basis', type: 'governance', circleId: 'k1',
  payload: { body: { kind: 'propose', subject: `p-${id}`, author, payload: { action, authorRef } }, sig: 'x' },
});

describe('decision 4 — the per-kind "tell me" setting', () => {
  it('every kind a projection can produce is offered, and defaults to ON', () => {
    // The list is a literal (a derived one would be an import cycle through circlePolicy); pin the agreement.
    const produced = [...Object.keys(MEMBERSHIP_NOTICE_KEYS).filter((k) => k !== 'removedWithReason'), ...Object.keys(GOVERNANCE_NOTICE_KEYS)];
    expect([...NOTICE_KINDS].sort()).toEqual([...produced].sort());
    for (const k of NOTICE_KINDS) expect(wantsNotice(k)).toBe(true);
  });
  it('the admin default is the circle policy; a member\'s private override wins over it', () => {
    const policy = normalizeCirclePolicy({ notices: { joined: false } });
    expect(policy.notices.joined).toBe(false);
    expect(wantsNotice('joined', { policy })).toBe(false);
    const override = mergeMemberOverride(normalizeMemberOverride({}), { notices: { joined: true } });
    expect(wantsNotice('joined', { policy, override })).toBe(true);
    expect(wantsNotice('promoted', { policy, override }), 'untouched kinds fall through to the circle').toBe(true);
  });
  it('the removal wording variant follows the removal setting', () => {
    expect(wantsNotice('removedWithReason', { policy: { notices: { removed: false } } })).toBe(false);
  });
  it('garbage in → defaults out; an override keeps only what was explicitly set', () => {
    expect(normalizeNotices({ joined: 'no', bogus: true })).toEqual({ removed: true, promoted: true, demoted: true, joined: true, decisionOpened: true });
    expect(normalizeNoticeOverride({ joined: false, bogus: false, promoted: 'x' })).toEqual({ joined: false });
  });
  it('the rows carry the NEXT value for the field, so both shells persist what they were handed', () => {
    const rows = noticeRows({ circleSetting: { joined: false } });
    const joined = rows.find((r) => r.kind === 'joined');
    expect(joined.on).toBe(false);
    expect(joined.next.joined).toBe(true);
    const mine = noticeOverrideRows({ policy: { notices: { joined: false } } }).find((r) => r.kind === 'joined');
    expect(mine).toMatchObject({ on: false, next: { joined: true } });
  });
  it('the conversation honours it: a kind turned off is not rendered, the others still are', () => {
    const events = [membership('j1', { kind: 'join', subject: 'newbie', author: 'me' }), proposal('g1')];
    const all = chatRows({ events, circleId: 'k1', viewerId: 'me', t, members: [{ webid: 'newbie', handle: 'piet' }] });
    expect(all.filter((r) => r.actor === 'bot')).toHaveLength(2);
    const wants = noticeWants({ policy: { notices: { joined: false } } });
    const some = chatRows({ events, circleId: 'k1', viewerId: 'me', t, wants, members: [{ webid: 'newbie', handle: 'piet' }] });
    expect(some.filter((r) => r.actor === 'bot').map((r) => r.event.payload.notice)).toEqual(['decisionOpened']);
  });
});

describe('governance notices as rendered projections — "a decision opened" is no longer appended', () => {
  it('renders the line from the proposal statement, naming the action', () => {
    const rows = chatRows({ events: [proposal('g1', { action: 'removeMember' })], circleId: 'k1', viewerId: 'me', t });
    const notice = rows.find((r) => r.actor === 'bot');
    expect(notice?.event.payload.text).toBe('circle.governance.notify_vote_opened:circle.governance.action.removeMember');
    expect(notice.id).toBe('notice:governance:g1');
  });
  it('says nothing about a proposal the viewer opened themselves, nor about votes and resolutions', () => {
    const vote = { id: 'governance:v1', ts: 110, app: 'basis', type: 'governance', circleId: 'k1', payload: { body: { kind: 'vote', subject: 'p-g1', author: 'x', payload: { choice: 'yes' } }, sig: 'x' } };
    const rows = chatRows({ events: [proposal('g2', { authorRef: 'me' }), vote], circleId: 'k1', viewerId: 'me', t });
    expect(rows.filter((r) => r.actor === 'bot')).toHaveLength(0);
  });
  it('the legacy flat entry shape still projects (a log written before the signed rail)', () => {
    const flat = { id: 'gov:abc', ts: 120, app: 'basis', type: 'governance', circleId: 'k1', payload: { kind: 'governance', event: 'propose', proposalId: 'p1', action: 'changePolicy', by: 'webid:admin', at: 120 } };
    const rows = chatRows({ events: [flat], circleId: 'k1', viewerId: 'me', t });
    expect(rows.find((r) => r.actor === 'bot')?.event.payload.notice).toBe('decisionOpened');
  });
  it('is derived, so the same log projects the same one row twice', () => {
    const events = [proposal('g3')];
    const a = chatRows({ events, circleId: 'k1', viewerId: 'me', t });
    const b = chatRows({ events, circleId: 'k1', viewerId: 'me', t });
    expect(a.filter((r) => r.actor === 'bot')).toHaveLength(1);
    expect(b.map((r) => r.id)).toEqual(a.map((r) => r.id));
  });
});
