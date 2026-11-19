/**
 * The person's own "+" as a CONVERSATION with their own assistant: one door both shells call with the line.
 *
 * Per line, in this order:
 *   1. help ("help", "?", a how-to question a help card knows): answered in the thread;
 *   2. the plain reading (`plusLineOutcome`): an own act, an own list's phrase, a circle's phrase. No model is asked;
 *   3. only then the person's OWN model (their settings' route; none set: no model, the line goes nowhere), through
 *      the one assistant composition (`createAssistantEngine`), asked with the catalogue of the OWN place only (the
 *      ops declared to be offered there) and this thread's last turns. It may answer in words or propose an act.
 *
 * Nothing the model proposes happens without the person's yes: an own act opens its form filled, and Save is the yes
 * (the door's dispatch never calls a store). The line and what the door answered are kept in the thread afterwards, so
 * the next turn reaches the model with this one.
 *
 * Every read returns ONE shape, what both shells paint and `plusAnswerLine` words:
 *   `{ done }` the answer in words · `{ actId, values }` an own act's form, filled · `{ card }` the which-circle card ·
 *   `{ error }` what went wrong or could not be read (a circle act run at once answers `{done}` or `{error}` too).
 */
import { createAssistantEngine } from '../v2/assistantEngine.js';
import { modelDownClass } from '../v2/modelWatch.js';
import { createLastReads } from '../v2/lastRead.js';
import { composeAssistantCatalogue } from './assistantCatalogue.js';
import { catalogueManifests } from '../v2/manifestSources.js';
import { withAssistantOps } from '../v2/assistantOps.js';
import { assistantManifest } from '../v2/assistantManifest.js';
import { opScopes, verbKind, isPeopleWritten, opWeight } from '@onderling/app-manifest';
import { PLUS_CEILINGS } from '@onderling/agent-registry';
import { OWN_DEVICES_SCOPE } from '../v2/grantsManifest.js';
import { makeOpAvailability } from '../v2/opAvailability.js';
import { ownPlacePolicy } from '../v2/circlePolicy.js';
import { plusIntro, plusNews, plusHelp, plusNearest, readPlusTold, writePlusTold } from '../v2/plusIntro.js';
import { HELP_CIRCLE_ID } from '../v2/helpCircle.js';
import { plusSuggestionPool } from '../v2/vandaagPlus.js';
import { PLUS_ACTS, plusLineOutcome, plusHelpAnswer, actRunsAtOnce, plusDoneLine, plusLabel, plusSuggest, NO_OWN_LIST } from '../v2/vandaagPlus.js';
import { plusAnswerLine, plusThreadId, PLUS_TURNS_SHOWN } from '../v2/plusThread.js';
import { interpretToCommand } from '../v2/interpretCommand.js';
import { listsGateRules } from '../v2/circleGate.js';
import { renderGate } from '@onderling/app-manifest';
import { readDayAndTime } from '../forms/parseDate.js';
import { createComposerCommands } from '../v2/composerCommands.js';
import { loadOwnItems, cutToSelf } from './ownItems.js';

/**
 * The answer when no own model is set and the plain reading did not take the line: no model is set, what works without
 * one, and the way to the setting, in the screens' own labels (so it stays true when a screen is renamed).
 * @param {{t: Function}} o
 */
export function plusNoModelAnswer({ t }) {
  return t('circle.vandaag.plus_no_model', { path: ownModelSettingPath({ t }) });
}

/** The way to the person's own model setting, in the screens' own labels. */
export function ownModelSettingPath({ t }) {
  return ['circle.tab.mij', 'circle.settings_home.title', 'circle.settings_home.appearance', 'circle.userLlm.title'].map((k) => t(k)).join(' → ');
}

/**
 * The own model did not answer, said by its cause (`modelDownClass`, the household bot's classes): refused (the
 * person's own key or credit: where their setting is), too slow, or not reachable. Never "the admin knows".
 * @param {object|null} info  what the engine hands `onLlmUnavailable`
 */
export function plusModelDownAnswer(info, { t }) {
  const cls = modelDownClass(info) ?? 'unreachable';
  if (cls === 'refused') return t('circle.vandaag.plus_model_refused', { path: ownModelSettingPath({ t }) });
  if (cls === 'slow') return t('circle.vandaag.plus_model_slow');
  return t('circle.vandaag.plus_model_unreachable');
}

/**
 * The line at the top of the conversation: which route answers, and whether it is confidential (`ownRouteOf`).
 * @param {{set: boolean, kind: string, confidential: boolean, host: string|null}} route  @param {{t: Function}} o
 */
export function plusRouteLine(route, { t }) {
  if (!route?.set) return t('circle.vandaag.plus_route_none');
  if (route.kind === 'confidential') return t('circle.vandaag.plus_route_confidential');
  // confidential only by the person's own word (a remote route, its attestation the setting's flag): never claimed as checked
  if (route.kind === 'confidential-asserted') return t('circle.vandaag.plus_route_confidential_asserted', { host: route.host ?? '' });
  // a model the person runs themselves: the most private route, never called "not confidential"
  if (route.kind === 'local') return t('circle.vandaag.plus_route_local', { host: route.host ?? '' });
  return t('circle.vandaag.plus_route_plain', { host: route.host ?? '' });
}

/**
 * Whose conversation the sheet shows: the self it is written as; with one self or none ticked, the general self's (as the
 * door reads a line then); with several ticked and none picked, nobody's until the sheet's question is answered.
 * @param {string|null} asSelf  @param {number} tickedCount  how many selves are ticked in the header
 * @returns {string|null}
 */
export function conversationSelf(asSelf, tickedCount = 0) {
  return asSelf ?? (tickedCount > 1 ? null : 'default');
}

/**
 * The apps the own "+" composes: every app that declares something for the own place (an op's or a noun's `scopes`).
 * Derived from the declarations, so an app that adds an own act appears in the "+" with no Basis code.
 * @param {object[]} manifests
 */
export function ownPlaceApps(manifests = catalogueManifests()) {
  const own = (h) => opScopes(h).includes('own');
  return manifests.filter((m) => m?.app && m.app !== 'basis'
    && ((m.operations ?? []).some(own) || Object.values(m.nouns ?? {}).some(own))).map((m) => m.app);
}

/**
 * What the own "+" offers: the door's catalogue as every door that is not a circle composes it
 * (`composeAssistantCatalogue`: only its apps merged, the door's own ops added), asked for the OWN place, so only the
 * ops declared to be offered there (the STRUCTURAL answer); then `opAvailability` over it, as every surface asks (the
 * CONTEXTUAL one): an op that may not happen now is not offered to the model either.
 * @param {{householdManifest?: object, apps?: string[]}} [o]
 * @returns {{catalogue: object, manifestsByOrigin: object}}
 */
export function ownPlaceCatalogue({ householdManifest, apps } = {}) {
  // composed ONCE per household manifest and app list (merging, availability): a door is cheap to compose per read, as
  // the shells do, because this part is not redone; the manifests are fixed for the life of the app
  const byManifest = OWN_PLACE_CACHE.get(householdManifest ?? NO_MANIFEST) ?? new Map();
  OWN_PLACE_CACHE.set(householdManifest ?? NO_MANIFEST, byManifest);
  const key = Array.isArray(apps) ? [...apps].sort().join(',') : '';
  const hit = byManifest.get(key);
  if (hit) return hit;
  const { catalogue: placed, manifestsByOrigin } = composeAssistantCatalogue({
    apps: apps ?? ownPlaceApps(catalogueManifests({ householdManifest })), householdManifest, place: 'own',
  });
  const offered = withinWeight(proposable(availableOnly(placed, manifestsByOrigin, ownPlacePolicy(Object.keys(manifestsByOrigin))), manifestsByOrigin), manifestsByOrigin, PLUS_CEILING, ownPlaceWeight);
  // no app's circle-bot background in the own place: the place's own lines say what it is (`OWN_PLACE_LINES`)
  const out = { catalogue: { ...offered, systemPromptFor: () => null }, manifestsByOrigin };
  byManifest.set(key, out);
  return out;
}
const OWN_PLACE_CACHE = new WeakMap();

/**
 * What a person just READ in their "+", for the one turn after it (the household bot's `createLastReads`): kept for the
 * process, per thread, so the phone's door-per-call keeps it too; never written anywhere.
 */
const PLUS_LAST_READS = createLastReads();
// The door a form the "+" opened from a line came through, and the act it is for, per conversation, until it is
// settled: the phone composes a door per call, so what a Save (`formDoor`) and `settled` need to name the same door for
// the yes and the no (ownActions.js) lives beside the thread.
const PLUS_OPEN_FORM_DOOR = new Map();

/**
 * What the model is told about the place it answers in (LLM-facing; the circle door's twin is `CIRCLE_LINES`): the
 * person's OWN place, never a household or a group. An app's own background (`systemPrompt`, household's: "a small
 * group of people share a household …") is NOT given here: it describes that app's circle bot, and the own place's
 * model answered "what can I do here" with the household's examples (walk on the phone, 2026-11-16).
 */
export const OWN_PLACE_LINES = Object.freeze([
  "This is the person's OWN place: a private conversation with their own assistant. Nobody else reads it; there is no household, group or circle here.",
  "What can be done here is what the tools offer: the person's own notes, own appointments and own lists. Asked what you can do, name those, in the person's words, and nothing a household or a circle does.",
]);
const NO_MANIFEST = Object.freeze({});

/**
 * A noun PEOPLE write (`writtenBy: 'people'`, the own note) gives no model a tool to write it: its generic writes carry no
 * chat surface (`genericOpSynth`). In the own place the model may PROPOSE one: the door's dispatch only opens the act's
 * form filled, never a store, and Save is the person's own write. So here, and only here, a people-written noun's `add`
 * offered in the own place gets a tool, from its declaration (no list of nouns): a bot and a circle stay without one.
 * @param {object} catalogue @param {object} manifestsByOrigin  `{app → manifest}`, whose nouns say who writes them
 */
export function proposable(catalogue, manifestsByOrigin = {}) {
  if (!catalogue?.opsById) return catalogue;
  const opsById = new Map([...catalogue.opsById].map(([k, e]) => {
    const g = e?.op?.__generic;
    if (!g || g.atom !== 'add' || e.op.surfaces?.chat || !isPeopleWritten(manifestsByOrigin?.[e.appOrigin] ?? null, g.noun)) return [k, e];
    // LLM-facing (never shown to the person)
    const hint = `propose an own ${g.noun} of the person's; they see it filled in and save it themselves`;
    return [k, { ...e, op: { ...e.op, surfaces: { ...e.op.surfaces, chat: { hint } } } }];
  }));
  return { ...catalogue, opsById };
}

/**
 * How far the "+" goes: the heaviest weight it offers (`opWeight`, ledger L977). 3 = own things and a circle's through
 * the card, what the "+" did before the weight existed. The ceiling per persona (hidden, 1, 2 or 3) will set it.
 */
export const PLUS_CEILING = 3;

/**
 * An op's weight IN THE OWN PLACE: what the "+" runs there lands in the person's own store (`OWN_DEVICES_SCOPE`), so a
 * write that declares a circle as its widest place (`addToList`, a noun offered in both places) weighs as the person's
 * own there: content 2, control 4; keys stay 6. A circle's act reaches the "+" only through a circle's line or card,
 * which asks for 3 itself.
 * @param {object} manifest @param {object} op
 */
export function ownPlaceWeight(manifest, op) {
  if (op?.writes?.scope !== 'circle') return opWeight(manifest, op);
  return opWeight(manifest, { ...op, writes: { ...op.writes, scope: 'person' } });
}

/**
 * A catalogue cut to the ops whose weight is at most `ceiling`: a 4 or 5 (who reaches what) is only pointed to on its
 * settings screen, a 6 (keys) never offered, and an op without a weight (a write that does not say what it writes) not
 * offered at all. `ceiling` 0 is a hidden persona: nothing.
 * @param {object} catalogue @param {object} manifestsByOrigin `{app → manifest}` @param {number} [ceiling]
 */
export function withinWeight(catalogue, manifestsByOrigin = {}, ceiling = PLUS_CEILING, weigh = opWeight) {
  if (!catalogue?.opsById) return catalogue;
  const fits = (e) => { const w = weigh(manifestsByOrigin?.[e?.appOrigin] ?? null, e?.op); return w !== null && w <= ceiling; };
  return { ...catalogue, opsById: new Map([...catalogue.opsById].filter(([, e]) => fits(e))) };
}

/**
 * A catalogue cut to the ops `opAvailability` says may happen now (composition, feature, capability).
 * @param {object} catalogue @param {object} manifestsByOrigin @param {object|null} [policy]  the place's policy
 */
export function availableOnly(catalogue, manifestsByOrigin = {}, policy = null) {
  if (!catalogue?.opsById) return catalogue;
  const av = makeOpAvailability({ catalogue, manifestsByOrigin, policy });
  // a noun's generic atom (`__generic`) is no manifest operation, so availability cannot name it (it answers "unknown"):
  // it stands or falls with its noun's declaration, which the place filter has already read
  const offered = (e) => Boolean(e?.op?.__generic) || av.of(e?.op?.id).state === 'available';
  return { ...catalogue, opsById: new Map([...catalogue.opsById].filter(([, e]) => offered(e))) };
}

/**
 * @param {object} a
 * @param {{invoke: Function}|null} a.llm          the person's OWN model (`ownModelOf`), or null: no model
 * @param {object} a.threads                        the bot threads over this device's log (`createBotThreads`): the
 *        thread's memory, and what the door's own ops (memory mode, forget, language) set
 * @param {string|null} a.threadId                 `plusThreadId(self)`
 * @param {(key: string, vars?: object) => string} a.t
 * @param {string} [a.lang]
 * @param {() => Promise<Array>} [a.circles]       the person's circles, as `plusLineOutcome` reads them
 * @param {(asSelf: string|null) => Promise<Array>} [a.ownListsOf]   the ticked self's own lists
 * @param {(command: object, circleId: string, asSelf: string|null, door?: string) => Promise<any>} [a.runInCircle]  a
 *        circle act the plain reading runs at once (the circle is clear); `door` is the door it came through (`phrase`),
 *        for the person's own record (ownActions.js), to be handed to the waist with the call
 * @param {Function} [a.interpret]                 the interpreter (default `interpretToCommand`; a stand-in in tests)
 * @param {object} [a.householdManifest]          the household manifest the person's agent carries (`agent.manifest`)
 * @param {string[]} [a.apps]                       the apps to compose (default: those that declare an own act)
 * @param {Array} [a.acts]                         the own acts (default: the catalogue's own-scope attach entries)
 * @param {(asSelf: string|null, door?: string) => Function} [a.readAs]  the shell's call AS a self (the waist's `actAs`):
 *        what the assistant reads for a line (own notes, appointments, list entries), and a read the model picks, run
 *        through it as the self the "+" writes as. `door`: the door the read was asked through (slash, phrase, model),
 *        handed to the waist with the call; none for what the door reads for itself (retrieval)
 * @param {(asSelf: string|null) => {key: string|null, isDefault: boolean}} [a.selfOf]  that self's key
 * A read takes `opts.onSlow`: called when the model is slow and retrying, so the sheet can say "even geduld".
 */
export function createPlusDoor({
  llm = null, threads = null, threadId = null, t, lang = 'nl', circles = async () => [], ownListsOf = async () => [],
  runInCircle = null, interpret = interpretToCommand, householdManifest, apps, acts = PLUS_ACTS,
  readAs = null, selfOf: selfOfIn = null, selfKeyOf = null, toldLog = null, noteOwn = null,
  // the line naming the model route that answers (the sheet's header, `plusRouteLine`), for help's last line; a string or
  // a getter; absent/null: no model is set
  routeLine = null,
  // how far the "+" goes for a self (0 off · 1 reads · 2 own things · 3 a circle's after a yes): by default read as that
  // self through the shell's own call (`agents.getPlusCeiling`); anything unreadable is the default, the "+" as before
  ceilingOf = null,
} = {}) {
  if (typeof t !== 'function') throw new TypeError('createPlusDoor: t required');
  const memory = threads?.memory ?? null;
  if (llm && !(memory && (threadId || typeof selfKeyOf === 'function'))) throw new TypeError('createPlusDoor: a model needs the thread (threads, and threadId or selfKeyOf)');
  // a self's key (`selfKeyOf`), and whether it is the general self: what the reader cuts notes by
  const selfOf = selfOfIn ?? ((id) => ({ key: typeof selfKeyOf === 'function' ? selfKeyOf(id ?? 'default') : null, isDefault: (id ?? 'default') === 'default' }));
  /**
   * The conversation's thread: ONE self's own thread (`own:<key>`, the id the "+" always had), or, for a SET of
   * selves read together, the combined conversation's own thread, keyed on the set (whoever is primary): never mixed
   * with a single self's. Without `selfKeyOf` the door has the one thread it was given.
   * @param {string[]} selves
   */
  const threadIdFor = (selves = ['default']) => {
    if (typeof selfKeyOf !== 'function') return threadId;
    const keys = [...new Set((selves.length ? selves : ['default']).map((id) => selfKeyOf(id)).filter(Boolean))].sort();
    if (!keys.length) return null;
    return keys.length === 1 ? plusThreadId(keys[0]) : `own-combined:${keys.join('+')}`;
  };
  const { catalogue: cat, manifestsByOrigin } = ownPlaceCatalogue({ householdManifest, apps });
  // THE CEILING of this turn (the strictest of its selves): what the model is handed, and what any way in may run
  const ceilingOfSelf = typeof ceilingOf === 'function' ? ceilingOf
    : (typeof readAs === 'function' ? async (self) => (await readAs(self)('agents', 'getPlusCeiling', { id: self ?? 'default' }))?.ceiling : null);
  const ceilingFor = async (set) => {
    if (!ceilingOfSelf) return PLUS_CEILING;
    const each = await Promise.all(set.map((id) => Promise.resolve().then(() => ceilingOfSelf(id)).catch(() => PLUS_CEILING)));
    return Math.min(...each.map((c) => (PLUS_CEILINGS.includes(c) ? c : PLUS_CEILING)));
  };
  let turnCeiling = PLUS_CEILING;
  const CUTS = new Map();
  const cutFor = (c) => { if (!CUTS.has(c)) CUTS.set(c, withinWeight(cat, manifestsByOrigin, c, ownPlaceWeight)); return CUTS.get(c); };
  /** Is this op heavier than the turn allows (in the own place)? An op the door does not offer is not judged here. */
  const overCeiling = (opId) => { const e = entryOf(opId); const w = e ? ownPlaceWeight(manifestsByOrigin?.[e.appOrigin] ?? null, e.op) : null; return Boolean(e) && (w === null || w > turnCeiling); };
  /** The catalogue entry of a model's pick (by op id: a key may carry its app's prefix). */
  const entryOf = (opId) => cat.opsById.get(opId) ?? [...cat.opsById.values()].find((e) => e?.op?.id === opId) ?? null;
  /** A pick that only READS (the atom catalogue, or the manifest's `domainVerbs`); one nothing classifies is a write. */
  const reads = (e) => verbKind(manifestsByOrigin?.[e?.appOrigin] ?? null, e?.op?.verb ?? e?.op?.__generic?.atom) === 'read';
  /** A read as the self the "+" writes as, on the own scope. */
  // a read as one self, cut to that self's rows where the route answers every self (the reader's own rule, `cutToSelf`)
  const readOwn = async (asSelf, e, args, door = undefined) => cutToSelf(e.appOrigin, await readAs(asSelf, door)(e.appOrigin, e.op.id, { ...(args ?? {}), circleId: OWN_DEVICES_SCOPE }), selfOf(asSelf));
  /**
   * A read for this conversation: as its one self, or, for a SET read together, as EACH self of the set (the same union
   * retrieval reads), every row tagged with the self it is (`self`); one self's refusal leaves the others' rows.
   */
  const readForTurn = async (ctx, e, args) => {
    const set = Array.isArray(ctx?.selves) && ctx.selves.length > 1 ? ctx.selves : null;
    if (!set) return readOwn(ctx?.asSelf ?? null, e, args, ctx?.door);
    const parts = await Promise.all(set.map(async (id) => ({ id, r: await Promise.resolve(readOwn(id, e, args, ctx?.door)).catch(() => null) })));
    const items = parts.flatMap(({ id, r }) => (Array.isArray(r?.items) ? r.items.map((it) => ({ ...it, self: id })) : []));
    return parts.every(({ r }) => r?.ok === false) ? parts[0].r : { ok: true, items };
  };
  // The door's own ops (`assistantManifest`: memory mode, forget, language), answered by the one door-op handler the
  // box's door uses (`withAssistantOps`). The person's own app IS their private door: one row, this thread, never a
  // screen or a group, so forgetting is theirs to do here as in their own Telegram chat.
  const doorOpsFor = (thread) => withAssistantOps({
    callSkill: async () => ({ ok: false, error: 'not-a-door-op' }), threads, t,
    admin: { users: async () => (thread ? [{ id: thread, channel: 'app' }] : []) },
  });
  const DOOR_OP_IDS = new Set((assistantManifest.operations ?? []).map((o) => o.id));
  const runDoorOp = async (opId, args = {}, thread = threadId) => {
    const r = await doorOpsFor(thread)('assistant', opId, args, { threadId: thread });
    const said = typeof r?.message === 'string' ? r.message : typeof r?.reply === 'string' ? r.reply : null;
    return r?.ok === false ? { error: (typeof r.error === 'object' ? r.error?.message : r.error) || t('circle.vandaag.plus_line_unread') } : said ? { done: said } : unread();
  };
  // what the "+" could place nowhere: marked (never a field on the answer the sheets paint) so `read` notes it
  const placedNowhere = new WeakSet();
  const unread = () => { const r = { error: t('circle.vandaag.plus_line_unread') }; placedNowhere.add(r); return r; };
  // THE PERSON'S OWN RECORD for what no op shows (ownActions.js): a proposal turned down (`declined`, naming the act it
  // proposed) and a line placed nowhere (`no_act`, no op). The shell hands the agent's note, which follows the person's
  // switch; never the words. A note that fails never breaks the turn.
  const note = ({ app = null, op = null, outcome, door, circleId = null }) => {
    if (typeof noteOwn !== 'function') return;
    try { Promise.resolve(noteOwn({ app, op, outcome, door, circleId })).catch(() => {}); } catch { /* never the turn's */ }
  };
  // the door the line now being read came through (slash, phrase, model): what a `no_act` names
  let lineDoor = null;

  // What this turn came to: set by the engine's sinks while the turn runs (the lane runs one turn at a time).
  let outcome = null;
  let currentLine = '';
  // the sheet's "even geduld" for the read running now (the lane runs one turn at a time)
  let currentOnSlow = null;
  // The deterministic gate reads only what this door offers: a household rule that builds a circle's op ("zet X …" as a
  // list entry or a task) is no reading here, so the line goes on to the model, never to "I could not read that"
  const offeredHere = (c) => Boolean(c?.opId) && (DOOR_OP_IDS.has(c.opId)
    || acts.some((a) => a.opId === c.opId && (!c.appOrigin || c.appOrigin === a.appOrigin)) || Boolean(entryOf(c.opId)));
  // THE OWN GATE, generated from what this door offers: the lists table over the self's own lists (its phrases for the
  // own note too: "onthoud dat …", "welke weetjes zijn er") and the door's manifests' phrases asked for the OWN place
  // (`renderGate`, `place: 'own'`: "wat heb ik gepland"), every language. A command for an op offered here goes through
  // `answer`, with or without a model; nothing else. The engine has no gate of its own: the plain reading and this one
  // are the gate, so "the gate took it" means one thing.
  const manifestGate = renderGate(Object.values(manifestsByOrigin ?? {}).filter(Boolean), { place: 'own' });
  const ownGate = async (text, asSelf) => {
    const lists = (await ownListsOf(asSelf) ?? []).filter((l) => l?.name && l.defaultChild !== 'calendar-event');
    const rules = [...listsGateRules(null, lists.length ? lists : [{ name: NO_OWN_LIST }], { greeting: false }), ...manifestGate];
    const first = (line) => {
      for (const r of rules) {
        let c = null;
        try { c = r.command(line); } catch { c = null; }
        if (offeredHere(c)) return c;
      }
      return null;
    };
    const c = first(text);
    if (c) return { opId: c.opId, args: c.args ?? {} };
    // a day said in the line ("wat heb ik MORGEN gepland?"): read without it, and a read that takes a day gets it
    const said = readDayAndTime(text);
    if (!said?.day || said.time || !said.rest) return null;
    const d = first(said.rest);
    const takesDay = (entryOf(d?.opId)?.op?.params ?? []).some((p) => p?.name === 'day');
    return d && takesDay ? { opId: d.opId, args: { ...(d.args ?? {}), day: said.day } } : null;
  };
  // EVERY op offered to the model, or named by a "/" line, has an outcome here (one handler: "/" and the model cannot
  // drift apart), and none reaches a store from the model: a door op runs (it sets this conversation), an own act
  // opens its form filled (Save is the yes), a read runs as the self and is answered, any other own write is a card
  // naming the act and its list, run only on the person's pick as the self.
  const answer = async (input, ctx) => {
    const cmd = typeof input === 'object' && input ? input : null;
    // above this persona's ceiling: refused, whichever way it came in (a slash line, a phrase, the model's pick)
    if (cmd && overCeiling(cmd.opId)) { outcome = { error: t('circle.vandaag.plus_ceiling_refused') }; return; }
    // the conversation's own settings (memory mode, language): the door's ops, run at once (they change no thing of
    // the person's, only how this thread talks; forgetting it is slash only and never a model's tool)
    if (cmd && DOOR_OP_IDS.has(cmd.opId)) { outcome = await runDoorOp(cmd.opId, cmd.args ?? {}, ctx?.id ?? threadId); return; }
    // only the acts that MAKE something: a line is never read as "open a door" (feedback runs from its button)
    const act = cmd && acts.find((a) => a.opId === cmd.opId && !actRunsAtOnce(a));
    const e = cmd && !act ? entryOf(cmd.opId) : null;
    if (e && reads(e) && typeof readAs === 'function') {
      const r = await Promise.resolve(readForTurn(ctx, e, cmd.args)).catch((err) => ({ ok: false, error: err?.message ?? String(err) }));
      // a read that fails could not READ (never "could not save": nothing was being saved)
      outcome = r?.ok === false ? { error: t('circle.vandaag.plus_read_failed', { error: r.error ?? '' }) } : { done: plusDoneLine(r, { opId: e.op.id, args: cmd.args ?? {}, t }) || t('circle.vandaag.plus_line_unread') };
      // what was read, for the model's next turn ("en morgen?" is about it); nothing kept where the thread keeps nothing
      const thread = ctx?.id ?? threadId;
      if (r?.ok !== false && thread && threads?.modeOf?.(thread) !== 'off') {
        PLUS_LAST_READS.saw(thread, { title: r?.title ?? null, lines: (Array.isArray(r?.items) ? r.items : []).map((i) => i?.label ?? i?.text ?? i?.title ?? '') });
      }
      return;
    }
    if (e && !reads(e) && !actRunsAtOnce(acts.find((a) => a.opId === cmd.opId))) {
      const { circleId: _c, ...args } = cmd.args ?? {};
      outcome = { card: { line: currentLine, to: [{ circleId: OWN_DEVICES_SCOPE, name: '', own: true }], command: { appOrigin: e.appOrigin, opId: e.op.id, args }, door: ctx?.door ?? lineDoor } };
      return;
    }
    if (!act) { outcome = unread(); return; }
    const values = {};
    for (const f of act.fields) {
      const v = cmd.args?.[f.name];
      if (v != null && String(v).trim()) values[f.name] = String(v).trim();
    }
    outcome = { actId: act.id, values };
  };

  // the "/" list: the commands of THIS door's catalogue, the same acts its buttons and its model have (`own`: no device
  // command, no circle op); a "/" line naming one goes through `answer`, a "/" line naming none is an ordinary line
  const commands = createComposerCommands({ kind: 'own', catalogue: cat });

  const engine = createAssistantEngine({
    catalogue: cat, catalogueFor: () => cutFor(turnCeiling), lang, llm, interpret, collectMs: 0, dispatchSlash: false, gateRules: [], promptLines: [...OWN_PLACE_LINES],
    // a line about one family gets that family's tools (the own note's too); no family is kept regardless here
    // the read of the turn before, if any (one turn only)
    threadHints: (thread) => PLUS_LAST_READS.hintsFor(thread),
    // the model is slow and retrying: the sheet says so while the person waits (the household bot's onSlow)
    onSlow: () => { try { currentOnSlow?.(); } catch { /* a sheet that cannot paint it: the answer still comes */ } },
    narrowing: {
      keep: [], own: true,
      // a line naming no family: the reads and the acts that MAKE something, and the door's own ops (Fable's ruling)
      otherwise: (e) => DOOR_OP_IDS.has(e?.op?.id) || reads(e) || acts.some((a) => a.opId === e?.op?.id && !actRunsAtOnce(a)),
    },
    // what the model may read for a line: the person's own things only, and only the ticked self's (or the set's)
    ...(typeof readAs === 'function'
      ? { loadItems: async (ctx) => {
        // one self, or the SET read together: the union of each self's own things, each read as that self
        const set = Array.isArray(ctx?.selves) && ctx.selves.length ? ctx.selves : [ctx?.asSelf ?? null];
        const seen = new Set();
        const rows = (await Promise.all(set.map((id) => loadOwnItems({ call: readAs(id), self: selfOf(id) })()))).flat();
        return rows.filter((r) => (r.id && seen.has(`${r.type}:${r.id}`) ? false : (seen.add(`${r.type}:${r.id}`), true)));
      } }
      : {}),
    ...(memory ? { memory } : {}),
    // a read the model picks for a line that asks for an act is looked at as the self and handed back to it once
    ...(typeof readAs === 'function'
      ? { peek: async (cmd, ctx) => { const e = entryOf(cmd?.opId); return e && reads(e) ? readForTurn(ctx, e, cmd.args) : null; } }
      : {}),
    dispatch: (input, ctx) => answer(input, ctx),
    // the model's own words (`model`): the only outcome kept as the assistant's turn; everything else is the system speaking
    onNoMatch: (_text, _ctx, opts) => { outcome = typeof opts?.reply === 'string' && opts.reply ? { done: opts.reply, model: true } : unread(); },
    // the own model is set but could not be reached: say that, never "I could not read that"
    onLlmUnavailable: (_text, _ctx, info) => { outcome = { error: plusModelDownAnswer(info, { t }) }; },
    onUnhandled: () => { outcome = unread(); },
  });

  /** The set this read is for, and the self a write is made as (the primary): one ticked self is the set of one. */
  const setOf = ({ asSelf = null, selves = null } = {}) => {
    const set = Array.isArray(selves) && selves.length ? [...new Set(selves)] : [asSelf ?? 'default'];
    return { set, primary: asSelf ?? (set.length === 1 ? set[0] : null) };
  };

  // "help", generated from what this door offers (plusIntro.js `plusHelp`): its reads by their "/" names, its own acts,
  // the circle line when the person is in one, and the model's route (or how it works without one)
  async function generatedHelp(asSelf = null) {
    const readNames = commands.pool.filter((c) => { const e = entryOf(c.opId); return e && reads(e); }).map((c) => c.command);
    const actNames = acts.filter((a) => !actRunsAtOnce(a)).map((a) => plusLabel(t, a));
    const cs = await Promise.resolve(circles()).catch(() => []);
    const route = typeof routeLine === 'function' ? routeLine() : routeLine;
    const lists = await Promise.resolve(ownListsOf(asSelf)).catch(() => []);
    const ex = plusIntro({ ownLists: lists, circles: cs, t });
    return plusHelp({
      reads: [...new Set(readNames)], acts: actNames, hasCircle: cs.some((c) => c?.id && c.id !== HELP_CIRCLE_ID),
      tryLine: ex.examples.length ? `${ex.tryLabel} ${ex.examples.join(' · ')}` : null,
      routeLine: llm ? route : null, modelPlace: ownModelSettingPath({ t }), t,
    }).join('\n');
  }

  // NOTHING TO DO WITH A LINE, said with its reason (the plan's step B): a line that names one of the person's circles
  // is about that circle, which the "+" does not read along in (what to do instead); with no model, the no-model answer
  // and, when one fits, an example of a line the "+" reads here; a line the model found nothing in: "not understood"
  // with that example, or today's line when none fits. Each stays no_act in the person's record (Fable's words).
  async function nothingFor(text, said, { asError = false, asSelf = null, understood = true } = {}) {
    const cs = await Promise.resolve(circles()).catch(() => []);
    const low = ` ${String(text).toLowerCase()} `;
    const names = cs.filter((c) => c?.id && c.id !== HELP_CIRCLE_ID && c.unnamed !== true && typeof c?.name === 'string' && c.name.trim());
    const aboutCircle = names.find((c) => new RegExp(`[^\\p{L}\\p{N}]${c.name.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\p{L}\\p{N}]`, 'u').test(low));
    if (aboutCircle) { const r = { error: t('circle.vandaag.plus_not_my_reach', { circle: aboutCircle.name.trim() }) }; placedNowhere.add(r); return r; }
    const lists = await Promise.resolve(ownListsOf(asSelf)).catch(() => []);
    const pool = [...plusIntro({ ownLists: lists, circles: cs, t }).examples, ...plusSuggestionPool({ circles: cs, lang })];
    const ex = plusNearest(text, pool);
    const line = !ex ? said
      : understood ? `${said} ${t('circle.vandaag.plus_try_example', { example: ex })}`
        : t('circle.vandaag.plus_not_understood', { example: ex });
    const r = asError ? { error: line } : { done: line };
    placedNowhere.add(r);
    return r;
  }

  async function read(line, opts = {}) {
    const text = String(line ?? '').trim();
    if (!text) return unread();
    const { set, primary } = setOf(opts);
    // several selves ticked and none picked to write as: the "+" asks which one first (both sheets paint the choice);
    // nothing is read and nothing reaches a model before it
    if (!primary) return { askSelf: true };
    const asSelf = primary;
    turnCeiling = await ceilingFor(set);
    // 0: the "+" is off for this persona; nothing of it reaches a model
    if (turnCeiling <= 0) return { done: t('circle.vandaag.plus_ceiling_off') };
    const slash = text.startsWith('/') ? commands.parse(text) : null;
    if (slash) {
      lineDoor = 'slash';
      outcome = null;
      currentLine = text;
      await answer({ opId: slash.opId, args: slash.args ?? {} }, { asSelf, selves: set, id: threadIdFor(set), door: 'slash' });
      return outcome?.actId ? { ...outcome, asSelf } : (outcome ?? unread());
    }
    lineDoor = 'phrase';
    const o = plusLineOutcome(text, { circles: await circles(), own: { lists: await ownListsOf(asSelf) }, lang });
    // a help card's own text for a how-to question; plain "help" says what is offered HERE, generated from this door
    if (o?.kind === 'help') return { done: o.card ? plusHelpAnswer(o, { t }) : await generatedHelp(asSelf) };
    // a circle's act needs the ceiling that allows a circle's things (3)
    if (o?.kind === 'circle' && turnCeiling < 3) return { error: t('circle.vandaag.plus_ceiling_refused') };
    // a circle act the plain reading runs at once: what the run says (`{error}` or `{done}`, its reply line)
    if (o?.kind === 'circle' && o.atOnce) return (typeof runInCircle === 'function' ? await runInCircle(o.command, o.circleId, asSelf, 'phrase') : null) ?? unread();
    if (o?.kind === 'circle') return { card: { line: text, to: o.to, command: o.command, door: 'phrase', ...(o.makeList ? { makeList: o.makeList } : {}), ...(o.followUp ? { followUp: o.followUp } : {}) } };
    // an own act's form, filled as the primary self (the form may change it)
    if (o?.kind === 'own' && o.actId && overCeiling(acts.find((x) => x.id === o.actId)?.opId)) return { error: t('circle.vandaag.plus_ceiling_refused') };
    if (o?.kind === 'own') return o.actId ? { actId: o.actId, values: o.values ?? {}, asSelf } : o;
    // the plain reading did not take it: the person's own model, or no model at all (the line goes nowhere, and the
    // "+" says what works without one and where to set one)
    // the own gate: a phrase for an op offered here acts with no model call, with or without a model set
    const gated = await ownGate(text, asSelf);
    if (gated) {
      outcome = null;
      currentLine = text;
      await answer(gated, { asSelf, selves: set, id: threadIdFor(set), door: 'phrase' });
      return outcome?.actId ? { ...outcome, asSelf } : (outcome ?? unread());
    }
    if (!llm) return nothingFor(text, plusNoModelAnswer({ t }), { asSelf });
    lineDoor = 'model';
    outcome = null;
    currentLine = text;
    currentOnSlow = typeof opts.onSlow === 'function' ? opts.onSlow : null;
    try { await engine.ask(threadIdFor(set), text, { asSelf, selves: set }); } finally { currentOnSlow = null; }
    if (outcome?.actId) return { ...outcome, asSelf };
    // the model found nothing to do: said with its reason (a circle's line, or an example that fits)
    if (!outcome || placedNowhere.has(outcome)) return nothingFor(text, t('circle.vandaag.plus_line_unread'), { asError: true, asSelf, understood: false });
    return outcome;
  }

  return {
    /** One line read, and kept: the line and what the door answered go into this conversation's thread afterwards. */
    async read(line, opts = {}) {
      lineDoor = null;
      const r = await read(line, opts);
      const thread = r?.askSelf ? null : threadIdFor(setOf(opts).set);
      if (r && placedNowhere.has(r) && lineDoor) note({ outcome: 'no_act', door: lineDoor });
      // a form opened from a line: the door it came through, until it is settled (`settled` notes a refused one)
      if (thread) { if (r?.actId) PLUS_OPEN_FORM_DOOR.set(thread, { door: lineDoor ?? 'phrase', actId: r.actId }); else PLUS_OPEN_FORM_DOOR.delete(thread); }
      // a turn ended: the read it made lives one turn more, an older one goes
      if (thread) PLUS_LAST_READS.turnEnded(thread);
      if (memory && thread) {
        memory.remember(thread, 'you', String(line ?? '').trim());
        const said = plusAnswerLine({ error: r?.error ?? null, done: r?.done ?? null, circleCard: r?.card ?? null, ownActId: r?.actId ?? null, t });
        // only the model's reply is the assistant's words; a read, an act, a card, help or an error is the system speaking
        // (the household bot's rule, `aroundTurn`): the model then reads it as a result, never as something it said
        if (said) memory.remember(thread, r?.model ? 'assistant' : 'system', said);
      }
      return r;
    },
    /**
     * A run with no new line (the pick on the which-circle card): what it answered is kept in THIS conversation's
     * thread, as a read's answer is. `run` returns `{error, done}`.
     */
    async exchange(opts = {}, run) {
      const r = await run();
      const thread = threadIdFor(setOf(opts).set);
      const said = plusAnswerLine({ error: r?.error ?? null, done: r?.done ?? null, t });
      if (memory && thread && said) memory.remember(thread, 'system', said);
      return r;
    },
    /**
     * The form the "+" opened is settled: saved, or closed without saving. Said in THIS conversation only when its last
     * turn is that form (the act's label, what `read` kept when it opened); so a refused proposal is said once, and a
     * form the "+" did not open from a line says nothing. Saving ANOTHER act (`actId`) while it was open settles it as
     * not saved. Read from the thread, not from the door: the phone composes a door per call. Returns what was said, or null.
     * @param {{asSelf?: string|null, selves?: string[]|null}} opts
     * @param {{saved: boolean, actId?: string|null}} how
     */
    /**
     * A card's "no" (Cancel): the line was not done and nothing was stored, said in THIS
     * conversation, as a closed form is. Returns what was said, or null without a thread.
     * @param {{asSelf?: string|null, selves?: string[]|null}} opts @param {{line?: string}} card
     */
    /**
     * The door a Save of this act comes through: the door of the line the "+" opened its form from (the model's
     * proposal, a phrase), so a yes is recorded by the same door as a no; none for a form the person opened by its
     * button (the act strip's wrapper names that a tap). Read before the Save; `settled` clears it after.
     * @param {{asSelf?: string|null, selves?: string[]|null}} opts @param {string} actId
     * @returns {string|undefined}
     */
    formDoor(opts = {}, actId = null) {
      const open = PLUS_OPEN_FORM_DOOR.get(threadIdFor(setOf(opts).set));
      return open && open.actId === actId ? open.door : undefined;
    },
    async cardRefused(opts = {}, card = null) {
      if (card?.command?.opId) note({ app: card.command.appOrigin ?? null, op: card.command.opId, outcome: 'declined', door: card.door ?? 'phrase' });
      const thread = threadIdFor(setOf(opts).set);
      if (!memory || !thread) return null;
      const said = t('circle.vandaag.plus_card_not_done', { line: card?.line ?? '' });
      memory.remember(thread, 'system', said);
      return said;
    },
        async settled(opts = {}, { saved = false, actId = null } = {}) {
      const thread = threadIdFor(setOf(opts).set);
      if (!memory || !thread || typeof memory.turns !== 'function') return null;
      const last = memory.turns(thread, 1).at(-1);
      // the form's label, kept when it opened (the system speaking); a later line of the person's means it was left
      if (!last || last.who === 'you') return null;
      const act = PLUS_ACTS.find((a) => plusLabel(t, a) === last.text);
      if (!act) return null;
      // another act saved by its button while this form was open: THIS form was not saved (said now, not at a later close)
      const kept = saved && (!actId || actId === act.id);
      const door = PLUS_OPEN_FORM_DOOR.get(thread)?.door ?? 'phrase';
      PLUS_OPEN_FORM_DOOR.delete(thread);
      // a proposal turned down: noted (a save is recorded by the waist, as the act it is)
      if (!kept) note({ app: act.appOrigin ?? null, op: act.opId ?? null, outcome: 'declined', door });
      const said = t(kept ? 'circle.vandaag.plus_act_saved' : 'circle.vandaag.plus_act_not_saved', { act: plusLabel(t, act) });
      memory.remember(thread, 'system', said);
      return said;
    },
    /**
     * What to offer under the line while it is typed: on a "/" word, this door's commands (the "/" list); otherwise the
     * shell's own suggestion pool (`plusSuggest`). Both sheets ask this one function.
     * @param {string} typed
     * @param {{pool?: string[]}} [o]
     */
    suggest(typed, { pool = [] } = {}) {
      const v = String(typed ?? '');
      // "/" alone answers "what can I do here": the whole list, not the composer's first twelve
      return v.startsWith('/') ? commands.suggest(v, { limit: 40 }).map((e) => e.command) : plusSuggest(pool, v);
    },
    catalogue: cat,
    threadIdFor,
    /** The last turns of a conversation (one self's, or a set's), oldest first, for the sheet to show. */
    // the sheet's length (`PLUS_TURNS_SHOWN`), never the model's memory window (six turns) the threads default to
    turns: (opts = {}, n = PLUS_TURNS_SHOWN) => { const th = threadIdFor(setOf(opts).set); return th && threads?.memory?.turns ? threads.memory.turns(th, n) : []; },
    /** "Forget this conversation": the door's own op (`assistant-forget`), for THIS conversation only. */
    forget: async (opts = {}) => {
      const thread = threadIdFor(setOf(opts).set);
      const r = await runDoorOp('assistant-forget', {}, thread);
      // forgetting the conversation forgets what it told, too: the next open says what it is again (Fable 2026-11-18)
      writePlusTold(toldLog, thread, null);
      return r;
    },
    /**
     * The conversation opens (the sheet, for the ticked self): the first time, what the "+" is (`{intro}`: two lines and
     * three examples from what the person has); later, once, the circles joined since (`{news}`); otherwise `{}`. What
     * was told is kept on this device's log (`plus-told`, `toldLog`), so a door composed per call says it once too.
     * No model call. Not an act: nothing of it is recorded as one.
     * @param {{asSelf?: string|null, selves?: string[]|null}} opts
     * @returns {Promise<{intro?: object, news?: string}>}
     */
    async opening(opts = {}) {
      const { set, primary } = setOf(opts);
      const thread = threadIdFor(set);
      if (!thread) return {};
      const cs = await Promise.resolve(circles()).catch(() => []);
      const told = readPlusTold(toldLog, thread);
      const n = plusNews({ told, circles: cs, t });
      writePlusTold(toldLog, thread, n.told);
      if (!told) {
        const lists = await Promise.resolve(ownListsOf(primary ?? null)).catch(() => []);
        return { intro: plusIntro({ ownLists: lists, circles: cs, t }) };
      }
      return n.line ? { news: n.line } : {};
    },
    /** Resolves when no turn is running. */
    /** Resolves when THIS conversation has no turn running (no conversation named: every one). */
    idle: (opts) => engine.idle(opts ? (threadIdFor(setOf(opts).set) ?? undefined) : undefined),
  };
}
