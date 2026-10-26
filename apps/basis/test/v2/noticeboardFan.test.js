import { describe, it, expect } from 'vitest';
import { noticeboardFanPayload } from '../../src/v2/noticeboardFan.js';

const post = (over = {}) => ({ id: 'p1', type: 'request', text: 'boormachine?', source: { targets: [{ kind: 'group', groupId: 'c1' }] }, ...over });

describe('the announcement of a landed post', () => {
  it('is keyed by the item\'s own id and carries what the notification and the driver match read', () => {
    const p = noticeboardFanPayload(post({ type: 'announcement', text: 'Hallo' }), { from: 'me' });
    expect(p).toMatchObject({ requestId: 'p1', type: 'announcement', text: 'Hallo', from: 'me', targets: [{ kind: 'group', groupId: 'c1' }] });
    expect(noticeboardFanPayload(post({ source: { groupId: 'c2' } }), { from: 'me', groupId: 'c2' }).targets).toEqual([{ kind: 'group', groupId: 'c2' }]);
  });
  it('reads a circle-store row\'s `body` when there is no `text`', () => {
    expect(noticeboardFanPayload({ id: 'p2', type: 'offer', body: 'een ladder', source: {} }, { from: 'me', groupId: 'c1' }).text).toBe('een ladder');
  });
});
