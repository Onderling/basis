/**
 * mijOverview — "Mijn overzicht" on the Mij tab: my chores across every circle ("Mijn dingen") and the appointments
 * of every circle I am in beside my own ("Mijn agenda"). These are the two blocks the screens book seeds; the Mij tab
 * shows them without that book around them — nothing to rename, delete, activate or add to. Declared once here,
 * materialized through the one screen materializer (`materializeScreen` → the cross-circle `items` block), and painted
 * by each shell's own block painter. The circles are the list Gepland reads (`myCircles`).
 */
import { materializeScreen } from './userScreenBlocks.js';
import { myCircles } from './plannedForMe.js';

/** The section's title on the Mij tab. */
export const MIJ_OVERVIEW_TITLE_KEY = 'circle.profile.overview_title';

/** The blocks the Mij overview shows, in order; each names its own title (the words the screens book seeds them with). */
export const MIJ_OVERVIEW_BLOCKS = Object.freeze([
  Object.freeze({ id: 'mij-my-things', type: 'items', titleKey: 'circle.screens.seed_my_things', config: Object.freeze({ noun: 'task', scope: 'mine' }) }),
  Object.freeze({ id: 'mij-my-agenda', type: 'items', titleKey: 'circle.screens.seed_my_calendar', config: Object.freeze({ noun: 'calendar-event', scope: 'all' }) }),
]);

/**
 * Materialize the overview's blocks for the person.
 * @param {object} a
 * @param {(app: string, op: string, args: object) => Promise<any>} a.callSkill   the shell's targeted call (as the person)
 * @param {string|null} [a.me]   who "mine" means (the person's id as their chores name them)
 * @returns {Promise<Array<object>>}   materialized blocks (`{blockId, type, status, content}`), each with its `titleKey`
 */
export async function mijOverviewBlocks({ callSkill, me = null } = {}) {
  try {
    const circles = typeof callSkill === 'function' ? await myCircles(callSkill) : [];
    const screen = { id: 'mij-overview', name: '', circleFilter: null,
      blocks: MIJ_OVERVIEW_BLOCKS.map((b) => ({ id: b.id, type: b.type, config: { ...b.config } })) };
    const blocks = await materializeScreen({ screen, hostOps: { callSkill, myWebid: me, circles } });
    return blocks.map((b, i) => ({ ...b, titleKey: MIJ_OVERVIEW_BLOCKS[i].titleKey }));
  } catch (err) {
    // never a missing section: each block says it could not load, under its own title
    return MIJ_OVERVIEW_BLOCKS.map((b) => ({ blockId: b.id, type: b.type, status: 'error', content: {}, error: String(err?.message ?? err), titleKey: b.titleKey }));
  }
}
