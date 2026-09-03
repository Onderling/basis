/**
 * replyToPost — the one path both shells take to answer a noticeboard post: the op sends, and OUR
 * side of the exchange is persisted into the poster's contact thread so the conversation the reply
 * starts is visible on the replier's device too (decided 2026-09-03).
 */
import { describe, it, expect, vi } from 'vitest';
import { replyToPost } from '../src/v2/replyToPost.js';

describe('replyToPost', () => {
  it('sends through the op, persists the outbound turn into the poster thread, and names the poster', async () => {
    const callSkill = vi.fn(async () => ({ ok: true, threadId: 'post-1', itemId: 'chat-item-9', toPubKey: 'poster-A' }));
    const contactChannel = { persistOutbound: vi.fn(async () => ({ itemId: 'x' })) };
    const r = await replyToPost({ callSkill, contactChannel, itemId: 'post-1', body: 'ik kan helpen' });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'respondToItem', { itemId: 'post-1', body: 'ik kan helpen' });
    expect(contactChannel.persistOutbound).toHaveBeenCalledWith(expect.objectContaining({
      contactId: 'poster-A', peerAddr: 'poster-A', text: 'ik kan helpen', replyTo: 'post-1', messageId: 'post-reply-chat-item-9',
    }));
    expect(r).toEqual({ ok: true, toPubKey: 'poster-A' });
  });

  it('makes the poster a contact row (the first-DM rule), and a graph failure hurts nothing', async () => {
    const callSkill = vi.fn(async () => ({ ok: true, toPubKey: 'poster-A', itemId: 'c1' }));
    const notePeer = vi.fn();
    await replyToPost({ callSkill, notePeer, itemId: 'p', body: 'x' });
    expect(notePeer).toHaveBeenCalledWith('poster-A');

    const broken = vi.fn(() => { throw new Error('graph down'); });
    const contactChannel = { persistOutbound: vi.fn(async () => ({ itemId: 'x' })) };
    expect(await replyToPost({ callSkill, notePeer: broken, contactChannel, itemId: 'p', body: 'x' }))
      .toEqual({ ok: true, toPubKey: 'poster-A' });
    expect(contactChannel.persistOutbound).toHaveBeenCalled();   // the turn still persists
  });

  it('persists nothing when the op refuses', async () => {
    const callSkill = vi.fn(async () => ({ error: 'not-found' }));
    const contactChannel = { persistOutbound: vi.fn() };
    const r = await replyToPost({ callSkill, contactChannel, itemId: 'post-1', body: 'x' });
    expect(r).toEqual({ ok: false, error: 'not-found' });
    expect(contactChannel.persistOutbound).not.toHaveBeenCalled();
  });

  it('still reports the send when the local copy cannot be written or no channel is wired', async () => {
    const callSkill = vi.fn(async () => ({ ok: true, toPubKey: 'poster-A' }));
    const contactChannel = { persistOutbound: vi.fn(async () => { throw new Error('store down'); }) };
    expect(await replyToPost({ callSkill, contactChannel, itemId: 'p', body: 'x' })).toEqual({ ok: true, toPubKey: 'poster-A' });
    expect(await replyToPost({ callSkill, contactChannel: null, itemId: 'p', body: 'x' })).toEqual({ ok: true, toPubKey: 'poster-A' });
  });
});

describe('replyToPost — the poster is a PERSON, not the address their post carried', () => {
  it('resolves the identity before opening, noting and persisting the thread', async () => {
    const callSkill = vi.fn(async () => ({ ok: true, toPubKey: 'nkn-addr', itemId: 'c1' }));
    const notePeer = vi.fn();
    const contactChannel = { persistOutbound: vi.fn(async () => ({ itemId: 'x' })) };
    const identityOf = (a) => (a === 'nkn-addr' ? 'peer-addr' : a);
    const r = await replyToPost({ callSkill, contactChannel, notePeer, identityOf, itemId: 'p1', body: 'ja' });
    expect(r).toEqual({ ok: true, toPubKey: 'peer-addr' });
    expect(notePeer).toHaveBeenCalledWith('peer-addr');
    expect(contactChannel.persistOutbound).toHaveBeenCalledWith(expect.objectContaining({
      contactId: 'peer-addr', peerAddr: 'peer-addr',
    }));
  });
});
