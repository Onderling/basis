/**
 * Per-circle stoop scoping (S4 GUI slice) — scopeStoopCallSkill injects the active
 * circle id as the stoop scope key on writes and filters list reads to the circle,
 * so each circle's prikbord is isolated through the ONE shared stoop agent (not N
 * agents). Mirrors the dispatch-path scopeReadyDispatch for the direct-callSkill path.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  scopeStoopCallSkill, keepForCircle, SCOPED_WRITE_OPS, SCOPED_LIST_OPS,
} from '../src/v2/circleStoopScope.js';

describe('keepForCircle', () => {
  it('keeps everything when no active circle', () => {
    expect(keepForCircle({ groupId: 'b' }, null)).toBe(true);
  });
  it('keeps an item with no circle hint (op already scoped it)', () => {
    expect(keepForCircle({ id: 'x' }, 'circle-a')).toBe(true);
  });
  it('keeps a matching hint, drops a non-matching one', () => {
    expect(keepForCircle({ groupId: 'circle-a' }, 'circle-a')).toBe(true);
    expect(keepForCircle({ groupId: 'circle-b' }, 'circle-a')).toBe(false);
    expect(keepForCircle({ circleId: 'circle-a' }, 'circle-a')).toBe(true);  // circleId alias
  });
});

describe('scopeStoopCallSkill', () => {
  it('returns the original callSkill when circleId is null', () => {
    const cs = vi.fn();
    expect(scopeStoopCallSkill(cs, null)).toBe(cs);
  });

  it('injects groupId on a write op (postRequest)', async () => {
    const cs = vi.fn().mockResolvedValue({ ok: true });
    const scoped = scopeStoopCallSkill(cs, 'circle-a');
    await scoped('stoop', 'postRequest', { intent: 'ask', text: 'hoi' });
    expect(cs).toHaveBeenCalledWith('stoop', 'postRequest', { intent: 'ask', text: 'hoi', groupId: 'circle-a' });
  });

  it('injects groupId on every scoped mutate op', async () => {
    const cs = vi.fn().mockResolvedValue({ ok: true });
    const scoped = scopeStoopCallSkill(cs, 'circle-a');
    for (const op of ['respondToItem', 'cancelRequest', 'markReturned', 'assignLend', 'reportPost']) {
      await scoped('stoop', op, { itemId: 'p1' });
    }
    for (const call of cs.mock.calls) expect(call[2].groupId).toBe('circle-a');
    expect(SCOPED_WRITE_OPS.has('postRequest')).toBe(true);
  });

  it('does NOT clobber an explicit scope the caller set', async () => {
    const cs = vi.fn().mockResolvedValue({});
    const scoped = scopeStoopCallSkill(cs, 'circle-a');
    await scoped('stoop', 'postRequest', { text: 'x', groupId: 'circle-explicit' });
    expect(cs.mock.calls[0][2].groupId).toBe('circle-explicit');
  });

  it('filters a list read to the active circle (keeps null-hint items)', async () => {
    const cs = vi.fn().mockResolvedValue({ items: [
      { id: '1', groupId: 'circle-a' },
      { id: '2', groupId: 'circle-b' },
      { id: '3' },                         // no hint → kept (already scoped upstream)
    ] });
    const scoped = scopeStoopCallSkill(cs, 'circle-a');
    const res = await scoped('stoop', 'listOpen', {});
    expect(res.items.map((i) => i.id)).toEqual(['1', '3']);
    expect(SCOPED_LIST_OPS.has('listOpen')).toBe(true);
  });

  it('does not inject/filter for a non-stoop app, and passes mutePeer through unscoped', async () => {
    const cs = vi.fn().mockResolvedValue({ items: [{ id: '1', groupId: 'circle-b' }] });
    const scoped = scopeStoopCallSkill(cs, 'circle-a');
    await scoped('tasks', 'listOpen', { x: 1 });
    expect(cs).toHaveBeenLastCalledWith('tasks', 'listOpen', { x: 1 });   // untouched
    await scoped('stoop', 'mutePeer', { peerWebid: 'did:bob' });
    expect(cs.mock.calls.at(-1)[2]).toEqual({ peerWebid: 'did:bob' });       // not a scoped op → no groupId
  });

  it('passes a non-list stoop read through (whoAmI) unscoped + unfiltered', async () => {
    const cs = vi.fn().mockResolvedValue({ webid: 'did:me' });
    const scoped = scopeStoopCallSkill(cs, 'circle-a');
    const res = await scoped('stoop', 'whoAmI', {});
    expect(res).toEqual({ webid: 'did:me' });
    expect(cs.mock.calls[0][2]).toEqual({});
  });

  // ── sealed (p2/p3) circle: seal post bodies at rest, open on read ───────────────────
  const fakeStrategy = {
    seal: (t) => `SEALED(${t})`,
    open: (t) => (typeof t === 'string' && t.startsWith('SEALED(') ? t.slice(7, -1) : t),
  };

  it('seals a postRequest body before it reaches the pod (sealed circle)', async () => {
    const cs = vi.fn().mockResolvedValue({ ok: true });
    const scoped = scopeStoopCallSkill(cs, 'circle-a', async () => fakeStrategy);
    await scoped('stoop', 'postRequest', { intent: 'ask', text: 'hoi circle' });
    expect(cs.mock.calls[0][2]).toMatchObject({ text: 'SEALED(hoi circle)', groupId: 'circle-a' });
  });

  it('opens sealed list items on read, leaves non-recipient/plaintext bodies as-is', async () => {
    const cs = vi.fn().mockResolvedValue({ items: [
      { id: '1', text: 'SEALED(geheim)', groupId: 'circle-a' },
      { id: '2', text: 'plain', groupId: 'circle-a' },
      { id: '3', text: 'SEALED(weg)', groupId: 'circle-b' },   // other circle → filtered out
    ] });
    const scoped = scopeStoopCallSkill(cs, 'circle-a', async () => fakeStrategy);
    const res = await scoped('stoop', 'listOpen', {});
    expect(res.items.map((i) => [i.id, i.text])).toEqual([['1', 'geheim'], ['2', 'plain']]);
    expect(res.items[0].label).toBe('geheim');
  });

  it('no strategy (p0 circle) → bodies pass through in cleartext', async () => {
    const cs = vi.fn().mockResolvedValue({ ok: true });
    const scoped = scopeStoopCallSkill(cs, 'circle-a', async () => null);
    await scoped('stoop', 'postRequest', { text: 'hoi' });
    expect(cs.mock.calls[0][2].text).toBe('hoi');
  });
});

// ── sealed IMAGE attachments (2026-07-11): the wrapper seals a picked image through the
//    per-circle media gateway — the SAME uploadBlob/{type:'media'} path basis's own
//    circle chat images use — and replaces the inline {dataB64,thumbnail} with an opaque
//    sealed pointer BEFORE it reaches stoop. ────────────────────────────────────────────
describe('scopeStoopCallSkill — sealed image attachments', () => {
  const TINY_PNG_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4XmNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==';
  const fakeStrategy = {
    seal: (t) => `SEALED(${t})`,
    open: (t) => (typeof t === 'string' && t.startsWith('SEALED(') ? t.slice(7, -1) : t),
  };

  async function makeCircleMedia() {
    const { generateKeypair, makeSealer, makeOpener } = await import('@onderling/pod-client/sealing');
    const kp = generateKeypair();
    const store = new Map();
    const bucket = { async put(k, v) { store.set(k, v); }, async presign() { return null; }, async delete(k) { store.delete(k); } };
    return {
      mediaGateway: { bucket, sealer: makeSealer([kp.publicKey]), opener: makeOpener(kp.privateKey), keyRef: 'urn:circle:a:content-key' },
      opener: makeOpener(kp.privateKey), localActor: 'me', t: (k) => k, store,
    };
  }

  const inlineImage = () => ({
    mime: 'image/png', width: 1, height: 1,
    dataB64: TINY_PNG_B64, thumbnail: `data:image/png;base64,${TINY_PNG_B64}`,
  });

  it('seals attachments → opaque {type:media, source:blob} pointer; no plaintext reaches stoop', async () => {
    const media = await makeCircleMedia();
    const cs = vi.fn().mockResolvedValue({ ok: true });
    const scoped = scopeStoopCallSkill(cs, 'circle-a', async () => fakeStrategy, async () => media);

    await scoped('stoop', 'postRequest', { intent: 'ask', text: 'foto', attachments: [inlineImage()] });

    const sentArgs = cs.mock.calls[0][2];
    const att = sentArgs.attachments[0];
    expect(att.type).toBe('media');
    expect(att.source.type).toBe('blob');
    expect(att.source.enc.sealed).toBe(true);
    // No plaintext anywhere in what stoop receives.
    const serialized = JSON.stringify(sentArgs);
    expect(serialized).not.toContain('data:image');
    expect(serialized).not.toContain(TINY_PNG_B64);
    // The sealed inline thumbnail opens with the circle opener (reuse of openThumbnail).
    const { openThumbnail } = await import('@onderling/blob-gateway');
    expect(openThumbnail({ line: att.source, opener: media.opener }).length).toBeGreaterThan(0);
  });

  it('opens sealed attachment thumbnails on the read path for render', async () => {
    const media = await makeCircleMedia();
    // First seal one through a post to get a real sealed pointer.
    const cs = vi.fn().mockResolvedValue({ ok: true });
    const scoped = scopeStoopCallSkill(cs, 'circle-a', async () => fakeStrategy, async () => media);
    await scoped('stoop', 'postRequest', { text: 'x', attachments: [inlineImage()] });
    const sealedAtt = cs.mock.calls[0][2].attachments[0];

    // Now a list read carrying that pointer opens the thumbnail into a render data URL.
    const csList = vi.fn().mockResolvedValue({ items: [
      { id: '1', text: 'SEALED(hoi)', groupId: 'circle-a', source: { groupId: 'circle-a', attachments: [sealedAtt] } },
    ] });
    const scopedList = scopeStoopCallSkill(csList, 'circle-a', async () => fakeStrategy, async () => media);
    const res = await scopedList('stoop', 'listOpen', {});
    const openedAtt = res.items[0].source.attachments[0];
    expect(openedAtt.thumbnail).toMatch(/^data:image\/jpeg;base64,/);   // opened for render
    expect(openedAtt.source.type).toBe('blob');                          // sealed pointer preserved
  });

  it('refuses attachments when the circle has no media gateway (sealed-only)', async () => {
    const cs = vi.fn().mockResolvedValue({ ok: true });
    const scoped = scopeStoopCallSkill(cs, 'circle-a', async () => fakeStrategy, async () => null);
    await expect(scoped('stoop', 'postRequest', { text: 'x', attachments: [inlineImage()] }))
      .rejects.toThrow(/media-gateway-unavailable/);
    expect(cs).not.toHaveBeenCalled();
  });
});
