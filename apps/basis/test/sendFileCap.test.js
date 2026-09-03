/**
 * /send-file's size cap, asserted on the SHARED door (web ≡ mobile).
 *
 * Until 2026-09-03 only the mobile twin (`filePickerSendFile.test.js`) asserted this, and it was the
 * one thing that caught a real regression: turning the bare `8 * 1024 * 1024` literal into a declared
 * param was written as `PARAM.value` — but `param()` RETURNS the resolved value itself — so the cap
 * became `undefined` and nothing oversize was ever refused. The basis suite stayed green because no test
 * here sent an oversize file through the door. This is that test, so the shared door is guarded where
 * the shared code lives, not only in one shell's harness.
 */
import { describe, it, expect } from 'vitest';
import { createLocalBuiltins } from '../src/core/localBuiltins.js';

const t = (key, params = {}) => {
  const tail = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(' ');
  return tail ? `[${key}](${tail})` : `[${key}]`;
};

function harness({ openFilePicker }) {
  const peerCalls = [];
  const agent = {
    identity: { chat: { pubKey: 'pk', stableId: 'sid' }, host: { webid: 'https://a/profile#me' } },
    peer:     { address: 'app.peer-addr', status: 'connected' },
    sendPeerMessage: async (addr, msg) => { peerCalls.push({ addr, msg }); return { ok: true }; },
  };
  const handlers = createLocalBuiltins({
    catalogue: [], t, threadStore: { get: () => null, upsert: () => {}, list: () => [] }, setActive: () => {},
    callSkill: async () => ({}), localActor: 'me', agent, openFilePicker,
  });
  return { handlers, peerCalls };
}

describe('/send-file — the door\'s own size question, on the shared code', () => {
  it('refuses what the peer wire should not carry at all (a video over the photo-sized cap)', async () => {
    const h = harness({ openFilePicker: async () => ({ name: 'film.mp4', type: 'video/mp4', size: 9 * 1024 * 1024, dataB64: 'AA==' }) });
    const r = await h.handlers['send-file']({ peer: 'app.peer-addr' });
    expect(r?.ok).toBe(false);
    expect(r.error).toContain('sendFile.too_large');
    expect(h.peerCalls).toHaveLength(0);
  });

  it('a photo-sized file passes the door — the façade chunks per route below it', async () => {
    const h = harness({ openFilePicker: async () => ({ name: 'foto.jpg', type: 'image/jpeg', size: 300 * 1024, dataB64: 'A'.repeat(400 * 1024) }) });
    const r = await h.handlers['send-file']({ peer: 'app.peer-addr' });
    expect(r?.error).toBeUndefined();
    expect(h.peerCalls).toHaveLength(1);
    expect(h.peerCalls[0].msg?.file?.size).toBe(300 * 1024);
  });
});
