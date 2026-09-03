/**
 * threaded-chat handler coverage — a reply to one of OUR noticeboard posts lands in the REPLIER's
 * contact thread, marked with the post it answers (decided 2026-09-03; before this web dropped the
 * subtype and mobile painted it into a thread v2 permanently hides).
 */
import { describe, it, expect, vi } from 'vitest';
import { makeHandleThreadedChat } from '../../src/core/handlers/threadedChat.js';

function deps(overrides = {}) {
  return {
    deliverToThread: vi.fn(),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...overrides,
  };
}

describe('makeHandleThreadedChat', () => {
  it('throws when deliverToThread missing', () => {
    expect(() => makeHandleThreadedChat({})).toThrow(/deliverToThread required/);
  });

  it('drops envelopes without a body (handshakes, claims)', () => {
    const d = deps();
    const handle = makeHandleThreadedChat(d);
    handle('peer-B', null);
    handle('peer-B', { subtype: 'chat-message', threadId: 'post-1' });
    handle('peer-B', { subtype: 'chat-message', threadId: 'post-1', body: '' });
    expect(d.deliverToThread).not.toHaveBeenCalled();
  });

  it("delivers the reply into the REPLIER's thread, marked with the post it answers", () => {
    const d = deps();
    makeHandleThreadedChat(d)('peer-B', {
      subtype: 'chat-message', threadId: 'post-1', body: 'Hoi, ik woon vlakbij', nonce: 'n-42', sentAt: 1234,
    });
    expect(d.deliverToThread).toHaveBeenCalledTimes(1);
    const turn = d.deliverToThread.mock.calls[0][0];
    expect(turn.fromAddr).toBe('peer-B');
    expect(turn.text).toBe('Hoi, ik woon vlakbij');
    expect(turn.replyTo).toBe('post-1');
    // The wire nonce is the dedup key — a relay-replayed reply must not land twice.
    expect(turn.messageId).toBe('chat-n-42');
    expect(turn.ts).toBe(1234);
  });

  it('makes the replier a known peer, and a graph failure hurts nothing', () => {
    const d = deps({ notePeer: vi.fn() });
    makeHandleThreadedChat(d)('peer-B', { body: 'hi', threadId: 'post-1' });
    expect(d.notePeer).toHaveBeenCalledWith('peer-B');

    const broken = deps({ notePeer: vi.fn(() => { throw new Error('graph down'); }) });
    makeHandleThreadedChat(broken)('peer-B', { body: 'hi' });
    expect(broken.deliverToThread).toHaveBeenCalled();
  });

  it('a broken thread sink never throws out of the router', () => {
    const d = deps({ deliverToThread: vi.fn(() => { throw new Error('store down'); }) });
    expect(() => makeHandleThreadedChat(d)('peer-B', { body: 'hi' })).not.toThrow();
  });
});
