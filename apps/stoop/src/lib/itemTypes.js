/**
 * Stoop's `Item.type` vocabulary — single source of truth.
 *
 * Stoop slots its kinds into the existing `item-store.Item.type`
 * field (no substrate change — see Phase 1A discovery).  Apps
 * importing these constants get auto-complete + a place to grep
 * for kind references when the vocabulary evolves.
 */

export const ITEM_TYPES = Object.freeze({
  /** Neighbour has a question / needs help. */
  ASK:           'ask',
  /** Neighbour offers a skill / time / item. */
  OFFER:         'offer',
  /** Neighbour is willing to lend an item; needs a `dueAt`. */
  LEND:          'lend',
  /** A report filed against another item (moderation). */
  REPORT:        'report',
  /** Persisted output of the create-group wizard. */
  GROUP_RULES:   'group-rules',
  /** Audit-trail entry: a member accepted a group's rules. */
  RULES_ACCEPT:  'rules-accept',
  /** Audit-trail entry: a member left a group. */
  GROUP_LEAVE:   'group-leave',
  /** Legacy V0 type — pre-Stoop H5 used `'request'`; preserved for back-compat. */
  REQUEST:       'request',
});

/** All Stoop kinds the board renders alongside one another. */
export const NOTICEBOARD_KINDS = Object.freeze([
  ITEM_TYPES.ASK,
  ITEM_TYPES.OFFER,
  ITEM_TYPES.LEND,
]);
