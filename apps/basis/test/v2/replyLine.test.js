/**
 * replyLine — one worded line per op family, from what the op returned. The words are the locale's (the key and its
 * values are checked here); the day and time are written in the locale's own date language.
 */
import { describe, it, expect } from 'vitest';
import { replyLine, replyLines, replyFact, REPLY_FAMILY } from '../../src/v2/replyLine.js';
import { BOT_OP_MAP } from '../../src/v2/botOpMap.js';

const t = (k, p) => (k === 'circle.reply.date_locale' ? 'nl-NL' : p ? `${k}:${JSON.stringify(p)}` : k);
const at = new Date(2026, 9, 9, 10, 0);   // vr 9 okt 10:00, the household's clock
const day = new Date(2026, 9, 10);        // za 10 okt, a chore's day (no time)

describe('replyLine, per family', () => {
  it('add: the list and the thing; a second add is not repeated as a sentence', () => {
    expect(replyLine({ ok: true, entry: 'melk', list: 'Boodschappen', message: 'm' }, { opId: 'addToList', t }))
      .toBe('circle.lists.added:{"text":"melk","name":"Boodschappen"}');
    // already there: the op's own words
    expect(replyLine({ ok: true, duplicate: true, message: "'melk' staat al op Boodschappen." }, { opId: 'addToList', t }))
      .toBe("'melk' staat al op Boodschappen.");
  });

  it('done: a list line and a chore are both ticked off', () => {
    expect(replyLine({ ok: true, entry: 'melk', list: 'Boodschappen' }, { opId: 'markListItemDone', t })).toBe('circle.lists.done_named:{"text":"melk"}');
    expect(replyLine({ ok: true, message: '✓ Klaar: lamp', task: { id: 'c', text: 'lamp' } }, { opId: 'completeTask', t })).toBe('circle.lists.done_named:{"text":"lamp"}');
    // a list line that was a chore: ticked by the chore's verb, its answer the chore's
    expect(replyLine({ ok: true, task: { id: 'c', text: 'lamp' } }, { opId: 'markListItemDone', t })).toBe('circle.lists.done_named:{"text":"lamp"}');
  });

  it('removed: from which list', () => {
    expect(replyLine({ ok: true, entry: 'brood', list: 'Boodschappen' }, { opId: 'removeFromList', t })).toBe('circle.lists.removed:{"text":"brood","name":"Boodschappen"}');
  });

  it('chores: taken · whose · given · nobody\'s · a day · removed · changed', () => {
    expect(replyLine({ ok: true, task: { id: 'c', text: 'lamp', dueAt: day.toISOString() } }, { opId: 'claimTask', t }))
      .toBe('circle.reply.chore_claimed:{"title":"lamp","when":", za 10 okt"}');
    expect(replyLine({ ok: true, title: 'ramen', to: 'Bob', task: { id: 'c', text: 'ramen' } }, { opId: 'reassignTask', t }))
      .toBe('circle.reply.chore_theirs:{"title":"ramen","name":"Bob","when":""}');
    expect(replyLine({ ok: true, title: 'ramen', task: { id: 'c', text: 'ramen' } }, { opId: 'reassignTask', t }))
      .toBe('circle.reply.chore_open:{"title":"ramen"}');
    // an add that says who and when
    expect(replyLine({ ok: true, chore: { title: 'ramen', holder: 'self', dueAt: day.toISOString() } }, { opId: 'addToList', t }))
      .toBe('circle.reply.chore_claimed:{"title":"ramen","when":", za 10 okt"}');
    expect(replyLine({ ok: true, chore: { title: 'ramen', holder: 'named', name: 'Bob' } }, { opId: 'makeChore', t }))
      .toBe('circle.reply.chore_theirs:{"title":"ramen","name":"Bob","when":""}');
    expect(replyLine({ ok: true, chore: { title: 'ramen', holder: 'given' } }, { opId: 'addToList', t }))
      .toBe('circle.reply.chore_given:{"title":"ramen","when":""}');
    expect(replyLine({ ok: true, chore: { title: 'stofzuigen', holder: null, dueAt: day.toISOString() } }, { opId: 'addToList', t }))
      .toBe('circle.reply.chore_due:{"title":"stofzuigen","when":"za 10 okt"}');
    expect(replyLine({ ok: true, title: 'stofzuigen', message: '✓ Weggehaald: stofzuigen' }, { opId: 'removeTask', t }))
      .toBe('circle.reply.chore_removed:{"title":"stofzuigen"}');
    expect(replyLine({ ok: true, title: 'ramen boven', message: '✓ Aangepast: ramen boven' }, { opId: 'editTask', t }))
      .toBe('circle.reply.chore_edited:{"title":"ramen boven"}');
    // an edit that changed nothing: the op's own words
    expect(replyLine({ ok: true, unchanged: true, message: 'Niets veranderd aan: ramen' }, { opId: 'editTask', t })).toBe('Niets veranderd aan: ramen');
  });

  it('appointments: the day and the time in the locale\'s date language', () => {
    expect(replyLine({ ok: true, title: 'tandarts', startsAt: at.toISOString() }, { opId: 'addEvent', t }))
      .toBe('circle.calendar.added:{"title":"tandarts","when":"vr 9 okt 10:00"}');
    expect(replyLine({ ok: true, duplicate: true, title: 'tandarts', startsAt: at.toISOString() }, { opId: 'addEvent', t }))
      .toBe('circle.calendar.already_there:{"title":"tandarts","when":"vr 9 okt 10:00"}');
    expect(replyLine({ ok: true, title: 'tandarts', startsAt: at.toISOString() }, { opId: 'rsvpDecline', t }))
      .toBe('circle.calendar.rsvp_declined:{"title":"tandarts","when":"vr 9 okt 10:00"}');
    expect(replyLine({ ok: true, title: 'tandarts', startsAt: at.toISOString() }, { opId: 'cancelEvent', t }))
      .toBe('circle.calendar.cancelled:{"title":"tandarts","when":"vr 9 okt 10:00"}');
  });

  it('a family op without its facts says the op\'s own words; an op outside the families, and a refusal, say nothing here', () => {
    expect(replyLine({ ok: true, message: 'Lijst "werk" gemaakt.' }, { opId: 'createList', t })).toBe('Lijst "werk" gemaakt.');
    expect(replyLine({ ok: true, message: 'x' }, { opId: 'listContacts', t })).toBeNull();
    expect(replyLine({ ok: false, error: 'nee' }, { opId: 'addToList', t })).toBeNull();
    // a qualified id is its op
    expect(replyLine({ ok: true, entry: 'melk', list: 'Boodschappen' }, { opId: 'lists.addToList', t })).toBe('circle.lists.added:{"text":"melk","name":"Boodschappen"}');
  });
});

describe('replyLines — one line per family in a turn', () => {
  it('adds to one list fold into one line; another list is its own; the order is kept', () => {
    const facts = [
      replyFact({ ok: true, entry: 'melk', list: 'Boodschappen' }, { opId: 'addToList' }),
      replyFact({ ok: true, entry: 'lamp', list: 'Klusjes' }, { opId: 'addToList' }),
      replyFact({ ok: true, entry: 'brood', list: 'Boodschappen' }, { opId: 'addToList' }),
      replyFact({ ok: true, entry: 'kaas', list: 'Boodschappen' }, { opId: 'markListItemDone' }),
      replyFact({ ok: true, task: { text: 'ramen' } }, { opId: 'completeTask' }),
    ];
    expect(replyLines(facts, { t })).toEqual([
      'circle.lists.added:{"text":"melk, brood","name":"Boodschappen"}',
      'circle.lists.added:{"text":"lamp","name":"Klusjes"}',
      'circle.lists.done_named:{"text":"kaas, ramen"}',
    ]);
  });
});

describe('the families cover what the bot reaches', () => {
  it('every op on the bot\'s map that acts has a family; the reads are painted as lists', () => {
    const reads = new Set(['listLists', 'listEntries', 'shopVisit', 'listMine', 'listEvents', 'weekOverview', 'sendWeekOverview']);
    const own = (id) => id.startsWith('assistant-') || id === 'remindMe';
    const acts = [...new Set([...BOT_OP_MAP.member, ...BOT_OP_MAP.admin])].filter((id) => !reads.has(id) && !own(id));
    expect(acts.filter((id) => !REPLY_FAMILY[id])).toEqual([]);
  });
});
