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
import { createAssistantEngine } from './assistantEngine.js';
import { scopeCatalogueToPlace } from './circleCatalogueScope.js';
import { mergeManifests } from '../manifestMerge.js';
import { catalogueManifests } from './manifestSources.js';
import { PLUS_ACTS, plusLineOutcome, plusHelpAnswer, actRunsAtOnce } from './vandaagPlus.js';
import { plusAnswerLine } from './plusThread.js';
import { interpretToCommand } from './interpretCommand.js';

/** The catalogue the own "+" offers: every composed manifest, narrowed to the ops declared for the own place. */
export function ownPlaceCatalogue({ manifests } = {}) {
  const ms = manifests ?? catalogueManifests();
  return scopeCatalogueToPlace(mergeManifests(ms.filter(Boolean).map((manifest) => ({ manifest }))), 'own');
}

/**
 * @param {object} a
 * @param {{invoke: Function}|null} a.llm          the person's OWN model (`ownModelOf`), or null: no model
 * @param {{remember: Function, recent: Function}} a.memory   the thread's memory (the bot threads over the device log)
 * @param {string|null} a.threadId                 `plusThreadId(self)`
 * @param {(key: string, vars?: object) => string} a.t
 * @param {string} [a.lang]
 * @param {() => Promise<Array>} [a.circles]       the person's circles, as `plusLineOutcome` reads them
 * @param {(asSelf: string|null) => Promise<Array>} [a.ownListsOf]   the ticked self's own lists
 * @param {(command: object, circleId: string, asSelf: string|null) => Promise<any>} [a.runInCircle]  a circle act the
 *        plain reading runs at once (the circle is clear)
 * @param {Function} [a.interpret]                 the interpreter (default `interpretToCommand`; a stand-in in tests)
 * @param {object} [a.catalogue]                   default: `ownPlaceCatalogue()`
 * @param {Array} [a.acts]                         the own acts (default: the catalogue's own-scope attach entries)
 */
export function createPlusDoor({
  llm = null, memory, threadId = null, t, lang = 'nl', circles = async () => [], ownListsOf = async () => [],
  runInCircle = null, interpret = interpretToCommand, catalogue = null, acts = PLUS_ACTS,
} = {}) {
  if (typeof t !== 'function') throw new TypeError('createPlusDoor: t required');
  if (llm && !(memory && threadId)) throw new TypeError('createPlusDoor: a model needs the thread (memory and threadId)');
  const cat = catalogue ?? ownPlaceCatalogue();
  const unread = () => ({ error: t('circle.vandaag.plus_line_unread') });

  // What this turn came to: set by the engine's sinks while the turn runs (the lane runs one turn at a time).
  let outcome = null;
  const engine = createAssistantEngine({
    catalogue: cat, lang, llm, interpret, collectMs: 0, dispatchSlash: false,
    ...(memory ? { memory } : {}),
    // The yes of an own act is its form: a proposal opens the act's form filled, and nothing is stored here.
    dispatch: (input) => {
      const cmd = typeof input === 'object' && input ? input : null;
      // only the acts that MAKE something: a line is never read as "open a door" (feedback runs from its button)
      const act = cmd && acts.find((a) => a.opId === cmd.opId && !actRunsAtOnce(a));
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
    await engine.ask(threadId, text);
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
    /** Resolves when no turn is running. */
    idle: () => engine.idle(threadId ?? undefined),
  };
}
