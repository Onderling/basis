import { describe, it, expect } from 'vitest';
import { shouldFanNoticeboardItem, noticeboardFanPayload, noticeboardItemCircle } from '../../src/v2/noticeboardFan.js';

const post = (over = {}) => ({ id: 'p1', type: 'request', text: 'boormachine?', source: { targets: [{ kind: 'group', groupId: 'c1' }] }, ...over });

describe('what a noticeboard write fans — derived from the item, not the op', () => {
  it('a request, an offer AND an announcement all fan', () => {
    for (const type of ['request', 'offer', 'announcement']) expect(shouldFanNoticeboardItem(post({ type }))).toBe(true);
  });
  it('an item that ARRIVED here does not fan again (no echo)', () => {
    expect(shouldFanNoticeboardItem(post({ source: { broadcast: true, requestId: 'p1' } }))).toBe(false);
  });
  it('system rows and bespoke rows stay local', () => {
    expect(shouldFanNoticeboardItem(post({ type: 'membership-code', source: { code: 'abc' } }))).toBe(false);
    expect(shouldFanNoticeboardItem(post({ type: 'report' }))).toBe(false);   // admins-only, not a canonical post
    expect(shouldFanNoticeboardItem(null)).toBe(false);
  });
  it('the payload is what ingestRemotePost expects, keyed by the item\'s own id', () => {
    const p = noticeboardFanPayload(post({ type: 'announcement', text: 'Hallo' }), { from: 'me' });
    expect(p).toMatchObject({ requestId: 'p1', type: 'announcement', text: 'Hallo', from: 'me', targets: [{ kind: 'group', groupId: 'c1' }] });
    expect(noticeboardItemCircle(post())).toBe('c1');
    expect(noticeboardFanPayload(post({ source: { groupId: 'c2' } }), { from: 'me', groupId: 'c2' }).targets).toEqual([{ kind: 'group', groupId: 'c2' }]);
  });
});
