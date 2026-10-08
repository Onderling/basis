/**
 * The runner for ONE circle a household bot joined — the same runner and engine as its private doors, composed with the
 * circle's own things: the circle's lists (their names in the model's lines and the word rules), retrieval over that
 * circle only, a call pinned to that circle (`doorCircleId`, which the agent's door pin follows), and a memory that is
 * the circle's. What a circle never gets: the door's own ops (reminders, the week's overview, a person's settings, the
 * admin's book, exports, screens) — they are not in its catalogue, so a line can neither be routed to them nor named.
 */
import { createTelegramRunner } from './runner.js';
import { createBotThreads, memoryThreadStore } from '../v2/botThreads.js';
import { EventLog } from '../eventLog.js';
import { loadListItems, promptLinesForLists } from '../v2/householdTemplate.js';
import { listsGateRules } from '../v2/circleGate.js';
import { scopeCatalogueToRole, roleHintsFor } from '../v2/botOpMap.js';
import { circleCallerActor } from '../v2/circleDoor.js';

/** What the model is told about a circle beside its lists. LLM-facing. */
const CIRCLE_LINES = Object.freeze([
  'Dit gesprek is een KRING waar de bot lid van is: wat je doet, doe je in de lijsten van deze kring.',
  'Herinneringen, het weekoverzicht en persoonlijke instellingen bestaan in een kring niet; die regelt ieder in zijn eigen gesprek met de bot. Zeg dat als erom gevraagd wordt.',
]);

/**
 * A circle's lists as the template functions read them.
 * @param {(app: string, op: string, args: object) => Promise<any>} hostCall  the bot's own call, in that circle
 */
export async function circleLists(hostCall) {
  const r = await hostCall('lists', 'listLists', {}).catch(() => null);
  const items = Array.isArray(r?.items) ? r.items : [];
  return items.map((l) => ({ name: l.label ?? l.text ?? l.title ?? '', kind: l.kind ?? 'list', defaultChild: l.defaultChild ?? null, aliases: [] })).filter((l) => l.name);
}

/**
 * @param {object} a
 * @param {string} a.circleId
 * @param {object} a.bridge      the circle's door bridge (`circleDoor.js`)
 * @param {(callerId: string) => string|null} a.roleOf  the member's role in this circle
 * @param {(app: string, op: string, args: object, ctx?: object) => Promise<any>} a.agentCall  the door's call (on the box
 *        `withAssistantOps` over the agent: the assistant's own ops are refused there for a circle's call)
 * @param {{catalogue: () => object, manifestsByOrigin: () => object}} a.catalogue  the circle catalogue (no door ops)
 * @param {Function} a.t
 * @param {string} [a.lang]
 * @param {object|null} [a.llm]
 * @param {Function|null} [a.interpret]
 * @param {Function|null} [a.expand]
 */
export async function composeCircleRunner({ circleId, bridge, roleOf, agentCall, catalogue, t, lang = 'nl', llm = null, interpret = null, expand = null }) {
  const hostCall = (app, op, args = {}) => agentCall(app, op, { ...args, circleId });
  const lists = await circleLists(hostCall);
  // the circle's memory: kept for the process, never on the device log (the box forgets a circle it leaves); a circle
  // has no welcome — the bot is a member there, not a new chat
  const base = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  const threads = { ...base, greeted: () => true, markGreeted: () => {} };
  const runner = createTelegramRunner({
    bridge,
    catalogue: catalogue.catalogue,
    manifestsByOrigin: catalogue.manifestsByOrigin,
    t, lang,
    // a person's call runs in this circle (the gate's circle-scoped caller, acting as their own ref), through the door's
    // call — which refuses the assistant's own ops for a circle — and the agent's door gate (their circle role's tier)
    callSkill: (app, op, args, ctx) => agentCall(app, op, args, { ...ctx, doorCircleId: circleId, doorActor: circleCallerActor(ctx?.caller, circleId) }),
    // the circle door only feeds its members (it read the roster): the sender is the caller
    admit: async ({ uid }) => (roleOf(uid) ? uid : { refused: 'not-a-member' }),
    threads,
    loadItems: loadListItems({ callSkill: hostCall }),
    ...(llm ? { llm, interpret } : {}),
    promptLines: [...promptLinesForLists(lists), ...CIRCLE_LINES],
    roleFor: (threadId) => roleOf(threadId),
    scopeToRole: scopeCatalogueToRole,
    hintsFor: (threadId) => roleHintsFor(roleOf(threadId), t),
    ...(typeof expand === 'function' ? { expand } : {}),
    // a circle has no door ops, so no greeting op: a greeting there stays the model's
    gateRules: listsGateRules(lang, lists, { greeting: false }),
  });
  return { ...runner, lists: lists.map((l) => l.name) };
}
