/**
 * routingTable — locked routing rules for the hybrid-pod pattern.
 *
 * `HybridPodOrchestrator` consumes this to decide which pod an item
 * lands on.  Two pods can hold real Item bytes:
 *
 *   - the **shared household pod** (everyone-readable household items)
 *   - the **per-member pod** of a specific member (private to them,
 *     visible to the household via a reference written to the
 *     household pod)
 *
 * The bot's pod is for the bot's own state (config, audit, chat
 * cursors, bot token) — Items don't land there.
 *
 * The rules are **pure data** so they're easy to test, easy to swap
 * out per-household later (e.g. a household that wants ALL errands
 * on the household pod regardless of assignee), and easy to reason
 * about.
 *
 * Routing decision shape:
 *
 *   route({ type, assignee }) → { pod, withRef }
 *
 *   pod      = 'household' | 'member'
 *   withRef  = if true and pod === 'member', the orchestrator also
 *              writes an ItemRef to the household pod's `refs/`
 *              collection so cross-member listing works.
 *
 * See `programming-plan.md` § "HybridPodOrchestrator" and
 * `track-H-app-household.md` § "Pod schema → Hybrid pod from v0
 * (Q-H2.6 lock)" for the full design context.
 */

/**
 * @typedef {object} RoutingDecision
 * @property {'household'|'member'} pod
 * @property {boolean}              withRef    write a ref on the household pod too
 */

/**
 * @param {object} args
 * @param {import('../types.js').ItemType} args.type
 * @param {string} [args.assignee]            webid of the owner, or absent
 * @returns {RoutingDecision}
 */
export function route({ type, assignee }) {
  switch (type) {
    case 'shopping':
      // Household-shared by definition (someone-buys-it-for-everyone).
      return { pod: 'household', withRef: false };
    case 'repair':
      // Same — repairs benefit the whole household.
      return { pod: 'household', withRef: false };
    case 'errand':
      // Default to household pod; if explicitly assigned to one
      // member, store on their pod with a ref for the household to see.
      return assignee
        ? { pod: 'member', withRef: true }
        : { pod: 'household', withRef: false };
    case 'schedule':
      // Schedule items: same as errand — personal if assigned, shared
      // otherwise.
      return assignee
        ? { pod: 'member', withRef: true }
        : { pod: 'household', withRef: false };
    default:
      // Unknown type: conservative default — household pod, no ref.
      return { pod: 'household', withRef: false };
  }
}

/**
 * Pure-data export for tests + introspection.  Locked at v0; changing
 * a row requires a doc note in `programming-plan.md`.
 */
export const ROUTING_TABLE = Object.freeze([
  { type: 'shopping', assignee: 'any',     pod: 'household', withRef: false },
  { type: 'repair',   assignee: 'any',     pod: 'household', withRef: false },
  { type: 'errand',   assignee: 'unset',   pod: 'household', withRef: false },
  { type: 'errand',   assignee: 'set',     pod: 'member',    withRef: true  },
  { type: 'schedule', assignee: 'unset',   pod: 'household', withRef: false },
  { type: 'schedule', assignee: 'set',     pod: 'member',    withRef: true  },
]);
