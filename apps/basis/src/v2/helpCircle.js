/**
 * helpCircle — the default "help" circle + its sole member, the Onderling-bot (shared web + mobile).
 *
 * A brand-new user's first experience is a 1:1 chat with the Onderling-bot inside a
 * REAL circle, so they learn "a bot is just a member you talk to" before meeting it as
 * machinery. This module is the shared, pure definition of that system circle:
 *   - its id + name spec (name via t(), so it's localised chrome),
 *   - the Onderling-bot member descriptor (relation:'agent' → `oneToOneBotLabel` lights
 *     the assistant-header strip; `isBot` covers hosts that read that marker instead),
 *   - the circle's fixed roster (you + the bot — a genuine 1:1 with a bot), and
 *   - `provisionHelpCircle`, an idempotent orchestrator that creates the circle + adds
 *     the bot THROUGH host-injected accessors (the real create/add path), guarded so it
 *     never double-provisions.
 *
 * The membership of a SYSTEM circle is a constant of the product, not user data, so the
 * roster is defined here rather than discovered — both shells render the same 1:1 by
 * construction. No DOM, no storage, no network: the host injects everything.
 */

/** The stable id of the default help circle. */
export const HELP_CIRCLE_ID = 'cc-help';

/** The stable WebID of the Onderling-bot (the help circle's sole non-you member). */
export const ONDERLING_BOT_WEBID = 'urn:onderling:bot';

/**
 * The Onderling-bot member row. `relation:'agent'` is the MemberMap marker for an
 * LLM-backed peer — the SAME marker `oneToOneBotLabel` / the circle-enforcement gate
 * read — so this row makes the help circle a genuine 1:1-with-a-bot chat. `isBot` is
 * carried too for hosts that key off that instead of `relation`.
 *
 * @param {string} [name]  the bot's display name (defaults to 'Onderling'); pass a
 *                         localised label when the host has a t().
 */
export function onderlingBotMember(name = 'Onderling') {
  return {
    webid: ONDERLING_BOT_WEBID,
    id: ONDERLING_BOT_WEBID,
    name,
    displayName: name,
    label: name,
    relation: 'agent',
    isBot: true,
    role: 'member',
  };
}

/**
 * The help circle spec (id + DISPLAY name). The name is the circle's own title (the
 * launcher tile + circle header) and goes through the host's `t()` (localised chrome),
 * falling back to 'Uitleg' when no translator is wired. This is DELIBERATELY not the
 * bot's name ('Onderling', `circle.onboarding.help_name`): the circle is named after its
 * purpose so the header never falls back to the raw id ('cc-help'), and so the app, the
 * bot, and the circle don't all read 'Onderling'.
 * @param {Function} [t]
 */
export function helpCircleSpec(t) {
  const tr = typeof t === 'function' ? t : null;
  const name = tr ? tr('circle.help.circle_name') : 'Uitleg';
  return { id: HELP_CIRCLE_ID, name: name || 'Uitleg' };
}

/**
 * The help circle's fixed roster: you + the Onderling-bot. Feeding this to
 * `oneToOneBotLabel({ members, selfWebid })` returns the bot's label (a 1:1 with a bot),
 * so the assistant-header strip shows. A system circle's membership is a product
 * constant, so it's defined here rather than fetched.
 *
 * @param {object}  [args]
 * @param {string}  [args.selfWebid]  the viewer's own webid (the "you" member)
 * @param {string}  [args.botName]    the bot's display name
 * @returns {Array<object>} `[you, onderlingBot]`
 */
export function helpCircleRoster({ selfWebid = null, botName = 'Onderling' } = {}) {
  return [
    { webid: selfWebid || 'urn:onderling:self', relation: 'group-member', role: 'member' },
    onderlingBotMember(botName),
  ];
}

/**
 * Provision the help circle once, idempotently. Skips when the marker is already set OR
 * the circle already exists (marking the marker in that case so it's a one-time cost),
 * otherwise creates the circle + adds the bot via the injected real accessors and then
 * sets the marker. All effects go through host-injected functions — this is pure
 * orchestration, so it's fully unit-testable and never double-provisions.
 *
 * @param {object} deps
 * @param {() => (boolean|Promise<boolean>)}       [deps.isProvisioned]   the persisted marker
 * @param {() => (string[]|Promise<string[]>)}     [deps.listCircleIds]   ids of the user's existing circles
 * @param {(spec:{id,name}) => (any|Promise<any>)} [deps.createHelpCircle] create the circle (real create path)
 * @param {(a:{circleId,bot}) => (any|Promise<any>)} [deps.addBotMember]   add the bot member (real add path)
 * @param {() => (void|Promise<void>)}             [deps.markProvisioned]  persist the marker
 * @param {{id:string,name:string}}                [deps.spec]            defaults to `helpCircleSpec()`
 * @param {object}                                 [deps.bot]             defaults to `onderlingBotMember()`
 * @returns {Promise<{provisioned:boolean, reason?:string}>}
 */
export async function provisionHelpCircle({
  isProvisioned,
  listCircleIds,
  createHelpCircle,
  addBotMember,
  markProvisioned,
  spec = helpCircleSpec(),
  bot = onderlingBotMember(),
} = {}) {
  if (await isProvisioned?.()) return { provisioned: false, reason: 'marker' };

  const ids = (await listCircleIds?.()) ?? [];
  if (Array.isArray(ids) && ids.includes(spec.id)) {
    await markProvisioned?.();
    return { provisioned: false, reason: 'exists' };
  }

  await createHelpCircle?.(spec);
  await addBotMember?.({ circleId: spec.id, bot });
  await markProvisioned?.();
  return { provisioned: true };
}
