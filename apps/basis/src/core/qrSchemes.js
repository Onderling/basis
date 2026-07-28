/**
 * QR URI schemes recognised by basis (web + mobile).
 *
 * Lifted out of src/renderer.js 2026-05-27 so the mobile chat-shell
 * can also detect QR-payload fields in record bubbles + render them
 * via @onderling/react-native/qr/view.  The list is the canonical
 * registry: any new scheme added here is auto-recognised by both
 * renderers + the mobile scanner classifier.
 *
 * Platform: neutral (pure data + a string-prefix test).
 */

export const QR_URI_PREFIXES = Object.freeze([
  'stoop-contact://',
  'stoop-invite://',
  'onderling-pair://', // OBJ-2 no-pod device/agent pairing: encodes a household peer address
  'basis://',    // future: chat-shell-level invites
]);

/**
 * @param {string} v
 * @returns {boolean} true if `v` looks like one of our QR-payload URIs.
 */
export function isQrUri(v) {
  return typeof v === 'string'
    && QR_URI_PREFIXES.some((p) => v.startsWith(p));
}

// ── OBJ-2 device/agent pairing payload ──────────────────────────────────────
// A pairing QR carries one household peer address: `onderling-pair://<addr>?name=<label>`.
// Scanning it on the other device → addHouseholdPeer(addr), so the two per-circle household
// agents share their items over the relay/peer transport — no typing a long address.
export const QR_PAIR_SCHEME = 'onderling-pair://';

/** Build a pairing URI for a household peer address (optional human label). */
export function makePairUri(addr, name) {
  const a = String(addr ?? '').trim();
  if (!a) return '';
  const q = name ? `?name=${encodeURIComponent(String(name))}` : '';
  return `${QR_PAIR_SCHEME}${encodeURIComponent(a)}${q}`;
}

/** Parse a pairing URI → { addr, name } | null. Tolerant of a bare address (no scheme). */
export function parsePairUri(uri) {
  if (typeof uri !== 'string') return null;
  const s = uri.trim();
  if (!s.startsWith(QR_PAIR_SCHEME)) {
    // Accept a bare address too (pasted directly), as long as it isn't some OTHER QR scheme.
    return s && !isQrUri(s) ? { addr: s, name: null } : null;
  }
  const rest = s.slice(QR_PAIR_SCHEME.length);
  const qi = rest.indexOf('?');
  const addrPart = qi === -1 ? rest : rest.slice(0, qi);
  let name = null;
  if (qi !== -1) {
    const m = /(?:^|&)name=([^&]*)/.exec(rest.slice(qi + 1));
    if (m) { try { name = decodeURIComponent(m[1]); } catch { name = m[1]; } }
  }
  let addr = addrPart;
  try { addr = decodeURIComponent(addrPart); } catch { /* keep raw */ }
  addr = addr.trim();
  return addr ? { addr, name } : null;
}
