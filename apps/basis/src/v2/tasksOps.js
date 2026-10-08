/**
 * tasksOps — the task noun's verbs over the circle's ONE store, beside `listsOps` and the bot's calendar ops.
 *
 * A chore is a typed item (`task`) in the circle's store, next to the list lines and the appointments; its verbs are
 * the item store's (`createTaskStore`: add, claim, complete, reassign, update, remove), gated by the role policy the
 * composition hands in. The op ids and the answers are the ones the separate tasks agent gave (`{task}`, `{result}`,
 * `{items}`, `{id}`), so the door's reply shaping reads them unchanged.
 *
 * Who acts: a host (a household bot) serves several people through ONE key. That key is the authority every gate
 * reads (`hostActor`); the person a call is for (`args.actor`, put there by the door after its own role gate) is who
 * the chore records — who added it, who holds it, who completed it. "Mine" is the chores that person holds.
 */
import { createTaskStore, effectiveStatus, unmetDeps, assigneesOf } from '@onderling/item-store';
import { taskHasWords } from '@onderling-app/tasks';

/**
 * @param {object} a
 * @param {(circleId: string) => object} a.storeFor   the circle's CircleItemStore
 * @param {() => string|null} a.activeCircle           the circle a call names none of
 * @param {string} a.hostActor                         the key with authority (the bot's own)
 * @param {object} [a.rolePolicy]                      the item store's RolePolicy (absent: allow)
 */
export function makeTasksOps({ storeFor, activeCircle, hostActor, rolePolicy = null } = {}) {
  if (typeof storeFor !== 'function') throw new TypeError('makeTasksOps: storeFor is required');
  if (typeof hostActor !== 'string' || !hostActor) throw new TypeError('makeTasksOps: hostActor is required');
  const taskStores = new Map();
  const tasksIn = (args) => {
    const circleId = args?.circleId ?? activeCircle?.() ?? null;
    if (!circleId) return null;
    if (!taskStores.has(circleId)) taskStores.set(circleId, createTaskStore(storeFor(circleId), { rolePolicy }));
    return taskStores.get(circleId);
  };
  const person = (args) => (typeof args?.actor === 'string' && args.actor ? args.actor : null);
  // the host's authority, and the person it is for
  const by = (args) => ({ actor: hostActor, ...(person(args) ? { onBehalfOf: person(args) } : {}) });
  const isTask = (it) => !it?.type || it.type === 'task';
  const withStatus = (items, open, closed) => items.map((t) => ({ ...t, status: effectiveStatus(t, open, closed), openDeps: unmetDeps(t, open, closed) }));
  const NO_CIRCLE = { error: 'circleId required' };

  return {
    async addTask(args = {}) {
      const ts = tasksIn(args);
      if (!ts) return NO_CIRCLE;
      const partial = { type: 'task', text: args.text };
      for (const f of ['notes', 'dueAt', 'visibility', 'maxAssignees', 'dependencies']) if (args[f] !== undefined) partial[f] = args[f];
      if (person(args)) partial.actor = person(args);
      const [task] = await ts.addItems([partial], by(args));
      return { task };
    },

    /** The open chores; `assignee` — those that person holds; `text` — those whose words hold these ("wie doet de lamp"). */
    async listOpen(args = {}) {
      const ts = tasksIn(args);
      if (!ts) return NO_CIRCLE;
      const open = (await ts.listOpen({})).filter(isTask);
      const closed = await ts.listClosed();
      const held = 'assignee' in args ? open.filter((t) => assigneesOf(t).includes(args.assignee)) : open;
      const words = typeof args.text === 'string' && args.text.trim() ? args.text.trim() : null;
      const items = withStatus(words ? held.filter((t) => taskHasWords(t, words)) : held, open, closed);
      // the words it read for, handed back: what the answer is worded by (`replyLine`)
      return { items, ...(words ? { text: words } : {}) };
    },

    /** The chores the person holds; with no person, every open chore (the painting shells' "my work"). */
    async listMine(args = {}) {
      const ts = tasksIn(args);
      if (!ts) return NO_CIRCLE;
      const open = (await ts.listOpen({})).filter(isTask);
      const closed = await ts.listClosed();
      const me = person(args);
      return { items: withStatus(me ? open.filter((t) => assigneesOf(t).includes(me)) : open, open, closed) };
    },

    async claimTask(args = {}) {
      const ts = tasksIn(args);
      if (!ts) return NO_CIRCLE;
      return { result: await ts.claim(args.id, by(args)) };
    },

    async completeTask(args = {}) {
      const ts = tasksIn(args);
      if (!ts) return NO_CIRCLE;
      try {
        const [task] = await ts.markComplete([{ id: args.id }], by(args));
        return { task };
      } catch (err) {
        if (err?.code === 'DEPENDENCIES_OPEN') return { error: 'has-open-dependencies', openDeps: err.openDeps };
        throw err;
      }
    },

    /** Reassign, or unassign with no `newAssignee`. */
    async reassignTask(args = {}) {
      const ts = tasksIn(args);
      if (!ts) return NO_CIRCLE;
      return { task: await ts.reassign(args.id, args.newAssignee ?? null, by(args)) };
    },

    async editTask(args = {}) {
      const ts = tasksIn(args);
      if (!ts) return NO_CIRCLE;
      if (typeof args.id !== 'string' || !args.id) return { error: 'id required' };
      const patch = {};
      for (const f of ['text', 'notes', 'dueAt', 'visibility']) if (args[f] !== undefined) patch[f] = args[f];
      if (!Object.keys(patch).length) return { error: 'no fields to update' };
      try {
        return { task: await ts.update(args.id, patch, by(args)) };
      } catch (err) {
        if (err?.code === 'ITEM_NOT_FOUND') return { error: 'not-found' };
        if (err?.code === 'PERMISSION_DENIED') return { error: 'permission-denied' };
        throw err;
      }
    },

    async removeTask(args = {}) {
      const ts = tasksIn(args);
      if (!ts) return NO_CIRCLE;
      const [id] = await ts.removeItems([{ id: args.id }], by(args));
      return { id };
    },
  };
}

/** The ops `makeTasksOps` answers — what a household bot no longer routes to the separate tasks agent. */
export const TASKS_IN_CIRCLE_OPS = Object.freeze(['addTask', 'listOpen', 'listMine', 'claimTask', 'completeTask', 'reassignTask', 'editTask', 'removeTask']);
