/**
 * Sender binding for NKN — the nkn-specific half of the shared rule.
 *
 * The rule itself (`senderVerdict`) is transport-agnostic and lives in the kernel
 * (`@onderling/core` → `src/transport/senderBinding.js`). Exactly one thing is per-transport: where the
 * authenticated sender comes from. That is this file, and it is deliberately OUTSIDE the kernel
 * (invariant 5) because everything in it is nkn trivia — the sub-client prefix, the encrypted-only
 * guarantee — that the kernel must not know about.
 *
 * Both NKN adapters use it: `@onderling/transports/src/NknTransport.js` (web/Node) and
 * `@onderling/react-native/src/transport/NknTransport.js` (mobile). One rule, one normalisation, two
 * adapters — web ≡ mobile by construction rather than by copy (invariants 2 + 3).
 *
 * ── Are `msg.src` and `envelope._from` even comparable? YES, on this transport. ─────────────────
 * `_from` is stamped by the base `Transport` from `this.address` (`mkEnvelope(P.OW, this.#address, …)`),
 * and both NKN adapters set that to `client.addr` — the nkn native address — on connect. So over nkn,
 * `_from` IS an nkn address, in nkn's namespace, and comparing it to `src` is a real comparison rather
 * than a type error dressed as a check.
 *
 * The divergence noted elsewhere in the codebase (`secure-agent/src/createSecureAgent.js` ~:944) is a
 * DIFFERENT pair: the nkn wire address vs. the agent's canonical chat pubKey. Those two are not
 * comparable, and nothing here pretends they are — we never compare `src` to a pubKey.
 *
 * ── Why the caller REJECTS, rather than annotating or passing provenance alongside ──────────────
 * Both alternatives were checked against the envelope format and neither survives it:
 *   • ANNOTATE / STRIP: `SecurityLayer.decryptAndVerify` verifies the signature over
 *     `canonicalize({...env, _sig: null})` — every field except `_sig`. Adding `_transportSender`, or
 *     removing `_from`, changes the canonical bytes, so every legitimate envelope would then fail
 *     BAD_SIG. Annotation is not available at this layer without a wire-format change.
 *   • PASS ALONGSIDE: `_receive(rawEnvelope)` is the port contract every adapter implements; widening it
 *     to carry per-transport provenance is a change to the port and to whoever would compare, neither of
 *     which exists yet.
 * Dropping needs no format change and is the only one of the three that is honest today.
 *
 * This is a SECOND line of defence, not the wall: it covers the transports that authenticate, it trusts
 * nkn's own authentication, and it binds a sender to a connection rather than to a key. The primary
 * defence is the circle layer (sealing + roster-authorised senders) — a separate build.
 */
import { senderVerdict } from '@onderling/core';

// nkn's MultiClient runs N sub-clients, addressed `__0__.<identifier>.<pubkeyhex>`. A MultiClient
// RECEIVER already strips that prefix before it hands us `src` (nkn-sdk `multiclient.js`:
// `src = util.removeIdentifier(src).addr`), but a single `Client` receiver does not — it passes
// `msg.getSrc()` through raw. Both adapters fall back to `Client` (the web one does so automatically on
// a MultiClient timeout), so a sub-client prefix CAN reach us, and comparing it un-normalised against a
// base address would reject perfectly good traffic. Same regex nkn uses (`multiclient/consts.js`).
const NKN_SUBCLIENT_PREFIX = /^__\d+__$/;

/** Drop a `__N__.` multiclient sub-client prefix so an address is comparable with `client.addr`. */
export function stripSubClientPrefix(addr) {
  const i = addr.indexOf('.');
  if (i < 0) return addr;
  return NKN_SUBCLIENT_PREFIX.test(addr.slice(0, i)) ? addr.slice(i + 1) : addr;
}

/**
 * The `authenticatedSender` port for nkn: who does nkn itself say sent this frame?
 *
 * ── The unencrypted case, and why the frame is refused rather than checked ──────────────────────
 * nkn authenticates `src` only for END-TO-END-ENCRYPTED frames: the payload is opened with a shared key
 * derived from the sender ADDRESS's public key (nkn-sdk `client.js` `_decryptPayload` →
 * `message.addrToPubkey(srcAddr)`), so a frame that decrypts could only have come from the holder of that
 * address's key. For `encrypted: false` frames, `src` is just a field on the inbound protobuf, relayed by
 * a node we do not trust, and checking it would be exactly the vacuous check this work exists to remove —
 * an attacker who can set `src` sets it to match `_from` and sails through. So an unencrypted frame is
 * refused. Neither adapter ever SENDS one (`_put` uses nkn's default `encrypt: true`, `consts.js`), so
 * this costs no legitimate traffic and closes the obvious way around the check.
 *
 * A frame with NO `src` at all cannot be checked either way. nkn always supplies one; a frame without it
 * is a test double or a library we do not know, so `null` is returned — the shared rule passes it through
 * UNCHECKED and announces the absence, because "no src" is a hole, not a pass.
 *
 * @param   {{src?: string, isEncrypted?: boolean}} msg — the raw nkn frame
 * @returns {string|null|{refuse: string}}
 */
export function nknAuthenticatedSender(msg) {
  // Explicitly `=== false`: nkn always sets the flag, so `undefined` means "a client that does not report
  // it" (a mock), not "a peer that turned encryption off". The attacker-reachable value is `false`.
  if (msg?.isEncrypted === false) return { refuse: 'unencrypted-sender-unauthenticated' };

  return typeof msg?.src === 'string' && msg.src ? stripSubClientPrefix(msg.src) : null;
}

/**
 * Is this inbound nkn frame allowed to speak as the sender its envelope claims?
 * The shared rule, asked with nkn's port.
 *
 * @param   {{src?: string, isEncrypted?: boolean}} msg       — the raw nkn frame
 * @param   {object}                                envelope  — the parsed envelope
 * @returns {{ok: boolean, reason: string, claimed: string|null, authenticated: string|null}}
 */
export function nknSenderVerdict(msg, envelope) {
  return senderVerdict(msg, envelope, nknAuthenticatedSender);
}
