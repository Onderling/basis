/**
 * listsOps — the composable lists' handlers, once.
 *
 * The ops are declared in `apps/lists/manifest.js` and MOUNTED on the agent's waist by whichever shell is
 * running (`agent.mountAppOps('lists', …)`), because the service is per-circle: it holds the circle's own
 * `CircleItemStore`, which only a live composition has. What must NOT be per-shell is the behaviour — a
 * copy in `circleApp.js` and another in `CircleLauncherScreen.js` is the drift this repo spends its guards
 * on, and it is what "a shell does composition and paint, nothing else" forbids. So the shells inject
 * their seams (which store, which translator, who is acting) and this decides what the ops mean.
 *
 * A list lives in the circle's own store, like a task or a message, so it rides the one fan-out path and
 * obeys the circle's data-move branch. Nothing here knows about sharing; that is the point.
 */
import { makeCircleLists } from '@onderling/kring-host/circleLists';

/**
 * @param {object} a
 * @param {(circleId: string) => object} a.storeFor   the circle's own CircleItemStore
 * @param {(k: string, vars?: object) => string} a.t  locale resolver
 * @param {() => string|null} a.activeCircle  the circle a call means when it does not name one
 * @param {string} [a.localActor]
 * @returns {Record<string, (args: object) => Promise<object>>} opId → handler
 */
export function makeListsOps({ storeFor, t, activeCircle, localActor = 'me' } = {}) {
  const svc = makeCircleLists({ storeFor });
  // A call names its circle, or means the one the person is looking at. Named wins: an agent or a
  // journey acts on a circle it is not "in", and must be able to say which.
  const circleOf = (args) => args?.circleId ?? activeCircle?.() ?? null;

  /** A person types a list's NAME; an id is what the app uses. Accept either. */
  const findList = async (circleId, ref) => {
    const containers = await svc.listContainers(circleId);
    return containers.find((c) => c.id === ref)
      ?? containers.find((c) => String(c.text ?? '').toLowerCase() === String(ref).toLowerCase())
      ?? null;
  };

  return {
    createList: async (args) => {
      const circleId = circleOf(args);
      const text = String(args?.text ?? '').trim();
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      if (!text) return { ok: false, error: t('circle.lists.need_name') };
      const made = await svc.createList(circleId, text, localActor);
      return { ok: true, itemId: made?.id ?? null, message: t('circle.lists.made', { name: text }) };
    },

    addToList: async (args) => {
      const circleId = circleOf(args);
      const text = String(args?.text ?? '').trim();
      const ref = String(args?.list ?? '').trim();
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      if (!text || !ref) return { ok: false, error: t('circle.lists.need_list_and_text') };
      const target = await findList(circleId, ref);
      if (!target) return { ok: false, error: t('circle.lists.no_such_list', { name: ref }) };
      // WHICH KIND of child is the container's `accepts` policy's decision, not this handler's: `hint`
      // names one of the kinds that container accepts, and absent it the policy's default child wins.
      const kind = String(args?.kind ?? '').trim() || undefined;
      const made = await svc.addItem(circleId, target.id, text, localActor, kind ? { hint: kind } : undefined);
      if (!made) return { ok: false, error: t('circle.lists.not_accepted', { name: target.text ?? ref }) };
      return {
        ok: true, itemId: made.id ?? null,
        message: t('circle.lists.added', { text, name: target.text ?? ref }),
      };
    },

    listLists: async (args) => {
      const circleId = circleOf(args);
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      const containers = await svc.listContainers(circleId);
      return { ok: true, items: containers.map((c) => ({ id: c.id, label: c.text ?? c.id, type: c.type })) };
    },

    markListItemDone: async (args) => {
      const circleId = circleOf(args);
      const itemId = String(args?.itemId ?? '').trim();
      if (!circleId) return { ok: false, error: t('circle.lists.no_circle') };
      if (!itemId) return { ok: false, error: t('circle.lists.need_item') };
      await svc.markDone(circleId, itemId, localActor);
      return { ok: true, message: t('circle.lists.done') };
    },

    /** The service itself, for a screen that projects containers (a read, not a second write path). */
    _service: svc,
  };
}

export default makeListsOps;
