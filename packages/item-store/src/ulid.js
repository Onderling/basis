/**
 * ULID generator — Crockford-base32 of (48-bit ms timestamp + 80 bits
 * of crypto randomness).  ~26 chars, lexicographically sortable by
 * creation time, collision-resistant.
 *
 * Lifted from apps/basis/src/household/InMemoryStore.js (see
 * pattern-source notes in Project Files/Substrates/L1b-item-store.md).
 *
 * Requires `globalThis.crypto.getRandomValues` — Node ≥19, browsers,
 * and React Native (when react-native-get-random-values is loaded
 * before this module).
 */

// Crockford base32 alphabet — excludes I, L, O, U for human legibility.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Monotonic state. The audit log is append-only and consumers sort by
// (timestamp, id); when several entries are created within the same
// millisecond the timestamp ties, so the id MUST break the tie in
// creation order. A fresh-random suffix per call doesn't — it sorts
// arbitrarily within a ms, which makes the audit order non-deterministic
// (observed as a flaky add/complete ordering). Per the ULID spec's
// monotonic factory: within the same (or a backwards-skewed) ms, reuse
// the timestamp and increment the previous random suffix instead.
let lastTime = 0;
/** @type {number[]|null} 16 base-32 digits (0..31) */
let lastDigits = null;

function freshDigits() {
  const rand = new Uint8Array(16);
  globalThis.crypto.getRandomValues(rand);
  const d = new Array(16);
  for (let i = 0; i < 16; i++) d[i] = rand[i] % 32;
  return d;
}

/** Increment a 16-digit base-32 number; null if it overflows all 80 bits. */
function incrementDigits(d) {
  const out = d.slice();
  for (let i = 15; i >= 0; i--) {
    if (out[i] < 31) { out[i]++; return out; }
    out[i] = 0;
  }
  return null;
}

/**
 * Generate a ULID.  Time prefix (10 chars) + randomness (16 chars) = 26
 * chars total.  Monotonic: ids created within the same millisecond are
 * strictly increasing, so lexicographic order matches creation order.
 *
 * @returns {string} 26-char ULID
 */
export function ulid() {
  let now = Date.now();
  let digits;
  if (now <= lastTime && lastDigits) {
    // Same ms, or the wall clock moved backwards — hold the timestamp
    // and bump the suffix so the id still sorts after the previous one.
    const inc = incrementDigits(lastDigits);
    if (inc) { now = lastTime; digits = inc; }
    else     { now = lastTime + 1; digits = freshDigits(); }
  } else {
    digits = freshDigits();
  }
  lastTime   = now;
  lastDigits = digits;

  // Encode 48-bit timestamp into 10 base32 chars, MSB first.
  let timeStr = '';
  let t = now;
  for (let i = 9; i >= 0; i--) {
    timeStr = CROCKFORD[t % 32] + timeStr;
    t = Math.floor(t / 32);
  }
  let randStr = '';
  for (let i = 0; i < 16; i++) {
    randStr += CROCKFORD[digits[i]];
  }
  return timeStr + randStr;
}
