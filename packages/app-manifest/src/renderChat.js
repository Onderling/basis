/**
 * Render the chat-surface projection of a manifest.
 *
 * Output is exactly what `@onderling/chat-agent`'s `ChatAgent` ctor expects
 * (`toolCatalogue` + `toolHandlers` + `systemPrompt`), plus the structured
 * chat affordances (`commandMenu` for Telegram `setMyCommands`,
 * `inlineKeyboardFor(item)` for per-item inline buttons) that the manifest
 * also feeds.
 *
 * Frozen contract (PLAN flag #10 / R5, owner-approved 2026-05-19):
 *   renderChat(manifest, { skillRegistry, toSkillCtx, onStateUpdates }, opts?)
 *
 * `toolHandlers[id]` adapts an app-side skill
 *     (args, skillCtx) → { replies, stateUpdates }
 * into a ChatAgent ToolHandler
 *     (args, toolCtx)  → { replies, data: { stateUpdates } }
 * mapping ctx via `toSkillCtx(toolCtx)` and forwarding stateUpdates via
 * `onStateUpdates(updates)` (typically `scheduler.onStateUpdate`).  This
 * reproduces household's `chatAgentBridge.asToolHandler` generically.
 *
 * Deterministic: outputs follow manifest declaration order
 * (internal/order.js invariant).
 */

import { paramsToJsonSchema } from './paramsToJsonSchema.js';
import { buildPrompt }         from './internal/prompt.js';

/**
 * Render the chat-surface projection of a manifest: `toolCatalogue` + `toolHandlers` + `systemPrompt`
 * (the `ChatAgent` ctor shape) plus the structured chat affordance lookups (`commandMenu`,
 * `inlineKeyboardFor`, `replyShapeFor`, `followUpsFor`, `runtimeFor`, `embedSnapshotFor`, `briefFor`,
 * `searchFor`). Ops without a matching skill in `skillRegistry` are omitted from `toolHandlers`;
 * outputs follow manifest declaration order. Throws when `manifest`, `skillRegistry`, or
 * `toSkillCtx` is missing.
 *
 * @param {import('./schema.js').Manifest} manifest
 * @param {object} args
 * @param {Record<string, function>} args.skillRegistry — `{ opId: skill }` app-side skills.
 * @param {(toolCtx: object) => object} args.toSkillCtx — maps a ChatAgent tool ctx to a skill ctx.
 * @param {(stateUpdates: Array<object>) => void} [args.onStateUpdates] — sink for a skill's
 *   stateUpdates (an error thrown here is logged, never allowed to kill the reply).
 * @param {object} [opts]
 * @param {{preamble?: string, perToolLine?: function, postamble?: string}} [opts.prompt] — prompt
 *   builder overrides (ignored when the manifest carries a verbatim `systemPrompt` string).
 * @returns {{toolCatalogue: Array<object>, toolHandlers: Record<string, function>,
 *   systemPrompt: string, commandMenu: Array<object>, inlineKeyboardFor: function,
 *   replyShapeFor: function, followUpsFor: function, runtimeFor: function,
 *   embedSnapshotFor: function, briefFor: function, searchFor: function}}
 */
export function renderChat(manifest, args, opts = {}) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('renderChat: manifest required');
  }
  const { skillRegistry, toSkillCtx, onStateUpdates } = args || {};
  if (!skillRegistry || typeof skillRegistry !== 'object') {
    throw new Error('renderChat: skillRegistry required');
  }
  if (typeof toSkillCtx !== 'function') {
    throw new Error('renderChat: toSkillCtx required');
  }

  const ops = Array.isArray(manifest.operations) ? manifest.operations : [];

  // (a) free-text channel — exactly what ChatAgent expects.
  const toolCatalogue = ops.map((op) => ({
    id:          op.id,
    description: op?.surfaces?.chat?.hint ?? op.id,
    schema:      paramsToJsonSchema(op.params ?? [], { manifest }),
  }));

  // toolHandlers: adapt skill → ToolHandler.  Permissive: ops without a
  // matching skill in the registry are omitted (so a manifest may grow
  // ahead of its skill set during development).  ChatAgent's "unknown
  // tool" path surfaces calls to absent handlers at runtime.
  const toolHandlers = {};
  for (const op of ops) {
    const skill = skillRegistry[op.id];
    if (typeof skill !== 'function') continue;
    toolHandlers[op.id] = async (toolArgs, toolCtx) => {
      const skillCtx     = toSkillCtx(toolCtx);
      const reply        = await skill(toolArgs, skillCtx);
      const stateUpdates = reply?.stateUpdates ?? [];
      if (typeof onStateUpdates === 'function' && stateUpdates.length > 0) {
        try { onStateUpdates(stateUpdates); }
        catch (err) {
          // Mirror chatAgentBridge: log + continue.  A scheduler hiccup
          // must not kill the user-facing reply.
          // eslint-disable-next-line no-console
          console.error('[renderChat] onStateUpdates threw:', err?.message ?? err);
        }
      }
      // (d) — structured list reply shape (task, 2026-05-22).
      // The skill MAY return `reply.data` (e.g. `{items: [...]}` for
      // list ops, `{settings: {...}}` for record-shape views).
      // Pass through verbatim alongside `stateUpdates` so consumers
      // can read structured data without re-querying the store.
      // Forward-additive — skills without `data` work unchanged.
      // Surfaced by A.3 agent: household's listOpen returns chat-shape
      // only, forcing the web adapter to re-read the store.  With this
      // pass-through, skills can opt into the structured shape.
      const replyData = reply?.data;
      return {
        replies: reply?.replies ?? [],
        data:
          (replyData && typeof replyData === 'object' && !Array.isArray(replyData))
            ? { stateUpdates, ...replyData }
            : { stateUpdates },
      };
    };
  }

  // (b) the system prompt.  F-SP1-d (locked 2026-05-19): if the manifest
  // carries a verbatim `systemPrompt` string, use it as-is.  Otherwise build
  // one from the manifest via the parameterised prompt builder.  This is the
  // PLAN §1.6 escape hatch for prose that isn't reproducible from per-op
  // templates (e.g. household's `SYSTEM_PROMPT_CLASSIFY`).
  const systemPrompt = typeof manifest.systemPrompt === 'string'
    ? manifest.systemPrompt
    : buildPrompt(manifest, opts.prompt);

  // (c) command menu — Telegram setMyCommands shape.
  //
  // 2026-05-23 bug-fix: `body` rule was silently dropped here, so
  // ops declared with `body: 'flags'` (canonical /addtask, /brief,
  // /find, /embed-*, /addappt etc) were parsed as the default
  // 'match' rule.  The first positional argument worked because
  // it bound to the op's first required param via _match-binding,
  // but bare `--key` flags landed in `_match` instead of being
  // parsed into args.  basis's parser reads entry.body to
  // pick parseFlags vs parseMatch; the field must round-trip.
  const commandMenu = ops
    .filter((op) => op?.surfaces?.slash?.command)
    .map((op) => ({
      command:     op.surfaces.slash.command,
      description: op.surfaces.chat?.hint ?? op.id,
      ...(op.surfaces.slash.body ? { body: op.surfaces.slash.body } : {}),
    }));

  // (d) inline-keyboard projector — per shown item, the applicable
  // per-item buttons.  callbackData carries `<opId>:<itemId>` (the
  // triple-in-text-form: a tap → callback_query → IncomingMessage →
  // ChatAgent's existing dispatch path).
  const inlineKeyboardFor = (item) => {
    const out = [];
    for (const op of ops) {
      const ui = op?.surfaces?.ui;
      if (!ui || ui.control !== 'button') continue;
      if (!matchesAppliesTo(op.appliesTo, item)) continue;
      out.push({
        label:        ui.label ?? op.id,
        callbackData: `${op.id}:${item?.id ?? ''}`,
      });
    }
    return out;
  };

  // (e) reply-shape lookup (basis v0.1, 2026-05-21). The
  // chat shell calls `replyShapeFor(opId)` to pick a renderer (text,
  // list, record, mini-page, file, embed-card, notification, brief).
  // When the op declares `surfaces.chat.reply`, that wins; otherwise
  // the shell falls back to a default it derives from `verb` +
  // `view.shape`.  Returning `undefined` here means "no opinion, ask
  // the consumer for a default."
  const replyShapeByOp = new Map();
  for (const op of ops) {
    const declared = op?.surfaces?.chat?.reply;
    if (declared) replyShapeByOp.set(op.id, declared);
  }
  const replyShapeFor = (opId) => replyShapeByOp.get(opId);

  // (f) follow-up hints (basis v0.4, 2026-05-22). After a
  // successful dispatch the chat shell looks up suggested next-actions
  // here; cross-app chains live in basis's static registry.
  const followUpsByOp = new Map();
  for (const op of ops) {
    const declared = op?.surfaces?.chat?.followUps;
    if (Array.isArray(declared) && declared.length > 0) {
      followUpsByOp.set(op.id, declared);
    }
  }
  const followUpsFor = (opId) => followUpsByOp.get(opId);

  // (g) runtime lookup (basis v0.4, 2026-05-22). Absent
  // value → 'both' (works anywhere); explicit value passes through.
  // Consumers (manifest-host wrappers, basis's merge) filter
  // ops by runtime as appropriate.
  const runtimeByOp = new Map();
  for (const op of ops) {
    runtimeByOp.set(op.id, op?.runtime ?? 'both');
  }
  const runtimeFor = (opId) => runtimeByOp.get(opId) ?? 'both';

  // (h) embed snapshot skill (basis v0.5, 2026-05-22).
  // When an op declares `surfaces.chat.embed.cardSnapshotSkill`, the
  // chat shell knows it can use this op as an inline-card factory
  // for J7 embed messages.  Returns the snapshot-skill-id string OR
  // undefined when the op doesn't opt in.
  const embedSnapshotByOp = new Map();
  for (const op of ops) {
    const skill = op?.surfaces?.chat?.embed?.cardSnapshotSkill;
    if (typeof skill === 'string' && skill !== '') {
      embedSnapshotByOp.set(op.id, skill);
    }
  }
  const embedSnapshotFor = (opId) => embedSnapshotByOp.get(opId);

  // (i) brief-summary skill (basis v0.7, 2026-05-23).
  // When an op declares `surfaces.chat.brief.summarySkill`, /brief
  // calls it to populate this app's section of the aggregated brief.
  const briefByOp = new Map();
  for (const op of ops) {
    const brief = op?.surfaces?.chat?.brief;
    if (brief?.summarySkill && typeof brief.summarySkill === 'string') {
      briefByOp.set(op.id, {
        summarySkill: brief.summarySkill,
        ...(typeof brief.order === 'number' ? { order: brief.order } : {}),
        ...(typeof brief.label === 'string' ? { label: brief.label } : {}),
      });
    }
  }
  const briefFor = (opId) => briefByOp.get(opId);

  // (j) search-skill (basis v0.7.5, 2026-05-23). When an
  // op declares `surfaces.chat.search.searchSkill`, /find calls it
  // to query this app's cached items by text.
  const searchByOp = new Map();
  for (const op of ops) {
    const skill = op?.surfaces?.chat?.search?.searchSkill;
    if (typeof skill === 'string' && skill !== '') {
      searchByOp.set(op.id, skill);
    }
  }
  const searchFor = (opId) => searchByOp.get(opId);

  return {
    toolCatalogue, toolHandlers, systemPrompt, commandMenu,
    inlineKeyboardFor, replyShapeFor, followUpsFor, runtimeFor,
    embedSnapshotFor, briefFor, searchFor,
  };
}

function matchesAppliesTo(appliesTo, item) {
  if (!appliesTo) return true;
  if (!item || typeof item !== 'object') return false;
  if (appliesTo.type !== undefined) {
    const types = Array.isArray(appliesTo.type) ? appliesTo.type : [appliesTo.type];
    if (!types.includes(item.type)) return false;
  }
  if (appliesTo.state !== undefined) {
    // F-SP3-a (locked 2026-05-20): state may be a string OR an array of
    // strings.  Multi-state gates encode DoD-lifecycle ops cleanly
    // (e.g. revoke applies to `['claimed','submitted','rejected']`).
    const states = Array.isArray(appliesTo.state) ? appliesTo.state : [appliesTo.state];
    if (!states.includes(item.state)) return false;
  }
  return true;
}
