/**
 * Sealed stoop media on MOBILE (2026-07-11) — regression + invariant-#2 gap.
 *
 * The sealed-media consolidation made stoop images sealed-only per-circle on WEB, but mobile's
 * stoop noticeboard never got the sealed-media wiring, so mobile stoop image-attach was REFUSED
 * for every circle. The fix threads THIS circle's media composition (`createCircleMediaGateway`)
 * as the 4th `getMedia` arg into the SHARED `scopeStoopCallSkill` wrapper (mirror web's
 * circleApp.js `getStoopMedia`) and gates the 📎 on the same composition.
 *
 * These tests exercise the EXACT mobile flow: the `attachmentPicker` output shape
 * (`toInboundAttachment` → {mime,dataB64,width,height,thumbnail}) fed through the shared wrapper +
 * the shared per-circle composition — the SAME path web uses (no reimplementation). Web≡mobile.
 *
 * RN screens can't render under Vitest (see vitest.config.js), so the 📎-hide is proven at the
 * gating input the component reads: `media` = the resolved composition (null for p0/p1). The
 * component renders `media ? <📎/> : null`, so composition===null ⇒ affordance hidden.
 */
import { describe, it, expect, vi } from 'vitest';
import { generateGroupKey, makeGroupSealer, makeGroupOpener } from '@onderling/pod-client/sealing';
import { openThumbnail } from '../../../packages/blob-gateway/src/index.js';
import { createCircleMediaComposition, makeDevMediaBucket } from '../../basis/src/v2/circleMediaGateway.js';
import { scopeStoopCallSkill } from '../../basis/src/v2/circleStoopScope.js';
import { toInboundAttachment } from '../src/v2/attachmentPicker.js';

const t = (k) => k;
const LOCAL_ACTOR = 'me';

// A real group-key content strategy — the same {seal,open} shape getCircleSealStrategy resolves
// for a p2/p3 circle. p0/p1 resolves null (below), so the composition is null → sealed-only.
function sealedStrategy() {
  const gk = generateGroupKey();
  return { seal: makeGroupSealer(gk), open: makeGroupOpener(gk) };
}

// The EXACT record attachmentPicker.pickAndEncodeImage emits ({mime,dataB64,width,height,thumbnail}).
const FULL_B64  = 'ZnVsbC1pbWFnZS1ieXRlcw==';        // "full-image-bytes"
const THUMB_B64 = 'dGh1bWItYnl0ZXM=';                // "thumb-bytes"
const pickedImage = () => toInboundAttachment({
  full: { base64: FULL_B64, width: 640, height: 480 }, thumbBase64: THUMB_B64, mime: 'image/jpeg',
});

// The composition + the 4th-arg getMedia the wrapper receives (mirror CircleLauncherScreen).
async function makeStoopMedia({ strategy = sealedStrategy() } = {}) {
  const composition = await createCircleMediaComposition({
    circleId: 'circle-a', getSealStrategy: async () => strategy,
    localActor: LOCAL_ACTOR, bucket: makeDevMediaBucket(),
  });
  const getMedia = async () => (composition && composition.mediaGateway
    ? { mediaGateway: composition.mediaGateway, localActor: LOCAL_ACTOR, t } : null);
  return { composition, strategy, getMedia };
}

describe('mobile stoop media — seals a picked prikbord image per-circle (web parity)', () => {
  it('picker shape → opaque {type:media, source:blob} pointer; NO plaintext reaches stoop', async () => {
    const { strategy, getMedia } = await makeStoopMedia();
    const cs = vi.fn().mockResolvedValue({ ok: true });
    const scoped = scopeStoopCallSkill(cs, 'circle-a', async () => strategy, getMedia);

    await scoped('stoop', 'postRequest', { intent: 'ask', text: 'foto', attachments: [pickedImage()] });

    const sentArgs = cs.mock.calls[0][2];
    const att = sentArgs.attachments[0];
    expect(att.type).toBe('media');
    expect(att.source.type).toBe('blob');
    expect(att.source.enc.sealed).toBe(true);
    // No plaintext bytes anywhere in what stoop (the pod / wire) receives.
    const serialized = JSON.stringify(sentArgs);
    expect(serialized).not.toContain('data:image');
    expect(serialized).not.toContain(FULL_B64);
    expect(serialized).not.toContain(THUMB_B64);
    // The sealed inline thumbnail opens with the circle opener (reuse of openThumbnail).
    expect(openThumbnail({ line: att.source, opener: strategy.open }).length).toBeGreaterThan(0);
  });

  it('a WRONG-circle opener cannot open the pointer (per-circle, no cross-seal)', async () => {
    const { getMedia } = await makeStoopMedia();
    const cs = vi.fn().mockResolvedValue({ ok: true });
    const scoped = scopeStoopCallSkill(cs, 'circle-a', async () => sealedStrategy(), getMedia);
    await scoped('stoop', 'postRequest', { text: 'x', attachments: [pickedImage()] });
    const att = cs.mock.calls[0][2].attachments[0];
    // A different circle's opener yields nothing (sealed with circle-a's key only).
    const otherOpener = sealedStrategy().open;
    let leaked = null;
    try { leaked = openThumbnail({ line: att.source, opener: otherOpener }); } catch { leaked = null; }
    expect(leaked == null || leaked.length === 0).toBe(true);
  });

  it('opens the sealed attachment thumbnail on the read path for render', async () => {
    const { strategy, getMedia } = await makeStoopMedia();
    const cs = vi.fn().mockResolvedValue({ ok: true });
    const scoped = scopeStoopCallSkill(cs, 'circle-a', async () => strategy, getMedia);
    await scoped('stoop', 'postRequest', { text: 'x', attachments: [pickedImage()] });
    const sealedAtt = cs.mock.calls[0][2].attachments[0];

    const csList = vi.fn().mockResolvedValue({ items: [
      { id: '1', text: 'x', groupId: 'circle-a', source: { groupId: 'circle-a', attachments: [sealedAtt] } },
    ] });
    const scopedList = scopeStoopCallSkill(csList, 'circle-a', async () => strategy, getMedia);
    const res = await scopedList('stoop', 'listOpen', {});
    const openedAtt = res.items[0].source.attachments[0];
    expect(openedAtt.thumbnail).toMatch(/^data:image\/jpeg;base64,/);   // opened for the chip
    expect(openedAtt.source.type).toBe('blob');                          // sealed pointer preserved
  });

  it('text still posts (sealed body) with NO attachment — unconditional', async () => {
    const { strategy, getMedia } = await makeStoopMedia();
    const cs = vi.fn().mockResolvedValue({ ok: true });
    const scoped = scopeStoopCallSkill(cs, 'circle-a', async () => strategy, getMedia);
    await scoped('stoop', 'postRequest', { intent: 'ask', text: 'hoi circle' });
    const sent = cs.mock.calls[0][2];
    expect(sent.groupId).toBe('circle-a');
    expect(sent.attachments).toBeUndefined();
    expect(sent.text).not.toBe('hoi circle');   // sealed at rest
    expect(strategy.open(sent.text)).toBe('hoi circle');
  });
});

describe('mobile stoop media — p0/p1 circle: sealed-only, attach hidden', () => {
  it('a circle with NO seal strategy composes to null → 📎 gating input is null (hidden)', async () => {
    // p0/p1 resolves no content strategy → createCircleMediaComposition returns null.
    const composition = await createCircleMediaComposition({
      circleId: 'circle-p0', getSealStrategy: async () => null,
      localActor: LOCAL_ACTOR, bucket: makeDevMediaBucket(),
    });
    expect(composition).toBeNull();   // CircleNoticeboard renders `media ? <📎/> : null` → hidden
  });

  it('the wrapper REFUSES an attachment when no media gateway (sealed-only, no plaintext fallback)', async () => {
    const cs = vi.fn().mockResolvedValue({ ok: true });
    // getMedia resolves null (p0/p1) — even if the 📎 were somehow reachable, the seal is refused.
    const scoped = scopeStoopCallSkill(cs, 'circle-p0', async () => null, async () => null);
    await expect(scoped('stoop', 'postRequest', { text: 'x', attachments: [pickedImage()] }))
      .rejects.toThrow(/media-gateway-unavailable/);
    expect(cs).not.toHaveBeenCalled();
  });

  it('text still posts in a p0/p1 circle (plaintext, unchanged)', async () => {
    const cs = vi.fn().mockResolvedValue({ ok: true });
    const scoped = scopeStoopCallSkill(cs, 'circle-p0', async () => null, async () => null);
    await scoped('stoop', 'postRequest', { intent: 'ask', text: 'hoi' });
    expect(cs.mock.calls[0][2]).toMatchObject({ text: 'hoi', groupId: 'circle-p0' });
  });
});
