/**
 * threadState — pure reducer tests for step 5 (mobile-local
 * multi-thread state).  No RN, no ThreadStore — just the
 * Map-of-thread-entries shape.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInitialThreadState, listThreads, getActiveThread,
  setActiveThread, createThread, deleteThread,
  appendMessage, patchMessage, setSourceDispatch,
  setPendingFollowUp, updateMessages,
  ensureDmThread, updatePeerDisplay,
  __resetThreadIdSeq,
} from '../src/core/threadState.js';

beforeEach(() => {
  __resetThreadIdSeq();
});

describe('createInitialThreadState', () => {
  it('seeds a single "Main" thread that is active', () => {
    const s = createInitialThreadState();
    expect(s.activeThreadId).toBe('main');
    expect(getActiveThread(s).name).toBe('Main');
    expect(getActiveThread(s).messages).toEqual([]);
    expect(getActiveThread(s).sourceDispatch).toBeNull();
  });

  it('listThreads returns the seed thread', () => {
    const s = createInitialThreadState();
    expect(listThreads(s)).toHaveLength(1);
    expect(listThreads(s)[0].id).toBe('main');
  });
});

describe('createThread', () => {
  it('adds a new thread + switches to it', () => {
    const s0 = createInitialThreadState();
    const { state: s1, newId } = createThread(s0, { name: 'Circle' });
    expect(s1.threads.size).toBe(2);
    expect(s1.activeThreadId).toBe(newId);
    expect(getActiveThread(s1).name).toBe('Circle');
  });

  it('falls back to the auto-id when name is empty', () => {
    const s0 = createInitialThreadState();
    const { state: s1, newId } = createThread(s0, { name: '   ' });
    expect(getActiveThread(s1).name).toBe(newId);     // not blank
  });
});

describe('setActiveThread', () => {
  it('switches between existing threads', () => {
    let s = createInitialThreadState();
    const { state: s1 } = createThread(s, { name: 'A' });
    const { state: s2, newId: bId } = createThread(s1, { name: 'B' });
    expect(s2.activeThreadId).toBe(bId);
    const s3 = setActiveThread(s2, 'main');
    expect(s3.activeThreadId).toBe('main');
    expect(getActiveThread(s3).name).toBe('Main');
  });

  it('no-ops (returns same state) when the id does not exist', () => {
    const s = createInitialThreadState();
    expect(setActiveThread(s, 'nope')).toBe(s);
  });

  it('no-ops when switching to the already-active thread', () => {
    const s = createInitialThreadState();
    expect(setActiveThread(s, 'main')).toBe(s);
  });
});

describe('deleteThread', () => {
  it('cannot delete the main thread (defensive — main is permanent)', () => {
    const s = createInitialThreadState();
    expect(deleteThread(s, 'main')).toBe(s);
  });

  it('removes a thread + reactivates the first remaining when the active was deleted', () => {
    let s = createInitialThreadState();
    const { state: sA, newId: aId } = createThread(s, { name: 'A' });
    const { state: sB, newId: bId } = createThread(sA, { name: 'B' });
    expect(sB.activeThreadId).toBe(bId);
    const s2 = deleteThread(sB, bId);                  // delete active
    expect(s2.threads.has(bId)).toBe(false);
    expect(s2.activeThreadId).toBe('main');            // fell back to first remaining
    expect(s2.threads.size).toBe(2);                   // main + A
  });

  it('no-ops when the id does not exist', () => {
    const s = createInitialThreadState();
    expect(deleteThread(s, 'nope')).toBe(s);
  });
});

describe('appendMessage', () => {
  it('appends to the right thread; others untouched', () => {
    let s = createInitialThreadState();
    const { state: s1, newId } = createThread(s, { name: 'A' });
    const s2 = appendMessage(s1, 'main', { id: 'm1', role: 'user', text: 'hi' });
    expect(s2.threads.get('main').messages).toHaveLength(1);
    expect(s2.threads.get(newId).messages).toHaveLength(0);  // unaffected
  });

  it('no-ops when the thread id does not exist', () => {
    const s = createInitialThreadState();
    expect(appendMessage(s, 'nope', { id: 'm1', role: 'user', text: 'hi' })).toBe(s);
  });
});

describe('patchMessage', () => {
  it('object-form patch merges into existing message', () => {
    let s = createInitialThreadState();
    s = appendMessage(s, 'main', { id: 'm1', role: 'bot', pending: true });
    s = patchMessage(s, 'main', 'm1', { pending: false, rendered: { kind: 'text', text: 'hi' } });
    const msg = s.threads.get('main').messages[0];
    expect(msg.pending).toBe(false);
    expect(msg.rendered.text).toBe('hi');
  });

  it('function-form patch can fully replace a message', () => {
    let s = createInitialThreadState();
    s = appendMessage(s, 'main', { id: 'm1', role: 'user', text: 'a' });
    s = patchMessage(s, 'main', 'm1', (old) => ({ ...old, text: old.text + '!' }));
    expect(s.threads.get('main').messages[0].text).toBe('a!');
  });

  it('no-ops when the message id does not exist', () => {
    const s = createInitialThreadState();
    expect(patchMessage(s, 'main', 'never', { x: 1 })).toBe(s);
  });
});

describe('setPendingFollowUp', () => {
  it('stores a follow-up shape on the thread + clears via null', () => {
    let s = createInitialThreadState();
    const pending = { opId: 'respondToItem', missingParam: 'body', promptText: '?', originMessageId: 'm1' };
    s = setPendingFollowUp(s, 'main', pending);
    expect(getActiveThread(s).pendingFollowUp).toBe(pending);
    s = setPendingFollowUp(s, 'main', null);
    expect(getActiveThread(s).pendingFollowUp).toBeNull();
  });

  it('is per-thread — switching threads does not carry the follow-up', () => {
    let s = createInitialThreadState();
    const { state: s1, newId } = createThread(s, { name: 'A' });
    const pending = { opId: 'foo', missingParam: 'x', promptText: '?', originMessageId: 'm1' };
    s = setPendingFollowUp(s1, 'main', pending);
    // active is `newId`; main holds the follow-up; newId does not.
    expect(s.threads.get('main').pendingFollowUp).toBe(pending);
    expect(s.threads.get(newId).pendingFollowUp).toBeNull();
  });

  it('no-ops when the value is unchanged', () => {
    let s = createInitialThreadState();
    const pending = { opId: 'foo', missingParam: 'x', promptText: '?', originMessageId: 'm1' };
    s = setPendingFollowUp(s, 'main', pending);
    expect(setPendingFollowUp(s, 'main', pending)).toBe(s);
  });
});

describe('updateMessages', () => {
  it('replaces the messages array via the transform', () => {
    let s = createInitialThreadState();
    s = updateMessages(s, 'main', (msgs) => [...msgs, { id: 'm1', role: 'user', text: 'hi' }]);
    expect(s.threads.get('main').messages).toHaveLength(1);
  });

  it('no-ops (returns same state) when the transform returns the SAME array reference', () => {
    let s = createInitialThreadState();
    s = appendMessage(s, 'main', { id: 'm1', role: 'user', text: 'hi' });
    const same = updateMessages(s, 'main', (msgs) => msgs);
    expect(same).toBe(s);
  });

  it('no-ops when the thread id does not exist', () => {
    const s = createInitialThreadState();
    expect(updateMessages(s, 'nope', (msgs) => [])).toBe(s);
  });
});

describe('setSourceDispatch', () => {
  it('stores a list-bubble origin on the thread (round-trips)', () => {
    let s = createInitialThreadState();
    const dispatch = { kind: 'ready', opId: 'listOpen', args: {}, appOrigin: 'household' };
    s = setSourceDispatch(s, 'main', dispatch);
    expect(getActiveThread(s).sourceDispatch).toBe(dispatch);
  });

  it('no-ops when the value is unchanged (identity-stable for re-renders)', () => {
    let s = createInitialThreadState();
    const dispatch = { kind: 'ready', opId: 'listOpen', args: {}, appOrigin: 'household' };
    s = setSourceDispatch(s, 'main', dispatch);
    expect(setSourceDispatch(s, 'main', dispatch)).toBe(s);
  });
});

describe('ensureDmThread / updatePeerDisplay — Bundle H (#268)', () => {
  it('creates a new DM thread for an unseen peer', () => {
    const s0 = createInitialThreadState();
    const { state: s1, threadId } = ensureDmThread(s0, { peerAddr: 'peer-A' });
    expect(s1.threads.has(threadId)).toBe(true);
    expect(s1.threads.get(threadId).peerAddr).toBe('peer-A');
    expect(s1.threads.get(threadId).name).toMatch(/^DM:/);
    // Active thread stays put.
    expect(s1.activeThreadId).toBe(s0.activeThreadId);
  });

  it('returns the existing DM thread for the same peer (idempotent)', () => {
    const s0 = createInitialThreadState();
    const { state: s1, threadId: t1 } = ensureDmThread(s0, { peerAddr: 'peer-A' });
    const { state: s2, threadId: t2 } = ensureDmThread(s1, { peerAddr: 'peer-A' });
    expect(t1).toBe(t2);
    expect(s2).toBe(s1); // no mutation when nothing changes
  });

  it('uses nameFallback when provided', () => {
    const s0 = createInitialThreadState();
    const { state: s1, threadId } = ensureDmThread(s0, {
      peerAddr: 'peer-A', nameFallback: 'DM: Anne',
    });
    expect(s1.threads.get(threadId).name).toBe('DM: Anne');
  });

  it('no-ops on empty peerAddr', () => {
    const s0 = createInitialThreadState();
    const { state: s1, threadId } = ensureDmThread(s0, { peerAddr: '' });
    expect(s1).toBe(s0);
    expect(threadId).toBe(s0.activeThreadId);
  });

  it('updatePeerDisplay renames matching DM threads', () => {
    const s0 = createInitialThreadState();
    const { state: s1 } = ensureDmThread(s0, { peerAddr: 'peer-A' });
    const s2 = updatePeerDisplay(s1, { peerAddr: 'peer-A', displayName: 'Anne' });
    const dm = [...s2.threads.values()].find((t) => t.peerAddr === 'peer-A');
    expect(dm.name).toBe('DM: Anne');
  });

  it('updatePeerDisplay is a no-op when the name is already current', () => {
    const s0 = createInitialThreadState();
    const { state: s1 } = ensureDmThread(s0, { peerAddr: 'peer-A' });
    const s2 = updatePeerDisplay(s1, { peerAddr: 'peer-A', displayName: 'Anne' });
    const s3 = updatePeerDisplay(s2, { peerAddr: 'peer-A', displayName: 'Anne' });
    expect(s3).toBe(s2);
  });

  it('updatePeerDisplay leaves unrelated threads alone', () => {
    const s0 = createInitialThreadState();
    const { state: s1 } = ensureDmThread(s0, { peerAddr: 'peer-A' });
    const { state: s2 } = createThread(s1, { name: 'Other' });
    const s3 = updatePeerDisplay(s2, { peerAddr: 'peer-A', displayName: 'Anne' });
    const other = [...s3.threads.values()].find((t) => t.name === 'Other');
    expect(other).toBeTruthy();
    expect(other.peerAddr).toBeNull();
  });
});
