/**
 * basis v2 — the app-layer bridge that turns THIS device's network identity into the per-text OPENER
 * for received "shared with me" copies (SILENT out-of-circle delivery). ONE shared source, so web≡mobile get
 * the same opener by construction (invariants #2/#3): both shells call `openerForIdentity(identity)`.
 *
 * LAYERING (invariant #5): the X25519 sealing-key DERIVATION + the envelope `open` live in the
 * `@onderling/pod-client` ADAPTER, which the kernel (`@onderling/core` / `AgentIdentity`) must not depend UP on. So
 * the kernel exposes `AgentIdentity.sharedCopyOpener(deriveOpener)` — a hole the app fills with the adapter.
 * `deviceSharedCopyOpener` IS that injected builder: it derives the sealing keypair from the network secret and
 * returns `makeOpener(privateKey)`. The network secret is consumed HERE and never leaves — only the opener
 * CLOSURE escapes (the kernel hands the secret to this builder internally and returns only its result).
 *
 * The sender sealed the copy to `sealingPublicKeyFromNetworkKey(myPublishedNetworkKey)`; this opener holds the
 * matching private key from `sealingKeyPairFromNetworkKey(myNetworkSecret)`, so `open` (recipient mode) decrypts
 * it. A copy sealed to SOMEONE ELSE's key is a foreign envelope → `open` throws (deny-safe, never ciphertext).
 */
import { sealingKeyPairFromNetworkKey, makeOpener, sealingPublicKeyFromNetworkKey, recipientStrategy } from '@onderling/pod-client';

/**
 * The injected `deriveOpener` for `AgentIdentity.sharedCopyOpener`: `(networkSecretB64) => (text) => plaintext`.
 * Derives the X25519 sealing keypair from the Ed25519 network secret and returns the per-text `open` closure
 * bound to its PRIVATE key. The secret / private key never escape this closure.
 *
 * @param {string} networkSecretB64  b64url of the 32-byte seed OR 64-byte Ed25519 secret key
 * @returns {(text:string)=>string}  opens `fp1:` sealed text; passes plaintext through; throws on a foreign envelope
 */
export function deviceSharedCopyOpener(networkSecretB64) {
  const { privateKey } = sealingKeyPairFromNetworkKey(networkSecretB64);
  return makeOpener(privateKey);
}

/**
 * Build THIS device's shared-copy opener from its agent identity, or `null` when unavailable (no identity /
 * pre-`sharedCopyOpener` core) — a null opener makes a row tap a deny-safe no-op. The identity keeps its network
 * secret ENCAPSULATED: it hands the secret to `deviceSharedCopyOpener` internally and returns only the closure.
 *
 * @param {{sharedCopyOpener?:Function}|null} identity  the core AgentIdentity (e.g. `agent.sa.agent.identity`)
 * @returns {((text:string)=>string|Promise<string>)|null}
 */
export function openerForIdentity(identity) {
  if (!identity || typeof identity.sharedCopyOpener !== 'function') return null;
  try { return identity.sharedCopyOpener(deviceSharedCopyOpener); }
  catch { return null; }
}

/**
 * Build THIS agent's SEAL-TO-SELF strategy for the parameter register's settings store (#36 pod-sync), or
 * `null` when unavailable (→ settings stay LOCAL). A `{ seal, open }` where:
 *   • `seal` wraps to the agent's OWN sealing PUBLIC key — `sealingPublicKeyFromNetworkKey(identity.pubKey)`,
 *     derived from the PUBLIC network key, so no secret is touched to seal;
 *   • `open` is the encapsulated opener (`openerForIdentity`) — the private key never escapes the identity.
 *
 * Because both keys derive from the agent's network identity (itself `deriveAgentSeed`'d from the owner root,
 * reproducible from the recovery phrase alone), EVERY device of the same user builds the SAME strategy — so
 * agent-scoped settings sealed on one device open on another. Only this user's key opens them (a foreign
 * envelope throws → deny-safe). ONE shared source so web ≡ mobile get it by construction (invariants #2/#5).
 *
 * @param {{pubKey?:string, sharedCopyOpener?:Function}|null} identity  the core AgentIdentity (`chatAgent.identity`)
 * @returns {{seal:(t:string)=>string, open:(t:string)=>string}|null}
 */
export function settingsSealStrategyForIdentity(identity) {
  if (!identity || typeof identity.pubKey !== 'string') return null;
  const open = openerForIdentity(identity);
  if (typeof open !== 'function') return null;
  let sealPub;
  try { sealPub = sealingPublicKeyFromNetworkKey(identity.pubKey); }
  catch { return null; }
  const { seal } = recipientStrategy({ recipients: [sealPub] });
  return { seal, open };
}

/**
 * The seal-to-self strategy widened by NAMED extra recipients — the writer-side grant: each
 * envelope's content key is wrapped to this identity AND to every listed network key's derived
 * sealing key, so the holders of those keys open what this identity writes, without ever
 * receiving this identity's own key material. Used for the remote surface's per-view mirror
 * lanes ("the addressed edition"): the acting device writes, the paired view opens its own lane.
 * Revocation is the writer's act — stop wrapping to a recipient and everything new is dark to
 * them at the seal.
 *
 * @param {{pubKey?:string, sharedCopyOpener?:Function}|null} identity  this device's AgentIdentity (the writer)
 * @param {string[]} recipientNetworkKeys  the granted holders' network pubkeys (e.g. a paired view's)
 * @returns {{seal:(t:string)=>string, open:(t:string)=>string}|null}
 */
export function sealStrategyForRecipients(identity, recipientNetworkKeys = []) {
  if (!identity || typeof identity.pubKey !== 'string') return null;
  const open = openerForIdentity(identity);
  if (typeof open !== 'function') return null;
  let recipients;
  try {
    recipients = [identity.pubKey, ...recipientNetworkKeys].map((k) => sealingPublicKeyFromNetworkKey(k));
  } catch { return null; }
  const { seal } = recipientStrategy({ recipients });
  return { seal, open };
}
