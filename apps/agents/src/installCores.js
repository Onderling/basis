/**
 * agents — install cores (PLAN-agent-management-surface).
 *
 * The INSTALL act: take an installable descriptor (an A2A Agent Card /
 * registry-entry projection per SPEC-agents-registry) and add it to the
 * user's `@onderling/agent-registry` ("your agents") with ONLY the
 * capabilities the user grants at install — capability-security,
 * default-deny, NO ambient authority.  Two ways in:
 *   • CURATED default — `installAgent({ catalogId })` fetches the card
 *     from a pluggable catalog SOURCE (`store.catalog`, a `list()`/
 *     `get(id)`-shaped collaborator).  The default source is a local
 *     stub (see defaultCatalog.js).
 *   • POWER-USER override — `installAgent({ card })` installs an
 *     arbitrary card (paste / URL-fetched JSON) BYPASSING the catalog.
 *
 * ── commons-governance seam ────────────────────────────────────────────
 * The catalog's trust/curation (signing keys, review, reputation, who is
 * allowed to publish) is DESIGNED SEPARATELY — the community-commons
 * governance thread (NOTE-online-agent-surface §3). treats the catalog
 * as a pluggable DATA SOURCE and hardcodes NO governance decision. A real
 * curated source drops in behind the same `{ list, get }` contract.
 *
 * ── capability-security (the anti-virus) ───────────────────────────────
 * Installing NEVER grants anything by itself: the entry is registered
 * with `capabilities: []` + `grants: []` (default-deny). Authority is
 * added ONLY per the user's requested grant set, and ONLY for skills the
 * card DECLARES it can do — a requested skill outside the card's declared
 * surface is REJECTED, never issued a token. Each accepted grant runs
 * through the `grantAgent` path (token issued FIRST, then mirrored),
 * so an installed agent holds only signed, scoped, revocable tokens for
 * exactly what the user picked. An ungranted skill has NO token → it is
 * denied at the invoke gate (PolicyEngine.checkInbound / offeringMatches).
 *
 * Uninstall = the `purgeAgent` (hard delete, sweeps live tokens
 * first) or `revokeAgent` (soft, keep for audit) — reused, not
 * reinvented.
 *
 * Dependency-free like cores.js / recoveryCores.js (no bare `@onderling/*`
 * import) so the standalone fitness suite runs without app-local
 * node_modules; the one collaborator it leans on — the grant path — is
 * imported from the sibling cores module (also import-free).
 */

import { grantAgent, viewAgent } from './cores.js';

/**
 * Local skill-cover test — a mirror of core's `offeringMatches` kept inline
 * so this module stays import-free. `pattern` covers `skillId` when they
 * are equal, `pattern` is `'*'`, or `pattern` is a `prefix.*` wildcard.
 */
function skillCovers(pattern, skillId) {
  if (typeof pattern !== 'string' || typeof skillId !== 'string') return false;
  if (pattern === '*') return true;
  if (pattern === skillId) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1);            // 'bot.' from 'bot.*'
    return skillId.startsWith(prefix) && skillId.length > prefix.length;
  }
  return false;
}

/** Pull the registry out of the shared store (bare registry accepted). */
function registryOf(store) {
  if (store && typeof store.list === 'function') return store;
  const registry = store?.registry;
  if (!registry || typeof registry.list !== 'function') {
    throw new TypeError('install cores: store must be a registry or { registry, catalog?, tokens? }');
  }
  return registry;
}

/**
 * Parse a card that may arrive as an object OR a JSON string (the
 * power-user paste path). Returns `null` on unparseable input.
 */
function coerceCard(card) {
  if (card && typeof card === 'object') return card;
  if (typeof card === 'string' && card.trim().length > 0) {
    try { return JSON.parse(card); } catch { return null; }
  }
  return null;
}

/**
 * The stable catalog / registry id for a card: `x-canopy.id`, else a
 * top-level `agentId`, else the pubKey.
 */
function cardId(card) {
  const xc = card?.['x-onderling'] ?? card?.['x-canopy'] ?? {};
  return xc.id ?? card?.agentId ?? xc.pubKey ?? card?.pubKey ?? null;
}

/**
 * The set of skills a card DECLARES it can perform — the ceiling on what
 * a grant may authorise. Union of the A2A `skills[].id`, any pre-existing
 * `x-canopy.grants[].skill`, and coarse `capabilities[]`. Patterns
 * (`p.*`) are kept as-is (they cover their prefix at grant time).
 */
function declaredSkills(card) {
  const xc = card?.['x-onderling'] ?? card?.['x-canopy'] ?? {};
  const out = new Set();
  for (const s of Array.isArray(card?.skills) ? card.skills : []) {
    const id = typeof s === 'string' ? s : s?.id;
    if (typeof id === 'string' && id.length > 0) out.add(id);
  }
  for (const g of Array.isArray(xc.grants) ? xc.grants : []) {
    if (typeof g?.skill === 'string' && g.skill.length > 0) out.add(g.skill);
  }
  for (const c of Array.isArray(card?.capabilities) ? card.capabilities : []) {
    if (typeof c === 'string' && c.length > 0) out.add(c);
  }
  return [...out].sort();
}

/** A card is authorised to grant `skill` iff some declared pattern covers it. */
function isDeclared(declared, skill) {
  return declared.some((pattern) => skillCovers(pattern, skill));
}

/** Card → the default-deny registry entry (capabilities/grants EMPTY). */
function cardToEntry(card, { name } = {}) {
  const xc = card?.['x-onderling'] ?? card?.['x-canopy'] ?? {};
  const pubKey = xc.pubKey ?? card?.pubKey ?? null;
  const agentId = cardId(card);
  if (typeof pubKey !== 'string' || pubKey.length === 0) return null;
  if (typeof agentId !== 'string' || agentId.length === 0) return null;
  return {
    agentId,
    pubKey,
    webid:    xc.owner ?? card?.webid ?? null,
    agentUri: card?.url ?? card?.agentUri ?? `agent://${pubKey}`,
    role:     xc.role ?? card?.role ?? 'service',
    name:     (typeof name === 'string' && name.length > 0) ? name : (card?.name ?? null),
    deviceId: xc.deviceId ?? card?.deviceId ?? null,
    // Capability-security: install grants NOTHING by itself.
    capabilities: [],
    grants:       [],
  };
}

/**
 * Normalise the requested grant set: an array (bare skill strings OR
 * grant objects) or a JSON string carrying such an array (the pasted /
 * gate-supplied form). Anything else ⇒ no grants (inert install).
 */
function normaliseGrants(grants) {
  let arr = grants;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .map((g) => (typeof g === 'string' ? { skill: g } : g))
    .filter((g) => g && typeof g.skill === 'string' && g.skill.length > 0);
}

/**
 * listCatalog — the curated catalog roster (the pluggable source).
 *
 * Reads `store.catalog.list()`; each entry is an installable card. When
 * NO source is injected the op answers the honest "coming with the
 * community catalog" state (`ok:false, error:'no-catalog'`) rather than
 * throwing — the curated commons is blocked on the governance thread.
 *
 * commons-governance: `store.catalog` is a DATA SOURCE only; what makes a
 * source trusted/curated is decided by the commons thread, not here.
 *
 * Additive `items:[{id,label,…}]` for the list renderer (same convention
 * as recoveryCores.listDataVersions).
 */
export async function listCatalog(store, _args = {}) {
  const catalog = store?.catalog;
  if (!catalog || typeof catalog.list !== 'function') {
    return {
      ok:      false,
      error:   'no-catalog',
      message: 'The curated catalog arrives with the community commons (governance designed separately).',
      catalog: [],
      items:   [],
    };
  }
  const cards = await catalog.list();
  const rows = (Array.isArray(cards) ? cards : []).map((card) => {
    const id = cardId(card);
    return {
      id,
      name:        card?.name ?? id,
      description: card?.description ?? null,
      skills:      declaredSkills(card),
      source:      'catalog',
    };
  });
  return {
    ok:      true,
    catalog: rows,
    count:   rows.length,
    items:   rows.map((r) => ({ ...r, label: r.name ?? r.id })),
  };
}

/**
 * installAgent — the install act.  Resolve a card (curated `catalogId` OR
 * power-user `card`), register it default-deny, then grant ONLY the
 * requested-and-declared skills through the token-first grant path.
 *
 * @param {object} store  `{ registry, catalog?, tokens? }`
 * @param {object} args
 * @param {string} [args.catalogId]  install a curated catalog entry
 * @param {object|string} [args.card]  install an arbitrary card (override)
 * @param {Array<string|{skill,capability?,expiresInDays?,subject?}>} [args.grants]
 *   the user-picked grant set (default-deny: omitted ⇒ inert install)
 * @param {string} [args.name]  optional local display name override
 * @returns {Promise<object>} install result (see below)
 */
export async function installAgent(store, args = {}) {
  const registry = registryOf(store);

  // 1. Resolve the card + its source (curated vs override).
  let card;
  let source;
  if (typeof args?.catalogId === 'string' && args.catalogId.length > 0) {
    const catalog = store?.catalog;
    if (!catalog || typeof catalog.get !== 'function') {
      return { ok: false, error: 'no-catalog', installed: false };
    }
    // commons-governance: the curated source's trust/curation is designed
    // separately — here it is just a keyed lookup.
    card = coerceCard(await catalog.get(args.catalogId));
    if (!card) return { ok: false, error: 'catalog-entry-not-found', installed: false, catalogId: args.catalogId };
    source = 'catalog';
  } else if (args?.card != null) {
    card = coerceCard(args.card);
    if (!card) return { ok: false, error: 'card-parse-failed', installed: false };
    source = 'override';   // the power-user override — bypasses the catalog
  } else {
    return { ok: false, error: 'card-or-catalogId-required', installed: false };
  }

  // 2. Card → default-deny entry (NO ambient authority).
  const entry = cardToEntry(card, { name: args?.name });
  if (!entry) return { ok: false, error: 'card-missing-identity', installed: false, source };
  const declared = declaredSkills(card);
  await registry.register(entry);

  // 3. Grant ONLY the requested skills that the card DECLARES it can do.
  //    Undeclared requests are REJECTED (never issued a token) — a card
  //    cannot be talked into authority it never advertised.
  const requested = normaliseGrants(args?.grants);
  const granted  = [];
  const rejected = [];
  for (const req of requested) {
    if (!isDeclared(declared, req.skill)) {
      rejected.push({ skill: req.skill, reason: 'not-declared' });
      continue;
    }
    // Reuse the token-first grant path — do NOT reinvent the registry.
    const res = await grantAgent(store, {
      agentId:       entry.agentId,
      skill:         req.skill,
      capability:    req.capability,
      expiresInDays: req.expiresInDays,
      subject:       req.subject,
    });
    granted.push({
      skill:       req.skill,
      granted:     res.granted,
      tokenId:     res.tokenId,
      tokenBacked: res.tokenBacked,
      expiresAt:   res.expiresAt,
    });
  }

  // Declared-but-not-requested — surfaced so the consent UI can show what
  // was declined (default-deny made visible).
  const requestedSkills = new Set(requested.map((r) => r.skill));
  const declined = declared.filter((s) => !requestedSkills.has(s));

  const { agent } = await viewAgent(store, { agentId: entry.agentId });
  return {
    ok:          true,
    installed:   true,
    source,
    agentId:     entry.agentId,
    tokenBacked: !!(store?.tokens),
    granted,
    rejected,
    declined,
    agent,       // post-install read-back: proves ONLY granted caps landed
  };
}

export const INSTALL_CORES = Object.freeze({
  listCatalog,
  installAgent,
});
