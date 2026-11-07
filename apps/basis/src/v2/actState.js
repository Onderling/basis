import { isAtom, isWritingVerb } from '@onderling/app-manifest';
import { replyLine } from './replyLine.js';

/**
 * ACT STATE — every act a person takes paints pending · done · failed, once, for every op.
 *
 * The two-phone walk (sitting Part 2 §4): Save said nothing, a join showed nothing for 23 seconds, an Accept made the
 * post vanish and said nothing. Each screen had invented its own feedback, or none. Every act goes through the waist
 * (`{opId, args}` → `callSkill`), so ONE wrapper around the waist can know when an act starts and how it ended, and
 * ONE shared strip can paint it — the shell paints `store.current`, nothing more. A new act gets its feedback for free.
 *
 * What counts as an act (`isActOp`): an op whose verb WRITES — an atom other than `list`/`get`, or a domain verb the
 * manifest classifies `write`. Reads paint nothing (a tab's list refresh is not an act). An op the manifests do not
 * know paints nothing either: the strip never claims a state for an act it cannot name. Ops whose own surface already
 * carries their state (a message's bubble) are excluded by id.
 *
 * Which calls are the person's: the waist is also what background work dispatches (an address announce, a sync, a
 * clock's row). The shell notes the person's last interaction (a pointer, a key, a touch — `noteInteraction`), and
 * only an act begun within `ACT_INTERACTION_WINDOW_MS` of it paints. A heuristic, said plainly: a background write
 * landing inside that window would paint; the window is short so it rarely does.
 *
 * Timing, shared so the shells cannot differ: `pending` paints only after `ACT_PENDING_DELAY_MS` (a fast act never
 * flickers); `done` stays `ACT_DONE_SHOWN_MS` and clears; `failed` stays until the next act. One act at a time: the
 * newest replaces the one before.
 *
 * Words (`actStateLine`): pending → the generic line; done → the op's reply-family line when it has one (the words the
 * bot's doors already use, `replyLine`), else the generic "done"; failed → the generic line with the error's words.
 */

export const ACT_PENDING_DELAY_MS = 400;
export const ACT_DONE_SHOWN_MS = 2500;
export const ACT_INTERACTION_WINDOW_MS = 1500;

/** Ops whose own surface carries their state (a bubble): the strip stays quiet for them. */
export const ACTS_WITH_THEIR_OWN_STATE = Object.freeze(new Set([
  'broadcastCircleChatStatement',   // the circle bubble's delivery chip
  'broadcastKringMessage',          // (the older fan-out name, same bubble)
  'send-file',                      // the thread bubble's chip + the settle line (contactAttachOutcome.js)
  'sendFile',
]));

/**
 * Does this op WRITE, by the manifests' own classification? Unknown op or verb → false (no claim).
 * @param {object|(() => object)|null} manifestsByOrigin   appOrigin → manifest (or a getter)
 */
export function isActOp(manifestsByOrigin, appOrigin, opId) {
  if (typeof opId !== 'string' || !opId || ACTS_WITH_THEIR_OWN_STATE.has(opId)) return false;
  let byOrigin = null;
  try { byOrigin = typeof manifestsByOrigin === 'function' ? manifestsByOrigin() : manifestsByOrigin; } catch { byOrigin = null; }
  const manifest = byOrigin?.[appOrigin] ?? null;
  const op = manifest?.operations?.find?.((o) => o?.id === opId) ?? null;
  const verb = typeof op?.verb === 'string' ? op.verb : null;
  if (!verb) return false;
  if (isAtom(verb)) return isWritingVerb(verb);   // alias-aware: `edit`, `done`, `delete` are writes; `list`/`get`/`read` are not
  const kind = manifest?.domainVerbs?.[verb];
  return kind === 'write';
}

/** A failed act, by the waist's own conventions: thrown, `{ ok: false }`, or a string `error`. */
export function actFailed(result) {
  if (result?.ok === false) return true;
  return typeof result?.error === 'string' && result.error.length > 0;
}

/**
 * The store: `current` is `null` or `{ opId, appOrigin, args, state, result?, error?, startedAt }`.
 * Timers are injected so a test can drive them; the defaults are the host's.
 */
export function createActState({ now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let current = null;
  let lastInteraction = -Infinity;
  let seq = 0;
  let newest = null;   // the act begun last — what `end` paints, whether or not pending ever showed
  let timer = null;
  const subs = new Set();
  const notify = () => { for (const fn of subs) { try { fn(current); } catch { /* a bad painter must not stop the act */ } } };
  const later = (fn, ms) => { if (timer) clearTimer(timer); timer = setTimer(() => { timer = null; fn(); }, ms); };
  const set = (next) => { current = next; notify(); };

  return {
    get current() { return current; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    /** The person did something (a pointer, a key, a touch). */
    noteInteraction() { lastInteraction = now(); },
    /** Was the person active just now? */
    recentlyInteracted() { return now() - lastInteraction <= ACT_INTERACTION_WINDOW_MS; },
    /** An act started: returns a token the end is reported with. Pending paints after the delay, not before. */
    begin({ appOrigin, opId, args }) {
      const token = ++seq;
      newest = { token, appOrigin, opId, args, startedAt: now() };
      if (timer) { clearTimer(timer); timer = null; }
      // the previous act's done/failed line gives way at once (a new act has started), but silently until the delay
      if (current && current.token !== token) set(null);
      later(() => { if (seq === token) set({ ...newest, state: 'pending' }); }, ACT_PENDING_DELAY_MS);
      return token;
    },
    /** The act ended. Only the newest act paints its end; an older one is forgotten. */
    end(token, { result = undefined, error = null } = {}) {
      if (token !== seq || !newest) return;
      if (timer) { clearTimer(timer); timer = null; }
      const base = newest;
      const failed = error != null || actFailed(result);
      set({ ...base, state: failed ? 'failed' : 'done', result, error: error == null ? null : (error?.message ?? String(error)) });
      if (!failed) later(() => { if (current?.token === token) set(null); }, ACT_DONE_SHOWN_MS);
    },
    /** Clear whatever shows (a tap on the strip). */
    dismiss() { if (timer) { clearTimer(timer); timer = null; } if (current) set(null); },
    /**
     * An act the host KNOWS is the person's and that does not pass the waist (a circle's policy Save writes a local
     * store and the governance lane): followed the same way, no interaction window. Resolves/rejects as `promise` does.
     */
    async track({ appOrigin = 'basis', opId, args = {} } = {}, promise) {
      const token = this.begin({ appOrigin, opId, args });
      let result;
      try { result = await promise; }
      catch (err) { this.end(token, { error: err }); throw err; }
      this.end(token, { result });
      return result;
    },
  };
}

/**
 * The waist, wrapped: the same `(appOrigin, opId, args)` in, the same result out, and the store told about every act
 * the person just took. Reads, unknown ops, background calls and ops with their own state pass through untouched.
 */
export function wrapCallSkillWithActState(callSkill, { store, manifestsByOrigin } = {}) {
  if (typeof callSkill !== 'function' || !store) return callSkill;
  return async function callSkillWithActState(appOrigin, opId, args) {
    if (!store.recentlyInteracted() || !isActOp(manifestsByOrigin, appOrigin, opId)) return callSkill(appOrigin, opId, args);
    const token = store.begin({ appOrigin, opId, args });
    let result;
    try { result = await callSkill(appOrigin, opId, args); }
    catch (err) { store.end(token, { error: err }); throw err; }
    store.end(token, { result });
    return result;
  };
}

/**
 * The words for what shows, or null for nothing. `{ state, text }`.
 * @param {object|null} current   `store.current`
 * @param {{ t: Function }} o
 */
export function actStateLine(current, { t } = {}) {
  if (!current || typeof t !== 'function') return null;
  if (current.state === 'pending') return { state: 'pending', text: t('circle.act.pending') };
  if (current.state === 'failed') {
    const error = current.error ?? (typeof current.result?.error === 'string' ? current.result.error : '');
    return { state: 'failed', text: error ? t('circle.act.failed_with', { error }) : t('circle.act.failed') };
  }
  // done: the op's own family line when it has one — the words the bot's doors already use — else the plain word
  let line = null;
  try { line = replyLine(current.result, { opId: current.opId, args: current.args ?? {}, t }); } catch { line = null; }
  return { state: 'done', text: line || t('circle.act.done') };
}
