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
import { parseSlash } from '../parser.js';
import { mergeManifests } from '../manifestMerge.js';
import { basisManifest } from '../../manifest.js';

/**
 * basis's OWN commands — the device's, not the circle's.
 *
 * A circle's catalogue is scoped to the apps it composes (`DEFAULT_CIRCLE_ORIGINS`), which deliberately
 * excludes basis so the bot's LLM cannot pick `/me` out of a hundred ops. That scope is right for the
 * LLM and wrong for a person's own typing: `/whoami`, `/logs`, `/transports` and the rest are things
 * this DEVICE does, and they are equally true in every circle, in a contact thread, and with no circle
 * at all. So they ride alongside whatever the place offers rather than being scoped by it.
 *
 * Built once from the manifest — the same declarations `/help` prints and the Advanced drawer lists.
 */
const BASIS_CATALOGUE = mergeManifests([{ manifest: basisManifest }]);
const BASIS_POOL = buildCommandPool(BASIS_CATALOGUE);

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
  // A circle offers what it composes, THEN what this device can do. The place wins a collision — a
  // circle that declares `/help` means its own help, and a command that changed meaning under someone
  // because a device op shared its name would be the worst kind of surprise.
  const placePool = kind === 'contact' ? poolFromSkills(ctx.skills) : buildCommandPool(ctx.catalogue);
  const taken = new Set(placePool.map((e) => e.command));
  const pool = kind === 'contact'
    ? placePool
    : [...placePool, ...BASIS_POOL.filter((e) => !taken.has(e.command))];

  return {
    kind,
    pool,
    /**
     * The ranked matches while the person is typing the command WORD. A circle asks the shared
     * `suggestCommands` (which reads the catalogue); a contact ranks its own pool the same way, so both
     * close the list the moment a space is typed and the person is into arguments.
     */
    suggest(input, { limit = 12 } = {}) {
      const v = String(input ?? '');
      if (!v.startsWith('/') || v.includes(' ')) return [];
      const q = v.slice(1).toLowerCase();
      // Ranked by the shared `suggestCommands` where the place has a catalogue, then topped up from the
      // device's own commands — one list, in the order "what is here, then what I can always do".
      const ranked = kind === 'circle' && ctx.catalogue
        ? suggestCommands(ctx.catalogue, input, { limit })
        : [];
      const seen = new Set(ranked.map((e) => e.command));
      const rest = pool.filter((e) => !seen.has(e.command) && e.command.slice(1).toLowerCase().startsWith(q));
      return [...ranked, ...rest].slice(0, limit);
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
      if (!hit) return null;
      // ARGS, where the declaration says how to read them. `parseSlash` applies the op's own `body`
      // rule (`flags` → `--key=value` + positionals, `argline` → the whole line), which is the same
      // reading the chat shell has always done — so `/block alice` and `/logs --app=stoop` mean here
      // exactly what they meant there. A shell that only got `rest` had to re-invent that per command,
      // which is how five hand-parsed builtins came to be the only typeable ops.
      const cat = hit.appOrigin === 'basis' ? BASIS_CATALOGUE : ctx.catalogue;
      const parsed = cat ? parseSlash(raw, cat) : null;
      return {
        opId: hit.opId,
        appOrigin: hit.appOrigin ?? parsed?.appOrigin ?? null,
        args: parsed?.kind === 'slash' ? parsed.args : {},
        rest,
      };
    },
  };
}
