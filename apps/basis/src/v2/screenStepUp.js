/**
 * screenStepUp — a screen's request that waits for a yes in the person's own private chat.
 *
 * What admits people, removes them or changes what they may do (the ops declaring `stepUp: 'private-door'`) reaches the
 * admin's screen, but a screen's call does not run it: the door's call holds it here and asks in the person's private
 * chat ("Scherm 'laptop' wil Bert uit het huishouden halen. Ja / Nee"). The yes runs it as the person; no, a newer
 * request, or no answer within ten minutes drops it. The screen is told either way, by outcome only — the words are
 * the screen's own (the answer itself, an invite link say, is said in the private chat, not on the screen).
 *
 * One request per person, held in memory: a restart drops a pending request (the screen then hears nothing more and
 * the person asks again), which is the safe side of "no answer drops it".
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How long a screen's request waits for the yes. */
export const SCREEN_STEP_UP_TTL_MS = param({ key: 'assistant.screenStepUpTtlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 * 60 * 1000 });

/** The peer-message subtype a screen hears its request's outcome as: `{outcome, op}`. */
export const SCREEN_STEP_UP_SUBTYPE = 'screen-step-up';
/** What can become of a held request (each a `circle.connectScreen.stepup_<outcome>` line on the screen). */
export const SCREEN_STEP_UP_OUTCOMES = Object.freeze(['done', 'declined', 'expired', 'replaced', 'failed']);

/** What can become of a request on the screen's side alone: no word from the bot within its own ten minutes. */
export const SCREEN_STEP_UP_UNANSWERED = 'unanswered';

// a request's id: four characters a person can compare at a glance (no 0/O, 1/I)
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newId = () => { const b = new Uint8Array(4); globalThis.crypto.getRandomValues(b); return [...b].map((x) => ID_ALPHABET[x % ID_ALPHABET.length]).join(''); };

/**
 * @param {object} a
 * @param {(person: string, q: {text: string, buttons: Array<{id: string, label: string}>}) => Promise<{ok: boolean}>} a.ask
 *   the question, to the person's PRIVATE door
 * @param {(viewPubKey: string, o: {outcome: string, op?: string}) => Promise<void>|void} a.tell  tells the screen
 * @param {() => number} [a.now]
 * @param {(fn: Function, ms: number) => any} [a.setTimer]
 * @param {() => string} [a.makeId]
 */
export function createScreenStepUp({ ask, tell, now = Date.now, makeId = newId, setTimer = (fn, ms) => { const h = setTimeout(fn, ms); h?.unref?.(); return h; } }) {
  const pending = new Map();   // person → { id, app, op, args, viewPubKey, until, timer }
  const gone = new Map();      // person → Map(id → 'replaced' | 'expired'): a late tap on an old question is told why
  const told = async (req, outcome) => { try { await tell?.(req.viewPubKey, { outcome, op: req.op }); } catch { /* the screen hears nothing; the person sees the chat */ } };
  const forget = (person, req, why) => {
    const m = gone.get(person) ?? new Map();
    m.set(req.id, why);
    while (m.size > 8) m.delete(m.keys().next().value);
    gone.set(person, m);
  };
  const drop = (person) => { const req = pending.get(person); if (req) { clearTimeout(req.timer); pending.delete(person); } return req ?? null; };

  return {
    /**
     * Hold a screen's request and ask; `question(id)` words it with the request's id (its buttons carry it). A newer
     * request replaces the one before, whose screen is told.
     * @returns {Promise<{ok: boolean, id?: string, reason?: string}>}
     */
    async hold(person, { app = 'assistant', op, args, viewPubKey }, question) {
      const before = drop(person);
      if (before) { forget(person, before, 'replaced'); await told(before, 'replaced'); }
      let id = makeId();
      while (gone.get(person)?.has(id)) id = makeId();
      const req = { id, app, op, args: { ...(args ?? {}) }, viewPubKey, until: now() + SCREEN_STEP_UP_TTL_MS, timer: null };
      req.timer = setTimer(() => { if (pending.get(person) === req) { pending.delete(person); forget(person, req, 'expired'); told(req, 'expired'); } }, SCREEN_STEP_UP_TTL_MS);
      pending.set(person, req);
      const asked = await ask(person, typeof question === 'function' ? question(id) : question);
      if (!asked?.ok) { drop(person); return { ok: false, reason: asked?.reason ?? 'not-reachable' }; }
      return { ok: true, id };
    },

    /**
     * The person's answer to the request with this id, from their private door only. `{ok: true, req}` for a yes the
     * caller now runs (and then reports with `done`), `{ok: true, declined: true}` for a no, or `{ok: false, reason}`
     * (not-private, no-id, replaced, expired, nothing-pending). An answer that names another request runs nothing and
     * leaves the waiting one waiting.
     */
    async answer(person, yes, id, { isPrivate = false } = {}) {
      if (!isPrivate) return { ok: false, reason: 'not-private' };
      const want = String(id ?? '').trim().toUpperCase();
      if (!want) return { ok: false, reason: 'no-id' };
      const req = pending.get(person);
      if (!req || req.id !== want) return { ok: false, reason: gone.get(person)?.get(want) ?? 'nothing-pending' };
      drop(person);
      if (now() > req.until) { forget(person, req, 'expired'); await told(req, 'expired'); return { ok: false, reason: 'expired' }; }
      if (!yes) { await told(req, 'declined'); return { ok: true, declined: true }; }
      return { ok: true, req };
    },
    /** The outcome of a request the caller ran after the yes. */
    done: (req, ok) => told(req, ok ? 'done' : 'failed'),
  };
}
