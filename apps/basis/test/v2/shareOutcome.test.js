/**
 * WHAT A SHARE SAYS IT DID — the honest line (Fable's ruling on L140(b), 2026-09-26). A circle that cannot carry a
 * picture (no seal strategy for its media) had the picture DROPPED from the outbound release while Mij said
 * "Gedeeld ✓". The share now reports what it left out, and one shared function turns that into the sentence every
 * Mij and About-me screen paints, on both shells.
 */
import { describe, it, expect } from 'vitest';
import { shareOutcome } from '../../src/v2/shareOutcome.js';
import { shareDisclosureToCircle } from '../../src/core/handlers/personaPropsUpdate.js';

const PIC = { type: 'blob', ref: 'blob://x', enc: { sealed: true, keyRef: 'k', format: 'fp1', thumb: 'T' } };

describe('shareOutcome', () => {
  it('shared', () => expect(shareOutcome({ ok: true })).toEqual({ key: 'circle.aboutme.shared_ok' }));
  it('stopped sharing', () => expect(shareOutcome({ ok: true }, { stopping: true })).toEqual({ key: 'circle.mij.stopped_sharing' }));
  it('failed, with the reason', () => expect(shareOutcome({ ok: false, reason: 'no-lane' })).toEqual({ key: 'circle.aboutme.share_failed', params: { reason: 'no-lane' } }));
  it('shared WITHOUT the picture says so', () => expect(shareOutcome({ ok: true, dropped: ['profilePicture'] })).toEqual({ key: 'circle.aboutme.shared_without_picture' }));
});

describe('shareDisclosureToCircle reports what the re-seal left out', () => {
  it('a picture the circle cannot carry is named in `dropped`', async () => {
    const res = await shareDisclosureToCircle({
      callSkill: async () => ({ released: { profilePicture: PIC, place: 'Groningen' } }),
      emitMemberProps: async () => ({ ok: true, emitted: ['c1'], unchanged: [], failed: [] }),
      circleId: 'c1', personaId: 'default',
      resealMediaForCircle: async (props) => { const out = { ...props }; delete out.profilePicture; return out; },
    });
    expect(res.ok).toBe(true);
    expect(res.dropped).toEqual(['profilePicture']);
  });
  it('nothing dropped → no `dropped`', async () => {
    const res = await shareDisclosureToCircle({
      callSkill: async () => ({ released: { place: 'Groningen' } }),
      emitMemberProps: async () => ({ ok: true, emitted: ['c1'], unchanged: [], failed: [] }),
      circleId: 'c1', personaId: 'default', resealMediaForCircle: async (p) => p,
    });
    expect(res.dropped).toBeUndefined();
  });
});
