/**
 * taskManifest — the DECLARED contract for the task lane's log entries.
 *
 * Third sibling of `governanceManifest` / `membershipManifest`: a cross-cutting plumbing manifest declaring
 * which signed statement kinds the task lane of the device log carries. The rail refuses anything else at
 * both ends (append + verify-on-ingest).
 *
 * Unlike governance/membership — where each statement is a distinct ACT the fold interprets — a task
 * statement carries the writer's FULL ITEM SNAPSHOT: the store row as the writer's lifecycle op left it
 * (claim cluster, claimSeq, confirmation signature and all). Receivers never replay verbs; they causally
 * merge the snapshot into their own materialised head, so the merge semantics stay exactly the store's
 * (`causalMerge`: content LWW on the Lamport clock + the claim fold). Two kinds suffice: a write is a
 * snapshot, a hard-delete is a remove.
 *
 * The lane is TYPE-GENERAL by the same token: the snapshot carries the item's own `type`, and whatever the
 * circle's store holds rides it — there is no list of types at the valve or at catch-up (the store's
 * registry is the only gate on what may be written). The kinds don't change per type — a shopping row is
 * just a snapshot the causal merge judges.
 */

/** The device-log lane task statements ride. The lane name doubles as the log-entry type, which the shared
 *  entry-kind table already classes as 14-day retention — the entries age out; the STORE ROW is the durable
 *  head, and catch-up serves both. */
export const TASK_LANE = 'task';

export const taskManifest = Object.freeze({
  app: 'task-lane',
  itemTypes: [],
  nouns: {},
  operations: [
    {
      id: 'task.snapshot',
      description: 'Any task write (add / claim / reassign / complete / update) fans the writer\'s full item snapshot; receivers causally merge it into their head.',
      appends: [{ lane: TASK_LANE, kind: 'snapshot' }],
    },
    {
      id: 'task.remove',
      description: 'A task hard-delete; receivers delete their head row by id.',
      appends: [{ lane: TASK_LANE, kind: 'remove' }],
    },
  ],
});

export default taskManifest;
