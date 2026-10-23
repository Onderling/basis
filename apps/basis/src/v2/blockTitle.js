/**
 * A screen block's title and its empty line, the same on both shells.
 *
 * The title is what the person calls the block: its own (`titleKey`, e.g. Mij's "Mijn agenda"), a projected list's
 * noun ("Notes", "Appointments"), else the block kind's declared name ("Agenda", "Tasks"). It is never the block's
 * TYPE — an empty generic list used to say "items: nothing to show here yet".
 *
 * An empty block is ONE quiet line under that title, in the block's own words: the agenda has "nothing planned",
 * a task list "nothing open", anything else "nothing yet".
 */
import { nounHeading } from './nounNames.js';

/** The block kinds with a declared name (`circle.recipe.block.<type>`). */
const NAMED = new Set(['quickActions', 'announcement', 'noticeboard', 'calendar', 'tasks', 'rules', 'photo', 'text',
  'circlesUnread', 'identityLine', 'agents', 'notes', 'onboarding', 'awaiting']);

/** What the empty line says, by kind (the others: "nothing yet"). */
const EMPTY_KEY = { calendar: 'circle.screen.block_empty_planned', tasks: 'circle.screen.block_empty_open', circlesUnread: 'circle.screen.block_empty_news', awaiting: 'circle.screen.block_empty_awaiting' };
/** …and a projected list says what its noun's kind would (the agenda's appointments, a task list's tasks). */
const EMPTY_KEY_BY_NOUN = { 'calendar-event': EMPTY_KEY.calendar, task: EMPTY_KEY.tasks };

/**
 * @param {{type: string, titleKey?: string, content?: {noun?: string}}} block   a materialised block
 * @param {(key: string, vars?: object) => string} t
 * @returns {string}
 */
export function blockTitle(block, t) {
  if (block?.titleKey) return t(block.titleKey);
  const noun = block?.content?.noun;
  if (block?.type === 'items' && typeof noun === 'string' && noun) return nounHeading(t, noun);
  if (NAMED.has(block?.type)) return t(`circle.recipe.block.${block.type}`);
  return t('circle.screen.block_untitled');
}

/**
 * Whether a block on the person's pages offers "meer" (open it whole): a block with rows does; the onboarding strip
 * does not — its cards are the whole of it, and a "more" under them reads as a second "Lees meer".
 */
export function blockOpensWhole(block) {
  return block?.status === 'ok' && block?.type !== 'onboarding';
}

/** The one quiet line an empty block shows. */
export function blockEmptyLine(block, t) {
  const key = EMPTY_KEY[block?.type] ?? (block?.type === 'items' ? EMPTY_KEY_BY_NOUN[block?.content?.noun] : null) ?? 'circle.screen.block_empty';
  return t(key, { title: blockTitle(block, t) });
}
