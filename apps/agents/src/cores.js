/**
 * agents — pure cores (read slice CONTROL ops).
 *
 * Uniform-route shape (decision #5): each core is a pure
 * `(store, args, ctx) → result` where `store` is `{ registry, tokens? }`:
 *   • `registry` — an `@onderling/agent-registry` instance
 *     (`createAgentRegistry(...)`), the mirror/write-truth.
 *   • `tokens`   — OPTIONAL duck-typed token collaborator:
 *       { issue({ subject, skill, expiresIn, constraints? })
 *           → Promise<{ id, expiresAt? }>,
 *         revoke(tokenId) → Promise<void> }
 *     The wire layer later binds this to `Agent.issueCapabilityToken`
 *     + `TokenRegistry`; the cores stay runnable WITHOUT a live core
 *     Agent.  When `tokens` is absent the control ops still keep the
 *     registry mirror honest and report `tokenBacked: false`.
 *
 * BACKWARD COMPAT: a bare registry (anything with `.list`) is accepted
 * as `store` and wrapped as `{ registry: store }`.
 *
 * DESIGN RULE (plan decision 2 — the token is the enforced authority,
 * the registry only mirrors it):
 *   • grantAgent   — `tokens.issue(...)` FIRST, then
 *     `registry.applyGrant(...)`.  An issue failure propagates — we
 *     never mirror a grant whose token doesn't exist.
 *   • revokeAgent  — `tokens.revoke` each grant token (best-effort,
 *     continue on individual failure), then `registry.revoke(id)`.
 *   • revokeGrant  — `tokens.revoke(tokenId)` first (failure
 *     propagates — never un-mirror a still-live token), then
 *     `registry.revokeGrant(id, tokenId)`.
 *   • purgeAgent   — `registry.purge(id)` (hard delete; works on a
 *     revoked agent).
 *
 * The SAME core is reachable two ways that MUST agree (see the fitness
 * test): LOCAL (called directly over the store) and WIRE (wrapped by
 * `wireSkill` + registered as a `defineSkill`, invoked over serialized
 * parts).  Kept dependency-free so the module imports nothing external.
 *
 * Identifier resolution everywhere: agentId OR pubKey ONLY (never
 * webid — ambiguous for multi-device users), via a registry.list() scan
 * so the registry's broader `_agentMatches` (webid/deviceId) is never
 * relied on.
 */

import {
  setSkillExposure, setCircleSkillExposure, isSkillExposed, normalizeExposure,
} from '@onderling/agent-registry';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRES_IN_DAYS = 30;   // BotAgentRegistry precedent.

/**
 * Normalise `store` → `{ registry, tokens }`.  A bare registry (has
 * `.list`) is wrapped; `tokens` is `null` when not injected.
 */
function asStore(store) {
  if (store && typeof store.list === 'function') {
    return { registry: store, tokens: null, profiles: null, roleGrants: null };
  }
  const registry = store?.registry;
  if (!registry || typeof registry.list !== 'function') {
    throw new TypeError('agents cores: store must be a registry or { registry, tokens? }');
  }
  return {
    registry,
    tokens:     store.tokens     ?? null,
    profiles:   store.profiles   ?? null,
    roleGrants: store.roleGrants ?? null,
  };
}

/**
 * Resolve one entry by agentId OR pubKey ONLY (registry.list() scan —
 * deliberately NOT registry.lookup, which also matches webid/agentUri/
 * deviceId).  Includes revoked entries.  `null` on miss / bad key.
 */
async function resolveEntry(registry, key) {
  if (typeof key !== 'string' || key.length === 0) return null;
  const entries = await registry.list();
  return entries.find((a) => a.agentId === key || a.pubKey === key) ?? null;
}

/** Registry entry → LIST row: name · role · status · lastSeen. */
function toRow(a) {
  return {
    agentId:  a.agentId,
    name:     a.name ?? null,
    role:     a.role ?? 'device',
    status:   a.revokedAt ? 'revoked' : 'active',
    // lastSeen ← `signedAt` (the registry's freshest per-agent stamp;
    // there is no dedicated last-seen field in the v2 resource shape).
    lastSeen: a.signedAt ?? null,
  };
}

/**
 * Derive the agent's skill set from its fine-grained grants
 * (`grants[].skill`) UNION its coarse mirrored `capabilities[]`.
 * Deduped + sorted for a stable, comparable surface.
 */
function deriveSkills(a) {
  const set = new Set();
  for (const g of a.grants ?? []) {
    if (typeof g.skill === 'string' && g.skill.length > 0) set.add(g.skill);
  }
  for (const c of a.capabilities ?? []) {
    if (typeof c === 'string' && c.length > 0) set.add(c);
  }
  return [...set].sort();
}

/** Compact grant summary for the detail record. */
function summariseGrants(grants = []) {
  return {
    total:  grants.length,
    tokens: grants.map((g) => ({
      tokenId:    g.tokenId,
      skill:      g.skill ?? null,
      capability: g.capability ?? null,
      subject:    g.subject ?? null,
      expiresAt:  g.expiresAt ?? null,
    })),
  };
}

/** Registry entry → DETAIL record. */
function toDetail(a) {
  return {
    agentId:      a.agentId,
    name:         a.name ?? null,
    role:         a.role ?? 'device',
    status:       a.revokedAt ? 'revoked' : 'active',
    lastSeen:     a.signedAt ?? null,
    skills:       deriveSkills(a),
    grantSummary: summariseGrants(a.grants),
  };
}

/**
 * Read the entry back AFTER a mutation and project it — the RESULT
 * convention: report what actually happened (the post-state), not just
 * that the op dispatched.
 */
async function readBack(registry, agentId) {
  const after = await resolveEntry(registry, agentId);
  return after ? toDetail(after) : null;
}

/**
 * listAgents — the non-revoked roster.  Soft-revoke is honoured here:
 * entries carrying a `revokedAt` are skipped (they stay in the resource
 * for audit, but never surface in the list).
 *
 * @param {object} store  `{ registry, tokens? }` or a bare registry
 * @returns {Promise<{ agents: Array<object> }>}
 */
export async function listAgents(store /*, args, ctx */) {
  const { registry } = asStore(store);
  const entries = await registry.list();
  return {
    agents: entries.filter((a) => !a.revokedAt).map(toRow),
  };
}

/**
 * viewAgent — one agent's detail, resolved by `agentId` OR `pubKey`
 * ONLY (deliberately NOT webid/agentUri/deviceId — a webid is ambiguous
 * for multi-device users).  Unlike the list, viewAgent DOES surface a
 * revoked agent (with `status: 'revoked'`) so detail lookups stay
 * addressable.  Returns `{ agent: null }` on miss.
 *
 * @param {object} store
 * @param {{ agentId?: string }} args
 * @returns {Promise<{ agent: object | null }>}
 */
export async function viewAgent(store, args = {}) {
  const { registry } = asStore(store);
  const entry = await resolveEntry(registry, args?.agentId);
  return { agent: entry ? toDetail(entry) : null };
}

/**
 * setAgentSkillExposure — hide or show ONE of an agent's skills, agent-wide or inside one circle.
 *
 * **This decides what people SEE, not what they may DO.** Exposure is a discovery filter: it removes
 * the skill from the cards and catalogs others read, and stops nothing. Someone on a modified client
 * who knows the skill id can still dispatch it — the grant/token check refuses that, not this. Callers
 * that surface this op must say so; promising protection here would be a lie (the enforceability test).
 *
 * Two authorities, both enforced here:
 *   • **agent-wide** (no `circleId`) requires `bySigner` to match the entry's `ownerFingerprint` —
 *     ownership IS the owner key, which is also what makes this answerable for an agent in no circle;
 *   • **per-circle** requires `isAdmin` in that circle, and can only NARROW — an admin asking to expose
 *     what the owner hid is refused `cannot-widen` rather than silently ignored.
 *
 * @param {object} store  `{ registry }`
 * @param {{ agentId?: string, skillId?: string, exposed?: boolean|string,
 *           circleId?: string, bySigner?: string, isAdmin?: boolean }} args
 * @returns {Promise<{ ok: boolean, reason?: string, agentId?: string, skillId?: string,
 *   exposed?: boolean, circleId?: string|null, exposure?: object }>}
 */
export async function setAgentSkillExposure(store, args = {}) {
  const { registry } = asStore(store);
  const entry  = await resolveEntry(registry, args?.agentId);
  if (!entry) return { ok: false, reason: 'agent-not-found' };
  const skillId  = typeof args?.skillId === 'string' ? args.skillId.trim() : '';
  const circleId = typeof args?.circleId === 'string' && args.circleId.trim() ? args.circleId.trim() : null;
  const exposed  = args?.exposed === true || args?.exposed === 'true';

  const r = circleId == null
    ? setSkillExposure({
        exposure: entry.exposure, skillId, exposed,
        ownerFingerprint: entry.ownerFingerprint, bySigner: args?.bySigner,
      })
    : setCircleSkillExposure({
        exposure: entry.exposure, skillId, exposed, circleId, isAdmin: args?.isAdmin === true,
      });
  if (!r.ok) return r;

  if (typeof registry.updateExposure !== 'function') return { ok: false, reason: 'registry-cannot-persist' };
  await registry.updateExposure(entry.agentId ?? entry.pubKey, r.exposure);
  return { ok: true, agentId: entry.agentId, skillId, exposed, circleId, exposure: r.exposure };
}

/**
 * getAgentSkillExposure — the agent's skills with, per skill, whether it is currently advertised.
 * The read model behind the owner's toggle list. `circleId` answers "as seen in that circle".
 *
 * @param {object} store
 * @param {{ agentId?: string, circleId?: string }} args
 * @returns {Promise<{ ok: boolean, reason?: string, agentId?: string, circleId?: string|null,
 *   skills?: Array<{ id: string, exposed: boolean }>, exposure?: object }>}
 */
export async function getAgentSkillExposure(store, args = {}) {
  const { registry } = asStore(store);
  const entry = await resolveEntry(registry, args?.agentId);
  if (!entry) return { ok: false, reason: 'agent-not-found', skills: [] };
  const circleId = typeof args?.circleId === 'string' && args.circleId.trim() ? args.circleId.trim() : null;
  // The same union the card projects FROM, so the toggle list and the card can never disagree about
  // which skills exist — only about which are shown.
  const ids = [...new Set([
    ...(Array.isArray(entry.grants) ? entry.grants.map((g) => g?.skill) : []),
    ...(Array.isArray(entry.capabilities) ? entry.capabilities : []),
  ].filter((x) => typeof x === 'string' && x.length > 0))].sort();
  return {
    ok: true,
    agentId: entry.agentId,
    circleId,
    exposure: normalizeExposure(entry.exposure),
    skills: ids.map((id) => ({ id, exposed: isSkillExposed({ exposure: entry.exposure, skillId: id, circleId }) })),
  };
}

/**
 * revokeAgent — soft-revoke the WHOLE agent.  Token-first: revoke each
 * of the entry's `grants[].tokenId` via the token collaborator
 * (best-effort — an individual token failure is counted but doesn't
 * stop the rest, nor the registry revoke), THEN stamp the entry
 * `revokedAt`.  Idempotent registry-side (a revoked agent stays
 * revoked).
 *
 * @param {object} store  `{ registry, tokens? }`
 * @param {{ agentId?: string }} args
 * @returns {Promise<{ revoked: boolean, tokensRevoked: number,
 *   tokenBacked: boolean, agent: object | null }>}
 *   `tokenBacked: false` = no token collaborator was injected — only
 *   the registry mirror changed (degraded, honest).
 */
export async function revokeAgent(store, args = {}) {
  const { registry, tokens } = asStore(store);
  const entry = await resolveEntry(registry, args?.agentId);
  if (!entry) {
    return { revoked: false, tokensRevoked: 0, tokenBacked: !!tokens, agent: null };
  }

  // 1. Tokens FIRST — the enforced authority dies before the mirror.
  let tokensRevoked = 0;
  if (tokens) {
    for (const g of entry.grants ?? []) {
      if (typeof g.tokenId !== 'string' || g.tokenId.length === 0) continue;
      try {
        await tokens.revoke(g.tokenId);
        tokensRevoked += 1;
      } catch {
        // best-effort: keep revoking the rest; the registry revoke
        // below still lands so the agent goes inert either way.
      }
    }
  }

  // 2. Then the registry mirror (soft — sets `revokedAt`).
  await registry.revoke(entry.agentId);

  return {
    revoked:       true,
    tokensRevoked,
    tokenBacked:   !!tokens,
    agent:         await readBack(registry, entry.agentId),
  };
}

/**
 * grantAgent — issue a fresh scoped CapabilityToken, THEN mirror it
 * into the registry entry (`applyGrant` upserts `grants[]` + mirrors
 * `capabilities[]` atomically).  ORDER IS THE RULE (decision 2): the
 * token op happens first; an issue failure propagates and the mirror is
 * never touched — we never let the UI claim authority the system
 * doesn't enforce.
 *
 * Without a token collaborator the mirror is still written (with a
 * synthetic `local-…` tokenId + computed expiry) and the result says
 * `tokenBacked: false`.
 *
 * @param {object} store  `{ registry, tokens? }`
 * @param {{ agentId?: string, skill?: string, capability?: string,
 *           expiresInDays?: number, subject?: string }} args
 * @returns {Promise<{ granted: boolean, tokenBacked: boolean,
 *   tokenId: string | null, expiresAt: string | null,
 *   agent: object | null }>}
 */
export async function grantAgent(store, args = {}) {
  const { registry, tokens } = asStore(store);
  const entry = await resolveEntry(registry, args?.agentId);
  const skill   = (typeof args?.skill   === 'string' && args.skill.length   > 0) ? args.skill   : null;
  const profile = (typeof args?.profile === 'string' && args.profile.length > 0) ? args.profile : null;
  // A grant delegates a SKILL and/or names a PROFILE the grantee (a device) may run — at least one.
  if (!entry || (!skill && !profile)) {
    return { granted: false, tokenBacked: !!tokens, tokenId: null, expiresAt: null, agent: null };
  }

  const capability    = (typeof args?.capability === 'string' && args.capability.length > 0)
    ? args.capability
    : skill;                                       // default: the skill (null for a profile-only grant)
  const expiresInDays = (typeof args?.expiresInDays === 'number' && args.expiresInDays > 0)
    ? args.expiresInDays
    : DEFAULT_EXPIRES_IN_DAYS;
  const subject       = (typeof args?.subject === 'string' && args.subject.length > 0)
    ? args.subject
    : entry.pubKey;                                // default: the grantee key
  const expiresIn     = expiresInDays * MS_PER_DAY;
  const tokenSkill    = skill ?? '*';                        // profile-only grant → any skill, gated by the profile scope
  const constraints   = profile ? { profile } : undefined;  // the token carries the profile scope (the PolicyEngine gate enforces it)

  // 1. The TOKEN op first — the enforced authority. Failure propagates.
  let tokenId;
  let expiresAt;
  if (tokens) {
    const issued = await tokens.issue({ subject, skill: tokenSkill, expiresIn, constraints });
    tokenId   = issued.id;
    expiresAt = issued.expiresAt ?? new Date(Date.now() + expiresIn).toISOString();
  } else {
    // Degraded: mirror-only. The `local-` prefix marks the grant as
    // not token-backed until the wire layer injects a collaborator.
    tokenId   = `local-${Math.random().toString(36).slice(2, 10)}`;
    expiresAt = new Date(Date.now() + expiresIn).toISOString();
  }

  // 2. Then the registry MIRROR (atomic grants[] + capabilities[] upsert).
  await registry.applyGrant(entry.agentId, { tokenId, skill, expiresAt, subject, capability, profile });

  return {
    granted:     true,
    tokenBacked: !!tokens,
    tokenId,
    expiresAt,
    agent:       await readBack(registry, entry.agentId),
  };
}

/**
 * grantRole — assign a ROLE to a member AND materialize its capability bundle
 * (: roles as capability bundles). Mirrors grantAgent's exposure, but the
 * enforced authority here is a role BUNDLE, not a single skill grant: the
 * injected `roleGrants` collaborator (core's `RoleGrantManager`) sets the
 * governance role via `GroupManager.setRole` (signed) AND issues the bundle's
 * cap-tokens to the member.
 *
 * The member is resolved by `agentId`/pubKey (a registry scan, like the other
 * control ops) OR named directly via `subject` (the member's pubKey — the
 * member need not be a local registry entry, since a role is held in a circle,
 * not on this device's roster).  Without a `roleGrants` collaborator the op
 * reports the honest degraded `roleBacked: false` (nothing materialized).
 *
 * @param {object} store  `{ registry, roleGrants? }`
 * @param {{ groupId?: string, role?: string, agentId?: string,
 *           subject?: string, expiresInDays?: number }} args
 * @returns {Promise<{ granted: boolean, roleBacked: boolean, role: string|null,
 *   rank: number|null, groupId: string|null, subject: string|null,
 *   tokenIds: string[] }>}
 */
export async function grantRole(store, args = {}) {
  const { registry, roleGrants } = asStore(store);
  const groupId = (typeof args?.groupId === 'string' && args.groupId.length > 0) ? args.groupId : null;
  const role    = (typeof args?.role    === 'string' && args.role.length    > 0) ? args.role    : null;

  // Resolve the member: explicit subject wins; else the resolved entry's pubKey.
  let subject = (typeof args?.subject === 'string' && args.subject.length > 0) ? args.subject : null;
  if (!subject && typeof args?.agentId === 'string' && args.agentId.length > 0) {
    const entry = await resolveEntry(registry, args.agentId);
    subject = entry?.pubKey ?? null;
  }

  const degraded = { granted: false, roleBacked: !!roleGrants, role: null, rank: null, groupId: null, subject: null, tokenIds: [] };
  if (!roleGrants || typeof roleGrants.grant !== 'function' || !groupId || !role || !subject) {
    return degraded;
  }

  const expiresInDays = (typeof args?.expiresInDays === 'number' && args.expiresInDays > 0)
    ? args.expiresInDays
    : DEFAULT_EXPIRES_IN_DAYS;

  // The collaborator does both halves (setRole + materialize) — token-first by
  // construction (RoleGrantManager sets the role, then issues the bundle).
  const res = await roleGrants.grant({
    memberPubKey: subject,
    groupId,
    roleId:       role,
    expiresIn:    expiresInDays * MS_PER_DAY,
  });

  return {
    granted:    true,
    roleBacked: true,
    role:       res?.roleId ?? role,
    rank:       res?.rank ?? null,
    groupId,
    subject,
    // `tokens` are CapabilityToken instances (materialized bundle) — report ids.
    tokenIds:   Array.isArray(res?.tokens) ? res.tokens.map((t) => t?.id).filter(Boolean) : [],
  };
}

/**
 * revokeGrant — the adjust op: revoke ONE token, then un-mirror it.
 * Token-first, but NOT best-effort here: a token-revoke failure
 * propagates and the mirror keeps the grant — un-mirroring a still-live
 * token would make the UI claim LESS authority than is enforced (the
 * dangerous direction).  Registry-side it removes the grant and
 * un-mirrors its coarse capability when no remaining grant references
 * it.  `revoked: false` when the agent or the grant isn't found (the
 * token is not touched in that case).
 *
 * @param {object} store  `{ registry, tokens? }`
 * @param {{ agentId?: string, tokenId?: string }} args
 * @returns {Promise<{ revoked: boolean, tokenBacked: boolean,
 *   agent: object | null }>}
 */
export async function revokeGrant(store, args = {}) {
  const { registry, tokens } = asStore(store);
  const entry = await resolveEntry(registry, args?.agentId);
  const tokenId = args?.tokenId;
  if (!entry || typeof tokenId !== 'string' || tokenId.length === 0) {
    return { revoked: false, tokenBacked: !!tokens, agent: entry ? toDetail(entry) : null };
  }
  const grant = (entry.grants ?? []).find((g) => g.tokenId === tokenId);
  if (!grant) {
    return { revoked: false, tokenBacked: !!tokens, agent: toDetail(entry) };
  }

  // 1. The token first (failure propagates — see doc above) …
  if (tokens) await tokens.revoke(tokenId);
  // 2. … then the mirror (removes the grant + un-mirrors an orphaned cap).
  await registry.revokeGrant(entry.agentId, tokenId);

  return {
    revoked:     true,
    tokenBacked: !!tokens,
    agent:       await readBack(registry, entry.agentId),
  };
}

/**
 * purgeAgent — HARD delete of the registry entry (contrast revokeAgent,
 * which keeps it for audit).  Works on a revoked agent; idempotent when
 * the entry is absent (`purged: false`, nothing to do).  Pure registry
 * op — outstanding tokens are expected to be revoked first via
 * revokeAgent (the surface's revoke → purge flow); purge itself does
 * not touch the token side.
 *
 * @param {object} store  `{ registry, tokens? }`
 * @param {{ agentId?: string }} args
 * @returns {Promise<{ purged: boolean, agent: null }>}
 *   `agent` is the post-state read-back — always `null` after a purge
 *   (the RESULT convention: prove the entry is gone, not just that the
 *   op dispatched).
 */
export async function purgeAgent(store, args = {}) {
  const { registry, tokens } = asStore(store);
  const entry = await resolveEntry(registry, args?.agentId);
  if (!entry) {
    return { purged: false, tokensRevoked: 0, tokenBacked: !!tokens, agent: null };
  }

  // 1. Token sweep FIRST (same as revokeAgent, best-effort). Purging an
  //    entry with live grants would otherwise leave ENFORCED tokens with
  //    no mirror — invisible authority, the exact stray-agent hole the
  //    registry exists to close. Purge therefore always kills the
  //    enforced side before erasing the record of it.
  let tokensRevoked = 0;
  if (tokens) {
    for (const g of entry.grants ?? []) {
      if (typeof g.tokenId !== 'string' || g.tokenId.length === 0) continue;
      try {
        await tokens.revoke(g.tokenId);
        tokensRevoked += 1;
      } catch {
        // best-effort: the purge below still lands.
      }
    }
  }

  // 2. Then the hard delete.
  await registry.purge(entry.agentId);
  return {
    purged: true,
    tokensRevoked,
    tokenBacked: !!tokens,
    agent: await readBack(registry, entry.agentId),   // must be null
  };
}

/**
 * The extracted-core map (mirrors tasks-v0's `TASK_CORES`) — the wire
 * module wraps each of these with `wireSkill`, and the fitness test
 * checks route parity against `manifest.operations`.
 */
/**
 * createProfile — mint a NEW root-derived profile (identity step 4). The key DERIVATION lives in
 * the injected `profiles` collaborator (keeps the cores dependency-free, like `tokens`): the wire
 * layer closes it over the owner root + registry (`@onderling/agent-registry`'s createProfile). Without
 * a `profiles` collaborator the op reports `created:false` (degraded — the substrate isn't wired).
 */
export async function createProfile(store, args = {}) {
  const s = asStore(store);
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  if (typeof s.profiles?.create !== 'function' || !id) {
    return { created: false, reason: !id ? 'id-required' : 'profiles-unavailable', agent: null };
  }
  // properties may arrive as an object (programmatic) or a JSON string (surface). Best-effort parse.
  let properties = {};
  if (args?.properties && typeof args.properties === 'object') properties = args.properties;
  else if (typeof args?.properties === 'string' && args.properties.trim()) {
    try { properties = JSON.parse(args.properties); } catch { properties = {}; }
  }
  const result = await s.profiles.create({ profileId: id, name: typeof args?.name === 'string' ? args.name : null, properties });
  return { created: true, id, pubKey: result?.pubKey ?? null, agent: await readBack(s.registry, id) };
}

/**
 * setProfileProperty — set an OWN coarse property on an existing profile (property layer / cross-app reuse).
 * The value is curated ONCE on the profile and readable by any app via getProfileProperties. Mutation goes
 * through the injected `profiles` collaborator (cores stay dependency-free). Degrades (ok:false) if unwired.
 */
export async function setProfileProperty(store, args = {}) {
  const s = asStore(store);
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  const key = typeof args?.key === 'string' ? args.key.trim() : '';
  if (typeof s.profiles?.setProperty !== 'function' || !id || !key) {
    return { ok: false, reason: !id ? 'id-required' : (!key ? 'key-required' : 'profiles-unavailable') };
  }
  await s.profiles.setProperty({ profileId: id, key, value: args?.value });
  return { ok: true, id, key };
}

/**
 * setProfileDriver — set an OWN personal DRIVER property (drivers #3): an open { kind, text, tags[] } value,
 * not a coarse string, so it needs its own op (setProfileProperty's value is a plain string). Building +
 * validating the driver lives in the `profiles` collaborator (dependency-free cores). `tags` accepts an array
 * (GUI) OR a comma-separated string (wire/slash). Degrades (ok:false) if unwired; ok:false on an empty driver.
 */
export async function setProfileDriver(store, args = {}) {
  const s = asStore(store);
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  const key = typeof args?.key === 'string' ? args.key.trim() : '';
  if (typeof s.profiles?.setDriver !== 'function' || !id || !key) {
    return { ok: false, reason: !id ? 'id-required' : (!key ? 'key-required' : 'profiles-unavailable') };
  }
  const tags = Array.isArray(args?.tags)
    ? args.tags
    : (typeof args?.tags === 'string' ? args.tags.split(',') : []);
  try {
    await s.profiles.setDriver({
      profileId: id, key, kind: args?.kind, text: args?.text, tags,
      categoryId: typeof args?.categoryId === 'string' ? args.categoryId : undefined,
    });
    return { ok: true, id, key };
  } catch (err) {
    return { ok: false, reason: 'invalid-driver', detail: err?.message ?? String(err) };
  }
}

/**
 * setProfileCircleMembership — record a per-circle MEMBERSHIP on a profile (registry restore-data): the
 * `{ handle, address, proof?, relays?, key? }` record a restored device needs so it knows its circles + the
 * handle it used there. Merge + validation live in the `profiles` collaborator (the pure setter preserves the
 * other circles' records). Degrades (ok:false) if unwired / missing id or circleId. Best-effort by the caller.
 */
export async function setProfileCircleMembership(store, args = {}) {
  const s = asStore(store);
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  const circleId = typeof args?.circleId === 'string' ? args.circleId.trim() : '';
  if (typeof s.profiles?.setCircleMembership !== 'function' || !id || !circleId) {
    return { ok: false, reason: !id ? 'id-required' : (!circleId ? 'circleId-required' : 'profiles-unavailable') };
  }
  try {
    await s.profiles.setCircleMembership({
      profileId: id, circleId,
      handle: args?.handle, address: args?.address, proof: args?.proof, relays: args?.relays, key: args?.key,
    });
    return { ok: true, id, circleId };
  } catch (err) {
    return { ok: false, reason: 'invalid-membership', detail: err?.message ?? String(err) };
  }
}

/** getProfileDrivers — just the DRIVER-typed properties of a profile (for the About-me editor + the matcher). */
export async function getProfileDrivers(store, args = {}) {
  const s = asStore(store);
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  if (typeof s.profiles?.getDrivers !== 'function' || !id) {
    return { ok: false, reason: !id ? 'id-required' : 'profiles-unavailable', drivers: {} };
  }
  return { ok: true, id, drivers: (await s.profiles.getDrivers({ profileId: id })) ?? {} };
}

/** getProfileProperties — the (own/inherit) properties of a profile, for cross-app reuse. */
export async function getProfileProperties(store, args = {}) {
  const s = asStore(store);
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  if (typeof s.profiles?.getProperties !== 'function' || !id) {
    return { ok: false, reason: !id ? 'id-required' : 'profiles-unavailable', properties: {} };
  }
  return { ok: true, id, properties: (await s.profiles.getProperties({ profileId: id })) ?? {} };
}

/**
 * setProfileDisclosure — record what a persona shares in a CONTEXT (circle/project): enable/disable a property
 * key + optional coarseness rung, persisted on the profile. The general (per-persona) version of the feedback
 * charter consent. Through the `profiles` collaborator (dependency-free cores). Degrades (ok:false) if unwired.
 */
export async function setProfileDisclosure(store, args = {}) {
  const s = asStore(store);
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  const contextId = typeof args?.contextId === 'string' ? args.contextId.trim() : '';
  const key = typeof args?.key === 'string' ? args.key.trim() : '';
  if (typeof s.profiles?.setDisclosure !== 'function' || !id || !contextId || !key) {
    return { ok: false, reason: !id ? 'id-required' : (!contextId ? 'contextId-required' : (!key ? 'key-required' : 'profiles-unavailable')) };
  }
  // Three independent axes: disclosed(enabled)+rung · matchable · requestable.
  // Only forward an axis the caller actually passed, so a call touching one axis
  // doesn't clobber the others (the pure setDisclosure merges per-axis).
  const patch = {};
  if (args?.enabled !== undefined) patch.enabled = args.enabled === true || args.enabled === 'true';
  if (typeof args?.rung === 'string') patch.rung = args.rung || null;
  if (args?.matchable !== undefined) patch.matchable = args.matchable === true || args.matchable === 'true';
  if (args?.requestable !== undefined) patch.requestable = args.requestable === true || args.requestable === 'true';
  await s.profiles.setDisclosure({ profileId: id, contextId, key, ...patch });
  return { ok: true, id, contextId, key };
}

/** getProfileDisclosure — the persona's persisted per-context disclosure policy. */
export async function getProfileDisclosure(store, args = {}) {
  const s = asStore(store);
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  if (typeof s.profiles?.getDisclosure !== 'function' || !id) {
    return { ok: false, reason: !id ? 'id-required' : 'profiles-unavailable', disclosure: { perContext: {} } };
  }
  return { ok: true, id, disclosure: (await s.profiles.getDisclosure({ profileId: id })) ?? { perContext: {} } };
}

/**
 * getPersonaView — the "About me" read model: a persona's properties + its per-context disclosure in ONE call
 * (so a shell renders "what I am + what I share where" without two round-trips). Composes the collaborator.
 */
export async function getPersonaView(store, args = {}) {
  const s = asStore(store);
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  if (typeof s.profiles?.getProperties !== 'function' || typeof s.profiles?.getDisclosure !== 'function' || !id) {
    return { ok: false, reason: !id ? 'id-required' : 'profiles-unavailable', properties: {}, disclosure: { perContext: {} } };
  }
  const [properties, disclosure] = await Promise.all([
    s.profiles.getProperties({ profileId: id }),
    s.profiles.getDisclosure({ profileId: id }),
  ]);
  return { ok: true, id, properties: properties ?? {}, disclosure: disclosure ?? { perContext: {} } };
}

/**
 * getPersonaRelease — what this persona would SHARE in a context (circle): its disclosure over its effective
 * (own + inherited) properties → the coarse {key:value}. The join-with-persona flow releases exactly this.
 */
export async function getPersonaRelease(store, args = {}) {
  const s = asStore(store);
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  const contextId = typeof args?.contextId === 'string' ? args.contextId.trim() : '';
  if (typeof s.profiles?.releaseFor !== 'function' || !id || !contextId) {
    return { ok: false, reason: !id ? 'id-required' : (!contextId ? 'contextId-required' : 'profiles-unavailable'), released: {} };
  }
  const keys = Array.isArray(args?.keys) ? args.keys
    : (typeof args?.keys === 'string' && args.keys.trim() ? args.keys.split(',').map((k) => k.trim()).filter(Boolean) : []);
  return { ok: true, id, contextId, released: (await s.profiles.releaseFor({ profileId: id, contextId, keys })) ?? {} };
}

export const AGENT_CORES = Object.freeze({
  listAgents,
  viewAgent,
  createProfile,
  setProfileProperty,
  getProfileProperties,
  setProfileDriver,
  getProfileDrivers,
  setProfileCircleMembership,
  setProfileDisclosure,
  getProfileDisclosure,
  getPersonaView,
  getPersonaRelease,
  setAgentSkillExposure,
  getAgentSkillExposure,
  revokeAgent,
  grantAgent,
  grantRole,
  revokeGrant,
  purgeAgent,
});
