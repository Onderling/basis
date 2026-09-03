import { describe, it, expect } from 'vitest';
import { isNoticeboardPost } from '../src/noticeboardPost.js';

describe('isNoticeboardPost — a DM chat turn is a conversation, never a post', () => {
  it('excludes a chat-p2p turn (wire nonce + the thread it answers), keeps a real post', () => {
    expect(isNoticeboardPost({ type: 'post', text: 'Ik heb er een', source: { threadId: 'post-1', nonce: 'n1', toPubKey: 'A', sentAt: 1 } })).toBe(false);
    expect(isNoticeboardPost({ type: 'post', text: 'Iemand een boormachine?', source: { requestId: 'post-1', broadcast: true, from: 'A' } })).toBe(true);
    expect(isNoticeboardPost({ type: 'post', text: 'plain' })).toBe(true);
  });
});
