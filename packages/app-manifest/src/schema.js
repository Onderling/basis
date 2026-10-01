/**
 * Schema for @onderling/app-manifest.  JSDoc typedefs only — no runtime
 * (per repo convention; cf. apps/household/src/types.js).  Importing this
 * file gives you `__types__` only; the typedefs are doc/IDE artefacts.
 *
 * The schema is the **frozen input contract** the four projectors
 * (`validateManifest`, `paramsToJsonSchema`, `renderChat`, `renderSlash`)
 * consume.  Forward-additive: unknown top-level / operation / param /
 * view / surface keys are tolerated; new surfaces and capabilities are
 * added without breaking existing ones (PLAN guardrail #2).
 *
 * Deferred-but-accepted fields:
 *   `requires` (top-level) — (granular capability vocab)
 *   `view.defaultAudience` — (audience/circle substrate)
 * `validateManifest` does NOT interpret these; renderers may consult
 * them in later SPs.
 */

/**
 * @typedef {object} Manifest
 * @property {string}                 app          stable app id (namespace key)
 * @property {string[]}               itemTypes    canonical (in @onderling/item-types
 *                                                 `list()`) OR app-local — both
 *                                                 are permitted (F-SP1-a).
 * @property {Operation[]}            operations
 * @property {View[]}                 [views]
 * @property {Tab[]}                  [tabs]       NAV-CHROME (D / Surface 1) — the ordered
 *                                                 top-level TAB BAR roots.  `renderWeb`/`renderMobile`
 *                                                 project these into `NavModel.tabs[]`; the web +
 *                                                 mobile shells render the bar FROM that projection
 *                                                 instead of a per-shell hardcoded literal (so the
 *                                                 tab ids + locale keys live ONCE, here).
 * @property {SlashGrammar}           [slashGrammar]  drives `renderSlash`
 * @property {string}                 [systemPrompt]  verbatim system prompt
 *                                                 (F-SP1-d, locked 2026-05-19).
 *                                                 When set, `renderChat` emits
 *                                                 it as-is, overriding the
 *                                                 parameterised builder.  Used
 *                                                 for apps whose prose was
 *                                                 hand-written and isn't
 *                                                 byte-reproducible from
 *                                                 per-op templates (PLAN §1.6).
 * @property {object} [requires], accepted-not-interpreted
 * @property {Setting[]} [settings] B · (2026-07-01, ruling): the app's
 *                                                 declarative SETTINGS — the same shape as op params,
 *                                                 so one renderer draws inline forms AND the creation
 *                                                 wizard.  A third-party app declares settings like it
 *                                                 declares op params; `validateManifest` shape-checks them.
 */

/**
 * Nav-chrome NavItem (D / Surface 1).  A top-level TAB BAR root.  The SAME
 * shape backs the nav-actions kind (Surface 2 — the detail action-bar),
 * so `Tab` is the reusable nav-chrome entry, not a tab-only type.
 *
 * @typedef {object} Tab
 * @property {string}     id        stable nav-item id; the shell keys its
 *                                   handler + active-state off this.
 * @property {string}     labelKey  localisation key (invariant #8) — resolved via `t()`.
 * @property {string}     [icon]    optional icon token (consumer-side glyph lookup).
 * @property {NavTarget}  target    what the tab SELECTS — `{kind:'nav', to}` (an
 *                                   app-nav root that maps to no op) OR
 *                                   `{kind:'op', opId}` (dispatch a manifest op).
 *
 * @typedef {{kind: 'nav', to: string} | {kind: 'op', opId: string}} NavTarget
 */

/**
 * A declarative app setting (B, ruling). Mirrors {@link Param} so the same renderer
 * handles inline forms and the admin creation wizard.  `scope` splits the two-level resolution:
 * `'circle'` settings are the ADMIN TEMPLATE (per-circle); `'user'` settings are member PREFERENCES.
 * The effective value is `admin-template ∩ member-prefs`.
 *
 * @typedef {object} Setting
 * @property {string}   key           unique within `manifest.settings`.
 * @property {string}   label         human label (English canonical; localise via `labelKey` later).
 * @property {'toggle'|'choice'|'text'|'number'|'member'} kind
 *                                     toggle=boolean · choice=one-of `of` · text · number ·
 *                                     member=a circle member (webid).
 * @property {string[]} [of]          the choices — REQUIRED when `kind==='choice'`.
 * @property {*}        [default]     default value (shape must fit `kind`).
 * @property {'circle'|'user'} [scope] `'circle'` (default) = admin template; `'user'` = member pref.
 * @property {boolean}  [adminOnly]   only the circle admin may set it (even at `user` scope).
 * @property {object}   [requiredWhen] conditional-required gate `{ otherKey: value | value[] }` —
 *                                     the setting is required only when every named sibling matches.
 * @property {string}   [description] LLM trigger hint / help text (helps the model know WHEN it applies).
 */

/**
 * @typedef {object} Operation
 * @property {string}                 id           unique within the manifest
 * @property {string}                 verb         must be in `VERBS` (item-store
 *                                                 verb allow-list).
 * @property {AppliesTo}              [appliesTo]
 * @property {Param[]}                [params]
 * @property {string}                 [role]       RolePolicy key (passed through;
 *                                                 not interpreted here).
 * @property {Surfaces}               [surfaces]
 * @property {CompositeStep[]} [steps] (feedback-extension DESIGN §1.3):
 *                                                 when present, this op is a COMPOSITE —
 *                                                 a pure-data sequence of EXISTING opIds
 *                                                 run by `runCompositeOp`. An op with
 *                                                 `steps` declares no own handler; its
 *                                                 functionality is the composition of its
 *                                                 steps. Bottoms out in already-present
 *                                                 atoms (the verifier enforces this →
 *                                                 sandbox-by-construction).
 * @property {'stop'|'continue'} [onError]: composite failure policy. 'stop'
 *                                                 (default) halts on the first failing step;
 *                                                 'continue' runs every step best-effort.
 *                                                 Best-effort only — NO implicit rollback (v0).
 */

/**
 * One step of a composite Operation. Each step names an EXISTING op
 * (`appOrigin` + `opId`) and the args to invoke it with.  `args` are
 * literal; `argRef` threads a prior step's RESULT into this step's args.
 *
 * @typedef {object} CompositeStep
 * @property {string}                 appOrigin    which app's agent owns the step's op
 * @property {string}                 opId         the existing op to call (verified in scope)
 * @property {object}                 [args]       literal args merged into the call
 * @property {ArgRef}                 [argRef]     pull a value from a prior step's result
 *                                                 and merge it into this step's args
 */

/**
 * Threads a value from an earlier step's result into a later step's args.
 *
 * @typedef {object} ArgRef
 * @property {number}                 from         index (0-based) of a PRIOR step whose
 *                                                 result to read from (must be < this step).
 * @property {string}                 path         dot-path into that step's result
 *                                                 (e.g. `'item.id'`); the resolved value is
 *                                                 merged into args under the LAST path segment
 *                                                 (`'item.id'` → `args.id`), or under
 *                                                 `as` when given.
 * @property {string}                 [as]         arg name to bind the resolved value to
 *                                                 (overrides the last path segment).
 */

/**
 * @typedef {object} AppliesTo
 * @property {string|string[]}        [type]       must reference manifest.itemTypes
 *                                                 when present.
 * @property {string|string[]}        [state]      single state (`'open'`) or a
 *                                                 multi-state gate (e.g.
 *                                                 `['claimed','rejected']` for
 *                                                 submit-from-either-state).
 *                                                 F-SP3-a (locked 2026-05-20).
 */

/**
 * @typedef {object} Param
 * @property {string}                 name
 * @property {'string'|'number'|'boolean'|'enum'} kind
 * @property {'itemTypes'|string[]}   [of]         for kind:'enum': either
 *                                                 'itemTypes' (resolve vs
 *                                                 manifest.itemTypes) or an
 *                                                 inline array of strings.
 * @property {boolean}                [required]
 * @property {object}                 [schema]     inline JSON Schema fragment
 *                                                 merged into the emitted
 *                                                 property after `type`
 *                                                 (F-SP1-c, locked 2026-05-19).
 *                                                 e.g. `{ minLength: 1 }` or
 *                                                 `{ pattern: '^\\d+$' }`.
 *                                                 Forward-additive escape
 *                                                 hatch for any JSON Schema
 *                                                 keyword the per-kind switch
 *                                                 doesn't model directly.
 */

/**
 * @typedef {object} Surfaces
 * @property {ChatSurface}            [chat]
 * @property {SlashSurface}           [slash]
 * @property {AttachSurface}          [attach]
 * @property {UiSurface}              [ui]
 */

/** @typedef {{ hint?: string, examples?: string[] }} ChatSurface */

/**
 * The ATTACHMENT surface — the predicate `renderAttachments` filters on.
 * Mirrors {@link SlashSurface}: declaring it on an op makes the op appear in
 * the attach ("+") menu, exactly as `surfaces.slash.command` makes it appear
 * in the slash menu. One declaration → chat + slash + attach-menu, no
 * per-surface wiring. Every attach entry IS an op; tapping it compiles to
 * `{ opId, args }` → `callSkill`, identical to a slash command firing.
 *
 * @typedef {object} AttachSurface
 * @property {string}   [label]     the menu label (e.g. 'Photo', 'File',
 *                                   'Appointment'). Defaults to the op id.
 * @property {string}   [group]     optional menu section to group the entry
 *                                   under (e.g. 'media', 'schedule').
 * @property {string}   [itemType]  the attachable noun the op produces, when it
 *                                   isn't the op's `appliesTo.type`. Lets the
 *                                   menu label/group by noun and connect to the
 *                                   `@onderling/item-types` registry of
 *                                   attachable nouns. Falls back to a single
 *                                   `appliesTo.type` when omitted.
 */

/**
 * @typedef {object} SlashSurface
 * @property {string}                 command      e.g. '/add' — feeds Telegram's
 *                                                 setMyCommands.
 * @property {string}                 [shape]      e.g. '/add <type> <text>'
 *                                                 (display only).
 * @property {SlashMatchSpec}         [match]      drives `renderSlash` for this op.
 */

/**
 * @typedef {object} SlashMatchSpec
 * @property {Array<string|string[]>} verbs        single tokens or multi-word
 *                                                 phrases ('voeg toe'); matched
 *                                                 case-insensitively.
 * @property {'none'|'match'|'type+text'|'type-only'|'text-only'} [body]
 *                                                 body parser kind.  Default 'none'.
 *                                                 `'text-only'` (F-SP2-a):
 *                                                 the body becomes the
 *                                                 whole `text` arg, no
 *                                                 type prefix.
 * @property {boolean}                [splitItems] split multi-item bodies on
 *                                                 ',', ' and ', ' en ' (quotes
 *                                                 preserved).  Applies to 'match'
 *                                                 and 'type+text'.
 * @property {Call}                   [onEmpty]    fallback Call when the body
 *                                                 parser yields nothing.
 * @property {string}                 [arg]        F-SP2 (2026-06-11): target the body at this arg
 *                                                 name instead of the default ('match' for 'match',
 *                                                 'text' for 'text-only'/'type+text'). E.g. `'id'`
 *                                                 for ops whose param is `id`. Inert if absent.
 * @property {string[]|true}          [dropTrailing] strip a trailing connector clause from
 *                                                 the body — words like ['to','op','toe'] turn
 *                                                 "milk to the list" → "milk". Applies to 'match',
 *                                                 'text-only', 'type+text'. Inert if absent. `true`: the
 *                                                 words are the app's gate words, per language.
 */

/** @typedef {{ skillId: string, args: object }} Call */

/**
 * @typedef {object} UiSurface
 * @property {string}                 [placement]  e.g. 'item-action' | 'list-header'
 * @property {'button'|'compose-box'|'toggle'|string} [control]
 * @property {string}                 [label]
 * @property {string}                 [icon]
 */

/**
 * @typedef {object} View
 * @property {string}                 id
 * @property {string}                 title
 * @property {string}                 type         must reference manifest.itemTypes.
 * @property {object}                 [filter]     e.g. { open: true }
 * @property {string} [defaultAudience],
 *                                                 accepted-not-interpreted.
 * @property {string}                 [labelField] D-mig-1a — which item field
 *                                                 supplies a list row's label
 *                                                 (default 'label' downstream).
 *                                                 Additive; a view without it is
 *                                                 unchanged.
 * @property {string}                 [categoryField]  D-mig-1a — which item field
 *                                                 groups/filters list rows
 *                                                 (e.g. 'category', 'kind').
 *                                                 Additive; optional.
 * @property {string[]}               [searchFields]   D-mig-2 — which item fields
 *                                                 the free-text list filter matches
 *                                                 (case-insensitive contains; an
 *                                                 item matches if ANY listed field
 *                                                 contains the query).  Default
 *                                                 `[labelField]` downstream ⇒ a view
 *                                                 without it searches only the label,
 *                                                 exactly as before.  Additive;
 *                                                 back-compatible.
 */

/**
 * @typedef {object} SlashGrammar
 * @property {string[]}               [addressedPrefixes]
 *                                                 regex sources to strip ONE
 *                                                 leading match (e.g. '/' or
 *                                                 '@household\\s+').
 * @property {SpecialForm[]}          [specials]   full-line regex → fixed Call.
 * @property {Record<string,string>}  [typeAliases]   token → canonical type
 *                                                 (e.g. groceries → shopping).
 * @property {string}                 [defaultType]   fallback when no alias hits.
 */

/**
 * @typedef {object} SpecialForm
 * @property {string}                 pattern      regex source.
 * @property {string}                 [flags]      default 'i'.
 * @property {string}                 skillId
 * @property {object}                 [args]
 */

// Empty export so this is a real ES module.  Imports of
// `@onderling/app-manifest/schema` (and `import './schema.js'`) resolve cleanly.
/**
 * Deliberate typedef-carrier marker — the module's only runtime export, always `true`. `schema.js`
 * exists for its JSDoc `@typedef`s (doc/IDE artefacts, no runtime validation); this constant makes
 * the file a real ES module so imports of the schema subpath resolve cleanly.
 */
export const __types__ = true;
