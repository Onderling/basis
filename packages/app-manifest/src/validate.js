/**
 * Manifest validator.  Forward-additive: tolerates unknown top-level /
 * operation / param / view / surface keys; rejects only on missing
 * structure or on enum-shaped values being unknown.
 *
 * Per PLAN flag #12 (F-SP1-a, locked 2026-05-19): app-local
 * (non-canonical) item types are PERMITTED — canonical ones (in
 * `@onderling/item-types` `list()`) are recognised by `classifyItemTypes`,
 * non-canonical pass through silently. Required for (household
 * uses shopping/errand/repair/schedule — not in the canonical registry);
 * introduces canonical types alongside.
 */

import { list as listCanonicalTypes, metadata as registryTypeMetadata } from '@onderling/item-types';
import { isAtom, canonicalAtom } from './atoms.js';

/**
 * L4 ≡ B — registry recognition. True when the shared `@onderling/item-types`
 * registry recognises `t` as a declared noun/item-type, either by its
 * canonical name OR a legacy alias (`registryTypeMetadata` resolves aliases,
 * returning `null` only for genuinely unknown names). This is the single
 * source-of-truth check the manifest validator uses to converge a manifest's
 * declared nouns (`manifest.itemTypes`, of which `manifest.nouns` keys are a
 * subset) with the registry.
 *
 * @param {string} t
 * @returns {boolean}
 */
export function isRegistryType(t) {
  return typeof t === 'string' && t !== '' && registryTypeMetadata(t) !== null;
}

/**
 * Frozen verb allow-list mirroring `@onderling/item-store` `ItemStore`
 * methods.  Operations must declare a `verb` from this set.
 */
export const VERBS = Object.freeze([
  'add',
  'list',
  'complete',
  'remove',
  'claim',
  'reassign',
  'submit',
  'approve',
  'reject',
  'revoke',
]);

const VERB_SET   = new Set(VERBS);

/**
 * B · (ruling) — frozen allow-list of setting `kind`s (the wizard/form renderer
 * picks a control per kind).  `toggle`=checkbox, `choice`=select(of), `text`/`number`=inputs,
 * `member`=circle-member picker.  Distinct from PARAM_KINDS (settings are user-facing config,
 * not op arguments).
 */
// `multi` — a set of options where any number may be on, and the option list is supplied at RENDER time
// rather than declared here (decision 3, 2026-07-29: the conversation-kinds axis is registry-driven, so a
// list frozen into the manifest would drift from the registry the moment a kind is added). That is why
// `multi` deliberately does NOT require `of` the way `choice` does — see the check below.
export const SETTING_KINDS = Object.freeze(['toggle', 'choice', 'multi', 'text', 'number', 'member']);
const SETTING_KIND_SET = new Set(SETTING_KINDS);
/** a setting's resolution scope: `circle` = admin template, `user` = member pref. */
export const SETTING_SCOPES = Object.freeze(['circle', 'user']);
const SETTING_SCOPE_SET = new Set(SETTING_SCOPES);
// v0.3.2 (basis) extended the form generator with 'date' +
// 'webid' input kinds; reserved 'file' + 'image' for the
// upload path.  All four pass through the validator forward-additively
// (older manifests using just string/number/boolean/enum still work).
// The flows substrate added 'secret' (a value the runner must never persist — the flow verifier
// enforces by-ref-only bindings for it; shells render it as a masked input) and 'object' (a
// structured argument, e.g. the restore-merge choices map — no generic form; bespoke or bound).
const PARAM_KINDS = new Set([
  'string', 'number', 'boolean', 'enum',
  'date', 'webid', 'file', 'image',
  'secret', 'object',
]);

/**
 * (basis v0.1, 2026-05-21) — frozen allow-list of chat
 * reply shapes.  The chat shell picks a renderer per shape; absent
 * `surfaces.chat.reply` falls back to a default derived from the op's
 * `verb` + the section's `view.shape`.
 */
export const CHAT_REPLY_SHAPES = Object.freeze([
  'text',
  'list',
  'record',
  'mini-page',
  'file',
  'embed-card',
  'notification',
  'brief',
  'find',          // v0.7.5 — /find aggregator output
  'curation',      // before/after curation view (feedback-extension)
]);

/**
 * (basis v0.4, 2026-05-22) — frozen allow-list of op.runtime
 * values.  'both' (the default when absent) means the op works in any
 * environment.  Browser builds filter out 'node' ops; sidecars re-
 * include them.  Per OQ-1.A user resolution.
 */
export const RUNTIME_VALUES = Object.freeze(['browser', 'node', 'both']);

/**
 * Frozen allow-list of an
 * `Operation.onError` policy for composite ops.  'stop' (default when
 * absent) halts the composite on the first failing step; 'continue'
 * runs every step best-effort.  No rollback either way (v0 non-goal).
 */
export const COMPOSITE_ON_ERROR = Object.freeze(['stop', 'continue']);

/**
 * Nav-chrome (D / Surface 1) — frozen allow-list of a NavItem target's
 * `kind`.  The SHARED nav-chrome vocabulary both `manifest.tabs` (Surface 1)
 * and the future `manifest.actions` / nav-actions (Surface 2) key off:
 *   'nav' — selects an app-nav root that maps to NO op (`target.to`).
 *   'op'  — selects/dispatches a manifest op (`target.opId`).
 */
export const NAV_TARGET_KINDS = Object.freeze(['nav', 'op']);
const NAV_TARGET_KIND_SET = new Set(NAV_TARGET_KINDS);

/** @param {string} verb */
export function isCanonicalVerb(verb) { return VERB_SET.has(verb); }

/**
 * Validate a manifest.
 *
 * @param {import('./schema.js').Manifest} manifest
 * @param {object} [opts]
 * @param {boolean} [opts.strict=false]
 *   when `true`, every `view.dataSource.skillId`
 *   AND every `view.fields[].patch.opId` must be either declared in
 *   `manifest.operations[].id` OR in the new `manifest.externalSkills`
 *   allow-list.  Catches typos (e.g. `'getMispelled'`) at manifest
 *   level.  Default: non-strict (existing tolerant behaviour).
 * @param {boolean} [opts.atoms=false]
 *   B · Layer 1 (2026-07-01) — ATOM DISCIPLINE.  When `true`, every
 *   `op.verb` must be a known SDK atom (or alias — see `atoms.js`) OR be
 *   declared in `manifest.domainVerbs`.  This is the fitness function
 *   against verb drift: a new noun-specific verb can't sneak in without
 *   either mapping to an atom or being explicitly named as domain-specific.
 *   Default off (F-SP1-e tolerant behaviour preserved for older callers).
 * @param {boolean} [opts.strictNouns=false]
 *   L4 ≡ B (2026-07-05) — REGISTRY-NOUN DISCIPLINE. The `@onderling/item-types`
 *   registry is the source of truth for nouns. By DEFAULT every declared
 *   `manifest.itemTypes` entry (and, transitively, every `manifest.nouns` key —
 *   nouns keys must be a subset of itemTypes) that the registry does not
 *   recognise is reported as a NON-BLOCKING WARNING (`result.warnings`,
 *   code `noncanonical-itemtype`) — F-SP1-a app-local types keep validating.
 *   When `true`, those same findings become hard ERRORS (default-deny toward
 *   `(verb × noun) = (atom × item-type)`): a manifest may only declare nouns
 *   the shared registry knows. Opt-in so existing apps that still carry
 *   app-local nouns don't hard-break.
 *
 * @returns {{ ok: boolean, errors: Array<{path: string, message: string}>, warnings: Array<{path: string, message: string, code?: string}> }}
 *   `ok` reflects `errors` only — warnings never flip `ok`. `warnings` is
 *   always present (empty array when clean); forward-additive for callers that
 *   only read `{ ok, errors }`.
 */
export function validateManifest(manifest, opts = {}) {
  const errors = [];
  /** @type {Array<{path: string, message: string, code?: string}>} */
  const warnings = [];
  const strict = !!opts.strict;
  const strictNouns = !!opts.strictNouns;
  // L4 ≡ B — a registry-unknown noun/item-type is an ERROR under strictNouns
  // (default-deny) and otherwise a non-blocking WARNING (F-SP1-a compatible).
  const registrySink = strictNouns ? errors : warnings;

  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, errors: [{ path: '/', message: 'manifest must be an object' }], warnings };
  }

  if (typeof manifest.app !== 'string' || manifest.app === '') {
    errors.push({ path: '/app', message: 'app must be a non-empty string' });
  }

  if (!Array.isArray(manifest.itemTypes)) {
    errors.push({ path: '/itemTypes', message: 'itemTypes must be an array' });
  } else {
    const seen = new Set();
    manifest.itemTypes.forEach((t, i) => {
      const p = `/itemTypes/${i}`;
      if (typeof t !== 'string' || t === '') {
        errors.push({ path: p, message: 'itemType entries must be non-empty strings' });
      } else if (seen.has(t)) {
        errors.push({ path: p, message: `duplicate itemType "${t}"` });
      } else {
        seen.add(t);
        // L4 ≡ B — converge the declared noun surface with the shared
        // `@onderling/item-types` registry (source of truth). A registry-unknown
        // type is a WARNING by default (F-SP1-a app-local types keep working)
        // and a hard ERROR under `opts.strictNouns` (default-deny).
        if (!isRegistryType(t)) {
          registrySink.push({
            path:    p,
            message: `itemType "${t}" is not declared in the @onderling/item-types registry (the registry is the source of truth for nouns)`,
            code:    'noncanonical-itemtype',
          });
        }
      }
    });
  }

  if (!Array.isArray(manifest.operations)) {
    errors.push({ path: '/operations', message: 'operations must be an array' });
  } else {
    const ids = new Set();
    manifest.operations.forEach((op, i) => {
      validateOperation(op, `/operations/${i}`, manifest, errors, ids, opts);
    });
  }

  // B · Layer 1 — `manifest.domainVerbs` is the explicit allow-list of
  // NON-atom (domain-specific) verbs this manifest ships (folio `sync`,
  // stoop `report`/`mute`, household `register`/`help`, …).  Validated as a
  // string array whenever present; the atom-discipline cross-check
  // (op.verb ∈ atoms ∪ domainVerbs) only fires under `opts.atoms`.
  if (manifest.domainVerbs !== undefined) {
    if (!Array.isArray(manifest.domainVerbs)) {
      errors.push({ path: '/domainVerbs', message: 'domainVerbs must be an array if present' });
    } else {
      manifest.domainVerbs.forEach((v, i) => {
        if (typeof v !== 'string' || v === '') {
          errors.push({ path: `/domainVerbs/${i}`, message: 'domainVerbs entries must be non-empty strings' });
        } else if (isAtom(v)) {
          // A domain verb that IS an atom is a mistake — it should just be used as the atom.
          errors.push({
            path:    `/domainVerbs/${i}`,
            message: `domainVerbs entry "${v}" is an SDK atom (or alias) — use it directly, don't declare it as a domain verb`,
            code:    'atom-in-domain-verbs',
          });
        }
      });
    }
  }

  // B · Layer 1 — `manifest.nouns` declares, PER NOUN (item type), which SDK
  // atoms apply: the (verb × noun) CAPABILITY SURFACE the B gate + the wizard
  // read (a noun "gets the standard verbs" by listing them here, decoupled
  // from whether a bespoke op exists yet).  Shape-validated whenever present.
  if (manifest.nouns !== undefined) {
    if (!manifest.nouns || typeof manifest.nouns !== 'object' || Array.isArray(manifest.nouns)) {
      errors.push({ path: '/nouns', message: 'nouns must be an object (itemType → { atoms }) if present' });
    } else {
      const itemTypes = Array.isArray(manifest.itemTypes) ? manifest.itemTypes : [];
      for (const [noun, decl] of Object.entries(manifest.nouns)) {
        const np = `/nouns/${noun}`;
        if (itemTypes.length && !itemTypes.includes(noun)) {
          errors.push({ path: np, message: `nouns key "${noun}" is not in manifest.itemTypes`, code: 'unknown-noun' });
        }
        if (!decl || typeof decl !== 'object' || Array.isArray(decl)) {
          errors.push({ path: np, message: 'nouns entry must be an object with an `atoms` array' });
          continue;
        }
        if (!Array.isArray(decl.atoms)) {
          errors.push({ path: `${np}/atoms`, message: 'nouns[noun].atoms must be an array' });
          continue;
        }
        decl.atoms.forEach((a, i) => {
          const ap = `${np}/atoms/${i}`;
          if (typeof a !== 'string' || a === '') {
            errors.push({ path: ap, message: 'atoms entries must be non-empty strings' });
          } else if (!isAtom(a)) {
            errors.push({ path: ap, message: `atom "${a}" is not an SDK atom (see atoms.js)`, code: 'unknown-atom' });
          } else if (canonicalAtom(a) !== a) {
            // Declarations must use the CANONICAL spelling, not an alias (keeps the surface unambiguous).
            errors.push({
              path:    ap,
              message: `atom "${a}" is an alias — declare the canonical atom "${canonicalAtom(a)}" instead`,
              code:    'alias-in-nouns',
            });
          }
        });
      }
    }
  }

  if (manifest.views !== undefined) {
    if (!Array.isArray(manifest.views)) {
      errors.push({ path: '/views', message: 'views must be an array if present' });
    } else {
      const ids = new Set();
      manifest.views.forEach((v, i) => {
        validateView(v, `/views/${i}`, manifest, errors, ids, strict);
      });
    }
  }

  // Nav-chrome (D / Surface 1) — `manifest.tabs` declares the ordered
  // top-level TAB BAR roots (the four screens/circles/contacten/mij tabs).
  // Each entry is a NavItem `{ id, labelKey, icon?, target }`.  Validated by
  // `validateNavItem`, the SHARED nav-chrome helper the future `nav-actions`
  // kind (Surface 2) also uses.  Forward-additive: absent → no tab bar.
  if (manifest.tabs !== undefined) {
    if (!Array.isArray(manifest.tabs)) {
      errors.push({ path: '/tabs', message: 'tabs must be an array if present' });
    } else {
      const tabIds = new Set();
      manifest.tabs.forEach((tab, i) => {
        validateNavItem(tab, `/tabs/${i}`, manifest, errors, tabIds, strict);
      });
    }
  }

  // Nav-chrome (D / Surface 2) — `manifest.actions` declares the ordered
  // DETAIL ACTION BAR: the per-detail nav buttons to sibling screens (the
  // circle detail bar's back/settings/viewAs/advisor/skills/files/rules/…).
  // A SIBLING nav-chrome kind to `tabs`: the SAME NavItem `{ id, labelKey,
  // icon?, target }` shape + the SAME `validateNavItem` helper, plus the
  // OPTIONAL gate fields (`requires`, `platforms`) an action's context-gating
  // needs.  Forward-additive: absent → no action bar.
  if (manifest.actions !== undefined) {
    if (!Array.isArray(manifest.actions)) {
      errors.push({ path: '/actions', message: 'actions must be an array if present' });
    } else {
      const actionIds = new Set();
      manifest.actions.forEach((action, i) => {
        validateNavItem(action, `/actions/${i}`, manifest, errors, actionIds, strict);
      });
    }
  }

  // (strict mode only) — `manifest.externalSkills` is the
  // forward-additive allow-list for skill ids that live outside the
  // manifest's `operations[]` (e.g. household's `listMine` from
  // buildSkills).  Validated as a string array if present; missing
  // is fine.
  if (manifest.externalSkills !== undefined) {
    if (!Array.isArray(manifest.externalSkills)) {
      errors.push({
        path:    '/externalSkills',
        message: 'externalSkills must be an array if present',
      });
    } else {
      manifest.externalSkills.forEach((s, i) => {
        if (typeof s !== 'string' || s === '') {
          errors.push({
            path:    `/externalSkills/${i}`,
            message: 'externalSkills entries must be non-empty strings',
          });
        }
      });
    }
  }

  // B · (ruling) — `manifest.settings`: the app's declarative settings, shaped like op
  // params so one renderer draws inline forms + the creation wizard.  Shape-validated whenever present.
  if (manifest.settings !== undefined) {
    if (!Array.isArray(manifest.settings)) {
      errors.push({ path: '/settings', message: 'settings must be an array if present' });
    } else {
      const keys = new Set();
      manifest.settings.forEach((s, i) => validateSetting(s, `/settings/${i}`, errors, keys));
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Build the set of skill ids that count as "known" for strict
 * cross-check: operations[].id ∪ externalSkills[].
 */
function knownSkillIds(manifest) {
  const set = new Set();
  if (Array.isArray(manifest.operations)) {
    for (const op of manifest.operations) {
      if (typeof op?.id === 'string') set.add(op.id);
    }
  }
  if (Array.isArray(manifest.externalSkills)) {
    for (const s of manifest.externalSkills) {
      if (typeof s === 'string') set.add(s);
    }
  }
  return set;
}

function validateOperation(op, path, manifest, errors, idSet, opts = {}) {
  if (!op || typeof op !== 'object') {
    errors.push({ path, message: 'operation must be an object' });
    return;
  }

  if (typeof op.id !== 'string' || op.id === '') {
    errors.push({ path: `${path}/id`, message: 'op.id must be a non-empty string' });
  } else if (idSet.has(op.id)) {
    errors.push({ path: `${path}/id`, message: `duplicate operation id "${op.id}"` });
  } else {
    idSet.add(op.id);
  }

  // F-SP1-e (locked 2026-05-19): any non-empty string is permitted; `VERBS`
  // (item-store) membership stays informational (use `isCanonicalVerb` for the
  // strict ItemStore-mapping check).  Apps may declare app-specific verbs like
  // `help` that don't map to ItemStore — parallel to F-SP1-a for item types.
  if (typeof op.verb !== 'string' || op.verb === '') {
    errors.push({
      path:    `${path}/verb`,
      message: `op.verb must be a non-empty string (got ${JSON.stringify(op.verb)})`,
    });
  } else if (opts.atoms) {
    // B · Layer 1 — atom discipline (opt-in).  The verb must be a known
    // SDK atom (or alias) OR explicitly declared as a domain verb.  Drift
    // guard: a new noun-specific verb fails here until it's mapped to an
    // atom or named in `manifest.domainVerbs`.
    const domainVerbs = Array.isArray(manifest?.domainVerbs) ? manifest.domainVerbs : [];
    if (!isAtom(op.verb) && !domainVerbs.includes(op.verb)) {
      errors.push({
        path:    `${path}/verb`,
        message: `op.verb "${op.verb}" is not an SDK atom (see atoms.js) and is not in manifest.domainVerbs — map it to an atom (add/list/get/update/remove/complete/claim/reassign/…) or declare it as a domain verb`,
        code:    'unknown-verb',
      });
    }
  }

  if (op.params !== undefined) {
    if (!Array.isArray(op.params)) {
      errors.push({ path: `${path}/params`, message: 'params must be an array if present' });
    } else {
      op.params.forEach((p, j) => validateParam(p, `${path}/params/${j}`, errors, manifest));
    }
  }

  // (basis, 2026-05-24) — optional `surfaces.page` slot
  // for ops that open a persistent rich-UI surface instead of (or
  // alongside) returning a chat reply.  Used by Cluster C wizards
  // (create-group, redeem-invite gate, restore-from-mnemonic, conflict
  // dispute, audience picker, encrypted backup) + future Settings /
  // contact-card panels.
  //
  // Web chat-shell interprets `kind` as a side-panel / modal / new
  // window respectively; mobile chat-shell maps the same declaration
  // to an RN nav screen (via @onderling chat-nav RN parallel).
  //
  //   kind: 'side-panel' | 'modal' | 'screen'  (required if surfaces.page exists)
  //   title?: string                            (rendered in panel header)
  //   route?: string                            (mobile nav route; web ignores)
  const pageSurface = op?.surfaces?.page;
  if (pageSurface !== undefined) {
    if (!pageSurface || typeof pageSurface !== 'object' || Array.isArray(pageSurface)) {
      errors.push({
        path:    `${path}/surfaces/page`,
        message: 'surfaces.page must be an object if present',
      });
    } else {
      const PAGE_KINDS = ['side-panel', 'modal', 'screen'];
      if (!PAGE_KINDS.includes(pageSurface.kind)) {
        errors.push({
          path:    `${path}/surfaces/page/kind`,
          message: `surfaces.page.kind must be one of ${PAGE_KINDS.map((k) => `'${k}'`).join(' | ')}`,
        });
      }
      if (pageSurface.title !== undefined
          && (typeof pageSurface.title !== 'string' || pageSurface.title === '')) {
        errors.push({
          path:    `${path}/surfaces/page/title`,
          message: 'surfaces.page.title must be a non-empty string if present',
        });
      }
      if (pageSurface.route !== undefined
          && (typeof pageSurface.route !== 'string' || pageSurface.route === '')) {
        errors.push({
          path:    `${path}/surfaces/page/route`,
          message: 'surfaces.page.route must be a non-empty string if present',
        });
      }
    }
  }

  // optional `surfaces.ui.labelKey` for localisation.
  // Validate shape only; the projector decides whether to surface it.
  const uiLabelKey = op?.surfaces?.ui?.labelKey;
  if (uiLabelKey !== undefined
      && (typeof uiLabelKey !== 'string' || uiLabelKey === '')) {
    errors.push({
      path:    `${path}/surfaces/ui/labelKey`,
      message: 'surfaces.ui.labelKey must be a non-empty string if present',
    });
  }

  // optional `surfaces.ui.confirm` severity
  // hint for destructive / side-effect-bearing ops.  Adapters style
  // the confirm button accordingly (red for danger, yellow for warn,
  // neutral for info).  Closes Tier C #4 (consent-gated reads).
  // Passphrase / one-shot reveals stay app-side — out of scope.
  const uiConfirm = op?.surfaces?.ui?.confirm;
  if (uiConfirm !== undefined) {
    if (!uiConfirm || typeof uiConfirm !== 'object' || Array.isArray(uiConfirm)) {
      errors.push({
        path:    `${path}/surfaces/ui/confirm`,
        message: 'surfaces.ui.confirm must be an object if present',
      });
    } else {
      if (!['info', 'warn', 'danger'].includes(uiConfirm.severity)) {
        errors.push({
          path:    `${path}/surfaces/ui/confirm/severity`,
          message: "surfaces.ui.confirm.severity must be 'info' | 'warn' | 'danger'",
        });
      }
      if (uiConfirm.message !== undefined
          && (typeof uiConfirm.message !== 'string' || uiConfirm.message === '')) {
        errors.push({
          path:    `${path}/surfaces/ui/confirm/message`,
          message: 'surfaces.ui.confirm.message must be a non-empty string if present',
        });
      }
    }
  }

  // (basis v0.1, 2026-05-21) — optional `surfaces.chat.reply`
  // declares the shape of the reply the op produces, so the chat shell
  // picks the right renderer (text bubble, list with inline keyboard,
  // record/mini-page, file attachment, embed-card, notification card,
  // multi-section brief).  Forward-additive: absent → chat shell
  // computes a default from `verb` + `view.shape`.  See
  // `Project Files/basis/coding-plan.md` § Phase v0.1.
  const chatReply = op?.surfaces?.chat?.reply;
  if (chatReply !== undefined
      && !CHAT_REPLY_SHAPES.includes(chatReply)) {
    errors.push({
      path:    `${path}/surfaces/chat/reply`,
      message: `surfaces.chat.reply must be one of ${CHAT_REPLY_SHAPES.map((s) => `'${s}'`).join(' | ')}`,
    });
  }

  // (basis v0.4, 2026-05-22) — optional `surfaces.chat.followUps`
  // lets an op declare suggested next actions the chat shell surfaces
  // as inline buttons after a successful dispatch.  Each entry has an
  // opId (the suggested next op) and optional prefilledArgs.  Cross-
  // app chains (e.g. after household.addMember → folio.share) live in
  // basis's static registry, NOT here.
  const chatFollowUps = op?.surfaces?.chat?.followUps;
  if (chatFollowUps !== undefined) {
    if (!Array.isArray(chatFollowUps)) {
      errors.push({
        path:    `${path}/surfaces/chat/followUps`,
        message: 'surfaces.chat.followUps must be an array if present',
      });
    } else {
      chatFollowUps.forEach((f, i) => {
        const p = `${path}/surfaces/chat/followUps/${i}`;
        if (!f || typeof f !== 'object' || Array.isArray(f)) {
          errors.push({ path: p, message: 'followUp entry must be an object' });
          return;
        }
        if (typeof f.opId !== 'string' || f.opId === '') {
          errors.push({ path: `${p}/opId`, message: 'followUp.opId must be a non-empty string' });
        }
        if (f.prefilledArgs !== undefined
            && (!f.prefilledArgs || typeof f.prefilledArgs !== 'object' || Array.isArray(f.prefilledArgs))) {
          errors.push({
            path:    `${p}/prefilledArgs`,
            message: 'followUp.prefilledArgs must be an object if present',
          });
        }
      });
    }
  }

  // (basis v0.4, 2026-05-22) — optional `op.runtime` tag
  // declares which runtimes the op's skill implementation supports.
  // Values: 'browser' | 'node' | 'both' (default 'both' when absent).
  // basis's browser-side merge filters out `runtime: 'node'`
  // ops (folio's sync/watch family); a future sidecar deployment
  // re-includes them.  Per OQ-1.A resolution.
  if (op.runtime !== undefined && !RUNTIME_VALUES.includes(op.runtime)) {
    errors.push({
      path:    `${path}/runtime`,
      message: `op.runtime must be one of ${RUNTIME_VALUES.map((s) => `'${s}'`).join(' | ')}`,
    });
  }

  // (basis v0.7, 2026-05-23) — optional `surfaces.chat.brief`
  // declares the skill the chat-shell `/brief` aggregator calls to
  // get this app's morning-brief summary.  Optional `order` controls
  // section ordering across apps; `label` overrides the default
  // section title (defaults to the app name).
  const chatBrief = op?.surfaces?.chat?.brief;
  if (chatBrief !== undefined) {
    if (!chatBrief || typeof chatBrief !== 'object' || Array.isArray(chatBrief)) {
      errors.push({
        path:    `${path}/surfaces/chat/brief`,
        message: 'surfaces.chat.brief must be an object if present',
      });
    } else {
      if (typeof chatBrief.summarySkill !== 'string' || chatBrief.summarySkill === '') {
        errors.push({
          path:    `${path}/surfaces/chat/brief/summarySkill`,
          message: 'surfaces.chat.brief.summarySkill must be a non-empty string',
        });
      }
      if (chatBrief.order !== undefined && typeof chatBrief.order !== 'number') {
        errors.push({
          path:    `${path}/surfaces/chat/brief/order`,
          message: 'surfaces.chat.brief.order must be a number if present',
        });
      }
      if (chatBrief.label !== undefined && typeof chatBrief.label !== 'string') {
        errors.push({
          path:    `${path}/surfaces/chat/brief/label`,
          message: 'surfaces.chat.brief.label must be a string if present',
        });
      }
    }
  }

  // (basis v0.7.5, 2026-05-23) — optional `surfaces.chat.search`
  // declares the skill the chat-shell `/find` aggregator calls to
  // search this app's cached items.  Per user resolution: cache-first
  // (instant + works offline); an [Extensive search] button on the
  // result card triggers deeper queries (pod/network) — separate
  // skill, not in scope for v0.7.5.
  const chatSearch = op?.surfaces?.chat?.search;
  if (chatSearch !== undefined) {
    if (!chatSearch || typeof chatSearch !== 'object' || Array.isArray(chatSearch)) {
      errors.push({
        path:    `${path}/surfaces/chat/search`,
        message: 'surfaces.chat.search must be an object if present',
      });
    } else if (typeof chatSearch.searchSkill !== 'string'
               || chatSearch.searchSkill === '') {
      errors.push({
        path:    `${path}/surfaces/chat/search/searchSkill`,
        message: 'surfaces.chat.search.searchSkill must be a non-empty string',
      });
    }
  }

  // (basis v0.5, 2026-05-22) — optional `surfaces.chat.embed`
  // declares the skill that produces a snapshot for the J7 embed
  // primitive (cards inserted into P2P chat messages).  When set, the
  // chat shell knows it can call this op as an inline-card factory;
  // dispatch produces an ItemSnapshot for the embed envelope.  See
  // `DESIGN-basis.md` § Embed primitive (J7).
  const chatEmbed = op?.surfaces?.chat?.embed;
  if (chatEmbed !== undefined) {
    if (!chatEmbed || typeof chatEmbed !== 'object' || Array.isArray(chatEmbed)) {
      errors.push({
        path:    `${path}/surfaces/chat/embed`,
        message: 'surfaces.chat.embed must be an object if present',
      });
    } else if (typeof chatEmbed.cardSnapshotSkill !== 'string'
               || chatEmbed.cardSnapshotSkill === '') {
      errors.push({
        path:    `${path}/surfaces/chat/embed/cardSnapshotSkill`,
        message: 'surfaces.chat.embed.cardSnapshotSkill must be a non-empty string',
      });
    }
  }

  // (feedback-extension DESIGN §1.3) — `op.steps` makes this op a
  // COMPOSITE: a pure-data sequence of EXISTING opIds run by
  // `runCompositeOp`.  Validate STRUCTURE here (each step has a string
  // appOrigin + opId; `args`/`argRef` are well-shaped).  The CATALOGUE-
  // level check — "every step's opId actually resolves" — is the
  // verifier's job (`verifyComposite`, sandbox-by-construction), because
  // it needs the merged cross-app catalogue, not a single manifest.
  if (op.steps !== undefined) {
    if (!Array.isArray(op.steps)) {
      errors.push({ path: `${path}/steps`, message: 'op.steps must be an array if present' });
    } else if (op.steps.length === 0) {
      errors.push({ path: `${path}/steps`, message: 'op.steps must not be empty when present' });
    } else {
      op.steps.forEach((step, j) => {
        const sp = `${path}/steps/${j}`;
        if (!step || typeof step !== 'object' || Array.isArray(step)) {
          errors.push({ path: sp, message: 'composite step must be an object' });
          return;
        }
        if (typeof step.appOrigin !== 'string' || step.appOrigin === '') {
          errors.push({ path: `${sp}/appOrigin`, message: 'step.appOrigin must be a non-empty string' });
        }
        if (typeof step.opId !== 'string' || step.opId === '') {
          errors.push({ path: `${sp}/opId`, message: 'step.opId must be a non-empty string' });
        }
        if (step.args !== undefined
            && (!step.args || typeof step.args !== 'object' || Array.isArray(step.args))) {
          errors.push({ path: `${sp}/args`, message: 'step.args must be an object if present' });
        }
        if (step.argRef !== undefined) {
          const ar = step.argRef;
          if (!ar || typeof ar !== 'object' || Array.isArray(ar)) {
            errors.push({ path: `${sp}/argRef`, message: 'step.argRef must be an object if present' });
          } else {
            if (!Number.isInteger(ar.from) || ar.from < 0 || ar.from >= j) {
              errors.push({
                path:    `${sp}/argRef/from`,
                message: `step.argRef.from must be an integer index of a PRIOR step (0..${j - 1})`,
              });
            }
            if (typeof ar.path !== 'string' || ar.path === '') {
              errors.push({ path: `${sp}/argRef/path`, message: 'step.argRef.path must be a non-empty dot-path string' });
            }
            if (ar.as !== undefined && (typeof ar.as !== 'string' || ar.as === '')) {
              errors.push({ path: `${sp}/argRef/as`, message: 'step.argRef.as must be a non-empty string if present' });
            }
          }
        }
      });
    }
  }
  if (op.onError !== undefined && !COMPOSITE_ON_ERROR.includes(op.onError)) {
    errors.push({
      path:    `${path}/onError`,
      message: `op.onError must be one of ${COMPOSITE_ON_ERROR.map((s) => `'${s}'`).join(' | ')}`,
    });
  }
  // `onError` is only meaningful on a composite — flag it on a plain op
  // so authors don't think a non-composite honours it.
  if (op.onError !== undefined && op.steps === undefined) {
    errors.push({
      path:    `${path}/onError`,
      message: 'op.onError is only meaningful when op.steps is present (composite op)',
    });
  }

  if (op.appliesTo !== undefined) {
    // An appliesTo may only carry discriminators the MATCHERS actually honour. `kind` was
    // declared in five rows across two manifests while every matcher ignored it, so those rows
    // read as narrow and behaved as wide — an approve-proposal action offered on every inbox
    // item, a lend action on every offer. An unknown key is now an error rather than a no-op.
    if (op.appliesTo && typeof op.appliesTo === 'object' && !Array.isArray(op.appliesTo)) {
      const KNOWN = ['type', 'kind', 'state'];
      Object.keys(op.appliesTo).forEach((k) => {
        if (!KNOWN.includes(k)) {
          errors.push({ path: `${path}/appliesTo/${k}`, message: `appliesTo.${k} is not a discriminator any matcher honours (known: ${KNOWN.join(', ')})` });
        }
      });
    }
    if (op.appliesTo === null || typeof op.appliesTo !== 'object' || Array.isArray(op.appliesTo)) {
      errors.push({ path: `${path}/appliesTo`, message: 'appliesTo must be an object if present' });
    } else if (op.appliesTo.type !== undefined) {
      const types = Array.isArray(op.appliesTo.type) ? op.appliesTo.type : [op.appliesTo.type];
      types.forEach((t, j) => {
        const p = `${path}/appliesTo/type${Array.isArray(op.appliesTo.type) ? `/${j}` : ''}`;
        if (typeof t !== 'string') {
          errors.push({ path: p, message: 'appliesTo.type must be a string or array of strings' });
        } else if (t === '*') {
          // NavModel (2026-05-21) — wildcard: "any of manifest.
          // itemTypes".  Permitted; rendered as itemAction in every
          // section by renderWeb's wildcard rule.
        } else if (Array.isArray(manifest.itemTypes) && !manifest.itemTypes.includes(t)) {
          errors.push({ path: p, message: `appliesTo.type "${t}" is not in manifest.itemTypes` });
        }
      });
    }
  }
}

/**
 * Validate one Setting (B, ruling) — mirrors validateParam's rigor. A setting is
 * user-facing config the wizard/form renders; `default` is sanity-checked against `kind`.
 */
function validateSetting(s, path, errors, keySet) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    errors.push({ path, message: 'setting must be an object' });
    return;
  }
  if (typeof s.key !== 'string' || s.key === '') {
    errors.push({ path: `${path}/key`, message: 'setting.key must be a non-empty string' });
  } else if (keySet.has(s.key)) {
    errors.push({ path: `${path}/key`, message: `duplicate setting key "${s.key}"`, code: 'duplicate-setting' });
  } else {
    keySet.add(s.key);
  }
  if (typeof s.label !== 'string' || s.label === '') {
    errors.push({ path: `${path}/label`, message: 'setting.label must be a non-empty string' });
  }
  if (!SETTING_KIND_SET.has(s.kind)) {
    errors.push({
      path:    `${path}/kind`,
      message: `setting.kind must be one of ${SETTING_KINDS.join('|')} (got ${JSON.stringify(s.kind)})`,
    });
  }
  if (s.kind === 'choice') {
    if (!Array.isArray(s.of) || s.of.length === 0) {
      errors.push({ path: `${path}/of`, message: "setting.kind='choice' requires a non-empty 'of' array" });
    } else if (s.of.some((v) => typeof v !== 'string')) {
      errors.push({ path: `${path}/of`, message: 'setting.of must contain only strings' });
    }
  }
  if (s.kind === 'multi') {
    // A `multi` names WHERE its options come from instead of listing them. Requiring that name is what
    // stops a registry-driven control being declared with no way to populate it — the "declared but
    // nothing produces it" failure this repo has now hit three times.
    if (typeof s.optionsFrom !== 'string' || s.optionsFrom === '') {
      errors.push({
        path:    `${path}/optionsFrom`,
        message: "setting.kind='multi' requires 'optionsFrom' — the name of the option source the shell resolves",
      });
    }
    if (s.of !== undefined) {
      errors.push({
        path:    `${path}/of`,
        message: "setting.kind='multi' takes 'optionsFrom', not 'of' — a frozen list would drift from its registry",
      });
    }
  }
  if (s.scope !== undefined && !SETTING_SCOPE_SET.has(s.scope)) {
    errors.push({ path: `${path}/scope`, message: `setting.scope must be one of ${SETTING_SCOPES.join('|')}` });
  }
  if (s.adminOnly !== undefined && typeof s.adminOnly !== 'boolean') {
    errors.push({ path: `${path}/adminOnly`, message: 'setting.adminOnly must be a boolean if present' });
  }
  if (s.requiredWhen !== undefined) {
    if (!s.requiredWhen || typeof s.requiredWhen !== 'object' || Array.isArray(s.requiredWhen)) {
      errors.push({ path: `${path}/requiredWhen`, message: 'setting.requiredWhen must be an object if present' });
    } else if (Object.keys(s.requiredWhen).length === 0) {
      errors.push({ path: `${path}/requiredWhen`, message: 'setting.requiredWhen must have at least one key' });
    }
  }
  if (s.description !== undefined && (typeof s.description !== 'string' || s.description === '')) {
    errors.push({ path: `${path}/description`, message: 'setting.description must be a non-empty string if present' });
  }
  // `default` shape sanity — best-effort match against `kind`.
  if (s.default !== undefined) {
    const d = s.default;
    const bad =
      (s.kind === 'toggle' && typeof d !== 'boolean') ||
      (s.kind === 'number' && typeof d !== 'number') ||
      ((s.kind === 'text' || s.kind === 'member') && typeof d !== 'string') ||
      (s.kind === 'choice' && Array.isArray(s.of) && !s.of.includes(d));
    if (bad) {
      errors.push({ path: `${path}/default`, message: `setting.default ${JSON.stringify(d)} doesn't fit kind '${s.kind}'`, code: 'bad-default' });
    }
  }
}

function validateParam(p, path, errors, manifest) {
  if (!p || typeof p !== 'object') {
    errors.push({ path, message: 'param must be an object' });
    return;
  }
  if (typeof p.name !== 'string' || p.name === '') {
    errors.push({ path: `${path}/name`, message: 'param.name must be a non-empty string' });
  }
  if (!PARAM_KINDS.has(p.kind)) {
    errors.push({
      path:    `${path}/kind`,
      message: `param.kind must be one of ${[...PARAM_KINDS].join('|')} (got ${JSON.stringify(p.kind)})`,
    });
  }
  if (p.kind === 'enum') {
    if (p.of === undefined) {
      errors.push({ path: `${path}/of`, message: "param.kind='enum' requires 'of'" });
    } else if (typeof p.of === 'string') {
      if (p.of !== 'itemTypes') {
        errors.push({
          path:    `${path}/of`,
          message: `param.of string only supports 'itemTypes' (got ${JSON.stringify(p.of)})`,
        });
      }
    } else if (!Array.isArray(p.of)) {
      errors.push({ path: `${path}/of`, message: "param.of must be 'itemTypes' or an array of strings" });
    } else if (p.of.some((v) => typeof v !== 'string')) {
      errors.push({ path: `${path}/of`, message: 'param.of array must contain only strings' });
    } else if (p.name === 'type' && Array.isArray(manifest?.itemTypes)) {
      // Completeness parity with appliesTo.type (see validateOperation): an op
      // names its noun EITHER via `appliesTo.type` OR via a `type`-named enum
      // param whose inline `of` lists the item types (the `opNouns` convention
      // in capabilities.js — only a param NAMED `type` names nouns; value-enums
      // like mode/action/lang list option VALUES, not nouns, so they are NOT
      // cross-checked). appliesTo.type is validated against manifest.itemTypes;
      // this makes the symmetric param path enforce the SAME registry loop, so
      // a noun that isn't a declared itemType can't slip through silently.
      p.of.forEach((v, i) => {
        if (v !== '*' && !manifest.itemTypes.includes(v)) {
          errors.push({
            path:    `${path}/of/${i}`,
            message: `param.of "${v}" is not in manifest.itemTypes`,
          });
        }
      });
    }
  }

  // (basis v0.7, 2026-05-23) — optional `pickerSource` for
  // form-elicitation of ID-style params.  When a required param has
  // a `pickerSource: {listOp, filter?}` declaration AND the param
  // is missing on a slash invocation, the chat-shell renders a
  // CLICKABLE LIST instead of a text input.  Closes the UX gap on
  // /claim, /done bare, /embed bare etc.
  if (p.pickerSource !== undefined) {
    const ps = p.pickerSource;
    if (!ps || typeof ps !== 'object' || Array.isArray(ps)) {
      errors.push({
        path:    `${path}/pickerSource`,
        message: 'param.pickerSource must be an object if present',
      });
    } else {
      if (typeof ps.listOp !== 'string' || ps.listOp === '') {
        errors.push({
          path:    `${path}/pickerSource/listOp`,
          message: 'param.pickerSource.listOp must be a non-empty string',
        });
      }
      if (ps.filter !== undefined
          && (typeof ps.filter !== 'object' || Array.isArray(ps.filter))) {
        errors.push({
          path:    `${path}/pickerSource/filter`,
          message: 'param.pickerSource.filter must be an object if present',
        });
      }
    }
  }
}

function validateView(v, path, manifest, errors, idSet, strict = false) {
  if (!v || typeof v !== 'object') {
    errors.push({ path, message: 'view must be an object' });
    return;
  }
  if (typeof v.id !== 'string' || v.id === '') {
    errors.push({ path: `${path}/id`, message: 'view.id must be a non-empty string' });
  } else if (idSet.has(v.id)) {
    errors.push({ path: `${path}/id`, message: `duplicate view id "${v.id}"` });
  } else {
    idSet.add(v.id);
  }
  if (typeof v.type !== 'string' || v.type === '') {
    errors.push({ path: `${path}/type`, message: 'view.type must be a non-empty string' });
  } else if (Array.isArray(manifest.itemTypes) && !manifest.itemTypes.includes(v.type)) {
    errors.push({ path: `${path}/type`, message: `view.type "${v.type}" is not in manifest.itemTypes` });
  }
  if (typeof v.title !== 'string') {
    errors.push({ path: `${path}/title`, message: 'view.title must be a string' });
  }

  // D-mig-1a — optional list-surface field selectors.  Mirrors the
  // view.title string check: present-but-non-string → a validation error;
  // absent → unchanged (back-compatible).
  if (v.labelField !== undefined && typeof v.labelField !== 'string') {
    errors.push({ path: `${path}/labelField`, message: 'view.labelField must be a string if present' });
  }
  if (v.categoryField !== undefined && typeof v.categoryField !== 'string') {
    errors.push({ path: `${path}/categoryField`, message: 'view.categoryField must be a string if present' });
  }

  // D-mig-2 — optional free-text search-field selector.  Mirrors the
  // labelField/categoryField checks above, but the value is a string[]
  // (WHICH item fields the text filter matches).  Present-but-not-an-
  // array-of-strings → a validation error; absent → unchanged (the
  // consumer defaults to `[labelField]`, so behaviour is back-compatible).
  if (v.searchFields !== undefined) {
    if (!Array.isArray(v.searchFields)) {
      errors.push({ path: `${path}/searchFields`, message: 'view.searchFields must be an array of strings if present' });
    } else if (v.searchFields.some((f) => typeof f !== 'string' || f === '')) {
      errors.push({ path: `${path}/searchFields`, message: 'view.searchFields entries must be non-empty strings' });
    }
  }

  // view.shape: 'list' | 'record' (default 'list').
  // Forward-additive; existing manifests (no `shape` field) → implicit 'list'.
  if (v.shape !== undefined && v.shape !== 'list' && v.shape !== 'record') {
    errors.push({
      path: `${path}/shape`,
      message: `view.shape must be 'list' or 'record' (got ${JSON.stringify(v.shape)})`,
    });
  }

  // dataSource shape sanity check.
  // Loose verification; consumers (renderWeb / fetchSectionItems) are
  // tolerant if structure deviates.
  if (v.dataSource !== undefined) {
    if (v.dataSource === null || typeof v.dataSource !== 'object' || Array.isArray(v.dataSource)) {
      errors.push({ path: `${path}/dataSource`, message: 'view.dataSource must be an object if present' });
    } else if (typeof v.dataSource.skillId !== 'string' || v.dataSource.skillId === '') {
      errors.push({
        path: `${path}/dataSource/skillId`,
        message: 'view.dataSource.skillId must be a non-empty string',
      });
    } else if (strict) {
      // strict — verify skillId is declared in operations[]
      // OR in the externalSkills allow-list.  Surfaces typos.
      const known = knownSkillIds(manifest);
      if (!known.has(v.dataSource.skillId)) {
        errors.push({
          path:    `${path}/dataSource/skillId`,
          message: `unknown skillId "${v.dataSource.skillId}" (not in operations[] or externalSkills[])`,
          code:    'unknown-skillId',
        });
      }
    }
    if (v.dataSource.argsFromContext !== undefined) {
      if (v.dataSource.argsFromContext === null
          || typeof v.dataSource.argsFromContext !== 'object'
          || Array.isArray(v.dataSource.argsFromContext)) {
        errors.push({
          path: `${path}/dataSource/argsFromContext`,
          message: 'view.dataSource.argsFromContext must be an object if present',
        });
      }
    }
  }

  // view.fields[] for record-shape views.
  if (v.fields !== undefined) {
    if (!Array.isArray(v.fields)) {
      errors.push({ path: `${path}/fields`, message: 'view.fields must be an array if present' });
    } else if (v.shape !== 'record') {
      errors.push({
        path:    `${path}/fields`,
        message: "view.fields only meaningful when view.shape === 'record'",
      });
    } else {
      const knownIds = strict ? knownSkillIds(manifest) : null;
      v.fields.forEach((f, j) => {
        const fp = `${path}/fields/${j}`;
        if (!f || typeof f !== 'object') {
          errors.push({ path: fp, message: 'field must be an object' });
          return;
        }
        if (typeof f.name !== 'string' || f.name === '') {
          errors.push({
            path:    `${fp}/name`,
            message: 'field.name must be a non-empty string',
          });
        }
        // optional `labelKey` for localisation
        // resolution.  Must be a non-empty string when present;
        // consumer-side lookup, no adapter wiring.
        if (f.labelKey !== undefined
            && (typeof f.labelKey !== 'string' || f.labelKey === '')) {
          errors.push({
            path:    `${fp}/labelKey`,
            message: 'field.labelKey must be a non-empty string if present',
          });
        }
        // `field.type` is documented in
        // `renderWeb.js` (recognized set: string|number|boolean|enum|
        // object|file|image).  Validator only insists on "string when
        // present" — unknown types pass through (consumers may
        // experiment with new shapes before they're codified).
        if (f.type !== undefined && typeof f.type !== 'string') {
          errors.push({
            path:    `${fp}/type`,
            message: 'field.type must be a string if present',
          });
        }
        // conditional-display gate.
        // `field.requiresField: {<otherField>: <value | value[]>}`
        // hides this field unless every named field on the record
        // matches one of the allowed values.  Same shape as
        // appliesTo.state gate; consumer-side resolution.
        if (f.requiresField !== undefined) {
          if (!f.requiresField || typeof f.requiresField !== 'object'
              || Array.isArray(f.requiresField)) {
            errors.push({
              path:    `${fp}/requiresField`,
              message: 'field.requiresField must be an object if present',
            });
          } else {
            const keys = Object.keys(f.requiresField);
            if (keys.length === 0) {
              errors.push({
                path:    `${fp}/requiresField`,
                message: 'field.requiresField must have at least one key',
              });
            }
          }
        }
        // optional per-field read skill for
        // multi-skill records.  Same shape as `view.dataSource`: an
        // object with non-empty `skillId` + optional `args` object.
        // When present, adapter calls this skill to resolve the
        // field's value instead of reading from the record's
        // dataSource result.
        if (f.readSkill !== undefined) {
          if (!f.readSkill || typeof f.readSkill !== 'object' || Array.isArray(f.readSkill)) {
            errors.push({
              path:    `${fp}/readSkill`,
              message: 'field.readSkill must be an object if present',
            });
          } else {
            if (typeof f.readSkill.skillId !== 'string' || f.readSkill.skillId === '') {
              errors.push({
                path:    `${fp}/readSkill/skillId`,
                message: 'field.readSkill.skillId must be a non-empty string',
              });
            } else if (strict && knownIds && !knownIds.has(f.readSkill.skillId)) {
              errors.push({
                path:    `${fp}/readSkill/skillId`,
                message: `unknown skillId "${f.readSkill.skillId}" (not in operations[] or externalSkills[])`,
                code:    'unknown-skillId',
              });
            }
            if (f.readSkill.args !== undefined
                && (typeof f.readSkill.args !== 'object'
                    || f.readSkill.args === null
                    || Array.isArray(f.readSkill.args))) {
              errors.push({
                path:    `${fp}/readSkill/args`,
                message: 'field.readSkill.args must be an object if present',
              });
            }
          }
        }
        if (f.patch !== undefined) {
          if (!f.patch || typeof f.patch !== 'object' || Array.isArray(f.patch)) {
            errors.push({ path: `${fp}/patch`, message: 'field.patch must be an object if present' });
          } else {
            if (typeof f.patch.opId !== 'string' || f.patch.opId === '') {
              errors.push({
                path:    `${fp}/patch/opId`,
                message: 'field.patch.opId must be a non-empty string',
              });
            } else if (strict && knownIds && !knownIds.has(f.patch.opId)) {
              errors.push({
                path:    `${fp}/patch/opId`,
                message: `unknown opId "${f.patch.opId}" (not in operations[] or externalSkills[])`,
                code:    'unknown-skillId',
              });
            }
            if (typeof f.patch.argName !== 'string' || f.patch.argName === '') {
              errors.push({
                path:    `${fp}/patch/argName`,
                message: 'field.patch.argName must be a non-empty string',
              });
            }
            // optional `argWrapper`. When
            // present, must be a non-empty string; signals the adapter
            // to dispatch a wrapped patch shape
            // (`opId({[argWrapper]: {[argName]: newValue}})`).
            if (f.patch.argWrapper !== undefined
                && (typeof f.patch.argWrapper !== 'string' || f.patch.argWrapper === '')) {
              errors.push({
                path:    `${fp}/patch/argWrapper`,
                message: 'field.patch.argWrapper must be a non-empty string if present',
              });
            }
          }
        }
      });
    }
  }
}

/**
 * Nav-chrome (D / Surface 1) — validate one NavItem (a `manifest.tabs[]`
 * entry today; a `manifest.actions[]` entry once nav-actions lands).  The
 * SHARED validator for every nav-chrome list, so both surfaces enforce the
 * one `{ id, labelKey, icon?, target }` contract.
 *
 *   - `id`       — non-empty string, unique within the list.
 *   - `labelKey` — non-empty string (invariant #8: every user-facing tab
 *                  label resolves through `t()` from a locale key).
 *   - `icon`     — optional; non-empty string when present.
 *   - `target`   — required object; `{kind:'nav', to}` or `{kind:'op', opId}`
 *                  (NavTarget union).  Under `strict`, a `kind:'op'` target's
 *                  `opId` must resolve in operations[] / externalSkills[].
 *
 * Nav-chrome (D / Surface 2) — the OPTIONAL gate fields a `manifest.actions[]`
 * detail-bar item carries so its context-gating rides through the projection
 * instead of being re-hardcoded per shell (`tabs` never set these):
 *   - `requires`  — optional; non-empty array of non-empty strings.  The
 *                   feature keys (e.g. `['memberDirectory']`, `['lists','notes']`)
 *                   that gate the action; the consumer shows it when ANY listed
 *                   feature is enabled (OR semantics — matches the current
 *                   `isFeatureEnabled(policy, 'lists') || …` gate).  The pure
 *                   projector only CARRIES this; the app-side selector evaluates it.
 *   - `platforms` — optional; non-empty array of non-empty strings.  The
 *                   platform tags the action is available on (e.g. `['mobile']`
 *                   for a destination whose target screen exists on mobile only).
 *                   Absent → all platforms.  Lets the manifest DECLARE a
 *                   platform gap instead of a divergent hardcoded button list.
 *
 * @param {*} item
 * @param {string} path
 * @param {object} manifest
 * @param {Array} errors
 * @param {Set<string>} idSet
 * @param {boolean} [strict=false]
 */
function validateNavItem(item, path, manifest, errors, idSet, strict = false) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    errors.push({ path, message: 'nav item must be an object' });
    return;
  }
  if (typeof item.id !== 'string' || item.id === '') {
    errors.push({ path: `${path}/id`, message: 'nav item.id must be a non-empty string' });
  } else if (idSet.has(item.id)) {
    errors.push({ path: `${path}/id`, message: `duplicate nav item id "${item.id}"`, code: 'duplicate-nav-id' });
  } else {
    idSet.add(item.id);
  }
  if (typeof item.labelKey !== 'string' || item.labelKey === '') {
    errors.push({ path: `${path}/labelKey`, message: 'nav item.labelKey must be a non-empty string' });
  }
  if (item.icon !== undefined && (typeof item.icon !== 'string' || item.icon === '')) {
    errors.push({ path: `${path}/icon`, message: 'nav item.icon must be a non-empty string if present' });
  }
  // Nav-chrome (D / Surface 2) — optional gate fields (detail-bar actions).
  // Each, when present, must be a non-empty array of non-empty strings.
  for (const field of ['requires', 'platforms']) {
    const v = item[field];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== 'string' || x === '')) {
      errors.push({
        path:    `${path}/${field}`,
        message: `nav item.${field} must be a non-empty array of non-empty strings if present`,
      });
    }
  }
  const target = item.target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    errors.push({ path: `${path}/target`, message: 'nav item.target must be an object' });
    return;
  }
  if (!NAV_TARGET_KIND_SET.has(target.kind)) {
    errors.push({
      path:    `${path}/target/kind`,
      message: `nav item.target.kind must be one of ${NAV_TARGET_KINDS.map((k) => `'${k}'`).join(' | ')}`,
    });
    return;
  }
  if (target.kind === 'nav') {
    if (typeof target.to !== 'string' || target.to === '') {
      errors.push({ path: `${path}/target/to`, message: "nav item.target.to must be a non-empty string when kind === 'nav'" });
    }
  } else if (target.kind === 'op') {
    if (typeof target.opId !== 'string' || target.opId === '') {
      errors.push({ path: `${path}/target/opId`, message: "nav item.target.opId must be a non-empty string when kind === 'op'" });
    } else if (strict) {
      // strict — the op the tab dispatches must resolve in the manifest.
      const known = knownSkillIds(manifest);
      if (!known.has(target.opId)) {
        errors.push({
          path:    `${path}/target/opId`,
          message: `unknown opId "${target.opId}" (not in operations[] or externalSkills[])`,
          code:    'unknown-skillId',
        });
      }
    }
  }
}

/**
 * Informational helper: split a manifest's `itemTypes` into canonical
 * (registered in `@onderling/item-types` `list()`) vs app-local.
 *
 * `validateManifest` does NOT reject app-local types (F-SP1-a); this is
 * pure introspection for tooling / docs / debug output.
 *
 * @param {import('./schema.js').Manifest} manifest
 * @returns {{ canonical: string[], appLocal: string[] }}
 */
export function classifyItemTypes(manifest) {
  const canonicalSet = new Set(listCanonicalTypes());
  const canonical    = [];
  const appLocal     = [];
  for (const t of (manifest?.itemTypes ?? [])) {
    (canonicalSet.has(t) ? canonical : appLocal).push(t);
  }
  return { canonical, appLocal };
}
