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

function harness({ openFilePicker, encodeImage = undefined }) {
  const peerCalls = [];
  const agent = {
    identity: { chat: { pubKey: 'pk', stableId: 'sid' }, host: { webid: 'https://a/profile#me' } },
    peer:     { address: 'app.peer-addr', status: 'connected' },
    sendPeerMessage: async (addr, msg, opts) => { peerCalls.push({ addr, msg, opts }); return { ok: true }; },
  };
  const handlers = createLocalBuiltins({
    catalogue: [], t, threadStore: { get: () => null, upsert: () => {}, list: () => [] }, setActive: () => {},
    callSkill: async () => ({}), localActor: 'me', agent, openFilePicker, encodeImage,
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

  it('a file to a contact with a PAIR ROSTER goes over it — to their per-circle address there, with the circle id (the route, L105)', async () => {
    const h = harness({ openFilePicker: async () => ({ name: 'foto.jpg', type: 'image/jpeg', size: 3, dataB64: 'YWJj' }) });
    const seen = [];
    const agent = {
      identity: { chat: { pubKey: 'pk', stableId: 'sid' }, host: { webid: 'https://a/profile#me' } },
      peer: { address: 'app.peer-addr', status: 'connected' },
      sendPeerMessage: async (addr, msg, opts) => { seen.push({ addr, opts }); return { ok: true }; },
      pairRouteFor: async (peer) => (peer === 'bea' ? { to: 'bea@pair', circleId: 'pair-x', personKey: null } : null),
    };
    const handlers = createLocalBuiltins({
      catalogue: [], t, threadStore: { get: () => null, upsert: () => {}, list: () => [] }, setActive: () => {},
      callSkill: async () => ({}), localActor: 'me', agent, openFilePicker: async () => ({ name: 'foto.jpg', type: 'image/jpeg', size: 3, dataB64: 'YWJj' }),
    });
    await handlers['send-file']({ peer: 'bea' });
    expect(seen[0]).toEqual({ addr: 'bea@pair', opts: { circleId: 'pair-x' } });
    await handlers['send-file']({ peer: 'cato' });
    expect(seen[1]).toEqual({ addr: 'cato', opts: undefined });
    expect(h.peerCalls).toHaveLength(0);
  });

  // L78 (Frits, 2026-09-25): ONLY THE ENCODER'S OUTPUT RIDES, the DM door shares the circle resize, one param.
  it('a photo leaves as the encoder\'s output — the same resize a circle photo gets', async () => {
    const encoded = { mime: 'image/jpeg', dataB64: 'B'.repeat(4000), width: 1280, height: 960, thumbnail: 'data:image/jpeg;base64,AA' };
    const seen = [];
    const h = harness({
      openFilePicker: async () => ({ name: 'IMG_2041.png', type: 'image/png', size: 5 * 1024 * 1024, dataB64: 'C'.repeat(64) }),
      encodeImage: async (f) => { seen.push(f.name); return encoded; },
    });
    const r = await h.handlers['send-file']({ peer: 'app.peer-addr' });
    expect(r?.error).toBeUndefined();
    expect(seen).toEqual(['IMG_2041.png']);
    const file = h.peerCalls[0].msg?.file;
    expect(file.dataB64).toBe(encoded.dataB64);
    expect(file.mime).toBe('image/jpeg');
    expect(file.size).toBe(3000);   // the bytes that ride, not the picked file's
  });

  it('one cap for what rides: the circle attachment cap, not a separate 8 MB door', async () => {
    const h = harness({ openFilePicker: async () => ({ name: 'notulen.pdf', type: 'application/pdf', size: 1024 * 1024, dataB64: 'AA==' }) });
    const r = await h.handlers['send-file']({ peer: 'app.peer-addr' });
    expect(r?.ok).toBe(false);
    expect(r.error).toContain('sendFile.too_large');
    expect(h.peerCalls).toHaveLength(0);
  });
});
