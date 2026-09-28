/**
 * manifestConformance — the MANIFEST-CONFORMANCE STANDARD, in code.
 *
 * CLAUDE.md invariant #4: "the manifest is the source of truth for surfaces".
 * This helper answers one question for a single app manifest: *is this a
 * conformant manifest?* — i.e. does it satisfy the standard every real app
 * manifest in the monorepo holds to, such that a projector can turn its one
 * declaration into every surface without a per-shell escape hatch?
 *
 * It is the STANDARDISATION BACKBONE for the §6 "all surfaces manifest-driven"
 * arc: a reusable, package-level check (so it isn't re-implemented per app)
 * that the cross-app fitness test (`test/manifestConformance.test.js`) runs
 * against `apps/<app>/manifest.js`, failing CI on drift.
 *
 * DESIGN: only rules that are TRUE of every already-conformant app manifest
 * (tasks-v0 · stoop · household · calendar · folio · basis) are encoded
 * here — so the check is GREEN on master and RED on a real regression. Rules
 * the codebase does NOT hold to universally (registry-canonical `itemTypes`
 * under `strictNouns`, the `strict` skillId cross-check) are deliberately
 * NOT conformance failures: F-SP1-a permits app-local nouns, and some apps
 * legitimately reference external skills. Registry-noncanonical nouns are
 * surfaced as NON-BLOCKING `warnings` (informational), never flipping `ok`.
 *
 * Rules (each returns a coded issue — codes, not free strings, so callers can
 * assert on them):
 *
 *   1. invalid-structure  — `validateManifest(m).ok` is false. The structural
 *                           backbone: `app`/`itemTypes`/`operations` well-shaped,
 *                           every enum-valued field known, no duplicate ids, and
 *                           every `nouns` key ∈ `itemTypes`. One issue per
 *                           underlying validator error (carrying its path).
 *
 *   2. verb-not-atom      — atom discipline (B · Layer 1). Every `op.verb` must
 *                           be a known SDK atom/alias OR be
 *                           a key of `manifest.domainVerbs` (and a domainVerb must not
 *                           itself be an atom). This is the drift guard against
 *                           a new noun-specific verb sneaking in un-mapped.
 *
 *   3. nouns-required     — §1a noun-declaration discipline. A manifest with any
 *                           noun-bearing atom op (an atom verb naming an
 *                           item-type via `appliesTo.type` or a `type`-enum
 *                           param) MUST declare `nouns` — its member-facing
 *                           (verb × noun) capability surface is then the author's
 *                           explicit, written-down choice, not an implicit set
 *                           the gate derives (the #79 noise this arc removed).
 *
 *   4. nouns-vacuous      — §1a, the inverse. A manifest with NO noun-bearing
 *                           atom op must NOT declare a `nouns` block. This is the
 *                           #81 basis exemption made into a rule: the
 *                           shell/unifier manifest names no item noun, so an
 *                           empty `nouns:{}` would be worse than nothing — it
 *                           flips the manifest to declared-authoritative and a
 *                           future noun-op's capability would be silently dropped.
 *
 *   5. projector-error    — PROJECTOR TOTALITY, the direct reading of invariant
 *                           #4. Each surface projector (renderChat · renderSlash
 *                           · renderGate · renderWeb · renderMobile) must turn
 *                           this manifest into its surface without throwing. A
 *                           manifest that any projector chokes on is NOT a
 *                           single source of truth for surfaces. One issue per
 *                           failing projector (carrying the surface key).
 *
 * @module conformance
 */

import { validateManifest } from './validate.js';
import { canonicalAtom } from './atoms.js';
import { opNouns } from './capabilities.js';
import { renderChat } from './renderChat.js';
import { renderSlash } from './renderSlash.js';
import { renderGate } from './renderGate.js';
import { renderWeb } from './renderWeb.js';
import { renderMobile } from './renderMobile.js';

/**
 * @typedef {object} ConformanceIssue
 * @property {'invalid-structure'|'verb-not-atom'|'nouns-required'|'nouns-vacuous'|'projector-error'} code
 * @property {string} message  human-readable detail
 * @property {string} [path]   manifest path the issue points at (validator paths / `/nouns` / `/operations`)
 * @property {string} [surface] projector surface key for `projector-error` ('chat'|'slash'|'gate'|'web'|'mobile')
 */

/**
 * The 5 surface projectors, keyed by surface. renderChat needs a skill wiring
 * to build its tool handlers — a pure/empty stub is enough to exercise the
 * PROJECTION (we assert it doesn't throw on the manifest, not that skills run).
 */
const PROJECTORS = [
  ['chat',   (m) => renderChat(m, { skillRegistry: {}, toSkillCtx: () => ({}) })],
  ['slash',  (m) => renderSlash(m)],
  ['gate',   (m) => renderGate(m)],
  ['web',    (m) => renderWeb(m)],
  ['mobile', (m) => renderMobile(m)],
];

/**
 * Does this op name an item-type noun AND carry an atom verb? Mirrors the §1a
 * `nounBearingAtomOps` predicate (basis `test/atom-discipline.test.js`),
 * lifted here so the standard lives in the package, not a single app's test.
 *
 * @param {object} op
 * @param {string[]} itemTypes
 * @returns {boolean}
 */
function isNounBearingAtomOp(op, itemTypes) {
  return !!canonicalAtom(op?.verb) && opNouns(op, itemTypes).length > 0;
}

/**
 * Assert a single app manifest against the conformance standard.
 *
 * @param {import('./schema.js').Manifest} manifest
 * @returns {{ ok: boolean, issues: ConformanceIssue[], warnings: Array<{path?: string, message: string, code?: string}> }}
 *   `ok` reflects `issues` only. `warnings` carries non-blocking signals
 *   (registry-noncanonical nouns via F-SP1-a) — present but never flipping `ok`.
 */
export function manifestConformance(manifest) {
  /** @type {ConformanceIssue[]} */
  const issues = [];

  // A non-object manifest can't be projected or reasoned about — short-circuit
  // with the one structural issue rather than throwing from a projector below.
  if (!manifest || typeof manifest !== 'object') {
    return {
      ok: false,
      issues: [{ code: 'invalid-structure', path: '/', message: 'manifest must be an object' }],
      warnings: [],
    };
  }

  // Rule 1 — structural validity (the backbone). One conformance issue per
  // underlying validator error, carrying its path so a per-app breakdown can
  // point at the offending field.
  const base = validateManifest(manifest);
  for (const e of base.errors) {
    issues.push({ code: 'invalid-structure', path: e.path, message: e.message });
  }

  // Rule 2 — atom discipline. Re-run the validator in `atoms` mode and lift
  // ONLY the verb-discipline errors (not the F-SP1-a-permitted concerns) to a
  // conformance issue.
  const atoms = validateManifest(manifest, { atoms: true });
  for (const e of atoms.errors) {
    if (e.code === 'unknown-verb' || e.code === 'atom-in-domain-verbs') {
      issues.push({ code: 'verb-not-atom', path: e.path, message: e.message });
    }
  }

  // Rules 3 & 4 — §1a noun-declaration discipline.
  const itemTypes = Array.isArray(manifest.itemTypes) ? manifest.itemTypes : [];
  const operations = Array.isArray(manifest.operations) ? manifest.operations : [];
  const hasNounOps = operations.some((op) => isNounBearingAtomOp(op, itemTypes));
  const declaresNouns =
    !!manifest.nouns && typeof manifest.nouns === 'object' && !Array.isArray(manifest.nouns);
  if (hasNounOps && !declaresNouns) {
    issues.push({
      code: 'nouns-required',
      path: '/nouns',
      message:
        'manifest has noun-bearing atom ops (an atom verb naming an itemType via appliesTo.type or a `type`-enum param) but declares no `nouns` block — its (verb × noun) capability surface must be declared-authoritative (§1a)',
    });
  } else if (!hasNounOps && declaresNouns) {
    issues.push({
      code: 'nouns-vacuous',
      path: '/nouns',
      message:
        'manifest declares a `nouns` block but has no noun-bearing atom ops — a shell/unifier manifest must NOT declare a vacuous `nouns` (it would flip it to declared-authoritative and silently drop future noun capabilities; the #81 basis exemption)',
    });
  }

  // Rule 5 — projector totality. The literal reading of invariant #4: the one
  // manifest must project to every surface without a projector throwing.
  for (const [surface, project] of PROJECTORS) {
    try {
      project(manifest);
    } catch (err) {
      issues.push({
        code: 'projector-error',
        surface,
        path: '/operations',
        message: `render${surface[0].toUpperCase()}${surface.slice(1)} threw projecting this manifest: ${err?.message ?? err}`,
      });
    }
  }

  // Non-blocking: registry-noncanonical nouns (F-SP1-a app-local types). These
  // are a real convergence signal for tooling/docs, but NOT a conformance
  // failure — the registry-source-of-truth standard is opt-in (`strictNouns`),
  // and 4 of 6 current apps still carry app-local nouns.
  const warnings = base.warnings.filter((w) => w.code === 'noncanonical-itemtype');

  return { ok: issues.length === 0, issues, warnings };
}
