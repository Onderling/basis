/**
 * HybridPodOrchestrator — routes item operations across the
 * household pod / bot pod / per-member pods, per the locked
 * routing table.
 *
 * Phase 2 convergence module.  Consumes the four parallel streams
 * (BotIdentity, HouseholdPod, BotPod, MemberPod + MemberWebIdMap).
 *
 * Responsibilities:
 *   - addItem: pick the target pod (household vs member) per
 *     routingTable.route(); if member-pod, also write an ItemRef on
 *     the household pod so cross-member listing finds it.
 *   - listOpen: merge household items + dereferenced member-pod items.
 *   - markComplete / remove / getById: locate the actual pod the
 *     item lives on, dispatch.
 *
 * This module is the sole consumer of the routing table.  Adding a
 * new pod or changing the routing semantics happens here + in
 * routingTable.js — nowhere else.
 *
 * The orchestrator is platform-pure: it depends on HouseholdPod /
 * MemberPod's interfaces, not on @onderling/pod-client directly.
 * Tests use mock pods that implement those interfaces.
 */

import { route } from './routingTable.js';

export class HybridPodOrchestrator {
  /** @type {import('./HouseholdPod.js').HouseholdPod} */
  #household;
  /**
   * Resolver: given a member's webid, return their MemberPod (or
   * null if they don't have one set up yet).  Lazy by design — we
   * don't pre-construct MemberPods for everyone, only the ones we
   * actually need to read/write.
   * @type {(webid: string) => Promise<import('./MemberPod.js').MemberPod|null>}
   */
  #memberPodFor;

  /**
   * @param {object} args
   * @param {import('./HouseholdPod.js').HouseholdPod}                                   args.householdPod
   * @param {(webid: string) => Promise<import('./MemberPod.js').MemberPod|null>}        args.memberPodFor
   */
  constructor({ householdPod, memberPodFor }) {
    if (!householdPod)                      throw new Error('HybridPodOrchestrator: householdPod required');
    if (typeof memberPodFor !== 'function') throw new Error('HybridPodOrchestrator: memberPodFor (webid → Promise<MemberPod|null>) required');
    this.#household    = householdPod;
    this.#memberPodFor = memberPodFor;
  }

  /**
   * Add an item.  Routes per the table; writes a household-pod ref
   * if the item lands on a member's pod.
   *
   * @param {import('../types.js').Item} item
   * @returns {Promise<{ pod: 'household'|'member', uri: string }>}
   */
  async addItem(item) {
    const { pod, withRef } = route({ type: item.type, assignee: item.assignee });

    if (pod === 'household') {
      const { uri } = await this.#household.addItem(item);
      return { pod: 'household', uri };
    }

    // pod === 'member' — needs an assignee webid + a resolvable MemberPod.
    if (!item.assignee) {
      // Defensive: the routing decision said 'member' but the item is
      // unclaimed — shouldn't happen given route() requires an assignee
      // for that branch.  Fall back to household.
      const { uri } = await this.#household.addItem(item);
      return { pod: 'household', uri };
    }
    const memberPod = await this.#memberPodFor(item.assignee);
    if (!memberPod) {
      // Member doesn't have a per-member pod set up yet.  Fall back to
      // the household pod.  Document the trade-off: the item ends up
      // visible to all members, which is what the assignee implicitly
      // accepts when they don't link a member pod.
      const { uri } = await this.#household.addItem(item);
      return { pod: 'household', uri };
    }

    const { uri, relPath } = await memberPod.addItem(item);

    if (withRef) {
      /** @type {import('../types.js').ItemRef} */
      const ref = {
        id:            item.id,
        type:          item.type,
        ownerWebid:    item.assignee,
        ownerPodRoot:  uri.slice(0, uri.length - relPath.length), // derive from uri minus relPath
        relPath,
        addedAt:       item.addedAt,
        excerpt:       (item.text ?? '').slice(0, 80),
      };
      await this.#household.writeRef(ref);
    }

    return { pod: 'member', uri };
  }

  /**
   * List all open items across the household pod + every member pod
   * that has a reference on the household pod.  Merges and returns a
   * single array (sorted addedAt ASC, mirroring HouseholdPod's order).
   *
   * @param {{ type?: import('../types.js').ItemType }} [filter]
   * @returns {Promise<Array<import('../types.js').Item>>}
   */
  async listOpen(filter = {}) {
    const householdItems = await this.#household.listOpen(filter);

    // Walk household refs → resolve each via the relevant MemberPod.
    const refs = await this.#household.listRefs(filter);
    const memberItems = [];
    for (const ref of refs) {
      const memberPod = await this.#memberPodFor(ref.ownerWebid);
      if (!memberPod) continue;          // can't reach the pod — skip
      const item = await memberPod.getById(ref.id);
      if (!item)               continue;  // ref dangling (item completed/removed there)
      if (item.completedAt)    continue;  // not open
      if (filter?.type && item.type !== filter.type) continue;
      memberItems.push(item);
    }

    return [...householdItems, ...memberItems].sort((a, b) => a.addedAt - b.addedAt);
  }

  /**
   * Locate + mark complete.  Tries the household pod first; falls
   * through to refs → member pods.  When a member-pod item is
   * completed, the household-pod ref is left in place (we treat refs
   * as cheap pointers; orphan refs are tolerated and skipped on
   * listOpen via the `!item || completedAt` check).
   *
   * @param {string} itemId
   * @returns {Promise<import('../types.js').Item>}
   */
  async markComplete(itemId) {
    const onHousehold = await this.#household.getById(itemId);
    if (onHousehold && !onHousehold.completedAt) {
      return this.#household.markComplete(itemId);
    }

    const refs = await this.#household.listRefs();
    const ref = refs.find((r) => r.id === itemId);
    if (ref) {
      const memberPod = await this.#memberPodFor(ref.ownerWebid);
      if (!memberPod) {
        throw new Error(`HybridPodOrchestrator.markComplete: member pod for ${ref.ownerWebid} unreachable`);
      }
      return memberPod.markComplete(itemId);
    }
    throw new Error(`HybridPodOrchestrator.markComplete: id not found: ${itemId}`);
  }

  /**
   * Hard-delete.  Same locate-then-dispatch as markComplete.  When a
   * member-pod item is removed we ALSO clean up the household ref
   * (since refs are cheap, the cleanup is best-effort: we don't fail
   * the whole op if the ref delete throws).
   *
   * @param {string} itemId
   */
  async remove(itemId) {
    const onHousehold = await this.#household.getById(itemId);
    if (onHousehold) {
      await this.#household.remove(itemId);
      return;
    }

    const refs = await this.#household.listRefs();
    const ref = refs.find((r) => r.id === itemId);
    if (ref) {
      const memberPod = await this.#memberPodFor(ref.ownerWebid);
      if (memberPod) {
        try { await memberPod.remove(itemId); } catch { /* tolerate */ }
      }
      // Best-effort ref cleanup.  Not all HouseholdPod implementations
      // expose a removeRef; if not present, the ref will dangle and
      // listOpen will skip it.
      if (typeof this.#household.removeRef === 'function') {
        try { await this.#household.removeRef(itemId); } catch { /* tolerate */ }
      }
      return;
    }
    throw new Error(`HybridPodOrchestrator.remove: id not found: ${itemId}`);
  }

  /**
   * Locate-and-fetch.  Returns null if the item doesn't exist
   * anywhere reachable.
   *
   * @param {string} itemId
   * @returns {Promise<import('../types.js').Item|null>}
   */
  async getById(itemId) {
    const onHousehold = await this.#household.getById(itemId);
    if (onHousehold) return onHousehold;

    const refs = await this.#household.listRefs();
    const ref = refs.find((r) => r.id === itemId);
    if (!ref) return null;

    const memberPod = await this.#memberPodFor(ref.ownerWebid);
    if (!memberPod) return null;
    return memberPod.getById(itemId);
  }
}
