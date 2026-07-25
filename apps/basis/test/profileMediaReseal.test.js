/**
 * profileMediaReseal — the SHARED profile-picture seal path (web ≡ mobile).
 *
 * The re-seal → circle-sealed-copy crypto is proven at the primitive level
 * (blob-gateway media.test.js: a stranger's key can't open a sealed blob). Here we
 * lock the WRAPPER decisions that both shells depend on: which release keys get
 * re-sealed, which pass through untouched, and what happens when a re-seal can't
 * complete (dropped, never leaked as the un-openable source).
 */
import { describe, it, expect, vi } from 'vitest';
import { makeResealMediaForCircle } from '../src/v2/profileMediaReseal.js';

const SEALED_PIC = { type: 'blob', ref: 'blob://self/pic1', enc: { sealed: true, keyRef: 'self', mime: 'image/jpeg' } };

describe('makeResealMediaForCircle', () => {
  it('a release with NO media prop is returned untouched (no composition work)', async () => {
    const getSelfComposition = vi.fn();
    const getCircleComposition = vi.fn();
    const reseal = makeResealMediaForCircle({ getSelfComposition, getCircleComposition });
    const props = { handle: 'jan', realName: 'Jan' };
    const out = await reseal(props, 'c1');
    expect(out).toBe(props);                       // same object, untouched
    expect(getSelfComposition).not.toHaveBeenCalled();
    expect(getCircleComposition).not.toHaveBeenCalled();
  });

  it('a media prop that cannot be re-sealed is DROPPED — the source ref never leaks', async () => {
    // No self composition ⇒ resealMediaRefForCircle returns null ⇒ the key is dropped.
    const getSelfComposition = vi.fn(async () => null);
    const getCircleComposition = vi.fn(async () => null);
    const getPolicy = vi.fn(async () => ({ revealPolicy: 'pairwise' }));
    const reseal = makeResealMediaForCircle({ getSelfComposition, getCircleComposition, getPolicy });

    const props = { handle: 'jan', profilePicture: SEALED_PIC };
    const out = await reseal(props, 'c1');

    expect(out).toEqual({ handle: 'jan' });        // non-media kept, media dropped
    expect(JSON.stringify(out)).not.toContain('blob://self/pic1');
    expect(getPolicy).toHaveBeenCalledWith('c1');
    // the SOURCE object is never mutated (the caller keeps it for the diff-gate/memo)
    expect(props.profilePicture).toBe(SEALED_PIC);
  });

  it('re-seals through the target circle: opens the source, re-uploads via the circle gateway', async () => {
    const SOURCE_BYTES = new Uint8Array([1, 2, 3]);
    // Fake gateways: the self gateway's opener/gate yield the source bytes; the circle
    // gateway's sealer/bucket accept the re-upload and return a circle-sealed line. We stub
    // the blob primitives via the gateway shape the shared module reads.
    const selfComposition = {
      mediaGateway: {
        opener: () => SOURCE_BYTES,
        gate: async () => ({ url: 'dev://ok' }),
        token: 'tok',
      },
    };
    let uploadedWith = null;
    const circleComposition = {
      mediaGateway: {
        bucket: { async put() {} },
        sealer: (bytes) => ({ sealed: 'c1', bytes }),
        keyRef: 'urn:circle:c1:content-key',
      },
    };
    // Intercept the blob-gateway primitives the module composes.
    vi.doMock('@onderling/blob-gateway', () => ({
      openBlob: async () => SOURCE_BYTES,
      openThumbnail: () => new Uint8Array([9]),
      uploadBlob: async ({ bytes, sealer, keyRef }) => {
        uploadedWith = { bytes, sealedTag: sealer(bytes).sealed, keyRef };
        return { type: 'blob', ref: 'blob://c1/copy1', enc: { sealed: true, keyRef } };
      },
    }));
    vi.resetModules();
    const { makeResealMediaForCircle: freshMake } = await import('../src/v2/profileMediaReseal.js');

    const reseal = freshMake({
      getSelfComposition: async () => selfComposition,
      getCircleComposition: async () => circleComposition,
      getPolicy: async () => ({}),
    });
    const out = await reseal({ handle: 'jan', profilePicture: SEALED_PIC }, 'c1');

    expect(out.handle).toBe('jan');
    expect(out.profilePicture).toEqual({ type: 'blob', ref: 'blob://c1/copy1', enc: { sealed: true, keyRef: 'urn:circle:c1:content-key' } });
    expect(uploadedWith.sealedTag).toBe('c1');     // sealed with the CIRCLE's sealer
    vi.doUnmock('@onderling/blob-gateway');
    vi.resetModules();
  });
});
