/**
 * Test helper — build a SEALED image attachment pointer the way basis's
 * per-circle pinboard wrapper (`scopePinboardCallSkill` → `createMediaEmbed` →
 * `uploadBlob`) hands one to pinboard.  Pinboard is key-agnostic, so its tests
 * construct the sealed pointer here (a dev sealer + an in-memory bucket) and
 * assert pinboard only ever carries/stores the OPAQUE line — never plaintext.
 *
 * The returned `att` is a canonical `media` item whose `source` IS a
 * blob-gateway manifest line (`{type:'blob', ref:'blob://…', enc:{sealed:true,
 * …, thumb}}`) — byte-identical to what the wrapper produces.  `opener`/`gate`/
 * `fetchImpl` let a test prove the sealed round-trip (openThumbnail / openBlob).
 */
import { generateKeypair, makeSealer, makeOpener } from '@onderling/pod-client/sealing';
import { uploadBlob } from '@onderling/blob-gateway';

/** A 1×1 transparent PNG, base64-encoded. Tiny but valid bytes. */
export const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4XmNgYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==';

function b64ToBytes(s) {
  const bin = atob(String(s));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** A dev sealing circle: {sealer, opener, bucket, gate, fetchImpl} over an
 *  in-memory ciphertext store. `gate`/`fetchImpl` resolve a blob ref back to
 *  its stored ciphertext (the dev stand-in for a presigned bucket GET). */
export function makeSealCircle() {
  const kp = generateKeypair();
  const store = new Map();                 // bucket key → sealed ciphertext (string)
  const bucket = {
    store,
    async put(key, bytes) { store.set(key, bytes); },
    async presign(key) { return store.has(key) ? `mem://blob/${key}` : null; },
    async delete(key) { store.delete(key); },
  };
  const keyOf = (ref) => String(ref).replace(/^blob:\/\//, '');
  const gate = async (_token, ref) => (store.has(keyOf(ref)) ? { url: keyOf(ref) } : { denied: true });
  const fetchImpl = async (url) => store.get(url);
  return {
    kp,
    sealer: makeSealer([kp.publicKey]),
    opener: makeOpener(kp.privateKey),
    bucket, gate, fetchImpl,
  };
}

/**
 * Build a sealed `media` attachment pointer for `circle` (from `makeSealCircle`).
 * @returns {Promise<{att:object, plaintextBytes:Uint8Array}>}
 */
export async function makeSealedImageAttachment(circle, {
  bytesB64 = TINY_PNG_B64, mime = 'image/png', width = 1, height = 1,
  createdBy = 'https://id.example/anne', id,
} = {}) {
  const plaintextBytes = b64ToBytes(bytesB64);
  const up = await uploadBlob({
    bytes:  plaintextBytes,
    bucket: circle.bucket,
    sealer: circle.sealer,
    keyRef: 'urn:circle:test:content-key',
    media:  { mime, width, height, thumbnail: bytesB64 },   // thumbnail sealed too
  });
  const att = {
    type:      'media',
    id:        id || `media-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    createdBy,
    source:    up.manifestLine,           // {type:'blob', ref, enc:{sealed:true,…,thumb}}
    mime, width, height,
  };
  return { att, plaintextBytes };
}
