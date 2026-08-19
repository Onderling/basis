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
 *   . Detail-view: V0 = buttons-on-row only. No `section.detail`
 *       field yet.  V1 may add when user tests show drilldowns are
 *       needed.
 *   . Section ordering: preserve `manifest.views[]` declaration
 *       order.  Activity-based sort would shift sections around at
 *       runtime, which is jarring for users.  Matches `renderChat`
 *       discipline (also declaration-order).
 *   . Globals source: inferred from
 *       `op.surfaces.ui.placement === 'global'`.  No new
 *       `manifest.navigation` block needed; forward-additive.
 *   . Equivalence: strict JSON equality renderWeb≡renderMobile;
 *       owner-approved exceptions only.
 *   . Item sort: `view.sort = {by, direction}` passed through to
 *       `section.sort`.  Forward-additive.  Adapter performs the
 *       sort.  User-reordering (interactive) deferred to V1+ (needs
 *       item-store ordinal field).
 * ─────────────────────────────────────────────────────────────────
 *
 * Phase boundary (PLAN guardrail): this package DECLARES.
 * `@onderling/interface-registry` runs per-type item rendering — once
 * mature, NavModel will reference `renderCompact` / `renderFull` for
 * per-item cells instead of returning `{text, buttons}`.  V0 stays
 * with the minimal {text, buttons} contract; adapters render the row.
 *
 * @typedef {object} NavModel
 * @property {string}   app                manifest.app verbatim
 * @property {Section[]} sections          one per manifest.view (declaration order)
 * @property {Affordance[]} globals        top-level affordances (e.g. global Help)
 * @property {Page[]} [pages] top-level PAGE surfaces (D)
 *                                         one per op with `surfaces.page`
 *                                         (declaration order).  Key is OMITTED
 *                                         when the manifest declares no page
 *                                         surface, so the NavModel shape is
 *                                         unchanged for page-less manifests.
 * @property {NavItem[]} [tabs]            NAV-CHROME (D / Surface 1) — the ordered
 *                                         top-level TAB BAR roots, one per
 *                                         `manifest.tabs` entry (declaration
 *                                         order).  Key is OMITTED when the
 *                                         manifest declares no tabs, so tab-less
 *                                         manifests keep the {app, sections,
 *                                         globals} shape.  See "Nav-chrome" below.
 * @property {NavItem[]} [actions]         NAV-CHROME (D / Surface 2) — the ordered
 *                                         DETAIL ACTION BAR (per-detail buttons to
 *                                         sibling screens), one per
 *                                         `manifest.actions` entry (declaration
 *                                         order).  SAME NavItem shape as `tabs`,
 *                                         plus the optional `requires`/`platforms`
 *                                         gate fields.  Key OMITTED when the
 *                                         manifest declares no actions.
 *
 * @typedef {object} NavItem
 * @property {string}   id                 stable nav-item id (the shell keys its
 *                                         handler/active-state off this).
 * @property {string}   labelKey           localisation key (invariant #8) — the
 *                                         shell resolves it via `t()`.
 * @property {string}   [icon]             optional icon token (consumer-side glyph
 *                                         lookup); passed through verbatim.
 * @property {NavTarget} target            what the item SELECTS — a nav root
 *                                         (no op) or an op dispatch.  See NavTarget.
 * @property {string[]} [requires]         NAV-CHROME (D / Surface 2) — feature
 *                                         keys gating a detail-bar action; the
 *                                         consumer shows it when ANY is enabled
 *                                         (OR).  Carried verbatim; the projector
 *                                         does not evaluate it.
 * @property {string[]} [platforms]        NAV-CHROME (D / Surface 2) — platform
 *                                         tags the action is available on (absent
 *                                         → all).  Declares a platform gap in the
 *                                         manifest instead of a divergent hardcode.
 *
 * @typedef {{kind: 'nav', to: string} | {kind: 'op', opId: string}} NavTarget
 *   Discriminated union — the SHARED nav-chrome vocabulary:
 *     `{kind: 'nav', to}`  — selects an app-nav root that maps to NO op (the
 *                            shell owns the surface, e.g. the circle list).
 *     `{kind: 'op', opId}`  — selects/dispatches a manifest op (e.g. the `me`
 *                            profile op backs the "Mij" tab).
 *
 * @typedef {object} Page
 * @property {string}   opId               op that opens this page (dispatch key)
 * @property {'side-panel'|'modal'|'screen'} kind  mirrors surfaces.page.kind
 * @property {string}   [title]            mirrors surfaces.page.title (panel header)
 * @property {string}   [route]            mirrors surfaces.page.route (mobile nav
 *                                         route; web adapter ignores it — the
 *                                         NavModel stays platform-neutral so the
 *                                         same projection feeds renderMobile)
 * @property {string} [labelKey] localisation key passthrough (see
 *                                         Affordance.labelKey) — absent today, but
 *                                         forward-additive so a localised page
 *                                         title can be looked up via `t()`.
 *
 * @typedef {object} Section
 * @property {string}   id                 mirrors view.id
 * @property {string}   title              mirrors view.title
 * @property {string}   itemType           mirrors view.type
 * @property {object}   [filter]           mirrors view.filter
 * @property {{by: string, direction?: 'asc'|'desc'}} [sort]
 *                                         mirrors view.sort
 * @property {*}        [audience]         the view's declared audience for the
 *                                         list-render seam to default its
 *                                         ListFilter.audience (consumer).
 *                                         Sourced from view.defaultAudience
 *                                         (schema.js) — an explicit view.audience,
 *                                         if a manifest sets one, overrides it.
 * @property {{skillId: string, args?: object}} [dataSource]
 *                                         mirrors view.dataSource.
 *                                         When present, adapters call this
 *                                         skill (with merged args) instead
 *                                         of the default `listOpen({type})`
 *                                         heuristic.  Resolves the
 *                                         convergent gap flagged by B.2 +
 *                                         E.1 + B.1 agents (sections
 *                                         needing custom data fetchers
 *                                         like `listMine`, `listMyRequests`,
 *                                         `getDagTree`).
 * @property {string}   [labelField]       mirrors view.labelField (D-mig-1a).
 *                                         Which item field supplies a list
 *                                         row's label; downstream defaults to
 *                                         'label' when unset.
 * @property {string}   [categoryField]    mirrors view.categoryField (D-mig-1a).
 *                                         Which item field groups/filters list
 *                                         rows (e.g. 'category', 'kind').
 * @property {string[]} [searchFields]     mirrors view.searchFields (D-mig-2).
 *                                         Which item fields the free-text list
 *                                         filter matches (case-insensitive
 *                                         contains; ANY field hit = match).
 *                                         Downstream defaults to `[labelField]`
 *                                         when unset (label-only search, as before).
 * @property {Affordance[]} affordances    per-section actions (e.g. add-form)
 * @property {ItemAction[]} itemActions    per-item state-gated buttons
 *
 * @typedef {object} Affordance
 * @property {string}   opId               matches manifest.operation.id
 * @property {string}   label              from surfaces.ui.label or op.verb
 * @property {object}   paramsSchema       from paramsToJsonSchema(op.params)
 * @property {'section'|'global'} placement
 * @property {object} [prefilledParams] (locked 2026-05-20) — when an
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
 *                                         honoured). — `type` may be
 *                                         `'*'` (wildcard): matches every
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
 * ──── — multi-type ops via type-enum fallback (locked 2026-05-20)
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
 * ──── — `view.dataSource` explicit declaration (locked 2026-05-21)
 *
 * Surfaced by the CONVERGENT signal from B.2 (tasks-v0 mine.html) +
 * E.1 (stoop mine.html) + B.1 (tasks-v0 dag.html). rule (b) says
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
 * ──── — `view.readOnly: true` marker (locked 2026-05-21)
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
 * ──── — Creative verbs auto-surface (locked 2026-05-21)
 *
 * rule (a) said `verb === 'add'` auto-surfaces. Generalised: any
 * verb in the `CREATIVE_VERBS` set (`{add, register}`) auto-surfaces.
 * Surfaced by A.3 agent: household's `registerName` op (verb=
 * 'register', non-canonical via F-SP1-e) creates contact items but
 * has no `surfaces.ui` — under rule (a) it was omitted from
 * NavModel.  Now it auto-surfaces in the `members` section.
 *
 * Forward-additive: future creative verbs can be added to the
 * CREATIVE_VERBS set.  Keep the set tight — each addition expands
 * the auto-surface behaviour implicitly.
 *
 * ──── — `appliesTo.type: '*'` wildcard (locked 2026-05-21)
 *
 * Surfaced by E.1: stoop's `cancelRequest` spans all 3 noticeboard
 * types (ask/offer/lend); `markReturned` only matches `lend` but
 * conceptually belongs on every per-row button. + F-SP3-a's
 * multi-type array helps but is manual per-op.
 *
 * Solution: `appliesTo: { type: '*' }` is permitted (validator).
 * Wildcard ops match EVERY view's section.  NavModel preserves the
 * `'*'` literal so adapters can decide rendering.
 *
 * Forward-additive: validator special-cases `'*'`; renderWeb's
 * `matchOp` returns matched=true for wildcard regardless of view.type.
 *
 * ──── — `view.dataSource.argsFromContext` (locked 2026-05-21)
 *
 * Surfaced by E.2 + E.3: stoop's privacy.html needs a runtime `lang`
 * arg (browser-derived) and stoop's settings.html surfaced the
 * adjacent need for context-bound args. `dataSource.args` is
 * static; runtime values forced consumers to bypass the manifest.
 *
 * Solution: `dataSource.argsFromContext: {lang: '$lang'}` — adapter
 * recognises `$<key>` strings and substitutes from the caller-
 * supplied `context` arg at call time.  Forward-additive — absent
 * means existing static-args behaviour.
 *
 * ──── — `view.shape: 'record'` (locked 2026-05-21)
 *
 * Surfaced by E.3: stoop's settings.html is a SINGLETON record
 * (`getSettings` returns `{settings: {...}}`), not a list.  NavModel
 * assumes sections are `Array<item>`. E.3 worked around by
 * treating the singleton as a 1-element list.
 *
 * Solution: `view.shape: 'record' | 'list'` (default `'list'` —
 * existing behaviour).  Adapter switches rendering: `'list'` →
 * iterate items[]; `'record'` → render the single returned record
 * with its fields. Future (deferred) lets the record's fields
 * declare their own patch-op for per-field mutations.
 *
 * ──── — `view.fields[].patch` per-field mutations (locked 2026-05-21)
 *
 * Surfaced by E.3 (signal #6).  Record-shape views (settings, profile)
 * have fields the user edits — but the current verb model has no slot
 * for "patch this field via opId(argName=value)".
 *
 * Solution: `view.fields: [{name, type, label?, choices?, patch?:
 * {opId, argName, argWrapper?}}]`.  Only meaningful when
 * `view.shape === 'record'`.  NavModel passes through to
 * `section.fields[]`.  Adapter renders each field as an input based on
 * `type`; on change, dispatches `patch.opId(<args>)` per.
 *
 * Forward-additive — absent means existing record-rendering (no
 * editable fields).
 *
 * ──── — `patch.argWrapper` for wrapped-patch shapes (locked 2026-05-22)
 *
 * Surfaced by the -adopt for stoop's settings (commit 9e7003b):
 * 's flat `{opId, argName}` assumes the dispatch shape
 * `opId({[argName]: newValue})`.  But many real APIs use nested patch
 * shapes — e.g. stoop's `updateSettings({patch: {pollIntervalMs: 30000}})`.
 * The page-level adapter wrapped this ad-hoc; makes it explicit
 * in the substrate.
 *
 * Solution: `patch.argWrapper?: string` opt-in.  When absent or empty,
 * dispatch stays FLAT: `opId({[argName]: newValue})` (behaviour
 * preserved).  When a non-empty string, dispatch is WRAPPED:
 * `opId({[argWrapper]: {[argName]: newValue}})`.
 *
 * Example (stoop settings):
 *   patch: { opId: 'updateSettings', argName: 'pollIntervalMs',
 *            argWrapper: 'patch' }
 *   → updateSettings({patch: {pollIntervalMs: newValue}})
 *
 * Forward-additive — absent means existing flat behaviour.
 *
 * ──── — `field.requiresField` conditional display (locked 2026-05-20)
 *
 * Surfaced by B.2.4 (tasks-v0 pod-settings): `groupPodUri` is only
 * meaningful when `policy ∈ {centralised, hybrid}` — the rich UI
 * hides the input when the policy is `personal`.  Auto-rendered
 * consumers would have no way to express that today; covered
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
 * ──── — `field.readSkill` for multi-skill records (locked 2026-05-20)
 *
 * Surfaced by E.4 (stoop profile): `holidayMode` is reachable two
 * ways — bulk via `getMyProfile()` (record-level dataSource) AND
 * dedicated `getHolidayMode` skill. has no slot for "this
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
 * Args are static at projection time (no `argsFromContext`
 * substitution yet; add when a real need surfaces).  Validator
 * enforces non-empty skillId + optional args object. -strict
 * mode cross-checks skillId against `operations[]` /
 * `externalSkills[]`.
 *
 * Forward-additive — adopting consumers add the field; non-adopting
 * consumers see absent readSkill and behave as before.
 *
 * ──── — `field.type: 'file' | 'image'` byte-shaped fields (locked 2026-05-20)
 *
 * 's recognized `field.type` set was implicit — manifests today use
 * `'string' | 'number' | 'boolean' | 'enum' | 'object'`.
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
 * is a data-URL post client-side resize; no type fit it before).
 *
 * Forward-additive — adopting consumers extend their renderer-side
 * field switch to handle the two new type values.
 *
 * ──── — `surfaces.ui.confirm` severity hint (locked 2026-05-20)
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
 *   localisation on message (use a future -style messageKey if needed)
 *
 * Adapters that don't understand `confirm` should fail the
 * affordance (strict) rather than silently ignore — a `danger` gate
 * dropped on the floor is a UX hazard.
 *
 * ──── — `labelKey` localisation passthrough (locked 2026-05-20)
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
 * ──── — Section-scope CTAs via `surfaces.ui.placement: 'section-header'`
 *
 * Surfaced by B.2.3 deferral.  Inbox has a "Clear all" header CTA —
 * not creative (doesn't add items), not per-item. No slot in.
 *
 * Solution: ops with `surfaces.ui.placement: 'section-header'`
 * surface in `section.sectionActions[]` (parallel to `affordances[]`
 * and `itemActions[]`).  Same Affordance shape; the placement
 * difference is purely semantic — header CTAs are adjacent to the
 * section title.
 *
 * Forward-additive.
 *
 * ──── -strict — opt-in skillId cross-check (locked 2026-05-21)
 *
 * `validateManifest(manifest, {strict: true})` walks every
 * `view.dataSource.skillId` (also `view.fields[].patch.opId`) and
 * verifies it's either declared in `manifest.operations[].id` OR in
 * the new `manifest.externalSkills?: string[]` allow-list.  Default
 * (no `strict` opt) keeps the existing tolerant behaviour.
 *
 * ──── D / — `surfaces.page` projection (renderWeb tail, 2026-07)
 *
 * The renderWeb-tail slice of Objective D (all surfaces manifest-driven).
 * Ops that open a persistent rich-UI surface declare `surfaces.page`
 * (validated by: `{kind: 'side-panel'|'modal'|'screen', title?,
 * route?}`) — the Settings side-panel, the Cluster-C wizards (restore
 * identity, dispute, audience picker, encrypted backup, create/join
 * circle), etc.  Before this slice, renderWeb DROPPED these declarations:
 * pages surfaced neither in the NavModel nor in renderCoverage's
 * web/mobile column, so the coverage snapshot under-counted the web
 * surface (invariant #4 honesty gap).
 *
 * Projection: each `surfaces.page` op becomes a `NavModel.pages[]` entry
 * (declaration order, deterministic).  Platform-neutral — `route` (the
 * mobile nav route) rides along so the SAME projection feeds
 * renderMobile; the web adapter ignores it.  renderWeb ≡ renderMobile
 * holds by construction (renderMobile re-exports renderWeb).
 *
 * Forward-additive: the `pages` KEY is omitted when a manifest declares
 * no page surface, so page-less manifests keep the exact
 * `{app, sections, globals}` shape.  renderCoverage's `screen` detector
 * now also counts `surfaces.page` (a page IS a web/mobile surface).
 *
 * ──── Nav-chrome — D / Surface 1: the top-level TAB BAR (2026-07)
 *
 * Objective D, Surface 1.  The four top-level tabs (screens · circles ·
 * contacten · mij) were hardcoded IDENTICALLY in the web + mobile shells
 * (invariant #3 violated by construction — same ids + same locale keys in
 * two files).  Nav chrome becomes MANIFEST-DECLARED: a manifest declares a
 * `tabs[]` block of nav roots, and the shells project the bar from
 * `NavModel.tabs` instead of a per-shell `TABS` literal.  The four ids +
 * locale keys now live ONCE, in `manifest.tabs`.
 *
 * Each `manifest.tabs[]` entry → a `NavModel.tabs[]` NavItem (declaration
 * order, deterministic).  Shape: `{ id, labelKey, icon?, target }` where
 * `target` is the NavTarget union above.  Platform-neutral — the SAME
 * projection feeds renderMobile (renderMobile re-exports renderWeb), so
 * renderWeb ≡ renderMobile holds by construction.
 *
 * SIBLING KIND → `nav-actions` (Surface 2, now implemented).  The
 * detail action-bar (per-detail buttons) is a SIBLING nav-chrome kind: an
 * ordered list of the SAME `{ id, labelKey, icon?, target }` NavItem shape,
 * projected to `NavModel.actions[]` (or `navActions[]`) from a
 * `manifest.actions` block, validated by the SAME `validateNavItem` helper.
 * A nav-action's `target` is typically `{kind:'op', opId}` (invoke the op);
 * `{kind:'nav', to}` stays available for a "back to list" style action.  So
 * the reusable vocabulary is: (1) the NavItem entry shape, (2) the NavTarget
 * union, (3) `validateNavItem`.  nav-actions slots in as a second consumer
 * of all three — no shape churn on tabs.
 * ─────────────────────────────────────────────────────────────────
 */

import { paramsToJsonSchema } from './paramsToJsonSchema.js';

/**
 * verbs that auto-surface as section affordances
 * without requiring `surfaces.ui` (rule (a) generalised).
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
 * Render the web/mobile-surface projection of a manifest: a platform-neutral `NavModel`
 * (`{ app, sections, globals }`, plus `pages` / `tabs` / `actions` keys only when the manifest
 * declares them). Deterministic — sections follow `manifest.views` order, affordances follow
 * `manifest.operations` order. `renderMobile` re-exports this function, so renderWeb ≡ renderMobile
 * holds by construction. Throws when `manifest` is missing.
 *
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
  //     Inferred from existing surfaces.ui (no schema change).
  //     `placement === 'section-header'` is NOT global;
  //     handled inside buildSection per-section.
  const globals = [];
  for (const op of ops) {
    const ui = op?.surfaces?.ui;
    if (!ui) continue;
    if (ui.placement !== 'global') continue;
    globals.push(buildAffordance(op, manifest, 'global'));
  }

  // (b) Sections — one per view; preserve declaration order.
  const sections = views.map((view) => buildSection(view, ops, manifest));

  // (c) Pages — D /: ops with `surfaces.page` project to top-level
  //     PAGE surfaces (Settings side-panel, Cluster-C wizards, …).
  //     Declaration order, deterministic.  Kept OUT of the return object
  //     when empty so page-less manifests keep the {app, sections,
  //     globals} shape.
  const pages = [];
  for (const op of ops) {
    const page = op?.surfaces?.page;
    if (!page || typeof page !== 'object' || Array.isArray(page)) continue;
    pages.push(buildPage(op, page));
  }

  // (d) Nav-chrome tabs — D / Surface 1: the ordered top-level TAB BAR
  //     roots.  Projected verbatim from `manifest.tabs` (declaration
  //     order).  Kept OUT of the return object when empty so tab-less
  //     manifests keep the {app, sections, globals} shape.
  const tabs = [];
  if (Array.isArray(manifest.tabs)) {
    for (const tab of manifest.tabs) {
      if (!tab || typeof tab !== 'object' || Array.isArray(tab)) continue;
      tabs.push(buildTab(tab));
    }
  }

  // (e) Nav-chrome actions — D / Surface 2: the ordered DETAIL ACTION BAR
  //     (the circle detail bar's sibling-screen buttons).  Projected verbatim
  //     from `manifest.actions` (declaration order), carrying the optional
  //     gate fields (`requires`/`platforms`) so the context-gating rides
  //     through the projection.  Kept OUT of the return object when empty so
  //     action-less manifests keep the {app, sections, globals} shape.
  const actions = [];
  if (Array.isArray(manifest.actions)) {
    for (const action of manifest.actions) {
      if (!action || typeof action !== 'object' || Array.isArray(action)) continue;
      actions.push(buildAction(action));
    }
  }

  const nav = {
    app: typeof manifest.app === 'string' ? manifest.app : '',
    sections,
    globals,
  };
  if (pages.length > 0) nav.pages = pages;
  if (tabs.length > 0) nav.tabs = tabs;
  if (actions.length > 0) nav.actions = actions;
  return nav;
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
  // D-mig-1a — list-surface field selectors.  Passed through verbatim
  // (same pattern as `view.filter` above) so the list-render seam can
  // project a row's label + group/filter field FROM the manifest instead
  // of a hardcoded LIST_SCREENS literal.  Absent → unset (back-compatible).
  if (view.labelField    !== undefined) section.labelField    = view.labelField;
  if (view.categoryField !== undefined) section.categoryField = view.categoryField;
  // D-mig-2 — the free-text filter grammar: WHICH item fields the list's
  // text search matches.  Passed through verbatim (same pattern as
  // labelField/categoryField above) so the consumer (buildScreenModel)
  // searches across the declared fields instead of only the label.
  // Absent → unset ⇒ consumer defaults to `[labelField]` (back-compatible).
  if (view.searchFields  !== undefined) section.searchFields  = view.searchFields;
  // project the view's declared audience so the list-render seam
  // (e.g. basis `buildScreenModel`) can DEFAULT its ListFilter.audience
  // to it.  The schema field is `view.defaultAudience` (schema.js); an explicit
  // `view.audience`, if a manifest carries one, wins over the declared default.
  if (view.audience !== undefined) section.audience = view.audience;
  else if (view.defaultAudience !== undefined) section.audience = view.defaultAudience;
  // explicit data-source declaration; adapters use
  // this in preference to the default `listOpen({type, ...filter})`
  // heuristic.  Validate-loose: shape correctness is the adapter's
  // concern (forward-additive — may tighten via JSDoc).
  // `dataSource.argsFromContext` passes
  // through verbatim.  Substitution happens in
  // `@onderling/web-adapter/fetchSectionItems` at call time.
  if (view.dataSource !== undefined) section.dataSource = view.dataSource;
  // read-only marker. Adapter skips Add forms /
  // creative affordances; itemActions still render (state-gated
  // buttons may still apply).  Section receives `readOnly: true`
  // verbatim so adapter can also disable per-row interactivity if
  // needed (e.g. dim the row).
  if (view.readOnly === true)       section.readOnly   = true;
  // section shape. Default `'list'`
  // (Array<item>); `'record'` switches the adapter to expect ONE
  // record (e.g. settings, profile).  Field NOT set on the section
  // when `view.shape` is absent OR equals `'list'` — keeps NavModel
  // JSON minimal + back-compatible (every existing section is
  // implicitly list-shaped).
  if (view.shape === 'record')      section.shape      = 'record';

  // per-field declarations for record-shape
  // views.  Pass through verbatim (defensive copy of each field +
  // patch sub-object).
  if (view.shape === 'record' && Array.isArray(view.fields)) {
    section.fields = view.fields.map((f) => {
      const out = { name: f.name };
      if (f.type    !== undefined) out.type    = f.type;
      if (f.label   !== undefined) out.label   = f.label;
      // localisation key passthrough on fields.
      if (typeof f.labelKey === 'string' && f.labelKey !== '') {
        out.labelKey = f.labelKey;
      }
      // conditional-display gate. Same shape
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
      // multi-skill records. Per-field
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
        // wrapped-patch shape opt-in. When
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
      // skip add/register affordances when the section is read-only.
      if (view.readOnly === true) continue;
      // (rule a) — creative verbs (: add | register) auto-surface
      // as section affordances without needing `surfaces.ui`.  Every
      // web section needs an "add new item" path; the manifest
      // shouldn't have to repeat `surfaces.ui` for each.
      section.affordances.push(
        buildAffordance(op, manifest, 'section', m.viaTypeEnum ? { type: view.type } : null),
      );
    } else if (ui?.placement === 'section-header') {
      // section-scope CTAs. e.g. inbox's
      // "Clear all" header CTA.  Adjacent to the section title; not
      // per-item, not creative.  Shape matches Affordance.
      if (!section.sectionActions) section.sectionActions = [];
      section.sectionActions.push(
        buildAffordance(op, manifest, 'section-header', m.viaTypeEnum ? { type: view.type } : null),
      );
    } else if (ui) {
      // (rule c) — other verbs require surfaces.ui to surface as itemActions.
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
 *   **Type-enum fallback (locked 2026-05-20):** op without
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
    // wildcard: '*' matches every section. No
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

/**
 * project one `surfaces.page` declaration into a NavModel
 * Page. Pure passthrough of the -validated shape (`kind` required;
 * `title`/`route` optional).  `route` (mobile nav route) is carried so
 * the same projection feeds renderMobile; the web adapter ignores it.
 */
function buildPage(op, page) {
  const out = { opId: op.id, kind: page.kind };
  if (typeof page.title === 'string' && page.title !== '') out.title = page.title;
  if (typeof page.route === 'string' && page.route !== '') out.route = page.route;
  // style localisation key passthrough — a consumer with a `t`
  // resolves the localised page title via `labelKey`; others fall back
  // to `title`.  Forward-additive (no manifest declares it yet).
  if (typeof page.labelKey === 'string' && page.labelKey !== '') out.labelKey = page.labelKey;
  return out;
}

/**
 * Nav-chrome (D / Surface 1) — project one `manifest.tabs[]` entry into a
 * NavModel NavItem.  Defensive passthrough of the validated shape
 * (`{ id, labelKey, icon?, target }`).  `target` is the NavTarget union —
 * copied field-by-field so the NavModel stays pure-data.  Shared with the
 * `nav-actions` kind (Surface 2), which reuses this exact NavItem
 * shape + `buildNavTarget`.
 */
function buildTab(tab) {
  const out = { id: tab.id, labelKey: tab.labelKey };
  if (typeof tab.icon === 'string' && tab.icon !== '') out.icon = tab.icon;
  const target = buildNavTarget(tab.target);
  if (target) out.target = target;
  return out;
}

/**
 * Nav-chrome (D / Surface 2) — project one `manifest.actions[]` entry into a
 * NavModel NavItem for the DETAIL ACTION BAR.  A SIBLING of `buildTab`: same
 * `{ id, labelKey, icon?, target }` NavItem shape + `buildNavTarget`, PLUS the
 * optional gate fields (`requires`/`platforms`) copied through verbatim so the
 * action's context-gating is declared in the manifest and rides the projection
 * (the app-side selector — basis `actionProjection.js` — evaluates them).
 * Pure passthrough of the validated shape.  Shared, deterministic: renderMobile
 * re-exports renderWeb, so renderWeb ≡ renderMobile for the actions projection.
 */
function buildAction(action) {
  const out = { id: action.id, labelKey: action.labelKey };
  if (typeof action.icon === 'string' && action.icon !== '') out.icon = action.icon;
  const target = buildNavTarget(action.target);
  if (target) out.target = target;
  // Gate fields — defensive copy; only set when a valid non-empty string array
  // (the validator rejects other shapes up front).  Kept out otherwise so a
  // gate-less action projects the exact tab-shape NavItem.
  for (const field of ['requires', 'platforms']) {
    const v = action[field];
    if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x !== '')) {
      out[field] = [...v];
    }
  }
  return out;
}

/**
 * Project a NavTarget (the shared nav-chrome vocabulary).  Returns a fresh
 * copy of the discriminated union — `{kind:'nav', to}` (an app-nav root, no
 * op) or `{kind:'op', opId}` (dispatch a manifest op).  Returns `undefined`
 * for an unrecognised shape (the validator rejects those up front).
 */
function buildNavTarget(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return undefined;
  if (target.kind === 'nav' && typeof target.to === 'string' && target.to !== '') {
    return { kind: 'nav', to: target.to };
  }
  if (target.kind === 'op' && typeof target.opId === 'string' && target.opId !== '') {
    return { kind: 'op', opId: target.opId };
  }
  return undefined;
}

function buildAffordance(op, manifest, placement, prefilledParams) {
  const a = {
    opId:         op.id,
    label:        op?.surfaces?.ui?.label ?? op.verb ?? op.id,
    paramsSchema: paramsToJsonSchema(op.params ?? [], { manifest }),
    placement,
  };
  // localisation key passthrough. When the manifest
  // declares `surfaces.ui.labelKey`, surface it alongside `label` so
  // consumers with an localisation function look up the localized string;
  // others fall back to `label`.  Forward-additive — absent means
  // existing English-label behaviour.
  if (typeof op?.surfaces?.ui?.labelKey === 'string'
      && op.surfaces.ui.labelKey !== '') {
    a.labelKey = op.surfaces.ui.labelKey;
  }
  // confirm-severity passthrough. Pure
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
  // pass through any *other* appliesTo fields verbatim (e.g.
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
  // localisation key passthrough (see buildAffordance).
  if (typeof op?.surfaces?.ui?.labelKey === 'string'
      && op.surfaces.ui.labelKey !== '') {
    action.labelKey = op.surfaces.ui.labelKey;
  }
  // confirm-severity passthrough (see buildAffordance).
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
