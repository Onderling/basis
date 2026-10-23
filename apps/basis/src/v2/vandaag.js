/**
 * VANDAAG — the home: the person's own pages (the screen book), opened on one page of a few capped blocks of what
 * matters today. Both shells seed the same first page from here, once, when the book is still empty: the coming week's
 * appointments across every circle, the person's own open tasks, and the circles with news.
 *
 * The seed is the first-run default, not an edit: it is written straight into the book (not through the screen ops),
 * so it is not in the history and an undo never takes it away; every change after it goes through the ops.
 */
import { addScreen, updateScreen, setActiveScreen, getActiveScreen } from './userScreens.js';
import { addBlock, BLOCK_DESCRIPTORS, blockTypesFor } from './circleRecipe.js';
import { carriesLabels, parseLabels } from './itemLabels.js';
import { PLANNED_HORIZON_DAYS } from './plannedForMe.js';

/** The first page's blocks, in order: what is on today, what is mine to do, where something is new. */
export const VANDAAG_DEFAULT_BLOCKS = Object.freeze([
  // the first steps (handle · what Basis is · begin): the cards go as each is done, then the block shows nothing
  Object.freeze({ type: 'onboarding', config: Object.freeze({}) }),
  // the week ahead across every circle and my own: Gepland's twin when opened whole ("meer"), by the same window
  Object.freeze({ type: 'calendar', config: Object.freeze({ horizonDays: PLANNED_HORIZON_DAYS, limit: 5 }) }),
  Object.freeze({ type: 'tasks', config: Object.freeze({ scope: 'assigned-to-me', limit: 5 }) }),
  Object.freeze({ type: 'circlesUnread', config: Object.freeze({ limit: 5 }) }),
]);

/**
 * The book, seeded with the first Vandaag page when it has none.
 * @param {object} a
 * @param {{get: Function, update: Function}} a.store   the shell's screen book store
 * @param {(key: string) => string} a.t
 * @returns {Promise<object>} the book
 */
export async function ensureVandaagBook({ store, t }) {
  const book = await store.get();
  if (book.screens.length > 0) return book;
  return store.update((cur) => {
    let next = addScreen(cur, t('circle.screens.vandaag_page'));
    const id = next.screens[next.screens.length - 1].id;
    for (const b of VANDAAG_DEFAULT_BLOCKS) next = updateScreen(next, id, (s) => addBlock(s, b.type, { ...b.config }));
    return setActiveScreen(next, id);
  });
}

/** How many rows a block opened whole shows ("meer"). */
export const EXPANDED_LIMIT = 100;

/**
 * One block of a page, opened whole: the page with only that block, its cap lifted. Both shells paint "meer" with it.
 * @param {object} screen   a page of the book
 * @param {string} blockId
 * @returns {object|null}   a page to materialize, or null when the block is not on it
 */
export function expandedPage(screen, blockId) {
  const block = (screen?.blocks ?? []).find((b) => b.id === blockId);
  if (!block) return null;
  // whole: the cap lifted, and no date window (a notes block's "recent" is the page's; opened, it is every note)
  return { ...screen, blocks: [{ ...block, config: { ...(block.config ?? {}), limit: EXPANDED_LIMIT, ...(block.type === 'notes' ? { withinDays: 0 } : {}) } }] };
}

/**
 * The horizon presets a calendar block offers ("pas aan"): today · 3 days · this week · this month. The time ranges
 * speak ONE label set (`range_*`): the "within" presets below are these same words, plus "any time".
 */
export const HORIZON_PRESETS = Object.freeze([
  Object.freeze({ value: 1, labelKey: 'circle.vandaag.range_today' }),
  Object.freeze({ value: 3, labelKey: 'circle.vandaag.range_3days' }),
  Object.freeze({ value: 7, labelKey: 'circle.vandaag.range_week' }),
  Object.freeze({ value: 30, labelKey: 'circle.vandaag.range_month' }),
]);
/** The caps a block offers. */
export const LIMIT_PRESETS = Object.freeze([3, 5, 10]);
/** The relative-date presets ("within"): any time, then the horizon's own ranges. */
export const WITHIN_PRESETS = Object.freeze([
  Object.freeze({ value: 0, labelKey: 'circle.vandaag.range_any' }),
  ...HORIZON_PRESETS,
]);
/** The heading over each control in the customise sheet, so a row of chips says what it sets. */
export const CONTROL_TITLES = Object.freeze({
  horizonDays: 'circle.vandaag.control_horizon',
  scope:       'circle.vandaag.control_scope',
  limit:       'circle.vandaag.control_limit',
  circleIds:   'circle.vandaag.circles_title',
  labels:      'circle.vandaag.labels_title',
  withinDays:  'circle.vandaag.control_within',
});
/** The blocks that show circles' contents, so may narrow to some of the page's circles. */
const CIRCLE_AWARE = new Set(['noticeboard', 'calendar', 'tasks', 'notes', 'circlesUnread']);
const SCOPE_OPTIONS = Object.freeze([
  Object.freeze({ value: 'assigned-to-me', labelKey: 'circle.vandaag.scope_mine' }),
  Object.freeze({ value: 'all', labelKey: 'circle.vandaag.scope_all' }),
]);

/**
 * "PAS AAN" — what the customise sheet shows for the active page, the same on both shells (they only paint it): its
 * blocks in order with the controls each block's config takes, the blocks that can be added (the block table's own,
 * for the person's pages, with their sentence), and the page acts. Every control is a screen op (`controlOp`).
 * @param {object} book
 * @returns {object|null}
 */
export function customiseModel(book, { circles = [] } = {}) {
  const page = getActiveScreen(book);
  if (!page) return null;
  const blocks = page.blocks ?? [];
  // the circles a block may narrow to: the page's own (all the person's, unless the page picked some)
  const pageCircles = (Array.isArray(page.circleFilter) && page.circleFilter.length
    ? circles.filter((c) => page.circleFilter.includes(c.id)) : circles)
    .filter((c) => c?.id).map((c) => ({ value: c.id, label: c.name ?? c.id }));
  return {
    pageId: page.id,
    pageName: page.name ?? '',
    canRemovePage: (book.screens ?? []).length > 1,
    blocks: blocks.map((b, i) => {
      const cfg = b.config ?? {};
      const controls = [];
      if (b.type === 'calendar') controls.push({ kind: 'horizonDays', value: cfg.horizonDays ?? 14, options: HORIZON_PRESETS });
      if (b.type === 'tasks') controls.push({ kind: 'scope', value: cfg.scope ?? 'assigned-to-me', options: SCOPE_OPTIONS });
      if ('limit' in cfg) controls.push({ kind: 'limit', value: cfg.limit, options: LIMIT_PRESETS.map((n) => ({ value: n, labelKey: 'circle.vandaag.limit_n', params: { n } })) });
      // the filters (Frits: "filters like labels and (relative) dates"): the block's own circles, its labels on a type
      // that carries them, a relative date on the types listed by their moment
      if (CIRCLE_AWARE.has(b.type) && pageCircles.length > 1) controls.push({ kind: 'circleIds', multi: true, value: Array.isArray(cfg.circleIds) ? cfg.circleIds : [], options: pageCircles });
      const noun = BLOCK_DESCRIPTORS[b.type]?.noun;
      if (noun && carriesLabels(noun)) controls.push({ kind: 'labels', text: true, value: (Array.isArray(cfg.labels) ? cfg.labels : []).join(', ') });
      if (b.type === 'tasks' || b.type === 'notes') controls.push({ kind: 'withinDays', value: Number(cfg.withinDays) || 0, options: WITHIN_PRESETS });
      return {
        blockId: b.id, type: b.type, labelKey: BLOCK_DESCRIPTORS[b.type]?.labelKey ?? b.type,
        canUp: i > 0, canDown: i < blocks.length - 1, index: i,
        controls: controls.map((c) => ({ ...c, titleKey: CONTROL_TITLES[c.kind] })),
      };
    }),
    addable: blockTypesFor('mij').map((type) => ({ type, labelKey: BLOCK_DESCRIPTORS[type].labelKey, descriptionKey: BLOCK_DESCRIPTORS[type].descriptionKey })),
  };
}

/**
 * The op a customise control is: `{ opId, args }` for `callSkill('basis', opId, args)` — the one door every edit of the
 * person's pages goes through.
 * @param {string} act   'up' | 'down' | 'remove' | 'config' | 'add' | 'rename-page' | 'add-page' | 'remove-page' | 'undo'
 * @param {object} a
 * @returns {{opId: string, args: object}}
 */
export function customiseOp(act, { pageId, blockId, index, kind, value, type, name } = {}) {
  switch (act) {
    case 'up': return { opId: 'screen-move-block', args: { pageId, blockId, index: index - 1 } };
    case 'down': return { opId: 'screen-move-block', args: { pageId, blockId, index: index + 1 } };
    case 'remove': return { opId: 'screen-remove-block', args: { pageId, blockId } };
    case 'config': return { opId: 'screen-set-block-config', args: { pageId, blockId, config: { [kind]: kind === 'labels' ? parseLabels(value) : value } } };
    case 'add': return { opId: 'screen-add-block', args: { pageId, type } };
    case 'rename-page': return { opId: 'screen-rename-page', args: { pageId, name } };
    case 'add-page': return { opId: 'screen-add-page', args: { name } };
    case 'remove-page': return { opId: 'screen-remove-page', args: { pageId } };
    case 'undo': return { opId: 'screen-undo', args: {} };
    default: throw new Error(`customiseOp: unknown act "${act}"`);
  }
}
