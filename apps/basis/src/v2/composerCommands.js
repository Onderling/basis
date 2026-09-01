/**
 * composerCommands — the typed door, in every composer, filtered by what THIS place offers.
 *
 * The oldest affordance in the app: type `/`, see what you can do here, pick one. It is also the one the
 * architecture leans on hardest — *"every opId had to be able to be invoked by chat or an inline menu"* —
 * because a surface you can type is a surface a journey, a terminal client and an agent can drive too.
 *
 * ── Why this module exists (measured 2026-09-01) ─────────────────────────────────────────────────────
 * The model was already here (`commandSuggest.js`), and one of four composers used it. Web's circle
 * composer had the dropdown; mobile's circle composer dispatched five hardcoded builtins with no
 * dropdown at all; mobile's contact thread had a SECOND, hand-written `/skill args` path over the peer's
 * exposed skills; web's contact thread had nothing, so a `/` there was sent as chat text. One idea, four
 * different amounts of it.
 *
 * ── The filter is the point, not the dropdown ────────────────────────────────────────────────────────
 * "What can I do here" has a different answer per place, and each answer already exists:
 *
 *   CIRCLE   the circle's own catalogue — `scopeCatalogueToApps(filterCatalogue(...))`, i.e. the apps
 *            this circle composes and the features it has switched on. Offering an op the circle does
 *            not compose is how the attach menu once produced "I couldn't turn that into an action":
 *            the app blaming a person for its own configuration.
 *   CONTACT  what that PEER exposes to you — their A2A skill cards (`contactSkillsLive.skillsFor`). Not
 *            your ops: theirs. A bot is a contact, so this is also the answer for "what can this bot do".
 *
 * Both collapse to one list of `{command, hint, opId}`, so the suggest logic, the ranking and the
 * dispatch shape are written once and every composer paints the same thing.
 *
 * Pure: no DOM, no React, no transport. Each shell renders the list its own way and calls `dispatch`
 * with what the person typed.
 */
import { buildCommandPool, suggestCommands } from './commandSuggest.js';

/** A peer's exposed skill cards → the same row shape a manifest op produces. */
function poolFromSkills(skills) {
  return (Array.isArray(skills) ? skills : [])
    .filter((s) => s && typeof s.id === 'string' && s.id)
    .map((s) => ({ command: `/${s.id}`, hint: s.description || s.id, opId: s.id }))
    .sort((a, b) => a.command.localeCompare(b.command));
}

/**
 * @param {object} ctx
 * @param {'circle'|'contact'} ctx.kind
 * @param {object} [ctx.catalogue]  circle: the merged + per-circle scoped catalogue
 * @param {Array}  [ctx.skills]     contact: the peer's exposed skill cards
 * @returns {{kind: string, pool: Array<{command,hint,opId}>,
 *           suggest: (input: string, opts?: {limit?: number}) => Array<{command,hint,opId}>,
 *           parse: (text: string) => {opId: string, rest: string}|null}}
 */
export function createComposerCommands(ctx = {}) {
  const kind = ctx.kind === 'contact' ? 'contact' : 'circle';
  const pool = kind === 'contact' ? poolFromSkills(ctx.skills) : buildCommandPool(ctx.catalogue);

  return {
    kind,
    pool,
    /**
     * The ranked matches while the person is typing the command WORD. A circle asks the shared
     * `suggestCommands` (which reads the catalogue); a contact ranks its own pool the same way, so both
     * close the list the moment a space is typed and the person is into arguments.
     */
    suggest(input, { limit = 12 } = {}) {
      if (kind === 'circle') return suggestCommands(ctx.catalogue, input, { limit });
      const v = String(input ?? '');
      if (!v.startsWith('/') || v.includes(' ')) return [];
      const q = v.slice(1).toLowerCase();
      return pool.filter((e) => e.command.slice(1).toLowerCase().startsWith(q)).slice(0, limit);
    },
    /**
     * What a typed line means HERE, or null when it is not a command this place offers.
     *
     * Null is the load-bearing half: a `/` line that names nothing available must fall through to
     * ordinary chat rather than be refused, because in a conversation a slash is sometimes just a
     * slash — and refusing it would tell a person their sentence was wrong when it was the app's
     * configuration that was narrow.
     */
    parse(text) {
      const raw = String(text ?? '').trim();
      if (!raw.startsWith('/')) return null;
      const sp = raw.indexOf(' ');
      const command = sp === -1 ? raw : raw.slice(0, sp);
      const rest = sp === -1 ? '' : raw.slice(sp + 1).trim();
      const hit = pool.find((e) => e.command === command);
      return hit ? { opId: hit.opId, rest } : null;
    },
  };
}
