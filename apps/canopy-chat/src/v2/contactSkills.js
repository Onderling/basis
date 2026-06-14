/**
 * contactSkills — contact/bot exposed-skill → catalog bridge
 * (feedback-extension P4, Mode-1 "bot-exposed skills").
 *
 * DESIGN-feedback-extension §1.2 (the SCOPED CATALOG) gives every entry a
 * `scope` ∈ {app, circle, contact-thread} + a `binding` ∈
 * {local-op, composite, remote-skill@contact}. A **remote-skill** entry is
 * ALWAYS contact-thread-scoped: its handler is a particular contact's bot,
 * reached over the transport, not a local atom. This module is the PURE,
 * testable core that turns a contact's *discovered* SkillCards (from
 * `@canopy/core` skillDiscovery / a2aDiscover — shape `{ id, description, tags }`)
 * into:
 *
 *   1. a `mergeManifests`-ready manifest (`skillCardsToManifest`), one op per
 *      card, carrying the `remote-skill@contact` binding shape that
 *      `mappings.js` `verifyMapping` already SKIPS (the catalog gate doesn't
 *      vouch for a bot's skill — the contact-thread bridge does);
 *   2. a `callSkill` (`makeRemoteCallSkill`) that ROUTES a dispatch of one of
 *      those ops to the bot via an injected `sendA2ATask` (so it's testable
 *      with a fake transport); and
 *   3. a `mergeManifests`-style source wrapper (`contactSkillSources`) tagged
 *      with `scope: 'contact-thread'` + the `contactId`.
 *
 * Pure (no I/O): the live PeerGraph listener + ChatScreen wiring (which calls
 * discovery, feeds the cards here, and registers the per-contact callSkill) is
 * a LATER slice. This file only synthesises + routes.
 */

import { validateManifest } from '@canopy/app-manifest';

/** The binding tag a remote (bot-exposed) skill op carries. */
export const REMOTE_SKILL_BINDING = 'remote-skill@contact';
/** The catalog scope a contact's exposed skills live in. */
export const CONTACT_THREAD_SCOPE = 'contact-thread';

/**
 * The `app` namespace key used for a contact's synthesized manifest. Per-contact
 * so two bots can each expose a `summarise` skill without colliding on the bare
 * op id at merge time (the second declarer gets an `<app>/<opId>` key — see
 * `mergeManifests`' op-id prefix-on-collision policy).
 *
 * @param {string} contactId
 * @returns {string}
 */
export function contactManifestApp(contactId) {
  return `contact:${contactId}`;
}

/**
 * Synthesize the catalog op for ONE discovered SkillCard. The op carries the
 * SAME binding shape `verifyMapping` skips (`binding: 'remote-skill@contact'`
 * AND `bindRef.skillId`), a `contact-thread` scope tag, and a `/`-prefixed
 * slash surface so the skill is invocable as `/<skillId>`.
 *
 * `verb: 'submit'` — a remote skill is a request handed to the bot (sent for
 * processing), which is what the canonical `submit` verb names; it keeps the op
 * within the validator's informational verb allow-list.
 *
 * @param {string} contactId
 * @param {{ id: string, description?: string, tags?: string[] }} card
 * @returns {object} an Operation for a `mergeManifests` source manifest
 */
export function skillCardToOp(contactId, card) {
  const skillId = card.id;
  return {
    id:      skillId,
    verb:    'submit',
    binding: REMOTE_SKILL_BINDING,
    bindRef: { contactId, skillId },
    scope:   CONTACT_THREAD_SCOPE,
    surfaces: { slash: { command: '/' + skillId } },
  };
}

/**
 * Turn a contact's discovered SkillCards into a single manifest that
 * `mergeManifests` can consume (it passes `@canopy/app-manifest`
 * `validateManifest`). `itemTypes` is `[]` — remote skills declare no item
 * types of their own; the validator requires the field to be an array.
 *
 * Cards without a non-empty string `id` are dropped (a skill needs an id to be
 * dispatchable) rather than producing an invalid op.
 *
 * @param {string} contactId
 * @param {Array<{ id: string, description?: string, tags?: string[] }>} skillCards
 * @returns {{ app: string, itemTypes: string[], operations: object[] }}
 */
export function skillCardsToManifest(contactId, skillCards) {
  const operations = (skillCards ?? [])
    .filter((card) => card && typeof card.id === 'string' && card.id !== '')
    .map((card) => skillCardToOp(contactId, card));
  return {
    app:       contactManifestApp(contactId),
    itemTypes: [],
    operations,
  };
}

/**
 * Wrap `skillCardsToManifest` as a `mergeManifests`-style source, tagged with
 * the contact-thread scope + the `contactId` (the contact-thread scope tag).
 * Returns an array (0 or 1 entries) so it composes with the other source lists
 * a composition root concatenates before merging.
 *
 * The `scope` + `contactId` tags ride ALONGSIDE the standard `{ manifest }`
 * shape `mergeManifests` reads; `mergeManifests` ignores the extra keys
 * (forward-additive), while the live wiring can use them to know which catalog
 * entries belong to which contact thread.
 *
 * @param {string} contactId
 * @param {Array<{ id: string, description?: string, tags?: string[] }>} skillCards
 * @returns {Array<{ manifest: object, scope: string, contactId: string }>}
 */
export function contactSkillSources(contactId, skillCards) {
  const manifest = skillCardsToManifest(contactId, skillCards);
  if (manifest.operations.length === 0) return [];
  return [{ manifest, scope: CONTACT_THREAD_SCOPE, contactId }];
}

/**
 * Build the `callSkill` that ROUTES a remote-skill dispatch to the contact's
 * bot. The router dispatches `(appOrigin, opId, args)`; for a remote-skill op
 * we look the op up (to read its `bindRef.skillId`) and hand it to the injected
 * `sendA2ATask` over the contact's peer URL.
 *
 * Dependencies are injected so this is testable without a real transport:
 *   - `resolvePeerUrl(contactId) -> string` maps the contact to its A2A base URL
 *     (the live wiring resolves this from the PeerGraph / contact record).
 *   - `sendA2ATask(peerUrl, skillId, args) -> Task|Promise` invokes the skill
 *     (the live wiring binds `@canopy/core` `sendA2ATask` with its `agent`
 *     already applied — `(agent, peerUrl, skillId, parts, opts)` → this 3-arg
 *     shape).
 *
 * The op → skillId map comes from `opsResolver`: either a `Map`/object keyed by
 * opId, or a function `(opId) -> op`. By default it reads the manifest this
 * module synthesised for `contactId`, so a caller can wire it from just the
 * cards. Passing the merged catalog's lookup keeps it aligned with what the
 * router actually dispatches.
 *
 * Routing is GATED to this contact: a dispatch for an op that isn't one of this
 * contact's remote skills returns `undefined` (the composition root chains this
 * callSkill with the others; a non-match falls through to the next handler).
 *
 * @param {object} deps
 * @param {string}   deps.contactId
 * @param {(contactId: string) => string} deps.resolvePeerUrl
 * @param {(peerUrl: string, skillId: string, args: object) => any} deps.sendA2ATask
 * @param {Map<string, object> | Record<string, object> | ((opId: string) => object|undefined)} [deps.opsResolver]
 *   opId → op lookup. Defaults to the manifest synthesised from `skillCards`.
 * @param {Array<{ id: string }>} [deps.skillCards]
 *   used to build the default `opsResolver` when none is given.
 * @returns {(appOrigin: string, opId: string, args?: object) => any}
 */
export function makeRemoteCallSkill({
  contactId,
  resolvePeerUrl,
  sendA2ATask,
  opsResolver,
  skillCards,
}) {
  const lookup = makeOpLookup(opsResolver, contactId, skillCards);

  return function remoteCallSkill(appOrigin, opId, args = {}) {
    const op = lookup(opId);
    if (!isRemoteSkillOp(op)) return undefined;     // not ours → fall through

    // bindRef.skillId is the bot's skill name; fall back to the opId (they're
    // equal by construction in skillCardToOp, but a hand-built op may differ).
    const skillId = op.bindRef?.skillId ?? opId;
    const peerUrl = resolvePeerUrl(contactId);
    return sendA2ATask(peerUrl, skillId, args);
  };
}

// ── internal ────────────────────────────────────────────────────────────────

/** An op is a remote-skill binding (handler is the contact's bot). */
function isRemoteSkillOp(op) {
  return !!op && (op.binding === REMOTE_SKILL_BINDING || !!op.bindRef?.skillId);
}

/**
 * Normalise the several accepted `opsResolver` shapes (Map | object |
 * function) into a single `(opId) -> op` function. Defaults to the manifest
 * this module synthesises for `contactId` from `skillCards`.
 */
function makeOpLookup(opsResolver, contactId, skillCards) {
  if (typeof opsResolver === 'function') return opsResolver;
  if (opsResolver instanceof Map)        return (opId) => opsResolver.get(opId);
  if (opsResolver && typeof opsResolver === 'object') {
    return (opId) => opsResolver[opId];
  }
  // Default: index the synthesised manifest by op id.
  const { operations } = skillCardsToManifest(contactId, skillCards ?? []);
  const byId = new Map(operations.map((op) => [op.id, op]));
  return (opId) => byId.get(opId);
}
