/**
 * The LAN connection's channel: what binds the mDNS hello to the bytes that follow it.
 *
 * Each side puts an ephemeral X25519 public key in its hello frame. The hello's signatures cover both ephemeral keys
 * (see `helloChallengeMessage` / `helloProofMessage`), so a forwarder that swaps one is caught by the signature, and a
 * forwarder that passes them on verbatim ends up between two ends whose shared key it does not hold. Every frame
 * after the hello is boxed under keys derived from that shared secret and the TRANSCRIPT, the hash of everything the
 * hello fixed (both LAN keys, both nonces, both ephemeral keys). The transcript is also what a later step of the
 * connection (the whisper) binds to, so a tag computed on one connection means nothing on another.
 *
 * Frames are boxed with nacl.secretbox under one key per direction, the nonce a counter: TCP delivers in order, so a
 * receiver expects exactly the next counter, and a replayed, dropped or reordered frame fails to open.
 */
import nacl from 'tweetnacl';
import { b64Encode, b64Decode } from './utils/base64.js';

const CHANNEL_DOMAIN = 'onderling-mdns-channel-v1';
const enc = (s) => new TextEncoder().encode(s);

/** A fresh ephemeral X25519 key pair for one handshake. Never stored. */
export function ephemeralKeyPair() {
  const kp = nacl.box.keyPair();
  return { publicKey: b64Encode(kp.publicKey), secretKey: kp.secretKey };
}

/**
 * The transcript: one hash over what the hello fixed, in a fixed order (dialler first).
 * @returns {Uint8Array} 32 bytes
 */
export function helloTranscript({ D, L, nD, nL, eD, eL }) {
  return nacl.hash(enc([CHANNEL_DOMAIN, 'transcript', D, L, nD, nL, eD, eL].join('|'))).subarray(0, 32);
}

const keyFor = (shared, H, direction) => {
  const m = new Uint8Array(shared.length + H.length + direction.length);
  m.set(shared, 0); m.set(H, shared.length); m.set(enc(direction), shared.length + H.length);
  return nacl.hash(m).subarray(0, 32);
};

const counterNonce = (n) => {
  const nonce = new Uint8Array(nacl.secretbox.nonceLength);
  let v = n;
  for (let i = 0; i < 8; i++) { nonce[i] = v % 256; v = Math.floor(v / 256); }
  return nonce;
};

/**
 * Open the channel on one end once the hello is proven.
 * @param {object} p
 * @param {'dialler'|'listener'} p.role
 * @param {Uint8Array} p.mySecret        this side's ephemeral secret
 * @param {string} p.theirPublic         the other side's ephemeral public key (b64)
 * @param {Uint8Array} p.transcript      `helloTranscript(...)`
 * @returns {{transcript: Uint8Array, seal: (bytes: Uint8Array) => string, open: (b64: string) => Uint8Array|null}}
 */
export function openChannel({ role, mySecret, theirPublic, transcript }) {
  const shared = nacl.scalarMult(mySecret, b64Decode(theirPublic));
  // a low-order ephemeral key makes the shared secret all zeros whatever our key is (nacl does not reject it): such a
  // channel would be keyed by the transcript alone, which anyone on the wire can compute
  if (shared.every((b) => b === 0)) throw new Error('mdnsChannel: a low-order ephemeral key (all-zero shared secret)');
  const d2l = keyFor(shared, transcript, 'dialler-to-listener');
  const l2d = keyFor(shared, transcript, 'listener-to-dialler');
  const [sendKey, recvKey] = role === 'dialler' ? [d2l, l2d] : [l2d, d2l];
  let sent = 0;
  let received = 0;
  return {
    transcript,
    seal(bytes) { return b64Encode(nacl.secretbox(bytes, counterNonce(sent++), sendKey)); },
    open(b64) {
      let box;
      try { box = b64Decode(b64); } catch { return null; }
      const plain = nacl.secretbox.open(box, counterNonce(received), recvKey);
      if (plain) received += 1;
      return plain;
    },
  };
}

// ── The whisper ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// After the bound hello each side sends a fixed number of tags: one per secret it holds, the rest random fillers,
// shuffled. A tag is an HMAC of the connection's transcript under the secret, so it matches only on the same secret
// AND the same connection: a stranger sees random values, and a tag from one connection means nothing on the next.

const WHISPER_DOMAIN = 'onderling-lan-whisper-v1';
const HMAC_BLOCK = 128;   // SHA-512's block size

function hmacSha512(key, message) {
  let k = key.length > HMAC_BLOCK ? nacl.hash(key) : key;
  const padded = new Uint8Array(HMAC_BLOCK);
  padded.set(k);
  const inner = new Uint8Array(HMAC_BLOCK + message.length);
  const outer = new Uint8Array(HMAC_BLOCK + 64);
  for (let i = 0; i < HMAC_BLOCK; i++) { inner[i] = padded[i] ^ 0x36; outer[i] = padded[i] ^ 0x5c; }
  inner.set(message, HMAC_BLOCK);
  outer.set(nacl.hash(inner), HMAC_BLOCK);
  k = null;
  return nacl.hash(outer);
}

/**
 * The whisper tag for one secret on one connection.
 * @param {Uint8Array} secret      a secret two parties hold (32 bytes or more)
 * @param {Uint8Array} transcript  the connection's hello transcript
 * @returns {string} 32 bytes, b64
 */
export function whisperTag(secret, transcript) {
  const domain = enc(WHISPER_DOMAIN);
  const m = new Uint8Array(domain.length + transcript.length);
  m.set(domain, 0); m.set(transcript, domain.length);
  return b64Encode(hmacSha512(secret, m).subarray(0, 32));
}

/** A random value shaped like a tag: what fills the slots a device has no secret for. */
export function whisperFiller() { return b64Encode(nacl.randomBytes(32)); }

/**
 * What a matched side signs with the address it claims: the transcript and the address, so the proof is for this
 * connection only and names what it binds.
 * @param {Uint8Array} transcript
 * @param {string} address
 */
export function bindMessage(transcript, address) {
  return `${WHISPER_DOMAIN}|bind|${b64Encode(transcript)}|${address}`;
}
