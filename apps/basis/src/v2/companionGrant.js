/**
 * companionGrant — what a person's companion lets another agent do there (a household bot putting people's agenda
 * files), and how that grant is given and kept.
 *
 * The companion's OWNER grants from their app, by family ("agenda-bestanden plaatsen"); the companion maps the family
 * to its ops, mints one capability token per op (issuer: the companion; subject: the bot) and sends them to the bot
 * over the relay. Two halves here, shared by every shell:
 *   - the BOT's: keep a grant only from a companion it holds as a contact, only tokens that companion signed for
 *     itself and for this bot's own key, never a wildcard — and present the one for an op on each call there;
 *   - the APP's: the people a grant can go to, and the choices a companion offers, worded through the locale.
 * Nothing here reaches a model's tools: the grant is the owner's act in their app, and the bot's use of it is its own
 * call to the companion.
 */
import { CapabilityToken, TokenRegistry } from '@onderling/core';
import { loadCompanions } from './feedCompanion.js';

/** The message a companion's grant arrives in. The companion names the same one (`GRANT_DELIVERY_SUBTYPE`). */
export const COMPANION_GRANT_SUBTYPE = 'companion-grant';

/** The outcomes of a grant from the app, as the app words them (`circle.companionGrant.outcome_<outcome>`). */
export const COMPANION_GRANT_OUTCOMES = Object.freeze([
  'ok', 'bad-args', 'not-owned', 'no-device-key', 'unreachable', 'forbidden', 'stale', 'unknown-family', 'bad-target', 'gate-off',
]);

/**
 * Whether a failed call to a companion is its GATE refusing the token (revoked, expired, not its own, missing) — as
 * opposed to the companion being away or slow, which says nothing about the grant. The gate's refusals all name the
 * token (`PolicyEngine`'s words); a timeout or an unreachable route does not.
 */
export function isTokenRefusal(err) {
  return /token/i.test(String(err?.message ?? err ?? ''));
}

/** An op a grant may name: exact, never a wildcard (`*`) or a prefix (`feed.*`). */
const EXACT_OP = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/;

/**
 * Whether these are tokens the bot may keep: each signed by `from` for `from` itself (issuer and agent), for the bot's
 * own key, naming one exact op, and not expired. All or nothing.
 * @returns {{ok: true, tokens: CapabilityToken[]}|{ok: false, reason: string}}
 */
export function checkCompanionGrant(from, payload, { self }) {
  if (payload?.subtype !== COMPANION_GRANT_SUBTYPE) return { ok: false, reason: 'not-a-grant' };
  const raw = Array.isArray(payload.tokens) ? payload.tokens : [];
  if (raw.length === 0) return { ok: false, reason: 'no-tokens' };
  const tokens = [];
  for (const r of raw) {
    let t;
    try { t = CapabilityToken.fromJSON(r); } catch { return { ok: false, reason: 'unreadable' }; }
    if (t.issuer !== from) return { ok: false, reason: 'wrong-issuer' };
    if (t.subject !== self) return { ok: false, reason: 'wrong-subject' };
    if (typeof t.skill !== 'string' || !EXACT_OP.test(t.skill)) return { ok: false, reason: 'not-one-op' };
    let valid = false;
    try { valid = CapabilityToken.verify(t, from) === true; } catch { valid = false; }   // signature, expiry, agent = from
    if (!valid) return { ok: false, reason: 'invalid' };
    tokens.push(t);
  }
  return { ok: true, tokens };
}

/**
 * The bot's kept grants, per companion.
 * @param {object} a
 * @param {object} a.vault     where they are kept (sealed at rest on the box)
 * @param {() => string} a.self  the key the bot calls a companion with — the tokens' subject
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill  the bot's waist (its contacts)
 */
export function createCompanionGrants({ vault, self, callSkill }) {
  const registry = new TokenRegistry(vault);
  /** Grants (by a token's id) already being ended after a refusal — so it is told once. */
  const ending = new Set();
  const heldKey = (node) => `companion-grant-held:${node}`;
  const held = async (node) => { try { const v = JSON.parse((await vault.get(heldKey(node))) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

  /** Forget what this companion granted: nothing is presented there until it grants again. */
  async function dropFor(node) {
    for (const id of await held(node)) await registry.revoke(id);
    await vault.set(heldKey(node), '[]');
  }

  return {
    /**
     * A grant message from `from`: kept when `from` is a companion among the bot's contacts and the tokens pass
     * `checkCompanionGrant`; it replaces what that companion granted before. `{ok, ops}` or `{ok: false, reason}`.
     */
    async accept(from, payload) {
      const companions = await loadCompanions({ callSkill });
      if (!companions.some((c) => c.node === from)) return { ok: false, reason: 'not-a-companion' };
      const v = checkCompanionGrant(from, payload, { self: self() });
      if (!v.ok) return v;
      await dropFor(from);
      for (const t of v.tokens) await registry.store(t);
      await vault.set(heldKey(from), JSON.stringify(v.tokens.map((t) => t.id)));
      return { ok: true, ops: v.tokens.map((t) => t.skill).sort() };
    },
    /** The token to present for `op` at that companion, or null. */
    async tokenFor(node, op) {
      return (await registry.get(node, op))?.toJSON() ?? null;
    },
    /**
     * A call to `node` failed. When its gate refused a token this bot PRESENTED from the grant it holds, the grant is
     * over (revoked, or no longer that companion's): drop it, and say so once — `tell` is true for exactly one caller
     * per grant, however many calls were in flight with it. Not a refusal (away, slow), or nothing presented: nothing.
     * @returns {Promise<{dropped: boolean, tell: boolean}>}
     */
    async refused(node, presented, err) {
      const id = presented?.id ?? null;
      if (!id || !isTokenRefusal(err) || ending.has(id)) return { dropped: false, tell: false };
      ending.add(id);   // before any await: a second call with the same token stops here
      if (!(await held(node)).includes(id)) return { dropped: false, tell: false };
      await dropFor(node);
      return { dropped: true, tell: true };
    },
    dropFor,
  };
}

// ── the APP's half: who a grant can go to, and what a node offers — what My data paints ────────────────────────

/** An agent's key as the relay addresses it (the key a grant's tokens are minted to). */
const AGENT_KEY = /^[A-Za-z0-9_-]{43}$/;

/**
 * The agents a person can grant a place on their node: their contacts (a bot added by its card) and the bots their
 * identity is linked to (`/koppel`), each by the key it is reached at — the address on its card first, which is the
 * key it calls with. Hidden contacts, rows with no such key, and the node itself are left out; one row per key.
 * @param {object} a
 * @param {Array<{webid?: string, pubKey?: string, peerAddr?: string, displayName?: string, handle?: string, hidden?: boolean}>} [a.contacts]
 * @param {Array<{bot: string, botName?: string|null}>} [a.linkedBots]
 * @param {string} [a.node]  the node being granted on (never a target of its own grant)
 * @returns {Array<{key: string, label: string}>}
 */
export function companionGrantTargets({ contacts = [], linkedBots = [], node = null } = {}) {
  const out = new Map();
  const add = (key, label) => {
    if (!AGENT_KEY.test(key ?? '') || key === node || out.has(key)) return;
    out.set(key, { key, label: label || `${key.slice(0, 8)}…` });
  };
  for (const c of Array.isArray(contacts) ? contacts : []) {
    if (!c || c.hidden === true) continue;
    const key = [c.peerAddr, c.pubKey, c.webid].find((k) => typeof k === 'string' && AGENT_KEY.test(k));
    add(key, c.displayName || c.handle || null);
  }
  for (const b of Array.isArray(linkedBots) ? linkedBots : []) add(b?.bot, b?.botName || null);
  return [...out.values()];
}

/**
 * A node's families as the tick list paints them: each worded by the locale (`circle.companionGrant.family_<id>`), a
 * family this app has no words for shown by its own name rather than hidden.
 * @param {string[]} families
 * @param {(key: string) => string} t
 * @returns {Array<{id: string, label: string}>}
 */
export function companionFamilyChoices(families, t) {
  return (Array.isArray(families) ? families : []).filter((f) => typeof f === 'string' && f).map((id) => {
    const key = `circle.companionGrant.family_${id.replace(/-/g, '_')}`;
    const said = typeof t === 'function' ? t(key) : key;
    return { id, label: said && said !== key ? said : id };
  });
}

/**
 * What the grant's picker shows for one node, read through the waist: the node's own choices (asked of it, signed by
 * this device) and the agents a grant can go to. `{ok: true, targets, choices}`, or `{ok: false, message}` worded
 * from the outcome (a node away, not yours, a clock that is off).
 * @param {object} a
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill
 * @param {string} a.node
 * @param {Array<{bot: string, botName?: string|null}>} [a.linkedBots]  the bots this identity is linked to (`/koppel`)
 * @param {(key: string, o?: object) => string} a.t
 */
export async function loadCompanionGrantPicker({ callSkill, node, linkedBots = [], t }) {
  const [choices, book] = await Promise.all([
    Promise.resolve(callSkill('household', 'companionGrantChoices', { node })).catch(() => null),
    Promise.resolve(callSkill('stoop', 'listContacts', {})).catch(() => null),
  ]);
  if (choices?.ok !== true) return { ok: false, message: companionGrantText(choices, t) };
  const contacts = Array.isArray(book?.contacts) ? book.contacts : (Array.isArray(book?.items) ? book.items : []);
  return { ok: true, targets: companionGrantTargets({ contacts, linkedBots, node }), choices: companionFamilyChoices(choices.families, t) };
}

/** The line a grant (or the picker's read) ends on: done, or its outcome worded (`circle.companionGrant.outcome_*`). */
export function companionGrantText(r, t) {
  if (r?.ok === true) return t('circle.companionGrant.done');
  const outcome = typeof r?.outcome === 'string' ? r.outcome : null;
  if (outcome && COMPANION_GRANT_OUTCOMES.includes(outcome)) {
    const key = `circle.companionGrant.outcome_${outcome.replace(/-/g, '_')}`;
    const said = t(key);
    if (said && said !== key) return said;
  }
  return t('circle.companionGrant.failed');
}

/**
 * What a node the person owns has granted, as My data's lines under it: one per agent, named as the person knows it (a
 * contact, a linked bot — else the start of its key), with what it may do worded from the node's families. Asked of
 * the node (one truth). `{ok: true, rows: [{to, label, may}]}`, or `{ok: false, message}` worded from the outcome.
 * @param {object} a
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill
 * @param {string} a.node
 * @param {Array<{bot: string, botName?: string|null}>} [a.linkedBots]
 * @param {(key: string, o?: object) => string} a.t
 */
export async function loadCompanionGrantRows({ callSkill, node, linkedBots = [], t }) {
  const [list, book] = await Promise.all([
    Promise.resolve(callSkill('household', 'companionGrantList', { node })).catch(() => null),
    Promise.resolve(callSkill('stoop', 'listContacts', {})).catch(() => null),
  ]);
  if (list?.ok !== true) return { ok: false, message: companionGrantText(list, t) };
  const contacts = Array.isArray(book?.contacts) ? book.contacts : (Array.isArray(book?.items) ? book.items : []);
  const names = new Map(companionGrantTargets({ contacts, linkedBots, node }).map((x) => [x.key, x.label]));
  const rows = (Array.isArray(list.grants) ? list.grants : []).map((g) => ({
    to: g.to,
    label: names.get(g.to) ?? `${String(g.to).slice(0, 8)}…`,
    may: t('circle.companionGrant.may', { what: companionFamilyChoices(g.families, t).map((c) => c.label).join(', ') }),
  }));
  return { ok: true, rows };
}

/** The line a revoke ends on. */
export function companionRevokeText(r, t) {
  return r?.ok === true ? t('circle.companionGrant.revoked') : companionGrantText(r, t);
}
