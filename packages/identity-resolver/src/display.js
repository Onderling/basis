/**
 * display — pure-fn helpers for rendering identity in UI:
 *   - initials() + paletteFor() for avatar pills
 *   - validateHandle() + normaliseHandle() for handle inputs
 *
 * Lifted from apps/stoop-mobile/src/lib/{avatar,handle}.js 2026-05-09
 * (Phase 41.0.b A1; Tasks-mobile is the second consumer).
 *
 * Pure JS; safe to import from any layer (web or RN). The handle
 * validator carries Stoop's defaults (3..32 chars, lowercase ASCII +
 * digits + `-_`); apps with different rules can re-implement
 * client-side. The SDK-side `setMyHandle` skill is always the
 * authoritative gate.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

// ── Avatar palette ──────────────────────────────────────────────────────────

export const PALETTE = Object.freeze([
  '#5d4037', '#0277bd', '#388e3c', '#e64a19',
  '#7b1fa2', '#0097a7', '#fbc02d', '#455a64',
]);

/**
 * Pick the up-to-two-letter initials from a display name.
 * Falls back to '·' for empty / non-string input so the avatar never
 * renders an empty pill.
 */
export function initials(name) {
  if (typeof name !== 'string' || name.trim().length === 0) return '·';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '·';
}

/**
 * Deterministic background colour derived from the name. Two callers
 * passing the same name always get the same colour.
 */
export function paletteFor(name) {
  if (typeof name !== 'string' || name.length === 0) return PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

// ── Handle validation ───────────────────────────────────────────────────────

// Parameter register (#36) — handle length bounds (scope:device, kind:internal).
const DEFAULT_MIN_LEN = param({ key: 'handleValidation.minLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3 });
const DEFAULT_MAX_LEN = param({ key: 'handleValidation.maxLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 32 });
const DEFAULT_HANDLE_RE = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export const HANDLE_LIMITS = Object.freeze({
  minLen: DEFAULT_MIN_LEN,
  maxLen: DEFAULT_MAX_LEN,
});

/**
 * @param {string} h
 * @returns {{ ok: true } | { ok: false, reason: 'empty'|'too_short'|'too_long'|'bad_chars' }}
 */
export function validateHandle(h, { minLen = DEFAULT_MIN_LEN, maxLen = DEFAULT_MAX_LEN, pattern = DEFAULT_HANDLE_RE } = {}) {
  if (typeof h !== 'string' || h.length === 0) return { ok: false, reason: 'empty' };
  if (h.length < minLen) return { ok: false, reason: 'too_short' };
  if (h.length > maxLen) return { ok: false, reason: 'too_long' };
  if (!pattern.test(h))  return { ok: false, reason: 'bad_chars' };
  return { ok: true };
}

/**
 * Make a string handle-shaped (lowercase, drop disallowed chars).
 * Used as a "tidy" pass before validating; doesn't pad or truncate
 * to the length range.
 */
export function normaliseHandle(h) {
  if (typeof h !== 'string') return '';
  return h.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

// ── Locale-keyed field unwrapping ──────────────────────────────────────────

/**
 * Return the language-appropriate string from a `{nl, en, ...}`
 * locale-field (the shape used by skill taxonomies and similar
 * identity-domain data). Falls back to en, then nl, then ''. Plain
 * strings pass through.
 *
 * Distinct from the `{text, doc}` leaf shape used in app locale
 * bundles (handled by `@onderling/react-native/localisation`'s `t()`).
 *
 * @param {string|object|null} field
 * @param {string} lang
 * @returns {string}
 */
export function localiseField(field, lang) {
  if (typeof field === 'string') return field;
  if (!field || typeof field !== 'object') return '';
  if (typeof field[lang] === 'string') return field[lang];
  if (typeof field.en === 'string') return field.en;
  if (typeof field.nl === 'string') return field.nl;
  return '';
}
