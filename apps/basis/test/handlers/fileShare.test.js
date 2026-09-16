/**
 * file-share handler coverage — a received peer-wire file lands in the SENDER's contact thread
 * (decided 2026-09-02; it used to paint into a main thread mobile v2 permanently hides).
 */
import { describe, it, expect, vi } from 'vitest';
import { makeHandleFileShare, buildFileShareEnvelope } from '../../src/core/handlers/fileShare.js';

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

  it('makes the sender a known peer (the first-DM rule), and a graph failure hurts nothing', () => {
    const d = deps({ notePeer: vi.fn() });
    const handle = makeHandleFileShare(d);
    handle('peer-A', { file: { id: 'f3', name: 'a.jpg', mime: 'image/jpeg', size: 5, dataB64: 'AA==' } });
    expect(d.notePeer).toHaveBeenCalledWith('peer-A');

    const broken = deps({ notePeer: vi.fn(() => { throw new Error('graph down'); }) });
    makeHandleFileShare(broken)('peer-A', { file: { id: 'f4', name: 'b.jpg', mime: 'image/jpeg', size: 5, dataB64: 'AA==' } });
    expect(broken.deliverToThread).toHaveBeenCalled();   // the thread still gets the file
  });

  it('a broken thread sink never eats the notification', () => {
    const d = deps({ deliverToThread: vi.fn(() => { throw new Error('store down'); }) });
    const handle = makeHandleFileShare(d);
    handle('peer-A', {
      file: { id: 'f2', name: 'foto.jpg', mime: 'image/jpeg', size: 9, dataB64: 'aGVsbG8=' },
    });
    expect(d.publishEvent).toHaveBeenCalled();
  });

  describe('sealed to the person (2026-09-17)', () => {
    const file = { id: 'f3', name: 'foto.jpg', mime: 'image/jpeg', size: 3, dataB64: 'YWJj' };
    it('the envelope: with a key on record the bytes are in the box and a stub travels; without one they ride inline', async () => {
      const sealFor = vi.fn(async (peer, content) => (peer === 'known' ? { to: { version: 2, pubKey: 'K2' }, from: { version: 1, pubKey: 'K1' }, sealed: `box(${content.file.dataB64})`, nonce: 'n' } : null));
      const boxed = await buildFileShareEnvelope({ file, peerAddr: 'known', sealFor, sentAt: 7 });
      expect(boxed).toEqual({ type: 'p2p-chat', subtype: 'file-share', file: { id: 'f3', name: 'foto.jpg', mime: 'image/jpeg', size: 3 }, sealed: expect.objectContaining({ to: { version: 2, pubKey: 'K2' } }), sentAt: 7 });
      expect(JSON.stringify(boxed)).not.toContain('"dataB64"');
      const plain = await buildFileShareEnvelope({ file, peerAddr: 'stranger', sealFor, sentAt: 7 });
      expect(plain).toEqual({ type: 'p2p-chat', subtype: 'file-share', file, sentAt: 7 });
      expect((await buildFileShareEnvelope({ file, peerAddr: 'known', sealFor: async () => { throw new Error('boom'); } })).file.dataB64, 'a seal that throws falls back, never loses the file').toBe('YWJj');
    });
    it('the handler opens the box with the seal seam and delivers the bytes, recording what it was sealed to', async () => {
      const d = deps({ openFor: vi.fn(async (sealed) => ({ file: { ...file, dataB64: sealed.sealed.slice(4, -1) } })) });
      await makeHandleFileShare(d)('peer-A', { sentAt: 1, file: { id: 'f3', name: 'foto.jpg', mime: 'image/jpeg', size: 3 }, sealed: { to: { version: 2, pubKey: 'K2' }, from: { version: 1, pubKey: 'K1' }, sealed: 'box(YWJj)', nonce: 'n' } });
      const turn = d.deliverToThread.mock.calls[0][0];
      expect(turn.file).toEqual(file);
      expect(turn.sealed).toEqual({ to: { version: 2, pubKey: 'K2' }, from: { version: 1, pubKey: 'K1' } });
      expect(d.publishEvent).toHaveBeenCalled();
    });
    it('a box that does not open here is DROPPED and said — never delivered, never a notification', async () => {
      const warn = vi.fn();
      const d = deps({ openFor: async () => null, logger: { warn } });
      await makeHandleFileShare(d)('peer-A', { file: { id: 'f3', name: 'foto.jpg', size: 3 }, sealed: { to: { version: 9 }, sealed: 'x', nonce: 'n' } });
      expect(d.deliverToThread).not.toHaveBeenCalled();
      expect(d.publishEvent).not.toHaveBeenCalled();
      expect(warn.mock.calls.some(([m]) => /version 9 did not open/.test(String(m)))).toBe(true);
      // and a sealed envelope with NO open seam wired is the same drop (a shell from before)
      const d2 = deps({ logger: { warn: () => {} } });
      await makeHandleFileShare(d2)('peer-A', { file: { id: 'f3', name: 'foto.jpg', size: 3 }, sealed: { to: { version: 2 }, sealed: 'x', nonce: 'n' } });
      expect(d2.deliverToThread).not.toHaveBeenCalled();
    });
  });
});
