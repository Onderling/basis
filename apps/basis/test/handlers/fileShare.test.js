/**
 * file-share handler coverage — a received peer-wire file lands in the SENDER's contact thread
 * (decided 2026-09-02; it used to paint into a main thread mobile v2 permanently hides).
 */
import { describe, it, expect, vi } from 'vitest';
import { makeHandleFileShare } from '../../src/core/handlers/fileShare.js';

function deps(overrides = {}) {
  return {
    deliverToThread: vi.fn(),
    publishEvent:    vi.fn(),
    logger:          { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
}

describe('makeHandleFileShare', () => {
  it('throws when deliverToThread missing', () => {
    expect(() => makeHandleFileShare({})).toThrow(/deliverToThread required/);
  });

  it('drops envelopes missing file fields', () => {
    const d = deps();
    const handle = makeHandleFileShare(d);
    handle('peer-A', null);
    handle('peer-A', { file: { id: 'f1' } });
    handle('peer-A', { file: { id: 'f1', name: 'a.txt' } });
    expect(d.deliverToThread).not.toHaveBeenCalled();
  });

  it("delivers the file into the SENDER's thread + publishes a notification", () => {
    const d = deps();
    const handle = makeHandleFileShare(d);
    handle('peer-A', {
      sentAt: 1234,
      file: { id: 'f1', name: 'recipe.md', mime: 'text/markdown', size: 1024, dataB64: 'aGVsbG8=' },
    });
    expect(d.deliverToThread).toHaveBeenCalledTimes(1);
    const turn = d.deliverToThread.mock.calls[0][0];
    expect(turn.fromAddr).toBe('peer-A');
    expect(turn.file).toEqual({ id: 'f1', name: 'recipe.md', mime: 'text/markdown', size: 1024, dataB64: 'aGVsbG8=' });
    // The sender's file id is the dedup nonce — a relay-replayed share must not land twice.
    expect(turn.messageId).toBe('file-share-f1');
    expect(turn.ts).toBe(1234);
    expect(d.publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      app: 'folio', type: 'notification',
    }));
  });

  it('a broken thread sink never eats the notification', () => {
    const d = deps({ deliverToThread: vi.fn(() => { throw new Error('store down'); }) });
    const handle = makeHandleFileShare(d);
    handle('peer-A', {
      file: { id: 'f2', name: 'foto.jpg', mime: 'image/jpeg', size: 9, dataB64: 'aGVsbG8=' },
    });
    expect(d.publishEvent).toHaveBeenCalled();
  });
});
