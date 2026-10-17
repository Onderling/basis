/**
 * Reveals — per-group + per-peer "show real name" state for the
 * Pinboard-shape "handle by default, displayName on reveal" pattern.
 *
 * The reveal state is *the viewer's local choice* — i.e. it lives on
 * Anna's device and records "for these peers / these groups, I have
 * agreed to see displayName instead of handle".  In the symmetric
 * pattern (chat-agent reveal handshake), both sides flip their own
 * Reveals records when they agree to reveal; nothing on the network
 * forces it.
 *
 * Two scopes:
 *  - per-group:  show displayName for every member of a given group
 *                that opted in to group-wide reveal.
 *  - per-peer:   show displayName for one specific peer (overrides
 *                per-group default; usually set after a chat-agent
 *                handshake).
 *
 * Resolution precedence (see Resolver.resolve()): peer override wins
 * over group default, group default wins over "show handle".
 *
 * Pure in-memory.  Persisting to the pod is the app's concern (Pinboard
 * writes to `/reveals/...` per the design in
 * `Project Files/Pinboard/advice-2026-05-05.md` § "Handle / nickname
 * design").
 *
 * ⚠ DEPRECATED-DELEGATING (C7). `@onderling/agent-registry`'s `disclosure.js` is now
 * THE reveal-state home. This class is a tiny special case of that general policy: ONE
 * attribute — the display name — governed per (group/peer) context. Its state is now
 * stored AS a disclosure policy and every read/write RESOLVES THROUGH disclosure's
 * `enabled` bit, so `showDisplayName` for a context ≡ `isDisclosed(policy, context,
 * 'displayName')`. Public signatures, events and outputs are unchanged (byte-identical).
 * A follow-up re-homes callers onto the general per-attribute reveal-state and retires
 * this single-boolean shim.
 */

import { Emitter } from '@onderling/core';
import { createDisclosurePolicy, setDisclosure, isDisclosed } from '@onderling/agent-registry';

/** The single attribute this legacy store governs — the display name (§1.2, folded into the general policy). */
export const REVEAL_DISPLAY_NAME_KEY = 'displayName';

/** Context ids that namespace the two scopes onto ONE disclosure policy (peer webids are URLs; the prefix disambiguates). */
export const groupRevealContext = (groupId) => `group:${groupId}`;
export const peerRevealContext = (peerWebid) => `peer:${peerWebid}`;
const GROUP_PREFIX = 'group:';
const PEER_PREFIX = 'peer:';

export class Reveals extends Emitter {
  /**
   * The reveal-state, held as a general disclosure policy over the single
   * `displayName` attribute. `perContext['group:<id>'|'peer:<webid>'].displayName.enabled`
   * IS the `showDisplayName` bit. Presence of the context entry = "there is a record"
   * (distinguishes an explicit `false` from an absent default).
   * @type {{perContext: object}}
   */
  #policy = createDisclosurePolicy();

  /**
   * @param {object} [opts]
   * @param {Array<{groupId: string, showDisplayName: boolean}>} [opts.groupReveals]
   * @param {Array<{peerWebid: string, showDisplayName: boolean}>} [opts.peerReveals]
   */
  constructor({ groupReveals, peerReveals } = {}) {
    super();
    if (Array.isArray(groupReveals)) {
      for (const r of groupReveals) {
        if (r?.groupId) this.#set(groupRevealContext(r.groupId), r.showDisplayName);
      }
    }
    if (Array.isArray(peerReveals)) {
      for (const r of peerReveals) {
        if (r?.peerWebid) this.#set(peerRevealContext(r.peerWebid), r.showDisplayName);
      }
    }
  }

  /** Set the display-name `enabled` bit for a context on the underlying disclosure policy. */
  #set(contextId, showDisplayName) {
    this.#policy = setDisclosure(this.#policy, contextId, REVEAL_DISPLAY_NAME_KEY, { enabled: !!showDisplayName });
  }

  /** Does the policy carry a record for this context (vs. an absent default)? */
  #hasRecord(contextId) {
    return this.#policy?.perContext?.[contextId]?.[REVEAL_DISPLAY_NAME_KEY] !== undefined;
  }

  /** The display-name disclosure bit for a context. */
  #show(contextId) {
    return isDisclosed(this.#policy, contextId, REVEAL_DISPLAY_NAME_KEY);
  }

  /**
   * Set or clear reveal-for-group.
   *
   * @param {string} groupId
   * @param {boolean} showDisplayName
   */
  setGroupReveal(groupId, showDisplayName) {
    if (typeof groupId !== 'string' || !groupId) {
      throw new TypeError('setGroupReveal: groupId required');
    }
    this.#set(groupRevealContext(groupId), showDisplayName);
    this.emit('group-reveal-changed', { groupId, showDisplayName: !!showDisplayName });
  }

  /**
   * Set or clear reveal-for-peer.  Overrides per-group when present.
   *
   * @param {string} peerWebid
   * @param {boolean} showDisplayName
   */
  setPeerReveal(peerWebid, showDisplayName) {
    if (typeof peerWebid !== 'string' || !peerWebid) {
      throw new TypeError('setPeerReveal: peerWebid required');
    }
    this.#set(peerRevealContext(peerWebid), showDisplayName);
    this.emit('peer-reveal-changed', { peerWebid, showDisplayName: !!showDisplayName });
  }

  /**
   * Remove a peer-reveal record (falls back to per-group default).
   *
   * @param {string} peerWebid
   */
  clearPeerReveal(peerWebid) {
    const contextId = peerRevealContext(peerWebid);
    const had = this.#hasRecord(contextId);
    if (had) {
      const perContext = { ...(this.#policy?.perContext || {}) };
      delete perContext[contextId];
      this.#policy = { perContext };
      this.emit('peer-reveal-cleared', { peerWebid });
    }
  }

  /**
   * Enumerate the current reveal state (UI / "what have I revealed
   * so far?" inventory).  Returns plain POJO snapshots; mutating the
   * returned arrays does not affect the store.
   *
   * @returns {{
   *   groups: Array<{groupId: string, showDisplayName: boolean}>,
   *   peers:  Array<{peerWebid: string, showDisplayName: boolean}>,
   * }}
   */
  list() {
    const groups = [];
    const peers = [];
    for (const contextId of Object.keys(this.#policy?.perContext || {})) {
      if (!this.#hasRecord(contextId)) continue;
      const showDisplayName = this.#show(contextId);
      if (contextId.startsWith(GROUP_PREFIX)) {
        groups.push({ groupId: contextId.slice(GROUP_PREFIX.length), showDisplayName });
      } else if (contextId.startsWith(PEER_PREFIX)) {
        peers.push({ peerWebid: contextId.slice(PEER_PREFIX.length), showDisplayName });
      }
    }
    return { groups, peers };
  }

  /**
   * Read the reveal decision for a specific (peer, group).  Peer
   * override wins; group default fills in; absent = false.
   *
   * @param {object} args
   * @param {string} args.peerWebid
   * @param {string} [args.groupId]
   * @returns {{showDisplayName: boolean, source: 'peer' | 'group' | 'default'}}
   */
  decide({ peerWebid, groupId } = {}) {
    if (peerWebid && this.#hasRecord(peerRevealContext(peerWebid))) {
      return { showDisplayName: this.#show(peerRevealContext(peerWebid)), source: 'peer' };
    }
    if (groupId && this.#hasRecord(groupRevealContext(groupId))) {
      return { showDisplayName: this.#show(groupRevealContext(groupId)), source: 'group' };
    }
    return { showDisplayName: false, source: 'default' };
  }

  /**
   * A read-only snapshot of the underlying disclosure policy (the C7 reveal-state).
   * For inspection / round-trip proof that `showDisplayName` ≡ the display-name
   * `enabled` bit; not part of the legacy behavioural surface.
   *
   * @returns {{perContext: object}}
   */
  disclosurePolicy() {
    return structuredClone(this.#policy);
  }
}
