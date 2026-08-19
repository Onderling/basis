/**
 * mobile sendFile uses the pre-encoded dataB64
 * short-circuit (2026-05-26).
 *
 * Pins the upstream patch in apps/basis/src/core/localBuiltins.js
 * that lets mobile pickers hand pre-encoded {dataB64} bytes to
 * sendFile without needing the browser-only FileReader.  Without
 * this, /send-file would crash on Hermes the moment the user picked
 * a file.
 *
 * We construct localBuiltins via buildMobileLocalBuiltins with an
 * openFilePicker stub that returns a fake PickedImage-shaped object,
 * then drive `send-file` and assert the agent received a
 * `file-share` envelope with the expected base64 payload.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { buildMobileLocalBuiltins } from '../src/core/hostOps.js';
import {
  createInitialThreadState, __resetThreadIdSeq,
} from '../src/core/threadState.js';

const t = (key, params = {}) => {
  const tail = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(' ');
  return tail ? `[${key}](${tail})` : `[${key}]`;
};

function buildHarness({ openFilePicker } = {}) {
  __resetThreadIdSeq();
  let threadState = createInitialThreadState();
  const threadStateRef = { current: threadState };
  const setThreadState = (v) => {
    const next = typeof v === 'function' ? v(threadStateRef.current) : v;
    threadStateRef.current = next;
    threadState = next;
  };

  const peerCalls = [];
  const agent = {
    identity: { chat: { pubKey: 'pk', stableId: 'sid' }, host: { webid: 'https://a/profile#me' } },
    peer:     { address: 'app.peer-addr', status: 'connected' },
    sendPeerMessage: async (addr, msg) => {
      peerCalls.push({ addr, msg });
      return { ok: true };
    },
  };

  const handlers = buildMobileLocalBuiltins({
    threadStateRef, setThreadState,
    agent,
    catalogue:   { opsById: new Map(), appOrigins: new Set(['basis']), appsById: new Map() },
    callSkill: async () => ({}),
    t,
    openFilePicker,
  });
  return { handlers, peerCalls };
}

describe('Bundle F P4 — /send-file with mobile picker', () => {
  it('uses the pre-encoded dataB64 instead of FileReader (so RN Hermes works)', async () => {
    const h = buildHarness({
      openFilePicker: async () => ({
        name:    'photo.jpg',
        type:    'image/jpeg',
        size:    1024,
        dataB64: 'ZmFrZS1iYXNlNjQtZGF0YQ==',   // "fake-base64-data"
      }),
    });
    const r = await h.handlers['send-file']({ peer: 'app.peer-addr' });
    // sendFile returns {message: '...'} on success (no `ok` field).
    expect(r?.message).toBeTruthy();
    expect(h.peerCalls).toHaveLength(1);
    expect(h.peerCalls[0].addr).toBe('app.peer-addr');
    expect(h.peerCalls[0].msg.subtype).toBe('file-share');
    expect(h.peerCalls[0].msg.file.name).toBe('photo.jpg');
    expect(h.peerCalls[0].msg.file.mime).toBe('image/jpeg');
    expect(h.peerCalls[0].msg.file.dataB64).toBe('ZmFrZS1iYXNlNjQtZGF0YQ==');
  });

  it('surfaces a clean error when the user cancels the picker', async () => {
    const h = buildHarness({
      openFilePicker: async () => null,
    });
    const r = await h.handlers['send-file']({ peer: 'app.peer-addr' });
    expect(r?.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });

  it('rejects files exceeding the 32KB inline cap', async () => {
    const huge = 'A'.repeat(50 * 1024);
    const h = buildHarness({
      openFilePicker: async () => ({
        name: 'big.bin', type: 'application/octet-stream',
        size: huge.length, dataB64: 'AA==',
      }),
    });
    const r = await h.handlers['send-file']({ peer: 'app.peer-addr' });
    expect(r?.ok).toBe(false);
    expect(r.error).toContain('sendFile.too_large');
  });
});
