/**
 * qrScanner — payload classifier for QR codes scanned via expo-camera.
 *
 * Stoop V3 Phase 40.6, lifted to substrate 2026-05-09 (Phase 41.0 L4 —
 * Tasks-mobile is the second consumer). The plug-in dispatcher lives
 * in `@onderling/react-native/qr/classifyQrPayload`; this file binds
 * Stoop's three classifiers (invite, contact, recovery) and re-exports
 * the zero-arg `classifyQrPayload(text)` shape existing call sites
 * already use.
 */

import { classifyQrPayload as _classifyQrPayload } from '@onderling/react-native/qr';

const STOOP_INVITE_PATH    = 'onboard.html';
const STOOP_CONTACT_SCHEME = 'onderling-contact://';
const BIP39_WORD_COUNTS    = new Set([12, 15, 18, 21, 24]);

const STOOP_CLASSIFIERS = [
  { kind: 'invite',   classify: _classifyInvite },
  { kind: 'contact',  classify: _classifyContact },
  { kind: 'recovery', classify: _classifyRecovery },
];

/**
 * Classify a Stoop QR payload. Returns `{kind, payload}` on success
 * or `{kind: 'unknown'}` on no match. The plug-in slot (substrate-
 * level `classifyQrPayload(text, classifiers)`) is reachable directly
 * via `@onderling/react-native/qr` for callers needing custom classifier
 * lists.
 *
 * @param {string} text
 */
export function classifyQrPayload(text) {
  return _classifyQrPayload(text, STOOP_CLASSIFIERS);
}

// ── Stoop classifier implementations ────────────────────────────────────────

function _classifyInvite(text) {
  // URL form: an `?invite=<encoded-json>` query, anywhere in the URL.
  const inviteMatch = /[?&]invite=([^&#]+)/i.exec(text);
  if (inviteMatch) {
    try {
      const decoded = decodeURIComponent(inviteMatch[1]);
      const parsed  = JSON.parse(decoded);
      if (_looksLikeInvite(parsed)) return parsed;
    } catch { /* fall through */ }
  }
  // Bare JSON form: starts with `{` and parses.
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (_looksLikeInvite(parsed)) return parsed;
    } catch { /* fall through */ }
  }
  return null;
}

function _classifyContact(text) {
  return text.startsWith(STOOP_CONTACT_SCHEME) ? text : null;
}

function _classifyRecovery(text) {
  // BIP-39 phrase: word count in {12, 15, 18, 21, 24}, lowercase ASCII.
  const words = text.split(/\s+/).filter(Boolean);
  if (!BIP39_WORD_COUNTS.has(words.length)) return null;
  if (!words.every((w) => /^[a-z]+$/.test(w) && w.length >= 3 && w.length <= 8)) return null;
  return words;
}

function _looksLikeInvite(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (typeof obj.groupId !== 'string' || obj.groupId.length === 0) return false;
  if (typeof obj.code      === 'string') return true;
  if (typeof obj.signature === 'string') return true;
  return false;
}

export const _internal = {
  STOOP_CONTACT_SCHEME,
  STOOP_INVITE_PATH,
  BIP39_WORD_COUNTS,
  _tryClassifyInvite:   _classifyInvite,
  _tryClassifyRecovery: (text) => {
    const r = _classifyRecovery(text);
    return r ? { kind: 'recovery', payload: r } : null;
  },
};
