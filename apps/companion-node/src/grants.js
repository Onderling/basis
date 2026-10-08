// What a companion's owner may let ANOTHER agent do here — a household bot putting people's agenda files — and the
// tokens that say so.
//
// The owner grants from their app by FAMILY ("agenda-bestanden plaatsen"), never by op: the node maps each family to
// its ops in ONE place (`GRANT_FAMILIES` below) and refuses a family it does not know — there is no wildcard and no
// way to ask for one. For each op the node mints ONE capability token: issuer and agent = this node, subject = the
// agent granted, skill = the op. The node's own gate (`PolicyEngine.checkInbound`) verifies a presented token on every
// call — its signature, that it is for this node, that the caller is its subject, its op, that this node issued it,
// and that it is not revoked. One live grant per agent: minting again for the same agent revokes what it held before.
// The node keeps, per agent, which tokens it holds and for which families — so the owner's app can ask what is granted
// (one truth: the node's) and revoke an agent whole.
//
// The tokens go to the agent over the relay as a ONE-WAY message, the way a connected screen's grant reaches the
// screen; the agent keeps them and presents one on every call.
import { CapabilityToken, param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

/** The op families an owner can grant, and the ops each one is. The only place the mapping lives. */
export const GRANT_FAMILIES = Object.freeze({
  // a person's agenda as a link: put a person's sealed file, and drop it
  'agenda-files': Object.freeze(['feed.put', 'feed.drop']),
});

/**
 * How long a granted token lives. The END of a grant is its revocation (by the owner, or with the contact); this
 * expiry is only the outer bound a token must carry. After it the owner ticks the grant again — nothing renews it.
 */
export const GRANT_TOKEN_TTL_MS = param({ key: 'companion.grantTokenTtlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 365 * 24 * 60 * 60 * 1000 });

/** The one-way message the tokens travel in, to the agent granted (its receiver reads this subtype). */
export const GRANT_DELIVERY_SUBTYPE = 'companion-grant';

/** How long the node waits for the agent's handshake and acknowledgement before it sends the grant one-way. */
const DELIVERY_WAIT_MS = 5_000;

/** An agent's key as the relay addresses it. */
const AGENT_KEY = /^[A-Za-z0-9_-]{43}$/;

/**
 * The ops a set of families grants — sorted, each once — or null when ANY family is unknown (a `*` included) or none
 * is asked for. Never a partial answer: a grant the owner did not mean is worse than none.
 * @param {unknown} families
 * @returns {string[]|null}
 */
export function opsForFamilies(families) {
  if (!Array.isArray(families) || families.length === 0) return null;
  const ops = new Set();
  for (const f of families) {
    if (typeof f !== 'string' || !Object.prototype.hasOwnProperty.call(GRANT_FAMILIES, f)) return null;
    for (const op of GRANT_FAMILIES[f]) ops.add(op);
  }
  return [...ops].sort();
}

/**
 * The node's grants. `vault` is where it keeps which tokens each agent holds (the permissions vault, beside the
 * issuer-side ledger), so a restart still knows what minting again must revoke.
 * @param {object} a
 * @param {import('@onderling/core').AgentIdentity} a.identity   this node's identity (the issuer)
 * @param {import('@onderling/core').Agent} a.agent             this node's agent (to deliver)
 * @param {import('@onderling/core').TokenRegistry} a.tokenRegistry  the issuer-side ledger the gate's revocation reads
 * @param {{get: Function, set: Function}} a.vault
 */
export function createNodeGrants({ identity, agent, tokenRegistry, vault }) {
  const HELD = 'grant-held:';
  const heldKey = (to) => `${HELD}${to}`;
  /** What an agent holds here: `{ids, families}` (empty when nothing). */
  const heldBy = async (to) => {
    try {
      const v = JSON.parse((await vault.get(heldKey(to))) ?? 'null');
      return { ids: Array.isArray(v?.ids) ? v.ids : [], families: Array.isArray(v?.families) ? v.families : [] };
    } catch { return { ids: [], families: [] }; }
  };
  /** Revoke every token an agent holds here and forget its grant; how many were revoked. */
  async function revokeAll(to) {
    const { ids } = await heldBy(to);
    for (const id of ids) await tokenRegistry.revoke(id);
    if (typeof vault.delete === 'function') await vault.delete(heldKey(to));
    else await vault.set(heldKey(to), 'null');
    return ids.length;
  }

  /** Hand the tokens to the agent over the relay: acknowledged when it answers, else one-way. `'acked'|'sent'|'failed'`. */
  async function deliver(to, tokens) {
    const payload = { subtype: GRANT_DELIVERY_SUBTYPE, tokens: tokens.map((t) => t.toJSON()) };
    try { await agent.hello(to, DELIVERY_WAIT_MS); } catch { /* an agent that is away still gets the one-way send below */ }
    try {
      const t = await agent.transportFor(to);
      try { await t.sendAck(to, payload, DELIVERY_WAIT_MS); return 'acked'; } catch { /* no acknowledgement: send it anyway */ }
      await t.sendOneWay(to, payload);
      return 'sent';
    } catch { return 'failed'; }
  }

  return {
    /**
     * Mint and deliver one token per op of the families, to `to`; revoke what `to` held before.
     * @param {{to: unknown, families: unknown}} a
     * @returns {Promise<{ok: true, ops: string[], delivery: string}|{ok: false, error: 'bad-target'|'unknown-family'}>}
     */
    async mint({ to, families }) {
      if (typeof to !== 'string' || !AGENT_KEY.test(to) || to === identity.pubKey) return { ok: false, error: 'bad-target' };
      const ops = opsForFamilies(families);
      if (!ops) return { ok: false, error: 'unknown-family' };
      const tokens = [];
      for (const skill of ops) {
        const token = await CapabilityToken.issue(identity, { subject: to, agentId: identity.pubKey, skill, expiresIn: GRANT_TOKEN_TTL_MS });
        await tokenRegistry.store(token);
        tokens.push(token);
      }
      // one live grant per agent: what it held before stops working now
      await revokeAll(to);
      const granted = [...new Set(families)].sort();
      await vault.set(heldKey(to), JSON.stringify({ ids: tokens.map((t) => t.id), families: granted }));
      return { ok: true, ops, delivery: await deliver(to, tokens) };
    },

    /**
     * Revoke everything `to` holds here: the gate refuses its next call (revocation is checked before every op).
     * @returns {Promise<{ok: true, revoked: number}|{ok: false, error: 'bad-target'}>}
     */
    async revoke({ to }) {
      if (typeof to !== 'string' || !AGENT_KEY.test(to)) return { ok: false, error: 'bad-target' };
      return { ok: true, revoked: await revokeAll(to) };
    },

    /** Who holds a grant here, and for which families: `[{to, families}]`. */
    async list() {
      const keys = (await vault.list()).filter((k) => k.startsWith(HELD));
      const out = [];
      for (const k of keys) {
        const to = k.slice(HELD.length);
        const { ids, families } = await heldBy(to);
        if (ids.length) out.push({ to, families });
      }
      return out.sort((a, b) => a.to.localeCompare(b.to));
    },
  };
}
