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
 * …and the people reads, worded the same way (a read without its question is painted as a list, as before):
 *   who          the chores that hold some words, with who does them and when ("wie doet de lamp")
 *                                                   "Klusje 'lamp vervangen' is van Bob, za 10 okt."
 *   mine         someone else's open chores, by the name asked ("wat moet Bob doen")
 *                                                   "Bob doet: lamp vervangen (za 10 okt); ramen."
 *   day          one day: its appointments with who comes, its chores with who does them ("wie is er zaterdag")
 *
 * A person a reader may not name is "iemand" in these lines — the reads hand over `{you}`, `{name}` or `{someone}` per
 * person, under the household's names ceiling; a row that never went through it names nobody, and never an id.
 *
 * Within one turn the lines of a family fold into one ("melk", "brood" added to one list is one line); a door that
 * paints a turn at once folds them (`replyLines`), a door that paints each reply on its own says each (`replyLine`).
 * A family op that did not hand over what it did says its own sentence; an op outside the families, and a refusal, get
 * no line here (the door paints them as it always did). The words are the locale's; the day is `whenWords`.
 */
import { whenWords, timeWords, dateLocaleOf } from './whenWords.js';
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
  // a household note written or taken away: in the op's own words ("Onthouden: …", "Vergeten: …")
  '__generic__:household:add:note': 'list',
  '__generic__:household:remove:note': 'list',
  // the people reads
  listOpen: 'who',
  listMine: 'mine',
  weekOverview: 'day',
});

/** The families that READ: a door paints their line instead of the list it would paint (`isReadFamily`). */
const READ_FAMILIES = new Set(['who', 'mine', 'day']);

/** Is this op one of the people reads (its answer a line, when it carries its question)? */
export const isReadFamily = (opId) => READ_FAMILIES.has(REPLY_FAMILY[bareOp(opId)]);

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
    case 'who':
      return whoFact(result, args);
    case 'mine':
      return mineFact(result);
    case 'day':
      return dayFact(result);
    case 'appointment': {
      if (!result.title || !result.startsAt) return own;
      const key = id === 'addEvent' ? (result.duplicate ? 'circle.calendar.already_there' : 'circle.calendar.added')
        : id === 'cancelEvent' ? 'circle.calendar.cancelled'
          : `circle.calendar.rsvp_${RSVP[id]}`;
      // a day without a time (local midnight — the whole day) is said without a time, as a chore's day is
      return { family, key, vars: { title: result.title }, when: { at: result.startsAt, dayOnly: 'auto' } };
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

/** The people a row names, as a reader may see them: their own `{you}`, a `{name}`, or `{someone}` they may not name. */
const RAW_HOLDERS = (row) => [...(Array.isArray(row?.assignees) ? row.assignees : []), row?.assignee].filter(Boolean);
function holdersOf(row) {
  if (Array.isArray(row?.heldBy)) return row.heldBy;
  // a row that never went through the reader's ceiling: who holds it is not named here, and never by its id
  const raw = RAW_HOLDERS(row);
  return raw.length || row?.state === 'claimed' ? [{ someone: true }] : [];
}
const titleOf = (row) => row?.text ?? row?.title ?? row?.label ?? '';
const choreDue = (row) => (row?.dueAt ? { at: row.dueAt, dayOnly: 'auto', suffix: true } : { at: null, dayOnly: 'auto', suffix: true });

/** "wie doet de lamp": the chores holding the words — none, one with who and when, or several, one row each. */
function whoFact(result, args) {
  const words = typeof result?.text === 'string' && result.text.trim() ? result.text.trim()
    : (typeof args?.text === 'string' && args.text.trim() ? args.text.trim() : null);
  const rows = Array.isArray(result?.items) ? result.items : null;
  if (!words || !rows) return null;
  const family = 'who';
  const choreOf = (row, held, open) => {
    const who = holdersOf(row);
    return who.length ? { key: held, vars: { title: titleOf(row) }, who, when: choreDue(row) } : { key: open, vars: { title: titleOf(row) }, when: choreDue(row) };
  };
  if (!rows.length) return { family, key: 'circle.reply.who_none', vars: { text: words } };
  if (rows.length === 1) return { family, ...choreOf(rows[0], 'circle.reply.who_held', 'circle.reply.who_open') };
  return { family, key: 'circle.reply.who_several', vars: { count: rows.length, text: words }, rows: rows.map((r) => choreOf(r, 'circle.reply.who_row_held', 'circle.reply.who_row_open')) };
}

/** "wat moet Bob doen": the chores of the person named (the read says whose); one's own stays the list. */
function mineFact(result) {
  const name = typeof result?.whose === 'string' && result.whose ? result.whose : null;
  const rows = Array.isArray(result?.items) ? result.items : null;
  if (!name || !rows) return null;
  const family = 'mine';
  if (!rows.length) return { family, key: 'circle.reply.mine_none', vars: { name } };
  return {
    family, key: 'circle.reply.mine_list', vars: { name },
    rows: rows.map((r) => (r?.dueAt
      ? { key: 'circle.reply.mine_row_due', vars: { title: titleOf(r) }, when: { at: r.dueAt, dayOnly: 'auto' } }
      : { key: 'circle.reply.mine_row', vars: { title: titleOf(r) } })),
  };
}

/** A day as `YYYY-MM-DD` on the household's clock (its own midnight, not UTC's). */
const localDay = (ymd) => { const [y, m, d] = String(ymd).split('-').map(Number); return y && m && d ? new Date(y, m - 1, d) : null; };

/** "wie is er zaterdag": that day's appointments with who comes, and its chores with who does them. */
function dayFact(result) {
  const at = typeof result?.day === 'string' ? localDay(result.day) : null;
  if (!at || !Array.isArray(result?.events) || !Array.isArray(result?.chores)) return null;
  const family = 'day';
  const when = { at, dayOnly: true };
  if (!result.events.length && !result.chores.length) return { family, key: 'circle.reply.day_none', vars: {}, when };
  const lines = [
    { key: 'circle.reply.day_head', vars: {}, when },
    ...result.events.map((e) => ({ key: 'circle.reply.day_event', vars: { time: e?.startsAt ?? null, title: titleOf(e) }, who: e?.everyone ? 'everyone' : (Array.isArray(e?.comes) ? e.comes : []) })),
    ...result.chores.map((c) => ({ key: 'circle.reply.day_chore', vars: { title: titleOf(c) }, who: holdersOf(c), nobody: true })),
  ];
  return { family, lines };
}

/** People in the person's words: "jou", a name, "iemand" (once, however many), joined as their language joins a list. */
function peopleWords(who, t) {
  if (who === 'everyone') return t('circle.reply.who_everyone');
  const words = [];
  for (const p of who ?? []) {
    const w = p?.you ? t('circle.reply.who_you') : (typeof p?.name === 'string' && p.name ? p.name : t('circle.reply.who_someone'));
    if (!words.includes(w)) words.push(w);
  }
  try { return new Intl.ListFormat(dateLocaleOf(t), { type: 'conjunction' }).format(words); } catch { return words.join(', '); }
}

/** A fact in the person's words (`t` is theirs; its bundle names the date language). */
function word(fact, t) {
  if (fact.message) return fact.message;
  if (Array.isArray(fact.lines)) return fact.lines.map((l) => word(l, t)).join('\n');
  const vars = {
    ...(Array.isArray(fact.rows) ? { chores: fact.rows.map((r) => word(r, t)).join('; ') } : {}),
    ...(fact.item != null ? { text: (fact.items ?? [fact.item]).join(', ') } : {}),
    ...fact.vars,
  };
  if (fact.who !== undefined) vars.who = Array.isArray(fact.who) && !fact.who.length && fact.nobody ? t('circle.reply.who_nobody') : peopleWords(fact.who, t);
  if ('time' in vars) vars.time = timeWords(vars.time);
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
