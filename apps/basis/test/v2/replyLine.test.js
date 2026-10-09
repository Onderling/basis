/**
 * replyLine — one worded line per op family, from what the op returned. The words are the locale's (the key and its
 * values are checked here); the day and time are written in the locale's own date language.
 */
import { describe, it, expect } from 'vitest';
import { replyLine, replyLines, replyFact, REPLY_FAMILY, isReadFamily } from '../../src/v2/replyLine.js';
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

describe('the people reads: who does it, whose, who is there on a day', () => {
  const ann = { name: 'Ann' };
  it('who does it: the holders and the day; nobody; none; several — as the row count says', () => {
    const one = (row) => replyLine({ text: 'lamp', items: [row] }, { opId: 'listOpen', t });
    expect(one({ text: 'lamp vervangen', dueAt: day.toISOString(), heldBy: [ann] }))
      .toBe('circle.reply.who_held:{"title":"lamp vervangen","who":"Ann","when":", za 10 okt"}');
    expect(one({ text: 'lamp vervangen', heldBy: [{ you: true }, ann] }))
      .toBe('circle.reply.who_held:{"title":"lamp vervangen","who":"circle.reply.who_you en Ann","when":""}');
    expect(one({ text: 'lamp vervangen', heldBy: [] })).toBe('circle.reply.who_open:{"title":"lamp vervangen","when":""}');
    expect(replyLine({ text: 'fiets', items: [] }, { opId: 'listOpen', t })).toBe('circle.reply.who_none:{"text":"fiets"}');
    expect(replyLine({ text: 'lamp', items: [{ text: 'lamp vervangen', heldBy: [ann] }, { text: 'lamp kopen', heldBy: [] }] }, { opId: 'listOpen', t }))
      .toBe('circle.reply.who_several:{"chores":"circle.reply.who_row_held:{\\"title\\":\\"lamp vervangen\\",\\"who\\":\\"Ann\\",\\"when\\":\\"\\"}; circle.reply.who_row_open:{\\"title\\":\\"lamp kopen\\",\\"when\\":\\"\\"}","count":2,"text":"lamp"}');
    // the words read for may come as the call's args (a door that did not hand them back)
    expect(replyLine({ items: [] }, { opId: 'listOpen', args: { text: 'fiets' }, t })).toBe('circle.reply.who_none:{"text":"fiets"}');
    // without words it is the plain open read: painted as a list, no line
    expect(replyLine({ items: [{ text: 'lamp' }] }, { opId: 'listOpen', t })).toBeNull();
  });

  it('the ceiling: a holder the reader may not name is "someone", never an id — whatever the row carries', () => {
    expect(replyLine({ text: 'lamp', items: [{ text: 'lamp vervangen', heldBy: [{ someone: true }] }] }, { opId: 'listOpen', t }))
      .toBe('circle.reply.who_held:{"title":"lamp vervangen","who":"circle.reply.who_someone","when":""}');
    // a row that was never put through the reader's ceiling (no `heldBy`): its holders are not named, its ids never said
    const raw = replyLine({ text: 'lamp', items: [{ text: 'lamp vervangen', assignees: ['telegram:7'], state: 'claimed' }] }, { opId: 'listOpen', t });
    expect(raw).toBe('circle.reply.who_held:{"title":"lamp vervangen","who":"circle.reply.who_someone","when":""}');
    expect(raw).not.toContain('telegram:7');
  });

  it('whose: someone else\'s chores, by the name asked; none; my own stays the list', () => {
    expect(replyLine({ whose: 'Bob', items: [{ text: 'lamp vervangen', dueAt: day.toISOString() }, { text: 'ramen' }] }, { opId: 'listMine', t }))
      .toBe('circle.reply.mine_list:{"chores":"circle.reply.mine_row_due:{\\"title\\":\\"lamp vervangen\\",\\"when\\":\\"za 10 okt\\"}; circle.reply.mine_row:{\\"title\\":\\"ramen\\"}","name":"Bob"}');
    expect(replyLine({ whose: 'Bob', items: [] }, { opId: 'listMine', t })).toBe('circle.reply.mine_none:{"name":"Bob"}');
    expect(replyLine({ items: [{ text: 'ramen' }] }, { opId: 'listMine', t })).toBeNull();
  });

  it('a day: its appointments with who comes, its chores with who does them; nothing that day', () => {
    const r = { ok: true, day: '2026-10-10', events: [{ title: 'tandarts', startsAt: new Date(2026, 9, 10, 10, 0).toISOString(), comes: [ann] }, { title: 'feest', startsAt: new Date(2026, 9, 10, 20, 0).toISOString(), everyone: true }], chores: [{ text: 'lamp', heldBy: [{ someone: true }] }, { text: 'ramen', heldBy: [] }] };
    expect(replyLine(r, { opId: 'weekOverview', t }).split('\n')).toEqual([
      'circle.reply.day_head:{"when":"za 10 okt"}',
      'circle.reply.day_event:{"time":"10:00","title":"tandarts","who":"Ann"}',
      'circle.reply.day_event:{"time":"20:00","title":"feest","who":"circle.reply.who_everyone"}',
      'circle.reply.day_chore:{"title":"lamp","who":"circle.reply.who_someone"}',
      'circle.reply.day_chore:{"title":"ramen","who":"circle.reply.who_nobody"}',
    ]);
    expect(replyLine({ ok: true, day: '2026-10-10', events: [], chores: [] }, { opId: 'weekOverview', t })).toBe('circle.reply.day_none:{"when":"za 10 okt"}');
    // the week, without a day: its own words
    expect(replyLine({ ok: true, message: 'De week' }, { opId: 'weekOverview', t })).toBeNull();
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
    const reads = new Set(['listLists', 'listEntries', '__generic__:household:list:note', 'shopVisit', 'listMine', 'listEvents', 'weekOverview', 'sendWeekOverview']);
    // the people reads are worded too (who does it · whose · a day)
    expect(isReadFamily('listOpen') && isReadFamily('listMine') && isReadFamily('weekOverview')).toBe(true);
    expect(isReadFamily('addToList')).toBe(false);
    // the door's own ops answer in their own words (a reminder set or taken away; one said by the runner)
    const own = (id) => id.startsWith('assistant-') || ['remindMe', 'cancelReminder', 'sayReminder'].includes(id);
    const acts = [...new Set([...BOT_OP_MAP.member, ...BOT_OP_MAP.admin].map((q) => q.slice(q.indexOf('.') + 1)))].filter((id) => !reads.has(id) && !own(id));
    expect(acts.filter((id) => !REPLY_FAMILY[id])).toEqual([]);
  });
});
