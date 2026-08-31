// Shared locale blocks — the SINGLE source for keys both the web and mobile shells render, so they
// can't drift (the `circle.*` v2 surface used to be copy-pasted into both `locales/{en,nl}.json`, and
// drifted — `circle.bot.*` existed on mobile but not web → `/me` showed the raw key `circle.bot.failed`).
//
// Each shell merges these over its own platform-only keys: `{ ...appLocale, circle: sharedCircleLocale.<lng> }`.
// Leaves are the `{ text, doc }` shape (each shell's loader unwraps them). Add more shared blocks here
// (chat/common/reply/…) the same way as they get consolidated.
//
// A top-level block belongs here ONLY when it is byte-identical across both shells (union, 0 value
// conflicts) — the merge replaces the whole block, so a block with any platform-specific or differing
// leaf must stay per-shell. `consequence.*` + `role.*` joined `circle.*` (invariant #3 — finishing the
// consolidation `circle.*` started). Blocks that only partly overlap (e.g. a lone identical leaf inside
// an otherwise-divergent `chat`/`common`/`reply`) are deliberately NOT here — sharing them would need a
// nested merge or a key-path change, neither of which this shallow top-level-replacement mechanism does.

import circleEn from './circle.en.json';
import circleNl from './circle.nl.json';
import consequenceEn from './consequence.en.json';
import consequenceNl from './consequence.nl.json';
import roleEn from './role.en.json';
import roleNl from './role.nl.json';

/** The canonical `circle` block per language (union of the former web + mobile copies; 0 value conflicts). */
export const sharedCircleLocale = { en: circleEn, nl: circleNl };

/** The canonical `consequence` block per language (identical across both shells; 0 value conflicts). */
export const sharedConsequenceLocale = { en: consequenceEn, nl: consequenceNl };

/** The canonical `role` block per language (identical across both shells; 0 value conflicts). */
export const sharedRoleLocale = { en: roleEn, nl: roleNl };

/**
 * EVERY shared block, per language — the ONE thing a shell merges.
 *
 * Both loaders used to name the blocks themselves:
 * `{ ...appLocale, circle: sharedCircleLocale.en, consequence: …, role: … }`, in two files. Adding a
 * shared block therefore meant editing three files and a re-export, and forgetting one of them dropped
 * the block on one shell silently — the same failure this directory exists to end. Now a shell spreads
 * `sharedLocale[lng]` and names nothing, so a new block reaches both by construction: one file here,
 * one line below.
 *
 * The three named exports above stay: tests and callers already import them, and they are the honest
 * way to reach one block when that is what you mean.
 */
export const sharedLocale = {
  en: { circle: circleEn, consequence: consequenceEn, role: roleEn },
  nl: { circle: circleNl, consequence: consequenceNl, role: roleNl },
};
