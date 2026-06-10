/**
 * canopy-chat v2 — kind-aware "+ new circle" templates (β.4).
 *
 * Each known kind (household / buurt / vriendenkring / team) maps to a
 * partial policy that the create wizard pre-fills when the user picks
 * the kind in the C1 create flow (#197).  The user can override any
 * axis before submitting; the merge here is strictly "template fills
 * the gaps", never overwriting a value the user already set.
 *
 * Keys mirror `circlePolicy.js` exactly:
 *   - `features`            — record of `CIRCLE_FEATURES → boolean`
 *   - `revealPolicy`        — `'pairwise' | 'open'`
 *   - `pod`                 — `'none' | 'shared' | 'personal' | 'hybrid'`
 *   - `llmTool`             — `'off' | 'local' | 'cloud'`
 *   - `agents`              — `'yes' | 'admin-approval' | 'no'`
 *   - `consensusRequired`   — boolean
 *
 * Note: `view` and `admins` are NOT part of the template — `view` has
 * its own default ('screen') and `admins` is computed from the wizard's
 * `additionalAdmins` field at submit time.
 *
 * Switch-kind semantics: if the user picks `household` then changes to
 * `buurt`, the second `applyTemplate` is essentially a no-op for axes
 * the first template already filled.  This preserves every choice the
 * user made along the way (even by virtue of an earlier template) and
 * avoids surprise overwrites.  Design call documented inline below.
 */
import { CIRCLE_FEATURES, CIRCLE_POLICY_ENUMS } from './circlePolicy.js';

/**
 * @typedef {{
 *   features:          Record<string, boolean>,
 *   revealPolicy:      'pairwise' | 'open',
 *   pod:               'none' | 'shared' | 'personal' | 'hybrid',
 *   llmTool:           'off' | 'local' | 'cloud',
 *   agents:            'yes' | 'admin-approval' | 'no',
 *   consensusRequired: boolean,
 * }} KringTemplate
 */

/** @type {Record<string, KringTemplate>} */
export const KRING_TEMPLATES = Object.freeze({
  // A home — everyone sees each other, single shared pod, light governance.
  household: {
    features: {
      chat: true,  noticeboard: true,  tasks: true,  lists: true,
      calendar: true,  notes: true,  houseRules: true,  memberDirectory: true,
    },
    revealPolicy:      'open',
    pod:               'shared',
    llmTool:           'local',
    agents:            'admin-approval',
    consensusRequired: false,
  },
  // A neighbourhood — bigger group, pairwise reveal, personal pods,
  // governance matters (co-admin consensus on changes).  N1 (2026-06-02,
  // Frits): a buurt is noticeboard-first with **open chat OFF by default**
  // — a thread appears only when someone reacts to a vraag/aanbod
  // (the `/help-with` per-post DM-spawn).  `recommendChat` below turns
  // this into wizard advice: for bigger buurten chat-off is *advised*
  // (with reasoning); for smaller ones the wizard just *asks*.
  buurt: {
    features: {
      chat: false,  noticeboard: true,  tasks: true,  lists: false,
      calendar: false,  notes: false,  houseRules: true,  memberDirectory: true,
    },
    revealPolicy:      'pairwise',
    pod:               'personal',
    llmTool:           'off',
    agents:            'no',
    consensusRequired: true,
  },
  // A friend group — relaxed, no house rules / directory.
  vriendenkring: {
    features: {
      chat: true,  noticeboard: true,  tasks: false,  lists: true,
      calendar: true,  notes: true,  houseRules: false,  memberDirectory: false,
    },
    revealPolicy:      'open',
    pod:               'personal',
    llmTool:           'local',
    agents:            'admin-approval',
    consensusRequired: false,
  },
  // A team — work-style, cloud LLM + agents on, shared pod for the
  // workspace, no noticeboard / house rules.
  team: {
    features: {
      chat: true,  noticeboard: false,  tasks: true,  lists: true,
      calendar: true,  notes: true,  houseRules: false,  memberDirectory: true,
    },
    revealPolicy:      'open',
    pod:               'shared',
    llmTool:           'cloud',
    agents:            'yes',
    consensusRequired: false,
  },
  // Generic fallback when the picked kind isn't in the table.  Mirrors
  // the most-private defaults so an unknown kind defaults to the
  // safest, smallest surface.
  _default: {
    features: {
      chat: true,  noticeboard: true,  tasks: false,  lists: false,
      calendar: false,  notes: false,  houseRules: false,  memberDirectory: false,
    },
    revealPolicy:      'pairwise',
    pod:               'personal',
    llmTool:           'off',
    agents:            'no',
    consensusRequired: false,
  },
});

/** Known kinds (excluding the `_default` fallback). */
export const KRING_KINDS = Object.freeze(
  Object.keys(KRING_TEMPLATES).filter((k) => k !== '_default'),
);

/**
 * Lookup the template for a kind, falling back to `_default` when the
 * kind isn't in the table.  Always returns a template (never null).
 *
 * @param {string|null|undefined} kind
 * @returns {KringTemplate}
 */
export function defaultsForKind(kind) {
  if (typeof kind === 'string' && Object.prototype.hasOwnProperty.call(KRING_TEMPLATES, kind) && kind !== '_default') {
    return KRING_TEMPLATES[kind];
  }
  return KRING_TEMPLATES._default;
}

/**
 * Apply a kind's template to a (possibly partial) wizard state.  The
 * merge is "template fills the gaps": any axis the user has already
 * set on `state` wins over the template.  For `features`, the merge is
 * per-key — a user-toggled feature stays toggled even if the template
 * disagrees.
 *
 * If the user later picks a different kind, the second `applyTemplate`
 * is effectively a no-op for axes the first template already filled
 * (see file-header design call).
 *
 * @param {object} state — wizard state (any shape with the policy fields above)
 * @param {string} kind  — the kind the user just picked
 * @returns {object} a new state object with `kind` set + axes filled in
 */
export function applyTemplate(state, kind) {
  const s = state && typeof state === 'object' ? state : {};
  const t = defaultsForKind(kind);
  return {
    ...s,
    kind,
    // Template features first, state features overlay → user wins per key.
    features:          { ...t.features, ...(s.features && typeof s.features === 'object' ? s.features : {}) },
    revealPolicy:      s.revealPolicy      !== undefined ? s.revealPolicy      : t.revealPolicy,
    pod:               s.pod               !== undefined ? s.pod               : t.pod,
    llmTool:           s.llmTool           !== undefined ? s.llmTool           : t.llmTool,
    agents:            s.agents            !== undefined ? s.agents            : t.agents,
    consensusRequired: s.consensusRequired !== undefined ? s.consensusRequired : t.consensusRequired,
  };
}

/* ─── N1 — size-driven chat advice ─────────────────────────────── */

/** Size bands a create wizard can ask for (or derive from a count). */
export const SIZE_BANDS = Object.freeze(['small', 'large']);

/**
 * Heuristic: map an expected member/household count to a size band.
 * The 20-member cut mirrors the design note ("bigger buurten" — past a
 * couple dozen households open chat stops scaling).  Returns null for a
 * non-numeric input so callers can fall back to asking explicitly.
 *
 * @param {number} n
 * @returns {'small'|'large'|null}
 */
export function bandForCount(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return n >= 20 ? 'large' : 'small';
}

/**
 * N1 — recommend the `chat` feature value for a kind, plus *how strongly*
 * to surface that recommendation in the create wizard.
 *
 * Only the **buurt** is size-sensitive (Frits 2026-06-02): a buurt always
 * defaults chat OFF, but for a *large* buurt the wizard should advise
 * keeping it off (with reasoning), whereas for a *small* buurt it should
 * just ask the user.  Every other kind follows its template's chat value
 * with no special advice.
 *
 * `mode` values:
 *   - `'advise-off'`  — recommend off + show the reasoning (large buurt)
 *   - `'ask'`         — default off but prompt the user (small buurt)
 *   - `'default-off'` — buurt with no size chosen yet (off, neutral note)
 *   - `'default'`     — non-buurt; follow the template, no advice
 *
 * @param {{ kind?: string|null, size?: 'small'|'large'|null }} [opts]
 * @returns {{ value: boolean, mode: string, reasonKey: string|null }}
 */
export function recommendChat({ kind = null, size = null } = {}) {
  if (kind === 'buurt') {
    if (size === 'large') return { value: false, mode: 'advise-off',  reasonKey: 'circle.chatAdvice.buurtLarge' };
    if (size === 'small') return { value: false, mode: 'ask',         reasonKey: 'circle.chatAdvice.buurtSmall' };
    return                       { value: false, mode: 'default-off', reasonKey: 'circle.chatAdvice.buurtDefault' };
  }
  const tpl = defaultsForKind(kind);
  return { value: !!tpl.features?.chat, mode: 'default', reasonKey: null };
}

/**
 * Internal helper exposed for tests: assert that a template's keys are
 * a subset of the circlePolicy shape.  Returns the offending keys (or
 * an empty array on success).
 *
 * @param {KringTemplate} tpl
 * @returns {string[]}
 */
export function unknownKeysFor(tpl) {
  const allowedTop = new Set([
    'features', 'revealPolicy', 'pod', 'llmTool', 'storagePosture', 'agents', 'consensusRequired',
  ]);
  const bad = [];
  for (const k of Object.keys(tpl)) {
    if (!allowedTop.has(k)) bad.push(k);
  }
  if (tpl.features && typeof tpl.features === 'object') {
    const allowedFeat = new Set(CIRCLE_FEATURES);
    for (const k of Object.keys(tpl.features)) {
      if (!allowedFeat.has(k)) bad.push(`features.${k}`);
    }
  }
  // Enum values must be in CIRCLE_POLICY_ENUMS where present.
  for (const ax of ['revealPolicy', 'pod', 'llmTool', 'storagePosture', 'agents']) {
    if (tpl[ax] !== undefined && !CIRCLE_POLICY_ENUMS[ax].includes(tpl[ax])) {
      bad.push(`${ax}=${tpl[ax]}`);
    }
  }
  return bad;
}
