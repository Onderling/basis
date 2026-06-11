/**
 * Render the web-surface projection of a manifest: a `NavModel`.
 *
 * NavModel is **platform-neutral** — the same data structure feeds
 * `renderMobile` (Slice C of `PLAN-gui-chat-uplift.md`).  The killer
 * cross-surface property:
 *
 *   ∀ manifest m.  renderWeb(m) ≡ renderMobile(m)  (as JSON)
 *
 * Equivalence is **strict by default** (owner direction 2026-05-20).
 * Per-field exceptions are allowed only on explicit owner approval,
 * with an inline comment explaining the deviation.  When an exception
 * is added, also update `DESIGN-navmodel-sketch.md` § "Adapter
 * equivalence test depth".
 *
 * Deterministic: outputs follow manifest declaration order
 * (sections from `manifest.views`, affordances/itemActions from
 * `manifest.operations`).  See "Owner decisions" below.
 *
 * ──── Owner decisions (locked 2026-05-20) ─────────────────────────
 *   Q1. Detail-view: V0 = buttons-on-row only.  No `section.detail`
 *       field yet.  V1 may add when user tests show drilldowns are
 *       needed.
 *   Q2. Section ordering: preserve `manifest.views[]` declaration
 *       order.  Activity-based sort would shift sections around at
 *       runtime, which is jarring for users.  Matches `renderChat`
 *       discipline (also declaration-order).
 *   Q3. Globals source: inferred from
 *       `op.surfaces.ui.placement === 'global'`.  No new
 *       `manifest.navigation` block needed; forward-additive.
 *   Q4. Equivalence: strict JSON equality renderWeb≡renderMobile;
 *       owner-approved exceptions only.
 *   Q5. Item sort: `view.sort = {by, direction}` passed through to
 *       `section.sort`.  Forward-additive.  Adapter performs the
 *       sort.  User-reordering (interactive) deferred to V1+ (needs
 *       item-store ordinal field).
 * ─────────────────────────────────────────────────────────────────
 *
 * SP-0 Phase boundary (PLAN guardrail #9): this package DECLARES.
 * `@canopy/interface-registry` runs per-type item rendering — once
 * mature, NavModel will reference `renderCompact` / `renderFull` for
 * per-item cells instead of returning `{text, buttons}`.  V0 stays
 * with the minimal {text, buttons} contract; adapters render the row.
 *
 * @typedef {object} NavModel
 * @property {string}   app                manifest.app verbatim
 * @property {Section[]} sections          one per manifest.view (declaration order)
 * @property {Affordance[]} globals        top-level affordances (e.g. global Help)
 *
 * @typedef {object} Section
 * @property {string}   id                 mirrors view.id
 * @property {string}   title              mirrors view.title
 * @property {string}   itemType           mirrors view.type
 * @property {object}   [filter]           mirrors view.filter
 * @property {{by: string, direction?: 'asc'|'desc'}} [sort]
 *                                         mirrors view.sort (Q5)
 * @property {*}        [audience]         mirrors view.audience (SP-5b consumer)
 * @property {{skillId: string, args?: object}} [dataSource]
 *                                         mirrors view.dataSource (V0.2 Q7).
 *                                         When present, adapters call this
 *                                         skill (with merged args) instead
 *                                         of the default `listOpen({type})`
 *                                         heuristic.  Resolves the
 *                                         convergent gap flagged by B.2 +
 *                                         E.1 + B.1 agents (sections
 *                                         needing custom data fetchers
 *                                         like `listMine`, `listMyRequests`,
 *                                         `getDagTree`).
 * @property {Affordance[]} affordances    per-section actions (e.g. add-form)
 * @property {ItemAction[]} itemActions    per-item state-gated buttons
 *
 * @typedef {object} Affordance
 * @property {string}   opId               matches manifest.operation.id
 * @property {string}   label              from surfaces.ui.label or op.verb
 * @property {object}   paramsSchema       from paramsToJsonSchema(op.params)
 * @property {'section'|'global'} placement
 * @property {object}   [prefilledParams]  Q6 (locked 2026-05-20) — when an
 *                                         op surfaces in a section via the
 *                                         type-enum fallback (params:
 *                                         [{name:'type', kind:'enum',
 *                                         of:[…]}]), the section's itemType
 *                                         is recorded here so the adapter
 *                                         pre-fills the `type` param when
 *                                         calling the skill.
 *
 * @typedef {object} ItemAction
 * @property {string}   opId               matches manifest.operation.id
 * @property {string}   label              from surfaces.ui.label or op.verb
 * @property {{type?: string|string[]|'*', state?: string|string[]}} appliesTo
 *                                         passed through (F-SP3-a multi-state
 *                                         honoured).  V0.2 — `type` may be
 *                                         `'*'` (wildcard, Q8): matches every
 *                                         section regardless of itemType.
 *                                         Surfaced by stoop's `cancelRequest`
 *                                         spanning ask/offer/lend.
 * @property {object}   [prefilledParams]  same semantics as Affordance.prefilledParams
 *
 * Note on `callbackData`: the design sketch proposed a per-action
 * `callbackData` template (`"${opId}:${itemId}"`).  V0 stores just
 * `opId` here; the adapter constructs the dispatch key at render
 * time (`${opId}:${item.id}` for single-app, prefixed by manifest-
 * host when ≥2 apps composed).  Keeps NavModel pure-data.
 *
 * ──── Q6 — multi-type ops via type-enum fallback (locked 2026-05-20)
 *
 * Surfaced in A.2 by household's `addItem(type: shopping|errand|repair|
 * schedule, text)` — one chat-side tool, four web sections.  Three
 * surfacing rules:
 *
 *   (a) **`verb === 'add'` auto-surface.**  Add ops surface as section
 *       affordances without needing `surfaces.ui` to be declared.
 *       Rationale: every web section needs an "add new item"
 *       affordance; the manifest shouldn't have to repeat
 *       `surfaces.ui` for each.
 *   (b) **`verb === 'list'` skip.**  List ops are the section's
 *       implicit data source — adapter calls
 *       `listOpen({type: section.itemType, ...filter})` to fetch
 *       items.  Not a button.
 *   (c) **Other verbs require `surfaces.ui`** to surface as
 *       itemActions (state-gated per-item buttons).  Same as V0.
 *
 * ──── Q7 — `view.dataSource` explicit declaration (locked 2026-05-21)
 *
 * Surfaced by the CONVERGENT signal from B.2 (tasks-v0 mine.html) +
 * E.1 (stoop mine.html) + B.1 (tasks-v0 dag.html).  Q6 rule (b) says
 * "list ops are the section's implicit data source — adapter calls
 * `listOpen({type, ...filter})`".  But many real sections need a
 * DIFFERENT list skill: `listMine`, `listMyMasteredTasks`,
 * `listClaimable`, `listMyRequests`, `getDagTree`.  Hard-coded in
 * adapters today; convergent signal = real substrate gap.
 *
 * Solution: `view.dataSource: {skillId, args?}` declares the skill
 * the adapter should call to populate the section, with optional
 * pre-filled args.  Forward-additive: absent → existing behaviour
 * (adapter calls `listOpen({type, ...filter})`).
 *
 * ──── Q9 — `view.readOnly: true` marker (locked 2026-05-21)
 *
 * Surfaced by A.3 agent's signal: household's `members` section is
 * empty by substrate default (no listOpen for contact) and has no
 * `registerName` affordance because `registerName` has no
 * `surfaces.ui`.  Adapter renders an empty "Add"-less section.
 *
 * Solution: `view.readOnly: true` → section gets `readOnly: true` +
 * affordances are skipped (creative verbs don't auto-surface in
 * read-only sections).  itemActions still render (state-gated per-
 * item buttons may still apply on read-only views — e.g. a "delete"
 * button on a read-only audit log).  Adapter can also use the
 * `section.readOnly` flag for visual cues.
 *
 * ──── Q10 — Creative verbs auto-surface (locked 2026-05-21)
 *
 * Q6 rule (a) said `verb === 'add'` auto-surfaces.  Generalised: any
 * verb in the `CREATIVE_VERBS` set (`{add, register}`) auto-surfaces.
 * Surfaced by A.3 agent: household's `registerName` op (verb=
 * 'register', non-canonical via F-SP1-e) creates contact items but
 * has no `surfaces.ui` — under Q6 rule (a) it was omitted from
 * NavModel.  Now it auto-surfaces in the `members` section.
 *
 * Forward-additive: future creative verbs can be added to the
 * CREATIVE_VERBS set.  Keep the set tight — each addition expands
 * the auto-surface behaviour implicitly.
 *
 * ──── Q8 — `appliesTo.type: '*'` wildcard (locked 2026-05-21)
 *
 * Surfaced by E.1: stoop's `cancelRequest` spans all 3 prikbord
 * types (ask/offer/lend); `markReturned` only matches `lend` but
 * conceptually belongs on every per-row button.  Q6 + F-SP3-a's
 * multi-type array helps but is manual per-op.
 *
 * Solution: `appliesTo: { type: '*' }` is permitted (validator).
 * Wildcard ops match EVERY view's section.  NavModel preserves the
 * `'*'` literal so adapters can decide rendering.
 *
 * Forward-additive: validator special-cases `'*'`; renderWeb's
 * `matchOp` returns matched=true for wildcard regardless of view.type.
 *
 * ──── Q15 — `view.dataSource.argsFromContext` (locked 2026-05-21)
 *
 * Surfaced by E.2 + E.3: stoop's privacy.html needs a runtime `lang`
 * arg (browser-derived) and stoop's settings.html surfaced the
 * adjacent need for context-bound args.  V0.2 `dataSource.args` is
 * static; runtime values forced consumers to bypass the manifest.
 *
 * Solution: `dataSource.argsFromContext: {lang: '$lang'}` — adapter
 * recognises `$<key>` strings and substitutes from the caller-
 * supplied `context` arg at call time.  Forward-additive — absent
 * means existing static-args behaviour.
 *
 * ──── Q17 — `view.shape: 'record'` (locked 2026-05-21)
 *
 * Surfaced by E.3: stoop's settings.html is a SINGLETON record
 * (`getSettings` returns `{settings: {...}}`), not a list.  NavModel
 * V0.2 assumes sections are `Array<item>`.  E.3 worked around by
 * treating the singleton as a 1-element list.
 *
 * Solution: `view.shape: 'record' | 'list'` (default `'list'` —
 * existing behaviour).  Adapter switches rendering: `'list'` →
 * iterate items[]; `'record'` → render the single returned record
 * with its fields.  Future Q18 (deferred) lets the record's fields
 * declare their own patch-op for per-field mutations.
 *
 * ──── Q18 — `view.fields[].patch` per-field mutations (locked 2026-05-21)
 *
 * Surfaced by E.3 (signal #6).  Record-shape views (settings, profile)
 * have fields the user edits — but the current verb model has no slot
 * for "patch this field via opId(argName=value)".
 *
 * Solution: `view.fields: [{name, type, label?, choices?, patch?:
 * {opId, argName, argWrapper?}}]`.  Only meaningful when
 * `view.shape === 'record'`.  NavModel passes through to
 * `section.fields[]`.  Adapter renders each field as an input based on
 * `type`; on change, dispatches `patch.opId(<args>)` per Q21.
 *
 * Forward-additive — absent means existing record-rendering (no
 * editable fields).
 *
 * ──── Q21 — `patch.argWrapper` for wrapped-patch shapes (locked 2026-05-22)
 *
 * Surfaced by the V0.4-adopt for stoop's settings (commit 9e7003b):
 * Q18's flat `{opId, argName}` assumes the dispatch shape
 * `opId({[argName]: newValue})`.  But many real APIs use nested patch
 * shapes — e.g. stoop's `updateSettings({patch: {pollIntervalMs: 30000}})`.
 * The page-level adapter wrapped this ad-hoc; V0.5 makes it explicit
 * in the substrate.
 *
 * Solution: `patch.argWrapper?: string` opt-in.  When absent or empty,
 * dispatch stays FLAT: `opId({[argName]: newValue})` (Q18 behaviour
 * preserved).  When a non-empty string, dispatch is WRAPPED:
 * `opId({[argWrapper]: {[argName]: newValue}})`.
 *
 * Example (stoop settings):
 *   patch: { opId: 'updateSettings', argName: 'pollIntervalMs',
 *            argWrapper: 'patch' }
 *   → updateSettings({patch: {pollIntervalMs: newValue}})
 *
 * Forward-additive — absent means existing flat behaviour (V0.4).
 *
 * ──── Q26 — `field.requiresField` conditional display (locked 2026-05-20)
 *
 * Surfaced by B.2.4 (tasks-v0 pod-settings): `groupPodUri` is only
 * meaningful when `policy ∈ {centralised, hybrid}` — the rich UI
 * hides the input when the policy is `personal`.  Auto-rendered
 * consumers would have no way to express that today; V0.5 Q21 covered
 * the dispatch shape but not the visibility gate.
 *
 * Solution: `view.fields[].requiresField?: {<otherField>:
 * <value | value[]>}` — same shape as `appliesTo.state`.  Adapter
 * hides the field when the record's current value for any named gate
 * key doesn't match.  Multiple keys are AND-combined; a single key
 * with array-value is OR-combined within the key.
 *
 * Forward-additive — absent means "always show" (existing behaviour).
 *
 * ──── Q25 — `field.readSkill` for multi-skill records (locked 2026-05-20)
 *
 * Surfaced by E.4 (stoop profile): `holidayMode` is reachable two
 * ways — bulk via `getMyProfile()` (record-level dataSource) AND
 * dedicated `getHolidayMode()` skill.  V0.6 Q18 has no slot for "this
 * field's current value comes from a different skill than the
 * record's bulk read."  Real consequence: refresh granularity falls
 * back to "re-fetch the whole record" even when a single-field skill
 * exists.
 *
 * Solution: `view.fields[].readSkill?: {skillId, args?}` — same shape
 * as `view.dataSource`.  When present, the adapter calls this skill
 * to resolve the field's value instead of reading from the record
 * payload.  Absent (default) → existing behaviour (read from
 * `record[name]`).
 *
 * Args are static at projection time (no Q15 `argsFromContext`
 * substitution yet; add when a real need surfaces).  Validator
 * enforces non-empty skillId + optional args object.  Q16-strict
 * mode cross-checks skillId against `operations[]` /
 * `externalSkills[]`.
 *
 * Forward-additive — adopting consumers add the field; non-adopting
 * consumers see absent readSkill and behave as before.
 *
 * ──── Q23 — `field.type: 'file' | 'image'` byte-shaped fields (locked 2026-05-20)
 *
 * Q18's recognized `field.type` set was implicit — manifests today use
 * `'string' | 'number' | 'boolean' | 'enum' | 'object'`.  Q23
 * formalises the set + adds two new values for byte-shaped fields
 * (avatar upload, document attach, photo capture):
 *
 *   `'file'`   — generic binary payload (PDF, archive, anything).
 *   `'image'`  — image-typed binary (preview-able, resize-able).
 *
 * Dispatch contract (consumer-side):
 *   Web — patch dispatcher receives a DOM `File` instance as the
 *         field's value.  Consumer is responsible for any client-side
 *         transform (resize, format conversion) before calling the
 *         skill.
 *   RN  — patch dispatcher receives the image picker's result object
 *         `{uri, name, type, size}` as the field's value.  Same
 *         consumer-side transform rule.
 *
 * The substrate stays renderer-agnostic — projector passes `type`
 * through verbatim; rendering + transform are consumer concerns.
 * Surfaced by E.4 (stoop profile.html's avatar upload — `avatarUrl`
 * is a data-URL post client-side resize; no Q18 type fit it before).
 *
 * Forward-additive — adopting consumers extend their renderer-side
 * field switch to handle the two new type values.
 *
 * ──── Q27 — `surfaces.ui.confirm` severity hint (locked 2026-05-20)
 *
 * Surfaced by the Tier C investigation (Project Files/Substrates/tier-c-proposals.md):
 * 14 destructive / side-effect-bearing surfaces across folio + tasks
 * + stoop already have hand-rolled confirm modals (folio's 3 custom
 * confirm modals + tasks-mobile's <ConfirmModal> + stoop's CLI
 * confirm() prompts).  Severity hints are a tiny manifest-level
 * field that unlocks consistent cross-platform UX.
 *
 * Shape:
 *   op.surfaces.ui.confirm?: {
 *     severity: 'info' | 'warn' | 'danger',
 *     message?: string,
 *   }
 *
 * Adapter styling:
 *   - `danger`  → red button + irreversible-warning copy
 *   - `warn`    → yellow button + side-effect-warning copy
 *   - `info`    → neutral button + informational copy
 *
 * The projector propagates `confirm` onto affordances + itemActions +
 * sectionActions (every surface where `label` flows).  Forward-
 * additive — absent means today's behaviour (plain click → action).
 *
 * Out of scope:
 *   - passphrase prompts (mnemonic / encryptedBackup) — auth flow
 *   - one-shot reveals (mnemonic show-once) — business rule
 *   - localisation on message (use a future Q22-style messageKey if needed)
 *
 * Adapters that don't understand `confirm` should fail the
 * affordance (strict) rather than silently ignore — a `danger` gate
 * dropped on the floor is a UX hazard.
 *
 * ──── Q22 — `labelKey` localisation passthrough (locked 2026-05-20)
 *
 * Surfaced by C.3 closeout: manifest `label` strings are English while
 * stoop is Dutch-first and tasks-mobile RN screens already use an localisation
 * function (`t(key, fallback)`).  Auto-rendered substrate UIs would
 * regress on localization.
 *
 * Solution: opt-in `surfaces.ui.labelKey?: string` on operations AND
 * `view.fields[].labelKey?: string` on record fields.  When present
 * (non-empty string), the projector passes it through alongside
 * `label`.  Consumers with an `t()` function resolve via the key;
 * consumers without one fall back to `label` (existing behaviour).
 *
 * Forward-additive — absent means existing English-label behaviour.
 * No adapter changes — pure consumer-side resolution.
 *
 * ──── Q19 — Section-scope CTAs via `surfaces.ui.placement: 'section-header'`
 *
 * Surfaced by B.2.3 deferral.  Inbox has a "Clear all" header CTA —
 * not creative (doesn't add items), not per-item.  No slot in V0.3.
 *
 * Solution: ops with `surfaces.ui.placement: 'section-header'`
 * surface in `section.sectionActions[]` (parallel to `affordances[]`
 * and `itemActions[]`).  Same Affordance shape; the placement
 * difference is purely semantic — header CTAs are adjacent to the
 * section title.
 *
 * Forward-additive.
 *
 * ──── Q16-strict — opt-in skillId cross-check (locked 2026-05-21)
 *
 * `validateManifest(manifest, {strict: true})` walks every
 * `view.dataSource.skillId` (V0.4 also `view.fields[].patch.opId`) and
 * verifies it's either declared in `manifest.operations[].id` OR in
 * the new `manifest.externalSkills?: string[]` allow-list.  Default
 * (no `strict` opt) keeps the existing tolerant behaviour.
 * ─────────────────────────────────────────────────────────────────
 */

import { paramsToJsonSchema } from './paramsToJsonSchema.js';

/**
 * Q10 (2026-05-21) — verbs that auto-surface as section affordances
 * without requiring `surfaces.ui` (Q6 rule (a) generalised).
 *
 *   'add'      — the canonical creative verb.
 *   'register' — household's `registerName` (non-canonical via F-SP1-e);
 *                still creates a contact item, so it belongs on the
 *                section's affordance row.
 *
 * Forward-additive: extend the set when new "creative" verbs appear in
 * real manifests.  Keep the list small — every entry expands the
 * adapter's affordance-rendering surface implicitly.
 */
// Exported so renderCoverage detects the web/mobile surface with the SAME rule (no drift):
// a creative verb auto-surfaces even without `surfaces.ui`.
export const CREATIVE_VERBS = new Set(['add', 'register']);

/**
 * @param {object} manifest
 * @returns {NavModel}
 */
export function renderWeb(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('renderWeb: manifest required');
  }

  const ops   = Array.isArray(manifest.operations) ? manifest.operations : [];
  const views = Array.isArray(manifest.views)      ? manifest.views      : [];

  // (a) Globals — ops with surfaces.ui.placement === 'global'.  These
  //     surface at the app-shell level, NOT under any section.
  //     Inferred from existing surfaces.ui (Q3, no schema change).
  //     Q19 (V0.4) — `placement === 'section-header'` is NOT global;
  //     handled inside buildSection per-section.
  const globals = [];
  for (const op of ops) {
    const ui = op?.surfaces?.ui;
    if (!ui) continue;
    if (ui.placement !== 'global') continue;
    globals.push(buildAffordance(op, manifest, 'global'));
  }

  // (b) Sections — one per view; preserve declaration order (Q2).
  const sections = views.map((view) => buildSection(view, ops, manifest));

  return {
    app: typeof manifest.app === 'string' ? manifest.app : '',
    sections,
    globals,
  };
}

/* ─── internals ──────────────────────────────────────────────────── */

function buildSection(view, ops, manifest) {
  const section = {
    id:       view.id,
    title:    view.title,
    itemType: view.type,
    affordances: [],
    itemActions: [],
  };

  // Optional fields — only set when present (keep NavModel JSON minimal).
  if (view.filter     !== undefined) section.filter     = view.filter;
  if (view.sort       !== undefined) section.sort       = view.sort;
  if (view.audience   !== undefined) section.audience   = view.audience;
  // Q7 (2026-05-21) — explicit data-source declaration; adapters use
  // this in preference to the default `listOpen({type, ...filter})`
  // heuristic.  Validate-loose: shape correctness is the adapter's
  // concern (forward-additive — V0.3 may tighten via JSDoc).
  // Q15 (V0.3, 2026-05-21) — `dataSource.argsFromContext` passes
  // through verbatim.  Substitution happens in
  // `@canopy/web-adapter/fetchSectionItems` at call time.
  if (view.dataSource !== undefined) section.dataSource = view.dataSource;
  // Q9 (2026-05-21) — read-only marker.  Adapter skips Add forms /
  // creative affordances; itemActions still render (state-gated
  // buttons may still apply).  Section receives `readOnly: true`
  // verbatim so adapter can also disable per-row interactivity if
  // needed (e.g. dim the row).
  if (view.readOnly === true)       section.readOnly   = true;
  // Q17 (V0.3, 2026-05-21) — section shape.  Default `'list'`
  // (Array<item>); `'record'` switches the adapter to expect ONE
  // record (e.g. settings, profile).  Field NOT set on the section
  // when `view.shape` is absent OR equals `'list'` — keeps NavModel
  // JSON minimal + back-compatible (every existing section is
  // implicitly list-shaped).
  if (view.shape === 'record')      section.shape      = 'record';

  // Q18 (V0.4, 2026-05-21) — per-field declarations for record-shape
  // views.  Pass through verbatim (defensive copy of each field +
  // patch sub-object).
  if (view.shape === 'record' && Array.isArray(view.fields)) {
    section.fields = view.fields.map((f) => {
      const out = { name: f.name };
      if (f.type    !== undefined) out.type    = f.type;
      if (f.label   !== undefined) out.label   = f.label;
      // Q22 (V0.6, 2026-05-20) — localisation key passthrough on fields.
      if (typeof f.labelKey === 'string' && f.labelKey !== '') {
        out.labelKey = f.labelKey;
      }
      // Q26 (V0.7, 2026-05-20) — conditional-display gate.  Same shape
      // as appliesTo.state: { otherField: value | value[] }.  Adapter
      // hides the field when the record's current value for any gate
      // key doesn't match.
      if (f.requiresField && typeof f.requiresField === 'object'
          && !Array.isArray(f.requiresField)) {
        const gate = {};
        for (const [k, v] of Object.entries(f.requiresField)) {
          gate[k] = Array.isArray(v) ? v.slice() : v;
        }
        if (Object.keys(gate).length > 0) out.requiresField = gate;
      }
      // Q25 (V0.7, 2026-05-20) — multi-skill records.  Per-field
      // read skill replaces the record-level dataSource value when
      // present.  Pass through as a defensive copy.
      if (f.readSkill && typeof f.readSkill === 'object'
          && typeof f.readSkill.skillId === 'string'
          && f.readSkill.skillId !== '') {
        out.readSkill = { skillId: f.readSkill.skillId };
        if (f.readSkill.args && typeof f.readSkill.args === 'object'
            && !Array.isArray(f.readSkill.args)) {
          out.readSkill.args = { ...f.readSkill.args };
        }
      }
      if (Array.isArray(f.choices)) out.choices = f.choices.slice();
      if (f.patch && typeof f.patch === 'object') {
        out.patch = { opId: f.patch.opId, argName: f.patch.argName };
        // Q21 (V0.5, 2026-05-22) — wrapped-patch shape opt-in.  When
        // present, adapters dispatch
        // `opId({[argWrapper]: {[argName]: newValue}})` instead of the
        // flat default `opId({[argName]: newValue})`.  Validator
        // guarantees non-empty string when set.
        if (typeof f.patch.argWrapper === 'string' && f.patch.argWrapper !== '') {
          out.patch.argWrapper = f.patch.argWrapper;
        }
      }
      return out;
    });
  }

  for (const op of ops) {
    const ui = op?.surfaces?.ui;
    if (ui?.placement === 'global') continue;  // already pushed to globals

    const m = matchOp(op, view);
    if (!m.matched) continue;

    if (op.verb === 'list') continue;  // implicit data source — adapter fetches items

    if (CREATIVE_VERBS.has(op.verb)) {
      // Q9: skip add/register affordances when the section is read-only.
      if (view.readOnly === true) continue;
      // (Q6 rule a) — creative verbs (Q10: add | register) auto-surface
      // as section affordances without needing `surfaces.ui`.  Every
      // web section needs an "add new item" path; the manifest
      // shouldn't have to repeat `surfaces.ui` for each.
      section.affordances.push(
        buildAffordance(op, manifest, 'section', m.viaTypeEnum ? { type: view.type } : null),
      );
    } else if (ui?.placement === 'section-header') {
      // Q19 (V0.4, 2026-05-21) — section-scope CTAs.  e.g. inbox's
      // "Clear all" header CTA.  Adjacent to the section title; not
      // per-item, not creative.  Shape matches Affordance.
      if (!section.sectionActions) section.sectionActions = [];
      section.sectionActions.push(
        buildAffordance(op, manifest, 'section-header', m.viaTypeEnum ? { type: view.type } : null),
      );
    } else if (ui) {
      // (Q6 rule c) — other verbs require surfaces.ui to surface as itemActions.
      section.itemActions.push(
        buildItemAction(op, view, m.viaTypeEnum ? { type: view.type } : null),
      );
    }
  }

  return section;
}

/**
 * Does an op apply to this view's item-type?  Returns `{matched, viaTypeEnum}`.
 *
 *   - **Explicit `appliesTo.type` wins** (string OR array, F-SP3-a).
 *   - **Type-enum fallback (Q6, locked 2026-05-20):** op without
 *     `appliesTo` but with a `params: [{name:'type', kind:'enum',
 *     of:[…]}]` whose enum includes `view.type` matches that view.
 *     The section's itemType is recorded in `prefilledParams.type`
 *     downstream so the adapter pre-fills it.  Surfaced by
 *     household's `addItem(type, text)` — one chat-side tool, four
 *     web sections.
 *   - Op with neither signal does NOT match.
 */
function matchOp(op, view) {
  if (op.appliesTo?.type !== undefined) {
    // Q8 (2026-05-21) — wildcard: '*' matches every section.  No
    // prefilledParams; op is type-agnostic (operates on the item's
    // id, not its type).
    if (op.appliesTo.type === '*') {
      return { matched: true, viaTypeEnum: false, viaWildcard: true };
    }
    const types = Array.isArray(op.appliesTo.type) ? op.appliesTo.type : [op.appliesTo.type];
    return { matched: types.includes(view.type), viaTypeEnum: false };
  }
  const enumTypes = findTypeEnumParam(op);
  if (enumTypes !== null && enumTypes.includes(view.type)) {
    return { matched: true, viaTypeEnum: true };
  }
  return { matched: false, viaTypeEnum: false };
}

/**
 * Returns the enum-of values for an op's `type` enum param, or null
 * if the op doesn't have one.  Only handles the inline-array form
 * (`of: ['shopping', …]`); the string form (`of: 'itemTypes'`) is
 * out of V0 scope (needs manifest-level resolution).
 */
function findTypeEnumParam(op) {
  for (const p of op.params ?? []) {
    if (p.name === 'type' && p.kind === 'enum' && Array.isArray(p.of)) {
      return p.of;
    }
  }
  return null;
}

function buildAffordance(op, manifest, placement, prefilledParams) {
  const a = {
    opId:         op.id,
    label:        op?.surfaces?.ui?.label ?? op.verb ?? op.id,
    paramsSchema: paramsToJsonSchema(op.params ?? [], { manifest }),
    placement,
  };
  // Q22 (V0.6, 2026-05-20) — localisation key passthrough.  When the manifest
  // declares `surfaces.ui.labelKey`, surface it alongside `label` so
  // consumers with an localisation function look up the localized string;
  // others fall back to `label`.  Forward-additive — absent means
  // existing English-label behaviour.
  if (typeof op?.surfaces?.ui?.labelKey === 'string'
      && op.surfaces.ui.labelKey !== '') {
    a.labelKey = op.surfaces.ui.labelKey;
  }
  // Q27 (V0.8, 2026-05-20) — confirm-severity passthrough.  Pure
  // defensive copy: adapters style the confirm modal on
  // `severity` and render `message` if present.  Validator
  // guarantees severity ∈ {info,warn,danger} when set.
  const confirm = op?.surfaces?.ui?.confirm;
  if (confirm && typeof confirm === 'object'
      && ['info', 'warn', 'danger'].includes(confirm.severity)) {
    a.confirm = { severity: confirm.severity };
    if (typeof confirm.message === 'string' && confirm.message !== '') {
      a.confirm.message = confirm.message;
    }
  }
  if (prefilledParams) a.prefilledParams = prefilledParams;
  return a;
}

function buildItemAction(op, view, prefilledParams) {
  // For explicit appliesTo: pass type + state verbatim.
  // For type-enum fallback: scope to view.type only.
  const appliesTo = op.appliesTo?.type !== undefined
    ? { type: op.appliesTo.type }
    : { type: view.type };
  if (op.appliesTo?.state !== undefined) {
    appliesTo.state = op.appliesTo.state;  // F-SP3-a passthrough
  }
  // V0.4 — pass through any *other* appliesTo fields verbatim (e.g.
  // `kind: 'subtask-proposal'` on inbox ops).  Without this, the
  // adapter's `itemMatchesAppliesTo` generic gate sees no constraint
  // and surfaces the action on every item.  Surfaced by C.4 — web
  // inbox.html escaped notice because it dispatched via button-id
  // strings, not the projected appliesTo.
  for (const [field, gate] of Object.entries(op.appliesTo ?? {})) {
    if (field === 'type' || field === 'state') continue;
    if (gate === undefined) continue;
    appliesTo[field] = gate;
  }
  const action = {
    opId:  op.id,
    label: op?.surfaces?.ui?.label ?? op.verb ?? op.id,
    appliesTo,
  };
  // Q22 (V0.6) — localisation key passthrough (see buildAffordance).
  if (typeof op?.surfaces?.ui?.labelKey === 'string'
      && op.surfaces.ui.labelKey !== '') {
    action.labelKey = op.surfaces.ui.labelKey;
  }
  // Q27 (V0.8) — confirm-severity passthrough (see buildAffordance).
  const confirm = op?.surfaces?.ui?.confirm;
  if (confirm && typeof confirm === 'object'
      && ['info', 'warn', 'danger'].includes(confirm.severity)) {
    action.confirm = { severity: confirm.severity };
    if (typeof confirm.message === 'string' && confirm.message !== '') {
      action.confirm.message = confirm.message;
    }
  }
  if (prefilledParams) action.prefilledParams = prefilledParams;
  return action;
}
