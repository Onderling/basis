/**
 * acrossCircles — ONE projection for "my X across every circle I am in", for any item type: per circle the type's own
 * `list` (its bespoke op where the manifest declares one — `listOpen`, `listEvents` — else the generic store handler),
 * each row tagged with its circle, then filtered (mine or all), merged, sorted and capped by the type's presenter
 * (`itemPresenters.js`). It walks the circles' stores; it is not a second store (architecture: a circle owns ONE store;
 * reading across them is a projection). Messages are not read here: their entries are the render (the log projection).
 *
 * Pure composition: the circles, the manifests, the call and the generic handlers are handed in.
 */
import { dispatchCapability, resolveCapability } from '@onderling/app-manifest';
import { ITEM_PRESENTERS } from './itemPresenters.js';

/**
 * @param {object} a
 * @param {Array<{id: string, name?: string}>} a.circles   the circles in scope
 * @param {string} a.noun                                   a canonical item type
 * @param {Array<{appOrigin: string, manifest: object}>} a.manifests  where the noun's `list` may be declared
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill
 * @param {(circleId: string) => Record<string, Function>} [a.genericFor]  `createGenericAtomHandlers(store)` per circle
 * @param {'mine'|'all'} [a.scope='all']
 * @param {string|null} [a.me]   who "mine" means
 * @param {(row: object) => boolean} [a.filter]   a further filter (a window, a state)
 * @param {number} [a.limit=50]
 * @returns {Promise<{ok: true, items: object[], errors?: string[]}|{ok: false, reason: string, error?: string}>}
 */
export async function acrossCircles({ circles, noun, manifests, callSkill, genericFor = null, scope = 'all', me = null, filter = null, limit = 50, presenters = ITEM_PRESENTERS }) {
  const presenter = presenters[noun];
  if (!presenter) return { ok: false, reason: 'no-presenter' };
  const owner = (manifests ?? []).find((m) => resolveCapability(m.manifest, 'list', noun).kind !== 'none');
  if (!owner) return { ok: false, reason: 'no-list' };
  const errors = [];
  const buckets = await Promise.all((circles ?? []).map(async (c) => {
    try {
      const r = await dispatchCapability(owner.manifest, { atom: 'list', noun, args: { circleId: c.id } }, {
        dispatch: (opId, args) => callSkill(owner.appOrigin, opId, args),
        generic: typeof genericFor === 'function' ? genericFor(c.id) : {},
        ctx: { circleId: c.id },
      });
      if (!r?.ok) return [];
      const out = r.result;
      const rows = Array.isArray(out?.items) ? out.items : Array.isArray(out) ? out : [];
      return rows.map((row) => ({ ...row, circleId: c.id, circleName: c.name ?? '' }));
    } catch (err) { errors.push(String(err?.message ?? err)); return []; }   // one circle that does not answer does not empty the view
  }));
  let rows = buckets.flat();
  if (scope === 'mine') rows = rows.filter((r) => presenter.isMine(r, me));
  if (typeof filter === 'function') rows = rows.filter(filter);
  const sign = presenter.order === 'asc' ? 1 : -1;
  rows.sort((a, b) => sign * (presenter.when(a) - presenter.when(b)));
  // every circle failed: that is a failure, not an empty view (the caller says which)
  if (errors.length && errors.length === (circles ?? []).length) return { ok: false, reason: 'unreachable', error: errors[0] };
  return { ok: true, items: rows.slice(0, Math.max(0, limit)), ...(errors.length ? { errors } : {}) };
}
