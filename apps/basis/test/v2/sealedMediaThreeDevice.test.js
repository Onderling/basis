/**
 * A sealed photo in circle chat, across two circles — story 4.4 of
 * `plans/NOTE-multi-device-user-stories.md`.
 *
 * "Anna sends a photo; Bram (member) opens it; Cato (other circle) cannot — even with the ref."
 *
 * `kringMediaFanOut.dom.test.js` already covers the sender→wire→chip walk and pins that a WRONG circle key
 * degrades the inline THUMBNAIL to a placeholder. Two things it cannot express, and this file does:
 *   • the FULL image leg — the thumbnail rides inside the manifest line, but the full bytes go through the
 *     gatekeeper. A member must get through it; an outsider must be refused BY it, and refused again by the
 *     seal if they somehow got past. Two independent barriers, and only one of them was tested.
 *   • the "even with the ref" clause. The ref is not a secret: it travels in the envelope and any member
 *     can copy it. So the interesting adversary is not someone guessing a ref — it is someone HOLDING a
 *     valid one from another circle. Nothing tested that.
 *
 * This is the same shape as the profile-picture leak this corpus already found — data reaching a device
 * that the surface merely declines to render — applied to bytes.
 *
 * Real sealing primitives + a real gatekeeper over an in-memory bucket. No DOM, no native picker.
 *
 * Cast: Anna (posts) · Bram (her circle) · Cato (a DIFFERENT circle, holding the ref).
 */
import { describe, it, expect } from 'vitest';
import { generateGroupKey, makeGroupSealer, makeGroupOpener, isSealed } from '@onderling/pod-client/sealing';
import { uploadBlob, openBlob, openThumbnail, createBlobGatekeeper } from '@onderling/blob-gateway';
import { makeDevMediaBucket } from '../../src/v2/circleMediaGateway.js';

const ANNA = 'did:anna';
const BRAM = 'did:bram';
const CATO = 'did:cato';
const PHOTO = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6, 7, 8]);   // PNG-ish bytes

/** One circle's content key — the group-key posture circle chat uses for media. */
const circleKey = () => {
  const k = generateGroupKey();
  return { seal: makeGroupSealer(k), open: makeGroupOpener(k) };
};

/**
 * The circle's blob world: a bucket, the group sealer, and a gatekeeper whose ACL is the circle roster.
 * `verifyToken` stands in for the capability check — the test needs the ACL leg, not the crypto of tokens
 * (that has its own coverage in `capabilityVerifier.test.js`).
 */
function circleBlobs({ key, members }) {
  const bucket = makeDevMediaBucket();
  const gate = createBlobGatekeeper({
    verifyToken: (token) => (typeof token === 'string' && token.startsWith('who:') ? { webId: token.slice(4) } : null),
    acl: { canRead: (webId) => members.includes(webId) },
    bucket,
  });
  return { bucket, gate, key };
}
const tokenFor = (webId) => `who:${webId}`;

describe('4.4 — Anna posts a sealed photo to her circle', () => {
  /** Anna's circle: Anna + Bram. Cato is in a different one. */
  async function annaPosts() {
    const A = circleBlobs({ key: circleKey(), members: [ANNA, BRAM] });
    const up = await uploadBlob({
      bytes: PHOTO, bucket: A.bucket, sealer: A.key.seal,
      keyRef: 'urn:circle:oosterpoort:content-key',
      media: { mime: 'image/png', width: 4, height: 4, thumbnail: 'dGh1bWI' },   // `thumbnail`, sealed by uploadBlob
    });
    return { A, ...up };
  }

  it('the bytes in the bucket are CIPHERTEXT — the photo is never at rest in the clear', async () => {
    const { A, ref, ciphertext } = await annaPosts();
    expect(isSealed(ciphertext)).toBe(true);
    // …and what the bucket actually holds is that ciphertext, not the original bytes.
    const stored = await A.bucket.presign(ref).then((u) => A.bucket.fetchPresigned(u)).catch(() => null);
    if (stored) expect(new TextDecoder().decode(stored)).not.toContain('PNG');
  });

  it('Bram (a member) opens the full image through the gate', async () => {
    const { A, manifestLine } = await annaPosts();
    // Pass the manifest LINE, which is what a caller actually holds — `openBlob` accepts either that or a
    // bare ref, and only the line carries the media metadata back out.
    const opened = await openBlob({
      ref: manifestLine, gate: A.gate, token: tokenFor(BRAM), opener: A.key.open, fetch: A.bucket.fetchPresigned,
    });
    expect(opened?.bytes).toBeTruthy();
    // A TRUE round-trip, not merely "something came back": the original PNG header, byte for byte.
    expect([...opened.bytes]).toEqual([...PHOTO]);
    expect(opened.media?.mime).toBe('image/png');
  });

  it('Bram also sees the inline thumbnail, which needs no gate at all', async () => {
    const { A, manifestLine } = await annaPosts();
    const thumb = openThumbnail({ line: manifestLine, opener: A.key.open });   // sync — no gate, no fetch
    expect(thumb).toBeTruthy();
    expect(thumb.length).toBeGreaterThan(0);
  });

  it('Cato — another circle, HOLDING the ref — is refused at the gate', async () => {
    const { A, ref } = await annaPosts();
    // The ref is not a secret: it rides the envelope, and any member could pass it on. Cato has it.
    await expect(openBlob({
      ref, gate: A.gate, token: tokenFor(CATO), opener: circleKey().open, fetch: A.bucket.fetchPresigned,
    })).rejects.toThrow();

    // Specifically an ACL denial, not an incidental failure — a denial must never carry a URL.
    const denied = await A.gate(tokenFor(CATO), ref);
    expect(denied.url).toBeUndefined();
    expect(denied.denied).toBe(true);
    expect(denied.reason).toBe('acl');
  });

  it('…and the SEAL refuses him independently, so the gate is not the only thing standing there', async () => {
    // Defence in depth: if the gate were ever misconfigured — an over-broad ACL, a shared bucket, a
    // presigned URL forwarded to him — the bytes are still ciphertext under a key Cato does not hold.
    const { A, ref } = await annaPosts();
    const openGate = createBlobGatekeeper({          // a deliberately WRONG-permissive gate
      verifyToken: () => ({ webId: CATO }), acl: { canRead: () => true }, bucket: A.bucket,
    });
    await expect(openBlob({
      ref, gate: openGate, token: tokenFor(CATO), opener: circleKey().open, fetch: A.bucket.fetchPresigned,
    })).rejects.toThrow();
  });

  it('the inline THUMBNAIL is sealed too — the chip is not a free preview for an outsider', async () => {
    // The thumbnail travels inside the manifest line, so it passes no gate at all. If it were plaintext,
    // every out-of-circle holder of the envelope would get a readable preview of a "sealed" photo.
    const { manifestLine } = await annaPosts();
    const catoOpener = circleKey().open;
    // It throws rather than returning plaintext — the package refuses to hand back an unopened thumb.
    expect(() => openThumbnail({ line: manifestLine, opener: catoOpener })).toThrow(/unseal failed/);
    // And it is genuinely sealed in the line, so there is nothing to read without opening it.
    expect(typeof manifestLine.enc.thumb).toBe('string');
    expect(manifestLine.enc.thumb).not.toContain('thumb');
  });

  it('a member of Anna\'s circle who was REMOVED loses the full image, ref or no ref', async () => {
    // Membership is the ACL, so removal has to bite at the gate — the ref Bram already copied must stop
    // working. (The seal alone would not: he still holds yesterday's group key until it rotates.)
    const key = circleKey();
    const bucket = makeDevMediaBucket();
    let roster = [ANNA, BRAM];
    const gate = createBlobGatekeeper({
      verifyToken: (t) => (typeof t === 'string' && t.startsWith('who:') ? { webId: t.slice(4) } : null),
      acl: { canRead: (webId) => roster.includes(webId) },
      bucket,
    });
    const { ref } = await uploadBlob({ bytes: PHOTO, bucket, sealer: key.seal, keyRef: 'urn:circle:x:content-key' });

    expect(await openBlob({ ref, gate, token: tokenFor(BRAM), opener: key.open, fetch: bucket.fetchPresigned })).toBeTruthy();
    roster = [ANNA];                                                     // Bram is removed
    await expect(openBlob({ ref, gate, token: tokenFor(BRAM), opener: key.open, fetch: bucket.fetchPresigned }))
      .rejects.toThrow();
  });

  it('no token at all is refused — deny-by-default, not deny-if-recognised', async () => {
    const { A, ref } = await annaPosts();
    for (const token of [undefined, null, '', 'garbage']) {
      const res = await A.gate(token, ref);
      expect(res.url, `token ${JSON.stringify(token)} was handed a URL`).toBeUndefined();
      expect(res.denied).toBe(true);
    }
  });
});
