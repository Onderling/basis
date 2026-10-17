/**
 * basis v2 — per-contact hop overrides.
 *
 * The "Per contact aanpassen" list lets the user set a 3-way
 * gate per contact: ALTIJD (always relay) / MET-OK (relay with my
 * approval) / UIT (never relay).  Pinboard's contact model already
 * carries a `hopThrough` flag per-contact (boolean); broadens
 * that to a 3-level enum and ships the pure mapping + a contact-list
 * projection the screen renders.
 *
 * Pure: hosts pass the contacts list + the global stance (`getHopMode`)
 * and we project a render-ready row list with the effective per-contact
 * choice (the global stance acts as the default for any contact that
 * hasn't been explicitly overridden).
 */

const PER_CONTACT_MODES = ['always', 'with-ok', 'off'];

export const HOP_PER_CONTACT_MODES = PER_CONTACT_MODES;

/**
 * Normalise a raw per-contact value to the 3-level enum.
 * Accepts:
 *   - 'always' | 'with-ok' | 'off'  — passes through
 *   - true                          → 'always' (back-compat with the existing boolean)
 *   - false                         → 'off'
 *   - anything else                 → null (fall back to the global stance)
 *
 * @param {unknown} raw
 * @returns {'always'|'with-ok'|'off'|null}
 */
export function normalizeContactHopMode(raw) {
  if (PER_CONTACT_MODES.includes(raw)) return raw;
  if (raw === true)  return 'always';
  if (raw === false) return 'off';
  return null;
}

/**
 * Resolve the effective hop mode for one contact, given a global stance.
 *
 * Global stance shape (mirrors normalizeHopMode 's radio):
 *   { global: 'off' | 'with-ok' | 'always' }
 * Back-compat: a plain `{global: boolean}` (existing
 * normalizeHopMode shape) maps `true → 'always'`, `false → 'off'`.
 *
 * Returns the per-contact mode when explicitly set, else the global.
 *
 * @param {object} contact   `{id, hopThrough?, ...}`
 * @param {object} hopMode
 * @returns {'always'|'with-ok'|'off'}
 */
export function effectiveHopMode(contact, hopMode = {}) {
  const explicit = normalizeContactHopMode(contact?.hopThrough);
  if (explicit) return explicit;
  return normalizeGlobalHopMode(hopMode);
}

function normalizeGlobalHopMode(hopMode) {
  const g = hopMode?.global;
  if (PER_CONTACT_MODES.includes(g)) return g;
  if (g === true)  return 'with-ok';   // boolean true = "I allow relaying" → safest = with-ok
  return 'off';                         // boolean false / missing = "no relay"
}

/**
 * Build a contact-list projection the screen renders verbatim.
 * Sort order: ALTIJD first, then MET-OK, then UIT, then anything else;
 * within each bucket the host's existing order (e.g. trust-tier) is
 * preserved.
 *
 * @param {object} args
 * @param {object[]} [args.contacts=[]]
 * @param {object}   [args.hopMode={}]
 * @returns {Array<{id:string, label:string, mode:'always'|'with-ok'|'off', trustTier:string|null, isDefault:boolean}>}
 */
export function buildContactHopList({ contacts = [], hopMode = {} } = {}) {
  const list = asArray(contacts)
    .filter((c) => c && typeof c === 'object')
    .map((c) => {
      const explicit = normalizeContactHopMode(c.hopThrough);
      return {
        id:        c.id ?? c.webid ?? null,
        label:     pickContactLabel(c),
        mode:      explicit ?? normalizeGlobalHopMode(hopMode),
        trustTier: typeof c.trustTier === 'string' ? c.trustTier : null,
        isDefault: explicit === null,   // true → the global stance is in effect
      };
    });
  return list.sort((a, b) => MODE_RANK[a.mode] - MODE_RANK[b.mode]);
}

const MODE_RANK = { always: 0, 'with-ok': 1, off: 2 };

function pickContactLabel(c) {
  const cands = [c.displayName, c.handle, c.label, c.name, c.id, c.webid];
  for (const v of cands) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '(unknown)';
}

function asArray(v) { return Array.isArray(v) ? v : []; }
