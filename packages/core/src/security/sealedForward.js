/**
 * sealedForward — pack/open a skill invocation sealed to the final target.
 *
 * Purpose: when Alice wants Bob to forward a skill call to Carol without
 * Bob being able to read the content, Alice seals `{ skill, parts, origin,
 * originSig, originTs }` with `nacl.box` to Carol's pubkey. Bob handles
 * the outer transport-level envelope (still encrypted to him by
 * SecurityLayer) but the inner `sealed` field is opaque to him — the
 * key is Carol's.
 *
 * See Design-v3/blind-forward.md §3-§4.
 *
 * Shape of the plaintext inside the seal:
 *   {
 *     v:         1,
 *     skill:     'receive-message',
 *     parts:     Part[],
 *     origin:    '<pubkey>',
 *     originSig: '<base64url ed25519 sig over Group Z claim>',
 *     originTs:  1716450000000,
 *   }
 *
 * Both helpers are pure (no Agent ref, no side effects). They validate
 * their inputs and fail fast on missing / malformed fields.
 */
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';
import { canonicalize }                              from '../Envelope.js';
import { parseUntrustedJson } from './untrustedJson.js';

/**
 * Version tag (`v`) embedded in the sealed-forward plaintext. `packSealed` writes it;
 * `openSealed` rejects any other version.
 */
export const SEALED_VERSION = 1;

/**
 * Pack a skill invocation as a sealed payload addressed to `recipientPubKey`.
 *
 * @param {object} opts
 * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
 *        Sender's identity — used for nacl.box authentication.
 * @param {string}                            opts.recipientPubKey
 *        Base64url Ed25519 pubkey of the final hop (the target).
 * @param {string}                            opts.skill
 * @param {import('../Parts.js').Part[]}      opts.parts
 * @param {string}                            opts.origin    — usually identity.pubKey
 * @param {string}                            opts.originSig — base64url Ed25519 sig (Group Z)
 * @param {number}                            opts.originTs  — ms timestamp (Group Z)
 * @returns {{ sealed: string, nonce: string }}
 *          `sealed` and `nonce` are both base64url-encoded so they ride in
 *          a DataPart unchanged.
 */
export function packSealed({
  identity,
  recipientPubKey,
  skill,
  parts,
  origin,
  originSig,
  originTs,
  extras,                                       // optional extension fields
} = {}) {
  if (!identity?.box)                            throw new Error('packSealed: identity required');
  if (typeof recipientPubKey !== 'string'
      || !recipientPubKey)                       throw new Error('packSealed: recipientPubKey required');
  if (typeof skill !== 'string' || !skill)       throw new Error('packSealed: skill required');
  if (!Array.isArray(parts))                     throw new Error('packSealed: parts must be an array');
  if (typeof origin !== 'string' || !origin)    throw new Error('packSealed: origin required');
  if (typeof originSig !== 'string' || !originSig) throw new Error('packSealed: originSig required');
  if (typeof originTs !== 'number'
      || !Number.isFinite(originTs))             throw new Error('packSealed: originTs must be a finite number');

  // `extras` carries opt-in fields that ride inside the seal without
  // affecting the canonical field set — used by Group CC3b to smuggle
  // a `tunnelKey` and `aliceTaskId` without polluting the base shape.
  const body = { v: SEALED_VERSION, skill, parts, origin, originSig, originTs };
  if (extras && typeof extras === 'object') {
    for (const k of Object.keys(extras)) {
      if (k in body) continue;          // never overwrite core fields
      body[k] = extras[k];
    }
  }

  const plaintext = new TextEncoder().encode(canonicalize(body));
  const { nonce, ciphertext } = identity.box(plaintext, recipientPubKey);

  return {
    sealed: b64encode(ciphertext),
    nonce:  b64encode(nonce),
  };
}

/**
 * Open a sealed payload.
 *
 * @param {object} opts
 * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
 *        Recipient's identity (final hop / target).
 * @param {string} opts.sealed         — base64url ciphertext from packSealed.
 * @param {string} opts.nonce          — base64url 24-byte nonce.
 * @param {string} opts.senderPubKey   — claimed sender pubkey, carried plaintext
 *                                       alongside the seal. Cross-checked
 *                                       against the inner `origin` field.
 * @returns {{ skill: string, parts: Array, origin: string, originSig: string, originTs: number }}
 * @throws {Error}                     on any validation / crypto failure.
 *                                     Caller emits `security-warning`.
 */
export function openSealed({ identity, sealed, nonce, senderPubKey } = {}) {
  if (!identity?.unbox)                          throw new Error('openSealed: identity required');
  if (typeof sealed !== 'string' || !sealed)    throw new Error('openSealed: sealed required');
  if (typeof nonce  !== 'string' || !nonce)     throw new Error('openSealed: nonce required');
  if (typeof senderPubKey !== 'string' || !senderPubKey)
                                                 throw new Error('openSealed: senderPubKey required');

  let cipherBytes, nonceBytes;
  try {
    cipherBytes = b64decode(sealed);
    nonceBytes  = b64decode(nonce);
  } catch {
    throw new Error('openSealed: malformed base64url input');
  }

  const plaintext = identity.unbox(cipherBytes, nonceBytes, senderPubKey);
  if (!plaintext) {
    throw new Error('openSealed: authentication failed (bad ciphertext / wrong recipient)');
  }

  let body;
  try {
    body = parseUntrustedJson(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('openSealed: sealed plaintext is not valid JSON');
  }

  if (body.v !== SEALED_VERSION) {
    throw new Error(`openSealed: unsupported version ${body.v}`);
  }
  if (typeof body.skill !== 'string' || !body.skill)
                                                 throw new Error('openSealed: body.skill required');
  if (!Array.isArray(body.parts))                throw new Error('openSealed: body.parts must be an array');
  if (typeof body.origin !== 'string' || !body.origin)
                                                 throw new Error('openSealed: body.origin required');
  if (typeof body.originSig !== 'string' || !body.originSig)
                                                 throw new Error('openSealed: body.originSig required');
  if (typeof body.originTs !== 'number' || !Number.isFinite(body.originTs))
                                                 throw new Error('openSealed: body.originTs must be a finite number');

  // Cross-check: the plaintext-origin claim must match the plaintext sender
  // carried in the outer DataPart. A bridge that tries to swap the `sender`
  // field will fail this check and the caller emits security-warning.
  if (body.origin !== senderPubKey) {
    throw new Error(
      `openSealed: sender mismatch (outer sender ${senderPubKey.slice(0, 12)}… ` +
      `≠ inner origin ${body.origin.slice(0, 12)}…)`,
    );
  }

  // Extras: any field in the sealed body beyond the canonical set is
  // returned under `extras` so opt-in extensions (Group CC3b tunnel
  // fields) ride through without requiring new named parameters here.
  const CORE = new Set(['v', 'skill', 'parts', 'origin', 'originSig', 'originTs']);
  const extras = {};
  for (const k of Object.keys(body)) {
    if (!CORE.has(k)) extras[k] = body[k];
  }

  return {
    skill:     body.skill,
    parts:     body.parts,
    origin:    body.origin,
    originSig: body.originSig,
    originTs:  body.originTs,
    extras,
  };
}
