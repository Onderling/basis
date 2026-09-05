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

import circleEn from './circle.en.json' with { type: 'json' };
import circleNl from './circle.nl.json' with { type: 'json' };
import consequenceEn from './consequence.en.json' with { type: 'json' };
import consequenceNl from './consequence.nl.json' with { type: 'json' };
import roleEn from './role.en.json' with { type: 'json' };
import roleNl from './role.nl.json' with { type: 'json' };
import hostEn from './host.en.json' with { type: 'json' };
import hostNl from './host.nl.json' with { type: 'json' };

/** The canonical `circle` block per language (union of the former web + mobile copies; 0 value conflicts). */
export const sharedCircleLocale = { en: circleEn, nl: circleNl };

/** The canonical `consequence` block per language (identical across both shells; 0 value conflicts). */
export const sharedConsequenceLocale = { en: consequenceEn, nl: consequenceNl };

/** The canonical `role` block per language (identical across both shells; 0 value conflicts). */
export const sharedRoleLocale = { en: roleEn, nl: roleNl };

/**
 * What the APP ITSELF says — the slash-command replies, sync/transport status, security notices,
 * the embed and picker chrome. 30 blocks, spread at the TOP level (so `sync.synced_to` keeps its
 * name; only the file that holds it changed).
 *
 * These lived in the web shell's bundle while being written by code both shells run, which is why a
 * phone answered `/mute` with the string "mute.added" — 102 keys the mobile bundle simply did not
 * have, and nothing failed, because a missing translation is a string. `threadsCmd.*` is the one
 * rename: the `/threads` replies could not keep the name `threads`, which the mobile thread drawer
 * owns (the `publishPeerAddrCmd` block beside it is the precedent for the suffix).
 */
export const sharedHostLocale = { en: hostEn, nl: hostNl };

/**
 * Merge a shell's own bundle with the shared blocks, one level deeper than a spread.
 *
 * A spread replaces a whole top-level block, which was fine while every shared block was shared
 * ENTIRELY. Three are not: `chat`, `common` and `logs` each hold a few strings that shared code writes
 * (`renderer.js`'s answer to every skill result; the `/logs` replies) sitting beside strings only one
 * shell renders (mobile's chat composer, its logs panel). Spreading a shared `common` would have wiped
 * mobile's `common.back` / `common.next`; keeping the shared ones per-shell is what let the SAME
 * sentence drift into two.
 *
 * So: blocks merge key-by-key, and SHARED WINS. Precedence never actually decides anything — the
 * ownership guard requires a key to be defined in exactly one place, so an overlap is a build error
 * rather than a quiet override — but when it does fire, the shared source is the one that is meant to
 * be true. (A leaf here is `{text, doc}`; it is replaced whole, never merged field-by-field.)
 *
 * `apps/tasks-v0/src/ui/localisationMerge.js` holds a twin of this with the opposite precedence and no
 * production consumer. Consolidating the two is worth doing when either app next touches it.
 */
export function mergeShared(app, shared) {
  const out = { ...app };
  for (const [block, sharedBlock] of Object.entries(shared ?? {})) {
    const own = out[block];
    const mergeable = own && typeof own === 'object' && !Array.isArray(own)
      && sharedBlock && typeof sharedBlock === 'object' && !Array.isArray(sharedBlock)
      && typeof own.text !== 'string' && typeof sharedBlock.text !== 'string';
    out[block] = mergeable ? mergeShared(own, sharedBlock) : sharedBlock;
  }
  return out;
}

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
  en: { circle: circleEn, consequence: consequenceEn, role: roleEn, ...hostEn },
  nl: { circle: circleNl, consequence: consequenceNl, role: roleNl, ...hostNl },
};
