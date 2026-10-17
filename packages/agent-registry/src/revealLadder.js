// Reveal ladder for an anonymous talk (drivers-matching #5b — "anonymous-talk-first").
//
// After an on-device driver match, the matcher reaches out. The KEY rule (Frits, 2026-07-15): each
// side controls ONLY THEIR OWN identity level, and revealing yourself is UNILATERAL — you can always
// show MORE of yourself, never less, and you can NEVER reveal the OTHER. Seeing the other requires
// THEIR reveal. The default start is `ephemeral` (anonymous); a per-user preference can start at
// `persona` instead, and either side can quick-switch up mid-talk.
//
// The matched DRIVER is never on this ladder — it's private to the matcher and only ever revealed by
// an explicit, separate choice (see drivers-matching note). This ladder is purely about WHO you are.
//
// ⚠ REUSES EXISTING INFRA — this is the UX-level VOCABULARY, NOT a new transport. The three rungs map
// directly onto mechanisms pinboard already ships; the drivers flow drives THOSE, never a new channel:
//   ephemeral → NO reveal record → `Resolver.resolve` renders the peer's `@handle` (the MemberMap
//               pseudonym); the ephemeralHandle here is only a fallback label when no roster handle exists.
//   persona   → `Reveals.setPeerReveal(peer, true)` → the peer renders your persona displayName.
//   identity  → the existing `requestContactAdd` / pairwise contact exchange (out of this module).
// The anonymous talk itself rides `packages/chat-p2p` (`chat.send`) — see `packages/identity-resolver/
// src/Reveals.js` + `Resolver.js` + `apps/pinboard` `requestReveal`/`respondToItem`. Keep this module pure
// vocabulary + presentation so the UI can name the rungs consistently; do NOT reimplement the channel.
//
// Pure — web ≡ mobile, no I/O. Ephemeral handles are DETERMINISTIC from the talk id (stable within a
// talk, unlinkable across talks) so there's no randomness to thread and it's fully testable.
//
// ⚠ DEPRECATED-DELEGATING (C7). `disclosure.js` is now THE reveal-state home; its amount presets
// `handle → profile → full` (`REVEAL_PRESETS`) are the pinned vocabulary. This module's `ephemeral →
// persona → identity` level NAMES are the OLD, mis-named talk-scoped vocabulary and are kept only as a
// back-compat shim: the ordering here now RESOLVES THROUGH the disclosure preset ordering via the 1:1
// mapping below, so there is a single source of ordering. Public signatures + outputs are unchanged.
// A follow-up re-homes the talk flow onto the presets and retires these level names.

import { REVEAL_PRESETS, revealPresetRank, nextRevealPreset } from './disclosure.js';

/**
 * The 1:1 rung↔preset mapping (design NOTE-reveal-state §1.8 / §4): the level names collapse onto the
 * pinned amount presets by rank. `ephemeral`=floor (handle), `identity`=ceiling (full). The middle
 * `persona` rung is the pinned `profile` preset (the presented self) — NOT the pinned model's "persona"
 * (which is the whole presented self); the code's rung is the mis-named one.
 */
const LEVEL_TO_PRESET = Object.freeze({ ephemeral: 'handle', persona: 'profile', identity: 'full' });
const PRESET_TO_LEVEL = Object.freeze({ handle: 'ephemeral', profile: 'persona', full: 'identity' });

/** The pinned reveal PRESET for an old level name (`ephemeral→handle`, `persona→profile`, `identity→full`), or undefined. */
export function presetForRevealLevel(level) { return LEVEL_TO_PRESET[level]; }
/** The old level name for a pinned reveal preset (inverse of `presetForRevealLevel`), or undefined. */
export function revealLevelForPreset(preset) { return PRESET_TO_LEVEL[preset]; }

/**
 * Identity levels, LEAST → MOST revealing. `identity` = hand off to the existing pairwise-reveal /
 * contact machinery. Derived from `REVEAL_PRESETS` order so the two vocabularies can never drift.
 */
export const REVEAL_LEVELS = Object.freeze(REVEAL_PRESETS.map((p) => PRESET_TO_LEVEL[p]));

/** True iff `l` is one of the REVEAL_LEVELS (`ephemeral` | `persona` | `identity`). */
export function isRevealLevel(l) { return REVEAL_LEVELS.includes(l); }

/** Rank a level (0=ephemeral … 2=identity), or -1 for an unknown level. Delegates to the preset rank. */
export function revealRank(level) { return revealPresetRank(LEVEL_TO_PRESET[level]); }

/** The next level up, or the same level when already at the top (`identity`). Delegates to `nextRevealPreset`. */
export function nextRevealLevel(level) {
  return PRESET_TO_LEVEL[nextRevealPreset(LEVEL_TO_PRESET[level])];
}

/**
 * A stable, friendly EPHEMERAL handle for a participant in a talk — deterministic from the talk id
 * (+ an optional side salt so the two participants differ). Same talk → same handle; different talk →
 * different handle (unlinkable). No PII, no randomness.
 *
 * @param {string} talkId
 * @param {string} [side='']   e.g. 'a' | 'b' — distinguishes the two participants of one talk
 */
export function ephemeralHandle(talkId, side = '') {
  const s = `${talkId}:${side}`;
  // Small FNV-1a hash → an index into a neutral adjective+noun pair. Enough spread for a talk pair;
  // collisions are cosmetic (the talk id is the real identifier, the handle is just a human label).
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const n = (h >>> 0);
  const adj = EPHEMERAL_ADJ[n % EPHEMERAL_ADJ.length];
  const noun = EPHEMERAL_NOUN[(n >>> 8) % EPHEMERAL_NOUN.length];
  return `${adj}-${noun}`;
}

const EPHEMERAL_ADJ = Object.freeze(['quiet', 'sunny', 'north', 'amber', 'calm', 'swift', 'green', 'still', 'bright', 'warm']);
const EPHEMERAL_NOUN = Object.freeze(['heron', 'willow', 'harbor', 'meadow', 'lantern', 'ferry', 'linden', 'compass', 'kettle', 'anchor']);

/**
 * Create a participant's own reveal state for a talk. `selfLevel` starts at `ephemeral` unless the
 * user's preference (or an explicit start level) opens higher.
 *
 * @param {object} a
 * @param {string} a.talkId
 * @param {string} [a.side='a']
 * @param {string} [a.startLevel='ephemeral']  the per-user default ('persona' = "always show my persona")
 * @param {{id:string, name?:string}} [a.persona]  this participant's circle-persona (shown at level ≥ persona)
 * @returns {{talkId:string, side:string, level:string, persona:object|null}}
 */
export function createParticipant({ talkId, side = 'a', startLevel = 'ephemeral', persona = null } = {}) {
  if (!talkId) throw new TypeError('createParticipant: talkId required');
  const level = isRevealLevel(startLevel) ? startLevel : 'ephemeral';
  return { talkId, side, level, persona: persona ?? null };
}

/**
 * Reveal MORE of yourself (unilateral). Bumps your own level UP to `toLevel`; a request to go to a
 * lower or equal level is a no-op (you can never un-reveal, and never reveal the other party). Returns
 * a NEW participant state (never mutates).
 *
 * @param {{talkId:string, side:string, level:string, persona:object|null}} self
 * @param {string} toLevel
 */
export function revealSelf(self, toLevel) {
  if (!isRevealLevel(toLevel)) return self;
  if (revealRank(toLevel) <= revealRank(self.level)) return self;   // only ever upward
  return { ...self, level: toLevel };
}

/** Quick-switch up one rung (the "reveal my persona" tap during an ephemeral talk). */
export function revealNext(self) { return revealSelf(self, nextRevealLevel(self.level)); }

/**
 * What the OTHER side learns about THIS participant at their current level — the projection sent over
 * the wire. `ephemeral` → only the deterministic handle; `persona` → the circle-persona; `identity` →
 * a marker that this side has opened to full identity (the contact exchange happens via the existing
 * pairwise machinery, not here). Never leaks a level the participant hasn't chosen.
 *
 * @param {{talkId:string, side:string, level:string, persona:object|null}} self
 */
export function presentSelf(self) {
  const base = { level: self.level };
  if (self.level === 'ephemeral') return { ...base, handle: ephemeralHandle(self.talkId, self.side) };
  if (self.level === 'persona') {
    return { ...base, persona: self.persona ? { id: self.persona.id, name: self.persona.name ?? self.persona.id } : null };
  }
  // identity — the ladder's job is done; signal readiness, defer the actual contact exchange.
  return { ...base, identityOpen: true, persona: self.persona ? { id: self.persona.id, name: self.persona.name ?? self.persona.id } : null };
}
