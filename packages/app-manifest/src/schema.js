/**
 * Schema for @canopy/app-manifest.  JSDoc typedefs only — no runtime
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
 *   - `requires` (top-level)        — SP-9 (granular capability vocab)
 *   - `view.defaultAudience`        — SP-5 (audience/circle substrate)
 * `validateManifest` does NOT interpret these; renderers may consult
 * them in later SPs.
 */

/**
 * @typedef {object} Manifest
 * @property {string}                 app          stable app id (namespace key)
 * @property {string[]}               itemTypes    canonical (in @canopy/item-types
 *                                                 `list()`) OR app-local — both
 *                                                 are permitted (F-SP1-a).
 * @property {Operation[]}            operations
 * @property {View[]}                 [views]
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
 * @property {object}                 [requires]   SP-9, accepted-not-interpreted
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
 * @property {CompositeStep[]}        [steps]      P1 (feedback-extension DESIGN §1.3):
 *                                                 when present, this op is a COMPOSITE —
 *                                                 a pure-data sequence of EXISTING opIds
 *                                                 run by `runCompositeOp`. An op with
 *                                                 `steps` declares no own handler; its
 *                                                 functionality is the composition of its
 *                                                 steps. Bottoms out in already-present
 *                                                 atoms (the verifier enforces this →
 *                                                 sandbox-by-construction).
 * @property {'stop'|'continue'}      [onError]    P1: composite failure policy. 'stop'
 *                                                 (default) halts on the first failing step;
 *                                                 'continue' runs every step best-effort.
 *                                                 Best-effort only — NO implicit rollback (v0).
 */

/**
 * One step of a composite Operation (P1).  Each step names an EXISTING op
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
 * Threads a value from an earlier step's result into a later step's args (P1).
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
 * @property {UiSurface}              [ui]
 */

/** @typedef {{ hint?: string, examples?: string[] }} ChatSurface */

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
 * @property {string[]}               [dropTrailing] F-SP2: strip a trailing connector clause from
 *                                                 the body — words like ['to','op','toe'] turn
 *                                                 "milk to the list" → "milk". Applies to 'match',
 *                                                 'text-only', 'type+text'. Inert if absent.
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
 * @property {string}                 [defaultAudience]  SP-5,
 *                                                 accepted-not-interpreted.
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
// `@canopy/app-manifest/schema` (and `import './schema.js'`) resolve cleanly.
export const __types__ = true;
