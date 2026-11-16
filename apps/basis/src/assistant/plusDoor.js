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
import { composeAssistantCatalogue } from './assistantCatalogue.js';
import { catalogueManifests } from '../v2/manifestSources.js';
import { withAssistantOps } from '../v2/assistantOps.js';
import { assistantManifest } from '../v2/assistantManifest.js';
import { opScopes, verbKind, isPeopleWritten } from '@onderling/app-manifest';
import { OWN_DEVICES_SCOPE } from '../v2/grantsManifest.js';
import { makeOpAvailability } from '../v2/opAvailability.js';
import { ownPlacePolicy } from '../v2/circlePolicy.js';
import { PLUS_ACTS, plusLineOutcome, plusHelpAnswer, actRunsAtOnce, plusDoneLine } from '../v2/vandaagPlus.js';
import { plusAnswerLine } from '../v2/plusThread.js';
import { interpretToCommand } from '../v2/interpretCommand.js';

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
  const out = { catalogue: proposable(availableOnly(placed, manifestsByOrigin, ownPlacePolicy(Object.keys(manifestsByOrigin))), manifestsByOrigin), manifestsByOrigin };
  byManifest.set(key, out);
  return out;
}
const OWN_PLACE_CACHE = new WeakMap();
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
 * @param {(command: object, circleId: string, asSelf: string|null) => Promise<any>} [a.runInCircle]  a circle act the
 *        plain reading runs at once (the circle is clear)
 * @param {Function} [a.interpret]                 the interpreter (default `interpretToCommand`; a stand-in in tests)
 * @param {object} [a.householdManifest]          the household manifest the person's agent carries (`agent.manifest`)
 * @param {string[]} [a.apps]                       the apps to compose (default: those that declare an own act)
 * @param {Array} [a.acts]                         the own acts (default: the catalogue's own-scope attach entries)
 * @param {(asSelf: string|null) => Function} [a.readAs]  the shell's call AS a self (the waist's `actAs`): a read the
 *        model picks is run through it, as the self the "+" writes as, on the own scope
 */
export function createPlusDoor({
  llm = null, threads = null, threadId = null, t, lang = 'nl', circles = async () => [], ownListsOf = async () => [],
  runInCircle = null, interpret = interpretToCommand, householdManifest, apps, acts = PLUS_ACTS, readAs = null,
} = {}) {
  if (typeof t !== 'function') throw new TypeError('createPlusDoor: t required');
  const memory = threads?.memory ?? null;
  if (llm && !(memory && threadId)) throw new TypeError('createPlusDoor: a model needs the thread (threads and threadId)');
  const { catalogue: cat, manifestsByOrigin } = ownPlaceCatalogue({ householdManifest, apps });
  /** The catalogue entry of a model's pick (by op id: a key may carry its app's prefix). */
  const entryOf = (opId) => cat.opsById.get(opId) ?? [...cat.opsById.values()].find((e) => e?.op?.id === opId) ?? null;
  /** A pick that only READS (the atom catalogue, or the manifest's `domainVerbs`); one nothing classifies is a write. */
  const reads = (e) => verbKind(manifestsByOrigin?.[e?.appOrigin] ?? null, e?.op?.verb ?? e?.op?.__generic?.atom) === 'read';
  /** A read as the self the "+" writes as, on the own scope. */
  const readOwn = (asSelf, e, args) => readAs(asSelf)(e.appOrigin, e.op.id, { ...(args ?? {}), circleId: OWN_DEVICES_SCOPE });
  // The door's own ops (`assistantManifest`: memory mode, forget, language), answered by the one door-op handler the
  // box's door uses (`withAssistantOps`). The person's own app IS their private door: one row, this thread, never a
  // screen or a group, so forgetting is theirs to do here as in their own Telegram chat.
  const doorOps = withAssistantOps({
    callSkill: async () => ({ ok: false, error: 'not-a-door-op' }), threads, t,
    admin: { users: async () => (threadId ? [{ id: threadId, channel: 'app' }] : []) },
  });
  const DOOR_OP_IDS = new Set((assistantManifest.operations ?? []).map((o) => o.id));
  const runDoorOp = async (opId, args = {}) => {
    const r = await doorOps('assistant', opId, args, { threadId });
    const said = typeof r?.message === 'string' ? r.message : typeof r?.reply === 'string' ? r.reply : null;
    return r?.ok === false ? { error: (typeof r.error === 'object' ? r.error?.message : r.error) || t('circle.vandaag.plus_line_unread') } : said ? { done: said } : unread();
  };
  const unread = () => ({ error: t('circle.vandaag.plus_line_unread') });

  // What this turn came to: set by the engine's sinks while the turn runs (the lane runs one turn at a time).
  let outcome = null;
  let currentLine = '';
  const engine = createAssistantEngine({
    catalogue: cat, lang, llm, interpret, collectMs: 0, dispatchSlash: false,
    ...(memory ? { memory } : {}),
    // a read the model picks for a line that asks for an act is looked at as the self and handed back to it once
    ...(typeof readAs === 'function'
      ? { peek: async (cmd, ctx) => { const e = entryOf(cmd?.opId); return e && reads(e) ? readOwn(ctx?.asSelf ?? null, e, cmd.args) : null; } }
      : {}),
    // EVERY op offered to the model has an outcome here, and none reaches a store from the model: a door op runs (it
    // sets this conversation), an own act opens its form filled (Save is the yes), a read runs as the self and is
    // answered, any other own write is a card naming the act and its list, run only on the person's pick as the self.
    dispatch: async (input, ctx) => {
      const cmd = typeof input === 'object' && input ? input : null;
      // the conversation's own settings (memory mode, language): the door's ops, run at once (they change no thing of
      // the person's, only how this thread talks; forgetting it is slash only and never a model's tool)
      if (cmd && DOOR_OP_IDS.has(cmd.opId)) { outcome = await runDoorOp(cmd.opId, cmd.args ?? {}); return; }
      // only the acts that MAKE something: a line is never read as "open a door" (feedback runs from its button)
      const act = cmd && acts.find((a) => a.opId === cmd.opId && !actRunsAtOnce(a));
      const e = cmd && !act ? entryOf(cmd.opId) : null;
      if (e && reads(e) && typeof readAs === 'function') {
        const r = await Promise.resolve(readOwn(ctx?.asSelf ?? null, e, cmd.args)).catch((err) => ({ ok: false, error: err?.message ?? String(err) }));
        outcome = r?.ok === false ? { error: t('circle.vandaag.plus_failed', { error: r.error ?? '' }) } : { done: plusDoneLine(r, { opId: e.op.id, args: cmd.args ?? {}, t }) || t('circle.vandaag.plus_line_unread') };
        return;
      }
      if (e && !reads(e) && !actRunsAtOnce(acts.find((a) => a.opId === cmd.opId))) {
        const { circleId: _c, ...args } = cmd.args ?? {};
        outcome = { card: { line: currentLine, to: [{ circleId: OWN_DEVICES_SCOPE, name: '', own: true }], command: { appOrigin: e.appOrigin, opId: e.op.id, args } } };
        return;
      }
      if (!act) { outcome = unread(); return; }
      const values = {};
      for (const f of act.fields) {
        const v = cmd.args?.[f.name];
        if (v != null && String(v).trim()) values[f.name] = String(v).trim();
      }
      outcome = { actId: act.id, values };
    },
    onNoMatch: (_text, _ctx, opts) => { outcome = typeof opts?.reply === 'string' && opts.reply ? { done: opts.reply } : unread(); },
    onLlmUnavailable: () => { outcome = unread(); },
    onUnhandled: () => { outcome = unread(); },
  });

  async function read(line, { asSelf = null } = {}) {
    const text = String(line ?? '').trim();
    if (!text) return unread();
    const o = plusLineOutcome(text, { circles: await circles(), own: { lists: await ownListsOf(asSelf) }, lang });
    if (o?.kind === 'help') return { done: plusHelpAnswer(o, { t }) };
    // a circle act the plain reading runs at once: what the run says (`{error}` or `{done}`, its reply line)
    if (o?.kind === 'circle' && o.atOnce) return (typeof runInCircle === 'function' ? await runInCircle(o.command, o.circleId, asSelf) : null) ?? unread();
    if (o?.kind === 'circle') return { card: { line: text, to: o.to, command: o.command } };
    if (o?.kind === 'own') return o.actId ? { actId: o.actId, values: o.values ?? {} } : o;
    // the plain reading did not take it: the person's own model, or no model at all (the line goes nowhere)
    if (!llm) return unread();
    outcome = null;
    currentLine = text;
    await engine.ask(threadId, text, { asSelf });
    return outcome ?? unread();
  }

  return {
    /** One line read, and kept: the line and what the door answered go into the thread afterwards. */
    async read(line, opts = {}) {
      const r = await read(line, opts);
      if (memory && threadId) {
        memory.remember(threadId, 'you', String(line ?? '').trim());
        const said = plusAnswerLine({ error: r?.error ?? null, done: r?.done ?? null, circleCard: r?.card ?? null, ownActId: r?.actId ?? null, t });
        if (said) memory.remember(threadId, 'assistant', said);
      }
      return r;
    },
    catalogue: cat,
    /** "Forget this conversation": the door's own op (`assistant-forget`), as in the person's private Telegram chat. */
    forget: () => runDoorOp('assistant-forget'),
    /** Resolves when no turn is running. */
    idle: () => engine.idle(threadId ?? undefined),
  };
}
