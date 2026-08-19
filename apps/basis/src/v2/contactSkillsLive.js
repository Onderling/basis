/**
 * contactSkillsLive — the LIVE wiring for contact/bot exposed skills
 * (feedback-extension, Mode-1 "bot-exposed skills").
 *
 * `contactSkills.js` is the PURE core: it synthesises a `contact-thread`-scoped
 * manifest from a contact's discovered SkillCards and a `makeRemoteCallSkill`
 * router that hands a dispatch to that contact's bot. This module is the live
 * glue that the pure core's header promised "is a LATER slice":
 *
 *   - it SUBSCRIBES to a `PeerGraph` (the agent's `peers`), so a bot contact's
 *     skills become available the moment it's discovered (`a2aDiscover` upserts
 *     an `a2a` peer whose `skills` are already SkillCards) and DISAPPEAR when the
 *     contact is removed (`peerGraph.remove` → `'removed'`);
 *   - it rebuilds, per contact, the `contact-thread` sources + a remote router,
 *     and exposes a CHAINED `callSkill` that tries each contact's router and
 *     returns `undefined` when no contact owns the op (so a host can chain it in
 *     front of its normal dispatch without affecting non-contact ops);
 *   - it fires `onChange()` whenever the contact-skill set changes, so the host
 *     can refresh whatever surface renders a contact thread's command pool.
 *
 * It is deliberately PLATFORM-INDEPENDENT (no DOM, no storage): the host injects
 * the `PeerGraph` and a `sendTask(peerUrl, skillId, args)` that has the agent +
 * task-result plumbing already applied. Web and mobile share this one wiring;
 * each shell adds only its `sendTask` binding + its refresh hook. (Invariant #1:
 * logic lives once in shared `src/`.)
 *
 * Scope note: contact-thread ops are NOT merged into the circle/app catalogue —
 * they belong to a particular contact's thread (a DM with the bot). The host
 * scopes a contact thread's catalogue to `sourcesFor(contactId)` and dispatches
 * through this module's `callSkill`; the circle bot's catalogue stays clean.
 */

import { contactSkillSources, makeRemoteCallSkill } from './contactSkills.js';

/** PeerGraph events that can change which contacts expose which skills. */
const REFRESH_EVENTS = ['added', 'removed', 'reachable', 'unreachable', 'cleared', 'tiered'];

/**
 * A peer exposes contact-thread skills when it's an A2A/hybrid agent that has at
 * least one discovered skill. (Native-only peers reach their skills over the RQ
 * skill-discovery path; this V0 wiring tracks the A2A roster `a2aAgents()`
 * returns, which is where bot contacts live.)
 *
 * @param {object} peer
 * @returns {boolean}
 */
function defaultIsContact(peer) {
  if (!peer || (peer.type !== 'a2a' && peer.type !== 'hybrid')) return false;
  return Array.isArray(peer.skills) && peer.skills.length > 0;
}

/** A contact's stable id — its pubKey if native-upgraded, else its A2A url. */
function peerContactId(peer) {
  return peer?.pubKey ?? peer?.url ?? null;
}

/** Normalise a peer's `skills` to the SkillCard shape `contactSkills` consumes. */
function peerSkillCards(peer) {
  return (peer?.skills ?? [])
    .map((s) => (typeof s === 'string' ? { id: s } : s))
    .filter((c) => c && typeof c.id === 'string' && c.id !== '');
}

/**
 * A change-detection signature for the whole contact-skill set: each contact's
 * id with its sorted skill ids. Two refreshes producing the same signature are
 * a no-op (we don't fire `onChange`), so a peer-graph event that doesn't touch
 * the skill surface (e.g. a latency update) doesn't churn the command pool.
 */
function setSignature(byContact) {
  return [...byContact.keys()]
    .sort()
    .map((cid) => `${cid}:${[...byContact.get(cid).skillIds].sort().join(',')}`)
    .join('|');
}

/**
 * Build the live contact-skill registry.
 *
 * @param {object} deps
 * @param {import('@onderling/core').PeerGraph} deps.peerGraph
 *   the agent's PeerGraph (`agent.peers`). When absent, the registry is inert
 *   (no contacts, `callSkill` always falls through) so a shell without a peer
 *   graph still boots.
 * @param {(peerUrl: string, skillId: string, args: object) => any} deps.sendTask
 *   sends a task to the contact's bot and resolves to the reply. The shell binds
 *   `@onderling/core` `sendA2ATask` with its `agent` + `task.done()` applied.
 * @param {() => void} [deps.onChange]
 *   called (after the internal state is updated) whenever the contact-skill set
 *   changes — the host's "refresh the contact-thread command pool" hook.
 * @param {(peer: object) => boolean} [deps.isContact]
 *   override which peers expose contact-thread skills (default: A2A/hybrid with
 *   ≥1 skill).
 * @returns {{
 *   callSkill: (appOrigin: string, opId: string, args?: object) => any,
 *   sources: () => Array<object>,
 *   sourcesFor: (contactId: string) => Array<object>,
 *   contacts: () => Array<{ contactId: string, name: string, skillCount: number }>,
 *   has: (contactId: string) => boolean,
 *   refresh: () => Promise<void>,
 *   start: () => Promise<void>,
 *   dispose: () => void,
 * }}
 */
export function createContactSkillRegistry({ peerGraph, sendTask, onChange, isContact = defaultIsContact } = {}) {
  // contactId → { sources, router, name, skillIds:Set, peerUrl }
  const byContact = new Map();
  let signature = '';
  let disposed = false;

  function rebuildOne(peer) {
    const contactId = peerContactId(peer);
    if (!contactId) return null;
    const cards = peerSkillCards(peer);
    if (cards.length === 0) return null;
    const peerUrl = peer.url ?? null;
    const sources = contactSkillSources(contactId, cards);
    if (sources.length === 0) return null;
    const router = makeRemoteCallSkill({
      contactId,
      // The op's bindRef carries the real contactId; resolve it back to the
      // peer's A2A url (one closure per contact keeps it correct even if the
      // url changes across a re-discovery).
      resolvePeerUrl: () => peerUrl,
      sendA2ATask: sendTask,
      skillCards: cards,
    });
    return {
      sources,
      router,
      peerUrl,
      name: peer.name ?? peer.label ?? contactId,
      cards,
      skillIds: new Set(cards.map((c) => c.id)),
    };
  }

  /** Re-scan the peer graph and rebuild the per-contact entries. */
  async function refresh() {
    if (disposed || !peerGraph) return;
    let peers = [];
    try { peers = await peerGraph.a2aAgents(); } catch { peers = []; }
    const next = new Map();
    for (const peer of peers) {
      if (!isContact(peer)) continue;
      const entry = rebuildOne(peer);
      if (entry) next.set(peerContactId(peer), entry);
    }
    byContact.clear();
    for (const [k, v] of next) byContact.set(k, v);

    const sig = setSignature(byContact);
    if (sig !== signature) {
      signature = sig;
      if (typeof onChange === 'function') { try { onChange(); } catch { /* host refresh is best-effort */ } }
    }
  }

  // ── PeerGraph subscription ───────────────────────────────────────────────
  const handler = () => { refresh().catch(() => {}); };
  function subscribe() {
    if (!peerGraph || typeof peerGraph.on !== 'function') return;
    for (const ev of REFRESH_EVENTS) peerGraph.on(ev, handler);
  }
  function unsubscribe() {
    if (!peerGraph || typeof peerGraph.off !== 'function') return;
    for (const ev of REFRESH_EVENTS) peerGraph.off(ev, handler);
  }

  // ── Public surface ───────────────────────────────────────────────────────

  /**
   * Chained router across all known contacts. Returns the first contact's
   * result for an op it owns, or `undefined` when no contact owns the op — so a
   * host can chain this in front of its normal dispatch safely.
   */
  function callSkill(appOrigin, opId, args = {}) {
    for (const entry of byContact.values()) {
      const out = entry.router(appOrigin, opId, args);
      if (out !== undefined) return out;
    }
    return undefined;
  }

  /** Every contact's `contact-thread` sources, flattened (for a merged view). */
  function sources() {
    const all = [];
    for (const entry of byContact.values()) all.push(...entry.sources);
    return all;
  }

  /** One contact thread's sources — scope a DM thread's catalogue to just this. */
  function sourcesFor(contactId) {
    return byContact.get(contactId)?.sources ?? [];
  }

  /**
   * The skill cards a contact exposes (`[{ id, description?, tags? }]`) — for a
   * DM thread to render the bot's skills as in-thread quick actions. Empty when
   * the contact has no discovered skills (a plain conversational bot/peer).
   */
  function skillsFor(contactId) {
    return (byContact.get(contactId)?.cards ?? []).map((c) => ({
      id: c.id, description: c.description ?? '', tags: Array.isArray(c.tags) ? c.tags : [],
    }));
  }

  /** Roster of contacts that currently expose skills (for a contact picker). */
  function contacts() {
    return [...byContact.entries()].map(([contactId, e]) => ({
      contactId, name: e.name, skillCount: e.skillIds.size,
    }));
  }

  function has(contactId) { return byContact.has(contactId); }

  /** Subscribe + do the first scan. Idempotent enough for boot. */
  async function start() {
    subscribe();
    await refresh();
  }

  function dispose() {
    disposed = true;
    unsubscribe();
    byContact.clear();
  }

  return { callSkill, sources, sourcesFor, skillsFor, contacts, has, refresh, start, dispose };
}

/**
 * Compose a contact-skill router IN FRONT OF a host's normal `callSkill`: try
 * the contact router first (it owns only remote-skill ops) and fall through to
 * the base dispatch for everything else. The result is the 3-arg
 * `(appOrigin, opId, args)` shape both shells' dispatch expects.
 *
 * @param {(appOrigin: string, opId: string, args?: object) => any} contactCallSkill
 * @param {(appOrigin: string, opId: string, args?: object) => any} baseCallSkill
 * @returns {(appOrigin: string, opId: string, args?: object) => any}
 */
export function chainContactCallSkill(contactCallSkill, baseCallSkill) {
  return function chainedCallSkill(appOrigin, opId, args = {}) {
    const out = typeof contactCallSkill === 'function'
      ? contactCallSkill(appOrigin, opId, args)
      : undefined;
    if (out !== undefined) return out;
    return typeof baseCallSkill === 'function' ? baseCallSkill(appOrigin, opId, args) : undefined;
  };
}
