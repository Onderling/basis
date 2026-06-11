/**
 * canopy-chat — router.
 *
 * Resolves a `ParseResult` (from `parser.js`) against the merged
 * catalog (from `manifestMerge.js`) and produces a tagged-union
 * `RouteResult`:
 *
 *   { kind: 'ready',        ...dispatchable }       — go ahead, fire
 *   { kind: 'needsForm',    schema, missing, ... }  — required params missing
 *   { kind: 'needsConfirm', severity, message, ... }— Q27 gate triggered
 *   { kind: 'unknown',      text, threadId }        — parser fell through
 *   { kind: 'error',        code, message, ... }    — invalid input
 *
 * Pure function — the renderer / chat-shell driver decides what UX
 * to show for each tag, then calls dispatch when the resolution is
 * `'ready'`.
 *
 * Phase v0.1 sub-slice 1.6 per `/Project Files/canopy-chat/coding-plan.md`.
 */

import { isBulkKeyword } from './bulkOps.js';

/**
 * Verbs that read rather than mutate — a bulk fan-out over them is
 * meaningless, so `/list all` etc. fall through to normal resolution.
 */
const BULK_READ_VERBS = new Set([
  'list', 'get', 'view', 'show', 'find', 'brief', 'snapshot', 'open', 'record',
]);

/**
 * @typedef {object} ReadyDispatch
 * @property {'ready'}         kind
 * @property {string}          opId
 * @property {object}          args
 * @property {string}          appOrigin
 * @property {string|null}     threadId
 * @property {string}          replyShape   effective Q28 shape (declared or default)
 */

/**
 * @typedef {object} NeedsFormDispatch
 * @property {'needsForm'}     kind
 * @property {object[]}        params       op.params verbatim
 * @property {string[]}        missing      names of required params not bound
 * @property {object}          prefilledArgs
 * @property {string}          opId
 * @property {string}          appOrigin
 * @property {string|null}     threadId
 * @property {string}          replyShape
 */

/**
 * @typedef {object} NeedsConfirmDispatch
 * @property {'needsConfirm'}  kind
 * @property {'warn'|'danger'} severity
 * @property {string}          [message]
 * @property {string}          opId
 * @property {object}          args
 * @property {string}          appOrigin
 * @property {string|null}     threadId
 * @property {string}          replyShape
 */

/**
 * @typedef {object} UnknownInput
 * @property {'unknown'}       kind
 * @property {string}          text
 * @property {string|null}     threadId
 */

/**
 * @typedef {object} ErrorInput
 * @property {'error'}         kind
 * @property {string}          code
 * @property {string}          message
 * @property {string|null}     threadId
 */

/**
 * @typedef {ReadyDispatch | NeedsFormDispatch | NeedsConfirmDispatch
 *          | UnknownInput | ErrorInput} RouteResult
 */

/**
 * Resolve a parser result into a route result.
 *
 * @param {import('./parser.js').ParseResult} parseResult
 * @param {import('./manifestMerge.js').MergedCatalog} catalog
 * @returns {RouteResult}
 */
export function resolveDispatch(parseResult, catalog) {
  if (!parseResult || !catalog) {
    throw new TypeError('resolveDispatch: parseResult + catalog required');
  }

  if (parseResult.kind === 'unknown') {
    return {
      kind: 'unknown',
      text:     parseResult.text,
      threadId: parseResult.threadId ?? null,
    };
  }

  if (parseResult.kind !== 'slash') {
    return {
      kind: 'error',
      code: 'unknown-parse-kind',
      message: `unsupported parse kind: ${parseResult.kind}`,
      threadId: parseResult.threadId ?? null,
    };
  }

  const { opId, args: rawArgs, threadId } = parseResult;
  const entry = catalog.opsById.get(opId);
  if (!entry) {
    return {
      kind: 'error',
      code: 'unknown-op',
      message: `unknown opId: ${opId}`,
      threadId: threadId ?? null,
    };
  }
  const { op, appOrigin } = entry;

  // E2 — bulk fan-out.  When the positional body is a bulk keyword
  // (`/done all`) and the op targets an item id with a mutation verb,
  // return a `bulk` dispatch instead of binding "all" as a literal id.
  // The host resolves the candidate items (most-recent listing) and
  // runs `runBulkOp`, whose item-changed events fan out cross-thread
  // via the EventRouter (OQ-4).
  const target = firstTargetParam(op);
  if (target && isBulkKeyword(rawArgs?._match) && !BULK_READ_VERBS.has(op?.verb)) {
    const { _match, ...baseArgs } = rawArgs ?? {};
    return {
      kind:       'bulk',
      opId,
      appOrigin,
      argName:    target.name,
      baseArgs,
      threadId:   threadId ?? null,
      replyShape: effectiveReplyShape(opId, op, catalog),
      verb:       op?.verb ?? null,
    };
  }

  // Bind `_match` (positional body from parser) to the op's first
  // required string param.  If no such param exists, drop _match.
  const boundArgs = bindMatchArg(rawArgs ?? {}, op);

  // Find missing required params (excluding any we just bound).
  const missing = findMissingRequired(op.params ?? [], boundArgs);
  const replyShape = effectiveReplyShape(opId, op, catalog);

  if (missing.length > 0) {
    return {
      kind: 'needsForm',
      params:        op.params ?? [],
      missing,
      prefilledArgs: boundArgs,
      opId, appOrigin,
      threadId: threadId ?? null,
      replyShape,
    };
  }

  // Q27 — confirm gate.  Only severity ∈ {warn, danger} triggers a
  // gate.  'info' is informational only; chat shell may show the
  // message but does not block dispatch.
  const confirm = op?.surfaces?.ui?.confirm;
  if (confirm && (confirm.severity === 'warn' || confirm.severity === 'danger')) {
    return {
      kind: 'needsConfirm',
      severity: confirm.severity,
      message:  confirm.message,
      opId,
      args: boundArgs,
      appOrigin,
      threadId: threadId ?? null,
      replyShape,
    };
  }

  return {
    kind: 'ready',
    opId,
    args: boundArgs,
    appOrigin,
    threadId: threadId ?? null,
    replyShape,
    verb: op?.verb ?? null,
  };
}

/** Verbs whose dispatch CREATES a new item that belongs to a scope (the item inherits the open circle). */
const CREATE_VERBS = new Set(['add', 'post']);

/**
 * Id-targeted MUTATION verbs that must ROUTE to the active circle's crew/group to FIND their target.
 * canopy-chat is multi-pod — each circle has its own tasks/stoop peer + item-store — so a mutation
 * dispatched WITHOUT the scope keys lands on the wrong crew and the store reports "item not found".
 * (Device-verify 2026-06-11: `@assistant done <task>` resolved the right id via the circle-scoped
 * `listOpen`, but `completeTask` carried no scope → wrong crew → it silently completed nothing.) The
 * circle bot always resolves the target FROM the active circle's listing, so binding it is correct.
 */
const MUTATE_VERBS = new Set(['complete', 'claim', 'submit', 'approve', 'reject', 'remove']);

/**
 * The scope arg keys the substrate resolvers read.  All four share the
 * one circle/crew/group id space (CIRCLE_ID_IS_CREW_ID_ALIAS); we set
 * them together so whichever key a given app's resolver checks resolves
 * to the active circle.
 */
const SCOPE_KEYS = ['circleId', 'crewId', 'groupId', '_scope'];

/**
 * F1 active-circle → app-scope sync (Phase 5.3).
 *
 * When a circle is open, item-creating dispatches should land inside
 * that circle.  The tasks / stoop resolvers already pick their crew /
 * group from an explicit scope arg (`args.crewId → args._scope → topic`
 * for tasks; per-call `args.groupId` for stoop), so binding the active
 * circle is just: inject that id as the scope arg on a *create*
 * dispatch.  The created item then carries the circle tag, readable
 * back via `itemCircleId` (circleScope.js).
 *
 * Scope is injected ONLY when:
 *   - the dispatch is `ready` (forms / confirms / errors are untouched),
 *   - a circle is active (`activeCircleId` truthy),
 *   - the verb is item-creating (`add` / `post` — the item inherits the circle) OR an id-targeted
 *     MUTATION (`complete` / `claim` / `submit` / `approve` / `reject` — which must route to the
 *     circle's crew/group to FIND the item; see MUTATE_VERBS). NOT `create` (makes a new container,
 *     e.g. createGroup, must not inherit the open circle) and NOT read verbs.
 *   - the caller hasn't already chosen a scope (an explicit `--crew=` /
 *     picked group wins wholesale).
 *
 * The host applies this at the runDispatch boundary, so peer-handler
 * `callSkill` calls (inbound remote posts) — which never pass through
 * here — are not mis-scoped to the locally-open circle.
 *
 * NB (corrected 2026-06-11): canopy-chat is MULTI-POD in practice — each circle has its own
 * tasks/stoop peer + item-store — so the scope arg is load-bearing for routing, not just a forward-
 * compatible tag. A mutation dispatched without it lands on the wrong crew (device-verified
 * "item not found" on `done <task>`). stoop is per-call group-aware; tasks routes by crewId.
 *
 * Pure: the host reads `getActiveCircle()` and passes the id in.
 *
 * @param {ReadyDispatch} ready
 * @param {string|null}   activeCircleId
 * @returns {ReadyDispatch}
 */
export function scopeReadyDispatch(ready, activeCircleId) {
  if (!ready || ready.kind !== 'ready' || !activeCircleId) return ready;
  // CREATE verbs: the new item inherits the open circle. MUTATE verbs: route to the circle's crew/group
  // so the store can find the target (multi-pod — see MUTATE_VERBS). Everything else is untouched.
  if (!CREATE_VERBS.has(ready.verb) && !MUTATE_VERBS.has(ready.verb)) return ready;

  const args = ready.args ?? {};
  const alreadyScoped = SCOPE_KEYS.some(
    (k) => args[k] !== undefined && args[k] !== null && args[k] !== '',
  );
  if (alreadyScoped) return ready;

  const scoped = { ...args };
  for (const k of SCOPE_KEYS) scoped[k] = activeCircleId;
  return { ...ready, args: scoped };
}

/**
 * Bind the parser's `_match` positional value to the op's first
 * required string-kind param.  If no `_match`, return args verbatim.
 *
 * v0.7 catch-up (2026-05-23, user-reported): when no required target
 * exists (e.g. /apps with two optional positional params), the
 * function used to STRIP `_match`, leaving handlers with no way to
 * read the positional input.  Now: preserve `_match` in `rest` so
 * the handler can split it manually for multi-positional commands.
 *
 * @param {object}            args
 * @param {object}            op
 * @returns {object}
 */
/**
 * The op param a positional slash body binds to: the first required
 * string-ish param.  Shared by `bindMatchArg` (single dispatch) and the
 * E2 bulk-keyword branch (fan-out target).
 *
 * @param {object} op
 * @returns {object|undefined}
 */
function firstTargetParam(op) {
  return (op.params ?? []).find(
    // 2026-05-27 — accept `webid` as a stringy identifier kind so
    // row-button taps on contacts (and slash bodies like
    // `/remove-contact <webid>`) bind the body to the webid param
    // instead of falling through to a single-field followup.
    (p) => p?.required && (p.kind === 'string' || p.kind === 'enum' || p.kind === 'webid'),
  );
}

function bindMatchArg(args, op) {
  if (args._match === undefined) return { ...args };
  const target = firstTargetParam(op);
  if (!target) {
    // No required target — keep _match for the handler to split.
    return { ...args };
  }
  const { _match, ...rest } = args;
  // Don't clobber an explicit `--key=value` for the same name.
  if (rest[target.name] !== undefined) return rest;
  return { ...rest, [target.name]: _match };
}

/**
 * Iterate the op's params; return the names of required ones the
 * caller hasn't bound.  Empty string treated as missing (matches
 * existing manifest-validator semantics).
 *
 * @param {object[]}  params
 * @param {object}    boundArgs
 * @returns {string[]}
 */
function findMissingRequired(params, boundArgs) {
  const missing = [];
  for (const p of params) {
    if (!p?.required) continue;
    const v = boundArgs[p.name];
    if (v === undefined || v === null || v === '') {
      missing.push(p.name);
    }
  }
  return missing;
}

/**
 * Compute the effective Q28 reply shape:
 *
 *   1. Declared `surfaces.chat.reply` (looked up via the catalog).
 *   2. Fallback by `op.verb`: 'list' → 'list', others → 'text'.
 *
 * v0.1 ships with only `text` + `list` renderers; later phases
 * (v0.3 mini-pages, v0.5 embeds) extend the default rules without
 * breaking this contract.
 *
 * @param {string}                                          opId
 * @param {object}                                          op
 * @param {import('./manifestMerge.js').MergedCatalog}      catalog
 * @returns {string}
 */
function effectiveReplyShape(opId, op, catalog) {
  const declared = catalog.replyShapeFor?.(opId);
  if (declared) return declared;
  if (op?.verb === 'list') return 'list';
  return 'text';
}
