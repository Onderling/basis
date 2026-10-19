/**
 * buttonSpecials — interception contract for step 7.
 *
 * Pinning the three special-case shapes ChatScreen must apply when a
 * row button is tapped:
 *   - respondToItem  → spawn-thread-with-followup (Help: <itemId>)
 *   - startDm        → spawn-thread (DM: <peerId>)
 *   - downloadFile   → inline-text ("downloads not wired yet")
 * Anything else falls through to the generic dispatch path.
 */
import { describe, it, expect } from 'vitest';
import { interceptButtonTap } from '../src/core/buttonSpecials.js';

const stubT = (key, params = {}) => {
  const tail = Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  return tail ? `[${key}](${tail})` : `[${key}]`;
};

describe('#253 step 7 — interceptButtonTap', () => {
  it('respondToItem spawns a thread with a parked single-field follow-up', () => {
    const r = interceptButtonTap({
      opId: 'respondToItem',
      itemId: 'post-42',
      buttonLabel: 'Help with',
      t: stubT,
    });
    expect(r.handled).toBe(true);
    expect(r.kind).toBe('spawn-thread-with-followup');
    expect(r.threadName).toContain('threads.help_with_thread_name');
    expect(r.threadName).toContain('post-42');
    expect(r.followUp).toBeTruthy();
    expect(r.followUp.kind).toBe('single');
    expect(r.followUp.opId).toBe('respondToItem');
    expect(r.followUp.missingParam).toBe('body');
    expect(r.followUp.prefilledArgs).toEqual({ itemId: 'post-42' });
    // User-bubble text was prepared via t('chat.button_tap', …)
    expect(r.userBubble).toContain('chat.button_tap');
  });

  it('startDm spawns a DM-flavoured thread (no follow-up, no substrate dispatch)', () => {
    const r = interceptButtonTap({
      opId: 'startDm',
      itemId: 'peer-bob',
      buttonLabel: 'Start DM',
      t: stubT,
    });
    expect(r.handled).toBe(true);
    expect(r.kind).toBe('spawn-thread');
    expect(r.threadName).toContain('threads.dm_thread_name');
    expect(r.threadName).toContain('peer-bob');
    expect(r.followUp).toBeUndefined();
  });

  it('downloadFile without embed emits inline-text (graceful "no inline bytes" bubble)', () => {
    const r = interceptButtonTap({
      opId: 'downloadFile',
      itemId: 'file-99',
      buttonLabel: 'Download',
      t: stubT,
    });
    expect(r.handled).toBe(true);
    expect(r.kind).toBe('inline-text');
    expect(r.text).toContain('chat.download_not_wired');
    expect(r.text).toContain('file-99');
  });

  it('downloadFile WITH embed.snapshot.dataB64 emits a save-file action (#266)', () => {
    const r = interceptButtonTap({
      opId: 'downloadFile',
      itemId: 'file-99',
      buttonLabel: 'Download',
      t: stubT,
      embed: {
        snapshot: {
          dataB64: 'aGVsbG8=',
          name:    'hello.txt',
          mime:    'text/plain',
        },
      },
    });
    expect(r.handled).toBe(true);
    expect(r.kind).toBe('save-file');
    expect(r.dataB64).toBe('aGVsbG8=');
    expect(r.name).toBe('hello.txt');
    expect(r.mime).toBe('text/plain');
    expect(r.userBubble).toContain('chat.button_tap');
  });

  it('falls through (handled:false) for any other op', () => {
    expect(interceptButtonTap({ opId: 'claimTask',     itemId: 't', buttonLabel: 'Claim',    t: stubT }).handled).toBe(false);
    expect(interceptButtonTap({ opId: 'editTask',      itemId: 't', buttonLabel: 'Edit',     t: stubT }).handled).toBe(false);
    expect(interceptButtonTap({ opId: 'markReturned',  itemId: 'p', buttonLabel: 'Returned', t: stubT }).handled).toBe(false);
  });

  // acceptResponder is an ordinary op: the poster's board calls it (no card, no envelope, no intercept).
  it('acceptResponder / declineResponder / counterResponder are not intercepted', () => {
    for (const opId of ['acceptResponder', 'declineResponder', 'counterResponder']) {
      expect(interceptButtonTap({ opId, itemId: 'post-1', buttonLabel: 'x', t: stubT, extra: { fromAddr: 'a' } }).handled).toBe(false);
    }
  });
});
