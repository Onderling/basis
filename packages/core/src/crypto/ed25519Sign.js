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
export function ed25519KeyPairFromSeed(seed) { return impl.keyPairFromSeed(seed); }

/**
 * A detached Ed25519 signature.
 * @param {Uint8Array} msg
 * @param {Uint8Array} secretKey  64 bytes, as `ed25519KeyPairFromSeed` gives it
 * @returns {Uint8Array}  64 bytes
 */
export function ed25519Sign(msg, secretKey) { return impl.sign(msg, secretKey); }

/** Which implementation answers now ('tweetnacl' until a shell installs one). For diagnostics. */
export function signingEquationName() { return impl.name; }

const sameBytes = (a, b) => a instanceof Uint8Array && b instanceof Uint8Array && a.length === b.length && a.every((x, i) => x === b[i]);

/** The fixed vectors: three seeds (zeros, a ramp, a pseudo-random one) × three messages (empty, short, 1 KB). */
function vectors() {
  const seeds = [new Uint8Array(32), Uint8Array.from({ length: 32 }, (_, i) => i), Uint8Array.from({ length: 32 }, (_, i) => (i * 167 + 13) & 0xff)];
  const msgs = [new Uint8Array(0), new TextEncoder().encode('onderling signing self-test'), Uint8Array.from({ length: 1024 }, (_, i) => (i * 31) & 0xff)];
  return { seeds, msgs };
}

/**
 * A FASTER IMPLEMENTATION, installed once by the shell. Taken only if it agrees with tweetnacl byte for byte on the
 * fixed vectors; otherwise the current one stays and the answer says why. `null` goes back to tweetnacl.
 * @param {{name: string, keyPairFromSeed: (seed: Uint8Array) => {publicKey: Uint8Array, secretKey: Uint8Array},
 *          sign: (msg: Uint8Array, secretKey: Uint8Array) => Uint8Array}|null} eq
 * @returns {{ok: boolean, name: string, reason?: string}}
 */
export function useSigningEquation(eq) {
  if (eq == null) { impl = TWEETNACL; return { ok: true, name: impl.name }; }
  if (typeof eq?.name !== 'string' || !eq.name || typeof eq.keyPairFromSeed !== 'function' || typeof eq.sign !== 'function') {
    return { ok: false, name: impl.name, reason: 'not-an-implementation' };
  }
  const { seeds, msgs } = vectors();
  try {
    for (const seed of seeds) {
      const ref = TWEETNACL.keyPairFromSeed(seed);
      const kp = eq.keyPairFromSeed(Uint8Array.from(seed));
      if (!sameBytes(kp?.publicKey, ref.publicKey) || !sameBytes(kp?.secretKey, ref.secretKey)) return { ok: false, name: impl.name, reason: 'key-pair-disagrees' };
      for (const msg of msgs) {
        if (!sameBytes(eq.sign(Uint8Array.from(msg), Uint8Array.from(ref.secretKey)), TWEETNACL.sign(msg, ref.secretKey))) return { ok: false, name: impl.name, reason: 'signature-disagrees' };
      }
    }
  } catch (e) {
    return { ok: false, name: impl.name, reason: `failed: ${String(e?.message ?? e)}` };
  }
  impl = Object.freeze({ name: eq.name, keyPairFromSeed: eq.keyPairFromSeed, sign: eq.sign });
  return { ok: true, name: impl.name };
}
