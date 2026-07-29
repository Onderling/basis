/**
 * How big an envelope may be on the peer wire — one number, shared by every transport and by the relay.
 *
 * ── Why 256 KB ───────────────────────────────────────────────────────────────────────────────────────
 * The peer wire is a CONTROL plane, not a data plane. Files and media do not travel on it: they go through
 * the blob gateway over HTTP, and the wire carries only the manifest line as a reference (`pointer`,
 * `source.ref` — see `mediaForKringWire`). So the largest legitimate envelopes are small:
 *
 *   a chat message      500 characters (CHAT_MAX_TEXT)
 *   a room card         label 40 + line 140 + 5 tags
 *   an invite           1–2 KB of base64 JSON
 *   a persona release   a few KB
 *   a sealed message    ~1 KB
 *
 * 256 KB is roughly a hundred times the largest of those, and there is no known legitimate sender that
 * comes near it. It is also ~400× smaller than what was actually enforced before this existed: the relay
 * was constructed as `new WebSocketServer({ server })` with no `maxPayload`, so the `ws` default applied.
 * Walked 2026-07-29 (S6/J-A14): a **64 MB envelope was forwarded intact** through a real relay, and at
 * 120 MB the library killed the SENDER's socket with code 1009 and no typed error — a receiver could not
 * tell a refusal from a peer going offline.
 *
 * ── Why this is safe where the rate limiter was not ──────────────────────────────────────────────────
 * The per-envelope rate limiter stays off because catch-up replay is a legitimate burst of up to 1000
 * items, and dropping those is message loss. A SIZE cap has no such problem: catch-up is many small
 * envelopes, never one big one. Nothing legitimate is caught.
 *
 * ── The two rules that matter more than the number ───────────────────────────────────────────────────
 *   • **Refuse, never truncate.** Silently shortening a payload mutates content without telling anyone —
 *     the receiver reads a mutilated version believing it whole. A refusal is honest; a truncation is not.
 *   • **Say so.** A closed socket is indistinguishable from a peer going offline. Both directions raise a
 *     typed error instead.
 */

/** The default ceiling for one envelope on the peer wire, in bytes. */
export const MAX_ENVELOPE_BYTES = 256 * 1024;

/** Raised when an envelope is refused for size — typed so a caller can tell it from a disconnect. */
export class EnvelopeTooLargeError extends Error {
  constructor(bytes, limit = MAX_ENVELOPE_BYTES) {
    super(`envelope is ${bytes} bytes, over the ${limit}-byte wire limit`);
    this.name   = 'EnvelopeTooLargeError';
    this.reason = 'envelope-too-large';
    this.bytes  = bytes;
    this.limit  = limit;
  }
}

/**
 * Measure an envelope the way the wire will carry it, and report whether it is over.
 *
 * Returns `null` when it is fine, so the call site reads as a guard. A value that cannot be measured
 * (circular, unserialisable) is treated as fine rather than refused: this is a size limit, not a
 * validator, and rejecting something we merely failed to measure would break sends for the wrong reason.
 *
 * @param {*} envelope
 * @param {number} [limit]
 * @returns {{bytes: number, limit: number}|null}
 */
export function envelopeExceedsLimit(envelope, limit = MAX_ENVELOPE_BYTES) {
  const max = Number.isFinite(limit) && limit > 0 ? limit : MAX_ENVELOPE_BYTES;
  const bytes = envelopeByteLength(envelope);
  if (bytes === null || bytes <= max) return null;
  return { bytes, limit: max };
}

/** Serialised byte length of an envelope, or null when it cannot be measured. */
export function envelopeByteLength(envelope) {
  if (typeof envelope === 'string') return byteLength(envelope);
  try {
    const json = JSON.stringify(envelope);
    return typeof json === 'string' ? byteLength(json) : null;
  } catch {
    return null;      // circular or unserialisable — see the note above
  }
}

function byteLength(str) {
  // TextEncoder is present on every runtime this ships to (browser, Hermes, node); the fallback is only
  // for an exotic host, and over-counting there is the safe direction.
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(str).length;
  return str.length * 2;
}
