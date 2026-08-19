/**
 * basis-mobile — E3 record-panel auto-refresh orchestration.
 *
 * After a mutation changes an item, re-fetch every OPEN record /
 * mini-page / embed panel in OTHER threads that shows that item.  This
 * mirrors the web EventRouter's `onPanelStale` path (which excludes the
 * dispatching thread, since its reply already shows fresh state).
 *
 * Selection uses the shared `collectStalePanels` substrate (same
 * predicate + read-verb gate as the web side); re-running uses the
 * existing `refreshList` helper; the fresh render is handed back through
 * `applyRefresh(threadId, messageId, freshRendered)` so the caller owns
 * the React state update.
 */
import { collectStalePanels, REFRESHABLE_VERBS } from '@onderling-app/basis';
import { refreshList } from './refreshList.js';

/**
 * @param {object} args
 * @param {{app?: string, type?: string|null, id: string}} args.itemRef
 * @param {Array<{id: string, messages: Array<object>}>} args.threads  listThreads(state)
 * @param {string}  args.excludeThreadId   the dispatching thread (skipped)
 * @param {object}  args.catalogue
 * @param {object}  args.manifestsByOrigin
 * @param {Function} args.callSkill
 * @param {Function} args.t
 * @param {(threadId: string, messageId: string, fresh: object) => void} args.applyRefresh
 * @returns {Promise<number>} number of panels actually refreshed
 */
export async function autoRefreshStalePanels({
  itemRef, threads, excludeThreadId,
  catalogue, manifestsByOrigin, callSkill, t, applyRefresh,
}) {
  if (!itemRef || typeof applyRefresh !== 'function') return 0;
  const isRefreshable = (opId) => REFRESHABLE_VERBS.has(catalogue?.opsById?.get(opId)?.op?.verb);
  const stale = collectStalePanels(threads, { itemRef, excludeThreadId, isRefreshable });
  let refreshed = 0;
  for (const { threadId, message, sourceDispatch } of stale) {
    const fresh = await refreshList({ sourceDispatch, catalogue, manifestsByOrigin, callSkill, t });
    if (!fresh) continue;                       // re-run failed → keep the old panel
    if (message.rendered?.messageId) fresh.messageId = message.rendered.messageId;
    applyRefresh(threadId, message.id ?? message.rendered?.messageId, fresh);
    refreshed += 1;
  }
  return refreshed;
}
