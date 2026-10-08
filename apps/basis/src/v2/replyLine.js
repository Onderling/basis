/**
 * replyLine — what a person reads after an op ran: one worded line per op FAMILY, the same on every door.
 *
 * An op answers with what happened (the line it put on which list, the chore and who holds it, the appointment and
 * when) and, often, a sentence of its own. What the person READS is decided here, once: the household bot's doors
 * (Telegram, its inbox, a circle it joined — the gate's replies and the model's alike, since both end in the same op
 * results) and the web and mobile circle bubble all word an op of these families through this table.
 *
 *   add          a line put on a list               "Op de lijst Boodschappen: melk, brood."
 *   done         a line ticked off, a chore done    "Afgevinkt: boter."
 *   removed      a line taken off a list            "Van Boodschappen gehaald: brood."
 *   chore        a chore taken, given, given up, with its day, removed, changed
 *                                                   "Klusje 'lamp vervangen' is van Bob, za 10 okt."
 *   appointment  an appointment set, answered, cancelled — its day and time in the person's date language
 *                                                   "Afspraak 'tandarts' staat op di 14 okt 10:00."
 *   list         a list's own verbs (made, removed, put back, a line edited or made a chore): the op's own sentence
 *
 * Within one turn the lines of a family fold into one ("melk", "brood" added to one list is one line); a door that
 * paints a turn at once folds them (`replyLines`), a door that paints each reply on its own says each (`replyLine`).
 * A family op that did not hand over what it did says its own sentence; an op outside the families, and a refusal, get
 * no line here (the door paints them as it always did). The words are the locale's; the day is `whenWords`.
 */
import { whenWords, dateLocaleOf } from './whenWords.js';
import { translatorOr } from '../locales/translatorOr.js';

/** The op families: op id → family. The ops a household bot reaches that act (its reads are painted as lists). */
export const REPLY_FAMILY = Object.freeze({
  addToList: 'add',
  markListItemDone: 'done',
  completeTask: 'done',
  removeFromList: 'removed',
  makeChore: 'chore',
  claimTask: 'chore',
  reassignTask: 'chore',
  removeTask: 'chore',
  editTask: 'chore',
  addEvent: 'appointment',
  rsvpAccept: 'appointment',
  rsvpDecline: 'appointment',
  rsvpTentative: 'appointment',
  cancelEvent: 'appointment',
  createList: 'list',
  removeList: 'list',
  restoreList: 'list',
  editEntry: 'list',
  entryReminders: 'list',
});

const RSVP = Object.freeze({ rsvpAccept: 'accepted', rsvpDecline: 'declined', rsvpTentative: 'tentative' });

/** An op id as the table knows it: a qualified one (`lists.addToList`, `tasks/claimTask`) is its op. */
const bareOp = (opId) => String(opId ?? '').replace(/^[A-Za-z-]+[./]/, '');
const wordsOf = (x) => (x && typeof x === 'object' ? (x.text || x.title || null) : null);

/**
 * What one op result says, without its words yet: the family, the locale key and its values, the moment it names, and —
 * for a line that folds with others of its family in a turn — the group it folds into and its item.
 * @param {*} result  what the op returned
 * @param {{opId: string, args?: object}} o
 * @returns {null|{family: string, message?: string, key?: string, vars?: object, item?: string, fold?: string,
 *   when?: {at: *, dayOnly: boolean|'auto', suffix?: boolean}}}
 */
export function replyFact(result, { opId, args = {} } = {}) {
  const id = bareOp(opId);
  const family = REPLY_FAMILY[id];
  if (!family || !result || typeof result !== 'object' || Array.isArray(result)) return null;
  if (result.ok === false || result.error) return null;
  const own = typeof result.message === 'string' && result.message ? { family, message: result.message } : null;
  switch (family) {
    case 'add':
      if (result.chore) return choreFact(family, result.chore) ?? own;
      if (result.duplicate || !result.entry || !result.list) return own;
      return { family, key: 'circle.lists.added', vars: { name: result.list }, item: result.entry, fold: `add:${result.list}` };
    case 'done': {
      const what = result.entry ?? wordsOf(result.task);
      return what ? { family, key: 'circle.lists.done_named', vars: {}, item: what, fold: 'done' } : own;
    }
    case 'removed':
      return result.entry && result.list
        ? { family, key: 'circle.lists.removed', vars: { name: result.list }, item: result.entry, fold: `removed:${result.list}` }
        : own;
    case 'chore':
      return choreOpFact(id, result, args) ?? own;
    case 'appointment': {
      if (!result.title || !result.startsAt) return own;
      const key = id === 'addEvent' ? (result.duplicate ? 'circle.calendar.already_there' : 'circle.calendar.added')
        : id === 'cancelEvent' ? 'circle.calendar.cancelled'
          : `circle.calendar.rsvp_${RSVP[id]}`;
      return { family, key, vars: { title: result.title }, when: { at: result.startsAt, dayOnly: false } };
    }
    default:
      return own;
  }
}

/** A chore an add or a "make it a chore" made, with who holds it and its day (what the door said it did). */
function choreFact(family, chore) {
  const title = chore?.title;
  if (!title) return null;
  const due = chore.dueAt ? { at: chore.dueAt, dayOnly: 'auto', suffix: true } : null;
  const when = due ?? { at: null, dayOnly: 'auto', suffix: true };
  if (chore.holder === 'self') return { family, key: 'circle.reply.chore_claimed', vars: { title }, when };
  if (chore.holder === 'named' && chore.name) return { family, key: 'circle.reply.chore_theirs', vars: { title, name: chore.name }, when };
  if (chore.holder === 'named' || chore.holder === 'given') return { family, key: 'circle.reply.chore_given', vars: { title }, when };
  if (due) return { family, key: 'circle.reply.chore_due', vars: { title }, when: { ...due, suffix: false } };
  return null;
}

/** A chore's own verbs: taken, given (to a name, or to nobody), removed, changed. */
function choreOpFact(id, result, args) {
  if (result.chore) return choreFact('chore', result.chore);
  const family = 'chore';
  const title = result.title ?? wordsOf(result.task);
  if (!title) return null;
  const dueAt = result.task?.dueAt ?? null;
  const when = { at: dueAt, dayOnly: 'auto', suffix: true };
  switch (id) {
    case 'claimTask': return { family, key: 'circle.reply.chore_claimed', vars: { title }, when };
    case 'reassignTask': {
      const to = typeof result.to === 'string' && result.to.trim() ? result.to.trim() : null;
      return to ? { family, key: 'circle.reply.chore_theirs', vars: { title, name: to }, when } : { family, key: 'circle.reply.chore_open', vars: { title } };
    }
    case 'removeTask': return { family, key: 'circle.reply.chore_removed', vars: { title } };
    case 'editTask': return result.unchanged ? null : { family, key: 'circle.reply.chore_edited', vars: { title } };
    default: return null;
  }
}

/** A fact in the person's words (`t` is theirs; its bundle names the date language). */
function word(fact, t) {
  if (fact.message) return fact.message;
  const vars = { ...(fact.item != null ? { text: (fact.items ?? [fact.item]).join(', ') } : {}), ...fact.vars };
  if (fact.when) {
    const w = whenWords(fact.when.at, { locale: dateLocaleOf(t), dayOnly: fact.when.dayOnly });
    vars.when = fact.when.suffix ? (w ? `, ${w}` : '') : w;
  }
  return t(fact.key, vars);
}

/**
 * The line one op result reads as, or null (not one of the families, or a refusal: the door paints it as before).
 * @param {*} result  what the op returned
 * @param {{opId: string, args?: object, t: Function}} o
 * @returns {string|null}
 */
export function replyLine(result, { opId, args, t } = {}) {
  const fact = replyFact(result, { opId, args });
  return fact ? word(fact, translatorOr(t, 'replyLine.js')) : null;
}

/**
 * A turn's facts as lines: those of a family that fold (adds to one list, ticks, lines off one list) become one line,
 * in the place of the first; the rest each their own. The order is the turn's.
 * @param {Array<ReturnType<typeof replyFact>>} facts
 * @param {{t: Function}} o
 * @returns {string[]}
 */
export function replyLines(facts, { t } = {}) {
  const tr = translatorOr(t, 'replyLine.js');
  const out = [];
  const groups = new Map();
  for (const f of facts ?? []) {
    if (!f) continue;
    if (f.fold) {
      const g = groups.get(f.fold);
      if (g) { g.items.push(f.item); continue; }
      const first = { ...f, items: [f.item] };
      groups.set(f.fold, first);
      out.push(first);
      continue;
    }
    out.push(f);
  }
  return out.map((f) => word(f, tr)).filter(Boolean);
}
