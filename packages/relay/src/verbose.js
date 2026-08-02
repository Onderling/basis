/**
 * Verbose-mode logging for the relay (Q-Smoke.4, locked 2026-04-29).
 *
 * Off by default.  Enabled by setting `RELAY_VERBOSE=1` in the relay's
 * environment.  When enabled, every forwarded message gets a structured
 * `[verbose]` log line that includes:
 *   - sender address (short form)
 *   - recipient address (short form)
 *   - message size in bytes
 *   - protocol field (`_p`) when present
 *   - message type (e.g. `send`, `multi-deliver`)
 *
 * Additionally, for the S9 (sealed-forward) smoke check, the verbose
 * logger inspects the forwarded body and emits a `[verbose] potential
 * plaintext leak: ...` line when the body is **not the shape a sealed
 * envelope has** — see `findPlaintextLeak` for the signal and why it is a
 * contract rather than a guess.
 *
 * Rewritten 2026-07-31.  The previous canary guessed: any run of ≥40 readable
 * characters with an English-looking vowel ratio was called plaintext.  A
 * base64 Ed25519 address is 43 readable characters, so it fired on ordinary
 * sealed traffic depending on the key material — and the line it emitted
 * carried an 80-character excerpt, printing the address in full and defeating
 * the `shortId` truncation every other log line uses.  Tuning the ratio only
 * moves that line: an address is not distinguishable from prose by entropy.
 * So the mechanism changed rather than its threshold, and the excerpt now goes
 * through `shortId` like everything else.
 *
 * No new deps.  Plain `console.log`.  When the env var is unset, all of
 * these helpers are no-ops.
 */
import { P } from '@onderling/core';

// Cached at module-load.  Tests that need to flip the flag mid-process
// can set it directly via setVerboseEnabled() (private; not exported
// from the public package surface).
let _enabled = (typeof process !== 'undefined' && process?.env?.RELAY_VERBOSE === '1');

/** Test hook — flips the runtime flag without touching process.env. */
export function setVerboseEnabled(v) { _enabled = !!v; }

/** Read-only accessor for tests + callers that want to skip building log strings. */
export function isVerboseEnabled() { return _enabled; }

/** Short pubkey form, matches the existing `shortId()` style in server.js. */
export function shortId(id) {
  if (!id) return '?';
  const s = String(id);
  return s.length > 12 ? s.slice(0, 12) + '…' : s;
}

/**
 * Log a single relay hop.  No-op unless RELAY_VERBOSE=1.
 *
 * @param {object} args
 * @param {string} args.kind    Wire frame type (e.g. 'send', 'multi-deliver')
 * @param {string} args.from    Sender pubkey (full)
 * @param {string} args.to      Recipient pubkey (full)
 * @param {object} [args.envelope]  The forwarded envelope (used for size + `_p` + leak scan)
 * @param {object} [args.payload]   For multi-deliver, the payload (scanned for leaks)
 */
export function logHop({ kind, from, to, envelope, payload }) {
  if (!_enabled) return;

  const body = envelope ?? payload ?? null;
  const size = bodySize(body);
  const p    = envelope?._p ?? '?';

  console.log(
    `[verbose] ${shortId(from)} → ${shortId(to)} ` +
    `kind=${kind} bytes=${size} _p=${p}`
  );

  if (body) {
    const leak = findPlaintextLeak(body);
    if (leak) {
      // The excerpt goes through `shortId` — the SAME truncation every other relay log line uses.
      // A canary that prints 80 characters of what it found is a canary that writes an address, a
      // name or a sentence into an operator's stdout; the marker says what is wrong and the excerpt
      // is only there to make the shape recognisable.
      console.log(
        `[verbose] potential plaintext leak: ` +
        `from=${shortId(from)} to=${shortId(to)} kind=${kind} marker=${leak.marker} ` +
        `excerpt=${JSON.stringify(shortId(leak.excerpt))}`
      );
    }
  }
}

/**
 * The envelope fields the relay is MEANT to read in cleartext — the routing header.
 * `SecurityLayer.encrypt` replaces only `payload`; these stay plaintext at the top level by
 * design, which is why the broker can log `_p` and route on `_to`.
 *
 * The privacy harness keeps the authoritative copy of this list
 * (`test/security/whatTheRelayMayLearn.js` → `ENVELOPE_HEADER_FIELDS`, plus `payload`), because
 * there it IS the claim: a circle id added to this header would be visible to every relay on
 * every path. `whatTheRelayLearns.test.js` asserts the two agree, so they cannot drift apart.
 */
export const ROUTING_HEADER_FIELDS = Object.freeze([
  '_v', '_p', '_id', '_re', '_from', '_to', '_topic', '_ts', '_sig', '_rotationProof',
  // Decision 1 (2026-07-31) — the key that signed the envelope. The relay neither reads nor checks
  // it (verification is end-to-end); it is listed so the sealing check does not mistake a routing
  // header field for readable content.
  '_signedBy',
]);

/** The one key a sealed payload carries: `SecurityLayer.encrypt` sets `payload = { _box }`. */
const SEALED_PAYLOAD_KEY = '_box';

/**
 * Is this body content the relay can READ that it should not be able to?
 *
 * The signal is a known marker, not entropy. Sealing has a shape, and it is a contract rather
 * than a statistical property: `SecurityLayer.encrypt` replaces `envelope.payload` with
 * `{ _box: <base64> }` and leaves the routing header in cleartext (`SecurityLayer.js`). So an
 * envelope crossing this relay is sealed **iff** its payload is exactly that, and everything
 * else it carries is a routing-header field. Anything else in the payload position, or any
 * readable field beside the header, is by definition not sealed — which is the whole and honest
 * statement of what this alarm is for.
 *
 * The one deliberate exemption is `P.HI`: the hello/agent-card exchange is *signed plaintext by
 * design*, not a leak. Firing on it would be the same cry-wolf failure in a new costume.
 *
 * Why not "does it look like prose": because a base64 Ed25519 address does, to any threshold you
 * pick. The old canary flagged one of this suite's real per-circle addresses and stayed quiet on
 * the next, which is a coin flip an operator learns to ignore.
 *
 * @param   {*} body  an envelope, or (for `multi-deliver`) a bare payload
 * @returns {{marker: string, excerpt: string} | null}
 *   `marker` names WHICH contract was broken; `excerpt` is a short structural sample the caller
 *   MUST truncate (`logHop` runs it through `shortId`). Null when the body is sealed, or is
 *   plaintext by design, or carries nothing readable at all.
 */
export function findPlaintextLeak(body) {
  if (body == null || typeof body !== 'object') return null;

  // Signed plaintext by design — the agent-card hello carries no user content.
  if (body._p === P.HI) return null;

  // A bare sealed box (a `multi-deliver` payload the caller sealed itself).
  if (isSealedBox(body)) return null;

  // 1. The case this alarm exists for: something readable where `{_box}` belongs.
  if ('payload' in body && !isSealedBox(body.payload)) {
    return { marker: 'unsealed-payload', excerpt: sample(body.payload) };
  }

  // 2. Readable structure BESIDE the routing header — content smuggled into a field of its own,
  //    or a bare application object handed straight to `_put` with no envelope around it.
  const extra = Object.keys(body).filter(
    (k) => k !== 'payload' && !ROUTING_HEADER_FIELDS.includes(k),
  );
  if (extra.length > 0) {
    return { marker: 'readable-outside-payload', excerpt: sample(pick(body, extra)) };
  }

  return null;
}

/** The sealed shape, exactly: an object whose only key is `_box`, holding a string. */
function isSealedBox(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === SEALED_PAYLOAD_KEY && typeof value._box === 'string';
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

/** A structural sample of what was readable. Truncation is the CALLER's job — see `logHop`. */
function sample(value) {
  try { return JSON.stringify(value) ?? String(value); } catch { return '<uninspectable>'; }
}

function bodySize(body) {
  if (body == null) return 0;
  try { return JSON.stringify(body).length; } catch { return -1; }
}
