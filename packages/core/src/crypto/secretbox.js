/**
 * SECRETBOX (XSalsa20-Poly1305) behind one port (ledger L619; the sibling of the signing port, `ed25519Sign.js`).
 *
 * Every symmetric seal and open the platform makes with a given key and nonce goes through here: the content-at-rest
 * envelopes of every local store (`sealWithGroupKey` / `openWithGroupKey`), the tunnel seal, the vault-free backups,
 * the enrol offer. By default tweetnacl answers. A shell may install a faster implementation once (the phone:
 * libsodium's C over JSI, the module its signing already uses), and the kernel takes it only if it gives tweetnacl's
 * EXACT bytes on fixed keys, nonces and messages, opens them back, and refuses a flipped byte and a wrong key: the
 * format is NaCl's (the 16-byte authenticator, then the ciphertext), so anything sealed by one implementation opens
 * with the other, both ways. On a refusal tweetnacl stays, and the answer says why.
 *
 * The port never chooses a nonce or keeps a key: both are the caller's, passed in by value at every call, exactly as
 * before. An open that does not authenticate answers `null` to every caller, whichever implementation ran.
 */
import nacl from 'tweetnacl';

const TWEETNACL = Object.freeze({
  name: 'tweetnacl',
  seal: (msg, nonce, key) => nacl.secretbox(msg, nonce, key),
  open: (box, nonce, key) => nacl.secretbox.open(box, nonce, key),
});
let impl = TWEETNACL;

/** An installed implementation that throws or disagrees AFTER its vetting: that call answers by tweetnacl (the same
 *  bytes, by the vetting), and the log says so once per implementation, so a broken native module never breaks a read. */
let saidFailure = null;
function failedOnce(what) {
  if (saidFailure === impl.name) return;
  saidFailure = impl.name;
  console.warn(`[security] secretbox: ${impl.name} ${what}; tweetnacl answers for such calls`);
}

/**
 * Seal `msg` under `key` with `nonce` (NaCl secretbox: authenticator ‖ ciphertext).
 * @param {Uint8Array} msg
 * @param {Uint8Array} nonce  24 bytes, chosen by the caller
 * @param {Uint8Array} key    32 bytes
 * @returns {Uint8Array}
 */
export function secretboxSeal(msg, nonce, key) {
  if (impl === TWEETNACL) return TWEETNACL.seal(msg, nonce, key);
  try {
    const out = impl.seal(msg, nonce, key);
    if (out instanceof Uint8Array && out.length === msg.length + nacl.secretbox.overheadLength) return out;
    failedOnce('gave a box of the wrong size');
  } catch (e) { failedOnce(`threw (${String(e?.message ?? e)})`); }
  return TWEETNACL.seal(msg, nonce, key);
}

/**
 * Open a secretbox; `null` when it does not authenticate under `key` and `nonce` (whichever implementation ran).
 * An installed implementation that refuses (by `null` or by throwing, as libsodium does) is asked of tweetnacl again:
 * a box that really does not open stays `null`, and one tweetnacl opens is the installed implementation failing — said
 * once. So a failed open costs one tweetnacl open more; an opened one costs nothing more.
 * @param {Uint8Array} box
 * @param {Uint8Array} nonce
 * @param {Uint8Array} key
 * @returns {Uint8Array|null}
 */
export function secretboxOpen(box, nonce, key) {
  if (impl === TWEETNACL) return TWEETNACL.open(box, nonce, key);
  let out = null;
  try { out = impl.open(box, nonce, key); } catch { out = null; }
  if (out instanceof Uint8Array) return out;
  const reference = TWEETNACL.open(box, nonce, key);
  if (reference) failedOnce('refused a box tweetnacl opens');
  return reference;
}

/** Which implementation answers now ('tweetnacl' until a shell installs one). For diagnostics. */
export function secretboxName() { return impl.name; }

const sameBytes = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((x, i) => x === b[i]);
const fromHex = (h) => Uint8Array.from((h.match(/../g) ?? []).map((b) => parseInt(b, 16)));

/**
 * The fixed vectors: one key and nonce, three messages (empty, short, 300 bytes: past a Salsa20 block and a Poly1305
 * chunk), with tweetnacl's boxes written down as BYTES, so vetting an implementation at a start runs no tweetnacl at
 * all. A test pins that tweetnacl still gives exactly these.
 */
export const SECRETBOX_VECTORS = Object.freeze({
  key: Uint8Array.from({ length: 32 }, (_, i) => (i * 29 + 7) & 0xff),
  nonce: Uint8Array.from({ length: 24 }, (_, i) => (i * 7 + 1) & 0xff),
  msgs: [new Uint8Array(0), new TextEncoder().encode('onderling secretbox self-test'), Uint8Array.from({ length: 300 }, (_, i) => (i * 31 + 5) & 0xff)],
  expected: [
    'f98122d28b0039b595678b97b2675479',
    'd87a9b21df5fa8a62cbcd1a4bc005a7a210ea49de6087ccba83fd51dfe392763bcb699811fc238622dcfb3368e',
    '54d3f5f20638b41b08778d3cf06c851c4b44839a15c4aa7b32039d22e4d3f5c12bcdd2f31d37fbcaedb7fd0f930e837e40ebe8d7fd3fb5e66d3c6d9b2cc406e330a5d6ded07696a7be21070f5c7bf1515e579a12e5cde100b90c9d0b44445dd70bd75b2aed91156797ba3034527bea0e8be10f999593fb0399aae8e5e2debaff8d719056cbe9794ad53ac060cdafb6d59c4d2aac2d6f0419fc225d0a08999184e9135e676732ac8d107afedfd26dd23760fa6d711a4b9b00911b0721b008259961862a19423d0d73f5a7f9693811079fce3c3f056fb13b97e5ac21904df45c5e1551d9e7462595bfc2adc9cfe379dd24ba3c7a8af9271c0bf15f3619f4ba5e2feb294f3482b7037baec5de9eab63b464fda0efd831343af87d6f0624e2c499eb7e15620cf35e65c30f7c039ea3e07dc128467983907f8e344f720d69',
  ],
});

/**
 * THE LARGE MESSAGE: 768 KiB built from a byte formula (no constant that size in the source), because the port's main
 * work on a phone is opening and sealing device-log segments (300-620 kB sealed) and every store row. An implementation
 * right for small inputs and wrong for large ones (a buffer or length limit in a native bridge) would pass the small
 * vectors and then seal a segment nothing can open. tweetnacl's answer is pinned in parts: the length, the 16-byte
 * authenticator (it covers the whole ciphertext) and the first and last 64 ciphertext bytes; a test pins them.
 */
export const SECRETBOX_LARGE = Object.freeze({
  length: 768 * 1024,
  byteAt: (i) => (i * 131 + (i >>> 8)) & 0xff,
  boxLength: 786448,
  tag: '4f927c628c787ab6bddc351bb25e4c89',
  head: '4ee3c67198eb0730d784b8d9b9ec68baee6ad718501816c148709894ae517e65c50cad7cf05058adc83b08a0f1bb1b58754253f51d19bb2cdbe6a214a124ccca',
  tail: '9971912776976ea6008184ad3c0c6ce119d350ebc3bacf3211551f5e29bb29c25bac015e1ebaf00b57dfad9db76588f40826bdf7125839805504e86be2228b6b',
});
/** The large message itself, built fresh (the vetting and the pin test build the same bytes). */
export function largeSecretboxMessage() {
  const m = new Uint8Array(SECRETBOX_LARGE.length);
  for (let i = 0; i < m.length; i += 1) m[i] = SECRETBOX_LARGE.byteAt(i);
  return m;
}
const hexOf = (u) => { let s = ''; for (let i = 0; i < u.length; i += 1) s += (u[i] < 16 ? '0' : '') + u[i].toString(16); return s; };

/** Does the candidate seal the large message to tweetnacl's box (pinned in parts), open it back and refuse a flipped
 *  middle byte? */
function largeAgrees(eq, nonce, key) {
  const msg = largeSecretboxMessage();
  const box = eq.seal(msg, Uint8Array.from(nonce), Uint8Array.from(key));
  const L = SECRETBOX_LARGE;
  if (!(box instanceof Uint8Array) || box.length !== L.boxLength) return false;
  if (hexOf(box.subarray(0, 16)) !== L.tag || hexOf(box.subarray(16, 80)) !== L.head || hexOf(box.subarray(box.length - 64)) !== L.tail) return false;
  let back = null;
  // (the large box is handed over as it came, not copied: 768 KiB less to move on a phone; the refusal below works on a copy)
  try { back = eq.open(box, Uint8Array.from(nonce), Uint8Array.from(key)); } catch { back = null; }
  if (!(back instanceof Uint8Array) || back.length !== msg.length) return false;
  for (let i = 0; i < msg.length; i += 1) if (back[i] !== msg[i]) return false;
  const flipped = Uint8Array.from(box); flipped[flipped.length >>> 1] ^= 0x01;
  return refuses(eq, flipped, nonce, key);
}

/** Does `open` refuse? `null`, a throw, or anything not bytes all count as a refusal. */
function refuses(eq, box, nonce, key) {
  try { return !(eq.open(Uint8Array.from(box), Uint8Array.from(nonce), Uint8Array.from(key)) instanceof Uint8Array); }
  catch { return true; }
}

/**
 * A FASTER IMPLEMENTATION, installed once by the shell. Taken only if, on the fixed vectors, it seals to tweetnacl's
 * exact bytes, opens each back to its message, and refuses a box with one ciphertext byte flipped, one with the
 * authenticator flipped, and the right box under a wrong key — and does the same for one LARGE message (768 KiB,
 * `SECRETBOX_LARGE`); otherwise the current one stays and the answer says why.
 * `null` goes back to tweetnacl.
 * @param {{name: string, seal: (msg: Uint8Array, nonce: Uint8Array, key: Uint8Array) => Uint8Array,
 *          open: (box: Uint8Array, nonce: Uint8Array, key: Uint8Array) => (Uint8Array|null)}|null} eq
 * @returns {{ok: boolean, name: string, reason?: string}}
 */
export function useSecretbox(eq) {
  if (eq == null) { impl = TWEETNACL; saidFailure = null; return { ok: true, name: impl.name }; }
  if (typeof eq?.name !== 'string' || !eq.name || typeof eq.seal !== 'function' || typeof eq.open !== 'function') {
    return { ok: false, name: impl.name, reason: 'not-an-implementation' };
  }
  const { key, nonce, msgs, expected } = SECRETBOX_VECTORS;
  const wrongKey = Uint8Array.from(key, (b) => b ^ 0x5a);
  try {
    for (let i = 0; i < msgs.length; i += 1) {
      const want = fromHex(expected[i]);
      if (!sameBytes(eq.seal(Uint8Array.from(msgs[i]), Uint8Array.from(nonce), Uint8Array.from(key)), want)) return { ok: false, name: impl.name, reason: 'seal-disagrees' };
      let back = null;
      try { back = eq.open(Uint8Array.from(want), Uint8Array.from(nonce), Uint8Array.from(key)); } catch { back = null; }
      if (!sameBytes(back instanceof Uint8Array ? back : null, msgs[i])) return { ok: false, name: impl.name, reason: 'open-disagrees' };
      const flippedBody = Uint8Array.from(want); flippedBody[flippedBody.length - 1] ^= 0x01;
      const flippedTag = Uint8Array.from(want); flippedTag[0] ^= 0x80;
      if (!refuses(eq, flippedBody, nonce, key) || !refuses(eq, flippedTag, nonce, key) || !refuses(eq, want, nonce, wrongKey)) {
        return { ok: false, name: impl.name, reason: 'opens-a-forgery' };
      }
    }
    if (!largeAgrees(eq, nonce, key)) return { ok: false, name: impl.name, reason: 'large-message-disagrees' };
  } catch (e) {
    return { ok: false, name: impl.name, reason: `failed: ${String(e?.message ?? e)}` };
  }
  impl = Object.freeze({ name: eq.name, seal: eq.seal, open: eq.open });
  saidFailure = null;
  return { ok: true, name: impl.name };
}
