/**
 * THE PERSON'S PAGES, EDITED THROUGH OPS. The screen book (one per device: the pages, their blocks, which page is
 * active) changes only through these verbs — a page added, renamed, removed or made active; a block added, removed,
 * moved or configured; the circles a page shows — so a button, a slash command and (later) a model reach the same
 * change, and every change can be seen and undone.
 *
 * Each change is KEPT as a version of the book (the store's `versions` adapter, the one the circle recipe, policy and
 * rules stores use) and WRITTEN to the device log as a settings change naming the op and the two versions it went
 * between — the log is what the person sees in their history; the version is what an undo puts back. An undo restores
 * the version before the newest change not undone yet, and is itself a logged change.
 *
 * The bodies are the pure book functions (`userScreens.js`) and block functions (`circleRecipe.js`); nothing here
 * re-implements them. A block the person's pages may not hold (the block table's `places`) is refused.
 */
import { addScreen, renameScreen, removeScreen, setActiveScreen, updateScreen, setAllCircles, ALL_CIRCLES } from './userScreens.js';
import { addBlock, removeBlock, moveBlock, updateBlock, blockTypesFor } from './circleRecipe.js';
import { makeAgentTrailEntry } from '../eventLog.js';

/** The op ids, as the basis manifest declares them. */
export const SCREEN_OP_IDS = Object.freeze([
  'screen-add-page', 'screen-remove-page', 'screen-rename-page', 'screen-set-active', 'screen-set-circles',
  'screen-add-block', 'screen-remove-block', 'screen-move-block', 'screen-set-block-config', 'screen-undo',
]);

const PAGE_PLACE = 'mij';
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * @param {object} a
 * @param {ReturnType<import('./userScreens.js').createUserScreenStore>|null} a.store   the shell's screen book store
 * @param {{append: Function, query: Function}|null} [a.log]   the device log
 * @param {string} [a.actor]   who acts (this device's person)
 * @returns {Record<string, (args: object) => Promise<object>>}
 */
export function createScreenOps({ store, log = null, actor = 'owner' } = {}) {
  const noStore = async () => ({ ok: false, error: 'no-screen-book' });
  if (!store || typeof store.updateVersioned !== 'function') {
    return Object.fromEntries(SCREEN_OP_IDS.map((id) => [id, noStore]));
  }
  const record = (op, version, ref = null) => {
    if (!log || typeof log.append !== 'function') return null;
    const entry = makeAgentTrailEntry({
      actor, op, kind: 'settings-change', target: { kind: 'screen-book', ref }, version, outcome: 'ok', via: 'owner',
    });
    if (entry) log.append(entry);
    return entry;
  };
  const hasPage = (book, pageId) => book.screens.some((s) => s.id === pageId);
  /** One change: checked against the current book, kept as a version, logged. */
  const change = async (op, check, mutator) => {
    const cur = await store.get();
    const refusal = check?.(cur);
    if (refusal) return { ok: false, error: refusal };
    const r = await store.updateVersioned(mutator);
    record(op, { previous: r.previous, current: r.current });
    return { ok: true, book: r.book };
  };
  const pageCheck = (pageId) => (book) => (hasPage(book, pageId) ? null : 'no-such-page');
  const onPage = (pageId, fn) => (book) => updateScreen(book, pageId, fn);

  return {
    'screen-add-page': async ({ name, circleIds } = {}) => {
      const filter = Array.isArray(circleIds) && circleIds.length ? circleIds.filter((c) => typeof c === 'string' && c) : ALL_CIRCLES;
      return change('screen-add-page', null, (book) => addScreen(book, str(name), filter));
    },
    'screen-remove-page': async ({ pageId } = {}) => change('screen-remove-page', pageCheck(pageId), (book) => removeScreen(book, pageId)),
    'screen-rename-page': async ({ pageId, name } = {}) => change('screen-rename-page', pageCheck(pageId), (book) => renameScreen(book, pageId, str(name))),
    'screen-set-active': async ({ pageId } = {}) => change('screen-set-active', pageCheck(pageId), (book) => setActiveScreen(book, pageId)),
    'screen-set-circles': async ({ pageId, circleIds } = {}) => change('screen-set-circles', pageCheck(pageId), onPage(pageId, (s) => (
      Array.isArray(circleIds) && circleIds.length
        ? { ...s, circleFilter: circleIds.filter((c) => typeof c === 'string' && c) }
        : setAllCircles(s)))),
    'screen-add-block': async ({ pageId, type, config } = {}) => change('screen-add-block', (book) => (
      !hasPage(book, pageId) ? 'no-such-page' : (blockTypesFor(PAGE_PLACE).includes(type) ? null : 'block-not-for-pages')
    ), onPage(pageId, (s) => addBlock(s, type, config && typeof config === 'object' ? config : null))),
    'screen-remove-block': async ({ pageId, blockId } = {}) => change('screen-remove-block', pageCheck(pageId), onPage(pageId, (s) => removeBlock(s, blockId))),
    'screen-move-block': async ({ pageId, blockId, index } = {}) => change('screen-move-block', pageCheck(pageId), onPage(pageId, (s) => moveBlock(s, blockId, Number(index)))),
    'screen-set-block-config': async ({ pageId, blockId, config } = {}) => change('screen-set-block-config', pageCheck(pageId), onPage(pageId, (s) => updateBlock(s, blockId, config && typeof config === 'object' ? config : {}))),
    /** Undo the newest page change not undone yet: its `previous` version comes back, and the undo is logged. */
    'screen-undo': async () => {
      if (!log || typeof log.query !== 'function') return { ok: false, error: 'no-history' };
      const entries = log.query({ filter: { type: 'settings-change' } })
        .filter((e) => typeof e?.payload?.op === 'string' && SCREEN_OP_IDS.includes(e.payload.op));
      const undone = new Set(entries.filter((e) => e.payload.op === 'screen-undo').map((e) => e.payload.target?.ref).filter(Boolean));
      const last = entries.find((e) => e.payload.op !== 'screen-undo' && !undone.has(e.id) && Number.isFinite(e.payload.version?.previous));
      if (!last) return { ok: false, error: 'nothing-to-undo' };
      const r = await store.restoreVersion(last.payload.version.previous);
      if (!r) return { ok: false, error: 'version-gone' };
      record('screen-undo', { previous: last.payload.version.current, current: r.current }, last.id);
      return { ok: true, book: r.book, undid: last.payload.op };
    },
  };
}
