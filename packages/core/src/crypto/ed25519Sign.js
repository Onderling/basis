/**
 * SIGNING AND KEY DERIVATION behind one port (ledger L619; the signing sibling of `useSignatureEquation`).
 *
 * Every Ed25519 key pair the kernel derives from a seed, and every signature it makes, goes through here. By default
 * tweetnacl answers. A shell may install a faster implementation once (the phone: libsodium's C over JSI, the same
 * module its signature check uses), and the kernel takes it only if it gives tweetnacl's EXACT bytes on fixed seeds and
 * messages: Ed25519 is deterministic, so a key pair and a signature have one right answer, and an implementation that
 * differs would make this device's identity or its statements differ from every other device's. On a refusal tweetnacl
 * stays, and the answer says why.
 */
import nacl from 'tweetnacl';

const TWEETNACL = Object.freeze({
  name: 'tweetnacl',
  keyPairFromSeed: (seed) => nacl.sign.keyPair.fromSeed(seed),
  sign: (msg, secretKey) => nacl.sign.detached(msg, secretKey),
});
let impl = TWEETNACL;

/**
 * The Ed25519 key pair of a 32-byte seed.
 * @param {Uint8Array} seed
 * @returns {{publicKey: Uint8Array, secretKey: Uint8Array}}  secretKey is the 64-byte seed‖public form
 */
export function ed25519KeyPairFromSeed(seed) {
  if (impl === TWEETNACL) return TWEETNACL.keyPairFromSeed(seed);
  try { return impl.keyPairFromSeed(seed); } catch (e) { failedOnce(e); return TWEETNACL.keyPairFromSeed(seed); }
}

/** An installed implementation that throws AFTER its vetting: that call answers by tweetnacl (the same bytes, by the
 *  vetting), and the log says so once per implementation, so a broken native module never breaks a send or a start. */
let saidFailure = null;
function failedOnce(e) {
  if (saidFailure === impl.name) return;
  saidFailure = impl.name;
  console.warn(`[security] signing: ${impl.name} threw (${String(e?.message ?? e)}); tweetnacl answers for such calls`);
}

/**
 * A detached Ed25519 signature.
 * @param {Uint8Array} msg
 * @param {Uint8Array} secretKey  64 bytes, as `ed25519KeyPairFromSeed` gives it
 * @returns {Uint8Array}  64 bytes
 */
export function ed25519Sign(msg, secretKey) {
  if (impl === TWEETNACL) return TWEETNACL.sign(msg, secretKey);
  try { return impl.sign(msg, secretKey); } catch (e) { failedOnce(e); return TWEETNACL.sign(msg, secretKey); }
}

/** Which implementation answers now ('tweetnacl' until a shell installs one). For diagnostics. */
export function signingEquationName() { return impl.name; }

const sameBytes = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((x, i) => x === b[i]);

const fromHex = (h) => Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)));
/**
 * The fixed vectors: three seeds (zeros, a ramp, a pseudo-random one) × three messages (empty, short, 1 KB), with
 * tweetnacl's answers written down as BYTES, so vetting an implementation at a start runs no tweetnacl at all (it cost
 * ~0.4 s on the phone, found in review). A test pins that tweetnacl still gives exactly these.
 */
export const SIGNING_VECTORS = Object.freeze({
  seeds: [new Uint8Array(32), Uint8Array.from({ length: 32 }, (_, i) => i), Uint8Array.from({ length: 32 }, (_, i) => (i * 167 + 13) & 0xff)],
  msgs: [new Uint8Array(0), new TextEncoder().encode('onderling signing self-test'), Uint8Array.from({ length: 1024 }, (_, i) => (i * 31) & 0xff)],
  expected: [
    { pub: '3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29', sigs: [
      '8f895b3cafe2c9506039d0e2a66382568004674fe8d237785092e40d6aaf483e4fc60168705f31f101596138ce21aa357c0d32a064f423dc3ee4aa3abf53f803',
      'c5e1d6b748ba81292170d65dfabeadd878fee23b3b8ce7e07c11ffaa008ce74312a67b5a312ca19cefbe7d97f8e3e7c8133973fb78648dcf6442ee63c87ebd08',
      '02572653db5521032fd0e9cfcc1ca094649e363eb1119121315ccfdc7eedb7d463e11702ddf5bb27f179e8b9abe325da60771c21f7a3a2eb72684b37ce0f290f',
] },
    { pub: '03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8', sigs: [
      '9ca53579530654d5c3df77089ef45eda613e2fedf670e96bedac4639504e5845ef4b95d5793077233dd16817b2532e9c5525872a73a4ad74b759369a9e05c102',
      'c522f2b08f2c89b2a5444525b1732e273a9d69a3bc240e2c524a65f2483e73426bbf6a6ec1aa9a4835c47707a9fc520ecf2e763ddab05ea3c53e2f60722a9e0c',
      'ee3fffa01038888b04a02dfa6d101851f3c4a9d341e1c707efab2f44a43d14759227634e94a4fab35350a1adbf9d311edf6b56856dbda42b0815943e4050ea06',
] },
    { pub: 'a9810cb1ffb85bddf739a6fda014f245f195b4c9363bf02ee4c17e162b2b138f', sigs: [
      '4bb5eab3a165213e30c4c9c04185af1b0d14063159d07b86bb72d079069384e3f0139a621ddc5db3aaf595e3abef83ae584f933bdd61a86d654c2cf255167a0f',
      '6d8527cfe644395670ed3ffae242f210038cbc84930a54b8ff3adf808d375df23cde82b978f18943f3d30848b84fb15e37719392383561c8f3cefebb64483e00',
      '8063211325c57a9f81769af09e46e84b4703f0f98e0a664292ae12add6dd3bdb4d2525e77ee02cf6a1a94b3e0b9b91af59c64a5cf4b581fa8a969fc8285be401',
] },
  ],
});

/**
 * A FASTER IMPLEMENTATION, installed once by the shell. Taken only if it agrees with tweetnacl byte for byte on the
 * fixed vectors; otherwise the current one stays and the answer says why. `null` goes back to tweetnacl.
 * @param {{name: string, keyPairFromSeed: (seed: Uint8Array) => {publicKey: Uint8Array, secretKey: Uint8Array},
 *          sign: (msg: Uint8Array, secretKey: Uint8Array) => Uint8Array}|null} eq
 * @returns {{ok: boolean, name: string, reason?: string}}
 */
export function useSigningEquation(eq) {
  if (eq == null) { impl = TWEETNACL; saidFailure = null; return { ok: true, name: impl.name }; }
  if (typeof eq?.name !== 'string' || !eq.name || typeof eq.keyPairFromSeed !== 'function' || typeof eq.sign !== 'function') {
    return { ok: false, name: impl.name, reason: 'not-an-implementation' };
  }
  const { seeds, msgs, expected } = SIGNING_VECTORS;
  try {
    for (let i = 0; i < seeds.length; i += 1) {
      const pub = fromHex(expected[i].pub);
      const secretKey = new Uint8Array(64); secretKey.set(seeds[i]); secretKey.set(pub, 32);
      const kp = eq.keyPairFromSeed(Uint8Array.from(seeds[i]));
      if (!sameBytes(kp?.publicKey, pub) || !sameBytes(kp?.secretKey, secretKey)) return { ok: false, name: impl.name, reason: 'key-pair-disagrees' };
      for (let j = 0; j < msgs.length; j += 1) {
        if (!sameBytes(eq.sign(Uint8Array.from(msgs[j]), Uint8Array.from(secretKey)), fromHex(expected[i].sigs[j]))) return { ok: false, name: impl.name, reason: 'signature-disagrees' };
      }
    }
  } catch (e) {
    return { ok: false, name: impl.name, reason: `failed: ${String(e?.message ?? e)}` };
  }
  impl = Object.freeze({ name: eq.name, keyPairFromSeed: eq.keyPairFromSeed, sign: eq.sign });
  saidFailure = null;
  return { ok: true, name: impl.name };
}
