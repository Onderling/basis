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

  it('a 50KB file passes the door now — the façade chunks per route; only the photo-vs-video cap remains', async () => {
    // The 32 KB cap was NKN's ceiling hardcoded one layer too high; the transport declares it and
    // the peer façade chunks (peerChunking.js). The door keeps only its own question: photo yes,
    // video no (8 MB).
    const h = buildHarness({
      openFilePicker: async () => ({
        name: 'big.bin', type: 'application/octet-stream',
        size: 50 * 1024, dataB64: 'A'.repeat(68 * 1024),
      }),
    });
    const r = await h.handlers['send-file']({ peer: 'app.peer-addr' });
    expect(r?.error).toBeUndefined();
    expect(h.peerCalls.length).toBe(1);
    expect(h.peerCalls[0].msg?.file?.size).toBe(50 * 1024);
  });

  it('rejects what the peer wire should not carry at all (over the 8MB photo-vs-video cap)', async () => {
    const h = buildHarness({
      openFilePicker: async () => ({
        name: 'film.mp4', type: 'video/mp4',
        size: 9 * 1024 * 1024, dataB64: 'AA==',
      }),
    });
    const r = await h.handlers['send-file']({ peer: 'app.peer-addr' });
    expect(r?.ok).toBe(false);
    expect(r.error).toContain('sendFile.too_large');
  });
});
