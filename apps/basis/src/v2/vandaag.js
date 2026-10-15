/**
 * VANDAAG — the home: the person's own pages (the screen book), opened on one page of a few capped blocks of what
 * matters today. Both shells seed the same first page from here, once, when the book is still empty: the coming week's
 * appointments across every circle, the person's own open tasks, and the circles with news.
 *
 * The seed is the first-run default, not an edit: it is written straight into the book (not through the screen ops),
 * so it is not in the history and an undo never takes it away; every change after it goes through the ops.
 */
import { addScreen, updateScreen, setActiveScreen } from './userScreens.js';
import { addBlock } from './circleRecipe.js';

/** The first page's blocks, in order: what is on today, what is mine to do, where something is new. */
export const VANDAAG_DEFAULT_BLOCKS = Object.freeze([
  Object.freeze({ type: 'calendar', config: Object.freeze({ horizonDays: 7, limit: 5 }) }),
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
