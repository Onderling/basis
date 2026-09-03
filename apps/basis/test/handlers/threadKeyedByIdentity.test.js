/**
 * Threads are keyed by IDENTITY, not by the address a message arrived at (Frits, 2026-09-03).
 *
 * Walked on a phone: the same member of the same circle answered twice over two routes — once from
 * their peer address, once from their NKN address — and became two contact rows and two threads.
 * Someone who is one person in the data does not get to appear as several; a separate persona is a
 * separate webid, not a second address for the same one.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeHandleThreadedChat, contactIdFor } from '../../src/core/handlers/threadedChat.js';
import { makeHandleFileShare } from '../../src/core/handlers/fileShare.js';

// The device knows these two addresses are one person (the agent's own alias map answers this).
const identityOf = (a) => (a === 'nkn-addr' || a === 'peer-addr' ? 'peer-addr' : a);

describe('contactIdFor', () => {
  it('answers the person, and falls back to the address for a stranger or a broken resolver', () => {
    expect(contactIdFor(identityOf, 'nkn-addr')).toBe('peer-addr');
    expect(contactIdFor(identityOf, 'someone-else')).toBe('someone-else');
    expect(contactIdFor(null, 'nkn-addr')).toBe('nkn-addr');
    expect(contactIdFor(() => { throw new Error('no'); }, 'nkn-addr')).toBe('nkn-addr');
    expect(contactIdFor(() => '', 'nkn-addr')).toBe('nkn-addr');
  });
});

describe('a reply arriving over a second route joins the thread that already exists', () => {
  it('threaded chat keys the turn and the contact row on the person', () => {
    const deliverToThread = vi.fn(); const notePeer = vi.fn();
    const handle = makeHandleThreadedChat({ deliverToThread, notePeer, identityOf });
    handle('nkn-addr', { subtype: 'chat-message', threadId: 'post-1', body: 'hoi', nonce: 'n1' });
    const turn = deliverToThread.mock.calls[0][0];
    expect(turn.contactId).toBe('peer-addr');   // the person
    expect(turn.fromAddr).toBe('nkn-addr');     // the route it came in on, unchanged
    expect(notePeer).toHaveBeenCalledWith('peer-addr');
  });

  it('a file lands in the same one thread', () => {
    const deliverToThread = vi.fn(); const notePeer = vi.fn();
    makeHandleFileShare({ deliverToThread, notePeer, identityOf })('nkn-addr', {
      file: { id: 'f1', name: 'a.jpg', mime: 'image/jpeg', size: 3, dataB64: 'AA==' },
    });
    const turn = deliverToThread.mock.calls[0][0];
    expect(turn.contactId).toBe('peer-addr');
    expect(turn.fromAddr).toBe('nkn-addr');
    expect(notePeer).toHaveBeenCalledWith('peer-addr');
  });

  it('without a resolver both doors behave exactly as before (the address is the key)', () => {
    const a = vi.fn(); const b = vi.fn();
    makeHandleThreadedChat({ deliverToThread: a })('nkn-addr', { body: 'hoi' });
    makeHandleFileShare({ deliverToThread: b })('nkn-addr', { file: { id: 'f', name: 'n', dataB64: 'AA==' } });
    expect(a.mock.calls[0][0].contactId).toBe('nkn-addr');
    expect(b.mock.calls[0][0].contactId).toBe('nkn-addr');
  });
});
