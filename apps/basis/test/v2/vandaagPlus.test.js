/**
 * Vandaag's "+": an own note or an own appointment — into the person's own store (the own-devices scope), never a
 * circle. One shared model both shells paint: the two acts, their fields, and the op each compiles to.
 */
import { describe, it, expect } from 'vitest';
import { decodeGenericOpId } from '@onderling/app-manifest';
import { PLUS_ACTS, plusActs, plusMomentNeedsTime, plusOp, plusFollowUp, plusEditFor, plusSaveOp, plusRemoveOp, plusShareOp, plusShareTargets, plusRead, actRunsAtOnce, plusCardWords } from '../../src/v2/vandaagPlus.js';
import { OWN_DEVICES_SCOPE } from '../../src/v2/grantsManifest.js';
// N CALENDAR days from now at this clock time — never `now + N × 24h`, which on a DST night lands on the wrong day
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

describe('Vandaag — the "+"', () => {
  it('offers the own-scope attach entries the composed manifests declare — each with its fields', () => {
    expect(PLUS_ACTS.map((a) => a.id)).toEqual(['basis.feedback', 'household.note', 'calendar.calendar-event']);
    expect(PLUS_ACTS.find((a) => a.id === 'calendar.calendar-event').fields.map((f) => f.name)).toEqual(['title', 'when']);
    // feedback makes nothing and asks nothing: it names itself and runs at once (no empty form)
    const fb = PLUS_ACTS.find((a) => a.id === 'basis.feedback');
    expect(fb).toMatchObject({ noun: null, labelKey: 'circle.feedback.plus' });
    expect(actRunsAtOnce(fb)).toBe(true);
    expect(actRunsAtOnce(PLUS_ACTS.find((a) => a.id === 'household.note'))).toBe(false);
  });

  it('an entry not declared for the own scope never appears on Vandaag (a circle composer entry stays a circle\'s)', () => {
    const acts = plusActs({ manifestsByOrigin: {
      lists: { app: 'lists', operations: [{ id: 'createList', surfaces: { attach: { label: 'x' } } }] },
      calendar: { app: 'calendar', operations: [{ id: 'addEvent', appliesTo: { type: 'calendar-event' }, scopes: ['own', 'circle'], surfaces: { attach: { label: 'y', buttonIn: ['own'] } }, params: [] }] },
    } });
    expect(acts.map((a) => a.opId)).toEqual(['addEvent']);
  });

  it('an own note compiles to the generic note add on the own scope', () => {
    const op = plusOp('household.note', { body: '  sleutel bij de buren ' });
    expect(op.app).toBe('household');
    expect(decodeGenericOpId(op.opId)).toMatchObject({ app: 'household', atom: 'add', noun: 'note' });
    expect(op.args).toEqual({ circleId: OWN_DEVICES_SCOPE, body: 'sleutel bij de buren' });
  });

  it('an own appointment compiles to addEvent on the own scope, its moment as an ISO time', () => {
    const op = plusOp('calendar.calendar-event', { title: 'tandarts', when: '2026-10-20T14:00' });
    expect(op).toMatchObject({ app: 'calendar', opId: 'addEvent' });
    expect(op.args.title).toBe('tandarts');
    expect(op.args.circleId).toBe(OWN_DEVICES_SCOPE);
    expect(new Date(op.args.when).getTime()).toBe(new Date('2026-10-20T14:00').getTime());
  });

  it('a moment in words is read by the one bounded reader — and one it cannot read is said, not guessed', () => {
    const op = plusOp('calendar.calendar-event', { title: 'tandarts', when: 'morgen om 14:00' });
    const d = new Date(op.args.when);
    const tomorrow = daysFromNow(1);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([tomorrow.getDate(), 14, 0]);
    expect(plusOp('calendar.calendar-event', { title: 'x', when: 'ooit eens' })).toEqual({ error: 'circle.vandaag.plus_when_unread' });
  });

  it('an empty field is refused before any op', () => {
    expect(plusOp('household.note', { body: '  ' })).toEqual({ error: 'circle.vandaag.plus_empty' });
    expect(plusOp('calendar.calendar-event', { title: 'x', when: '' })).toEqual({ error: 'circle.vandaag.plus_empty' });
    expect(plusOp('nope', {})).toEqual({ error: 'circle.vandaag.plus_empty' });
  });
});

describe('Vandaag — where an own item shows', () => {
  const page = (blocks) => ({ screens: [{ id: 'p1', name: 'Vandaag', blocks }], activeId: 'p1' });
  it('a page without a notes block gets one, through the screen op, after an own note', () => {
    expect(plusFollowUp(page([{ id: 'b', type: 'calendar', config: {} }]), 'household.note'))
      .toEqual({ opId: 'screen-add-block', args: { pageId: 'p1', type: 'notes', config: {} } });
  });
  it('a page that already shows the type needs nothing', () => {
    expect(plusFollowUp(page([{ id: 'b', type: 'notes', config: {} }]), 'household.note')).toBe(null);
    expect(plusFollowUp(page([{ id: 'b', type: 'calendar', config: {} }]), 'calendar.calendar-event')).toBe(null);
  });
});

describe('Vandaag — a row opens the sheet on itself (change it, or take it away)', () => {
  it('an own note row: its act, its words, its change and its removal on the own scope', () => {
    const e = plusEditFor({ id: 'n1', own: true, fields: { body: 'melk' } }, 'note');
    expect(e).toMatchObject({ id: 'n1', values: { body: 'melk' } });
    expect(e.act.id).toBe('household.note');
    const save = plusSaveOp(e.act.id, { body: 'melk en brood' }, { id: 'n1' });
    expect(decodeGenericOpId(save.opId)).toMatchObject({ atom: 'update', noun: 'note' });
    expect(save.args).toEqual({ circleId: OWN_DEVICES_SCOPE, id: 'n1', body: 'melk en brood' });
    const rm = plusRemoveOp(e.act.id, { id: 'n1' });
    expect(decodeGenericOpId(rm.opId)).toMatchObject({ atom: 'remove', noun: 'note' });
  });
  it('an own appointment row: updateEvent / cancelEvent, the moment kept as the picker shows it', () => {
    const e = plusEditFor({ id: 'e1', own: true, fields: { title: 'tandarts', when: '2026-11-03T14:00:00.000Z' } }, 'calendar-event');
    expect(e.values.title).toBe('tandarts');
    expect(plusSaveOp(e.act.id, { title: 'tandarts', when: '2026-11-03T15:00' }, { id: 'e1' })).toMatchObject({ app: 'calendar', opId: 'updateEvent', args: { id: 'e1', title: 'tandarts' } });
    expect(plusRemoveOp(e.act.id, { id: 'e1' })).toMatchObject({ app: 'calendar', opId: 'cancelEvent', args: { id: 'e1' } });
  });
  it('an own appointment is shared with whom the agent says the share accepts ("Delen met…") — the sheet filters nothing', async () => {
    const e = plusEditFor({ id: 'e1', own: true, fields: { title: 'tandarts', when: '2026-11-03T14:00:00.000Z' } }, 'calendar-event');
    const asked = [];
    const call = async (app, op, args) => { asked.push(`${app}.${op}`); return { items: [
      { id: 'webid:bob', label: 'Bob', pairCircleId: null },
    ] }; };
    expect(await plusShareTargets(e.act, call)).toEqual([{ id: 'webid:bob', label: 'Bob' }]);
    expect(asked).toEqual(['calendar.shareTargets']);
    expect(plusShareOp(e.act.id, { id: 'e1', with: 'webid:bob' })).toEqual({ app: 'calendar', opId: 'shareEvent', args: { circleId: OWN_DEVICES_SCOPE, id: 'e1', with: 'webid:bob' } });
    expect(plusShareOp(e.act.id, { id: 'e1', with: '' })).toHaveProperty('error');
  });
  it('a note has no share act: no picker, no op', async () => {
    const e = plusEditFor({ id: 'n1', own: true, fields: { body: 'x' } }, 'note');
    expect(await plusShareTargets(e.act, async () => { throw new Error('not asked'); })).toEqual([]);
    expect(plusShareOp(e.act.id, { id: 'n1', with: 'webid:bob' })).toHaveProperty('error');
  });
  it("a circle's row is not the own sheet's (it opens the circle's own actions)", () => {
    expect(plusEditFor({ id: 'c1', circleId: 'kring', fields: { body: 'x' } }, 'note')).toBe(null);
  });
});

describe('Vandaag — the free line at the top of the sheet', () => {
  it('names the act by its own word and fills its fields', () => {
    expect(plusRead('notitie: melk halen')).toEqual({ actId: 'household.note', values: { body: 'melk halen' } });
    const a = plusRead('afspraak morgen 14:00 tandarts');
    expect(a.actId).toBe('calendar.calendar-event');
    expect(a.values.title).toBe('tandarts');
    expect(a.values.when).toMatch(/T14:00$/);
  });
  it('a day and a time without a word is an appointment; nothing it can read leaves the fields empty', () => {
    expect(plusRead('tandarts vrijdag 10:30')?.actId).toBe('calendar.calendar-event');
    expect(plusRead('ooit eens iets')).toBe(null);
    expect(plusRead('  ')).toBe(null);
  });
  it('a said appointment: the day and the time in words are read, and "ik moet" is no part of its title', () => {
    const r = plusRead('ik moet vrijdag om half drie naar de tandarts');
    expect(r?.actId).toBe('calendar.calendar-event');
    expect(r.values.when).toMatch(/T14:30$/);
    expect(r.values.title).toBe('naar de tandarts');
    expect(plusRead('I need to see the dentist tomorrow at half past two')?.values?.title).toBe('see the dentist');
  });
  it('a line that only POINTS back ("zet dat morgen om 10 in mijn agenda") is not read: only a model with the turns knows what', () => {
    expect(plusRead('zet dat morgen om 10 in mijn agenda')).toBe(null);
    expect(plusRead('put that in my calendar tomorrow at 10')).toBe(null);
    // an article that also points opens an ordinary title; an act word still names its act
    expect(plusRead('het etentje morgen om 7')?.values?.title).toBe('het etentje');
    expect(plusRead('afspraak morgen 14:00 dat ding')?.actId).toBe('calendar.calendar-event');
    // "dat" joining a clause that says what: still read (the line says something of its own)
    expect(plusRead('onthoud dat de vuilnis dinsdag buiten gaat')).not.toBe(null);
  });
  it('a day without a time keeps the day and fills in NO time: the form asks for it (no 09:00 nobody said)', () => {
    const a = plusRead('afspraak morgen tandarts');
    expect(a.actId).toBe('calendar.calendar-event');
    expect(a.values.when).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const act = PLUS_ACTS.find((x) => x.id === a.actId);
    expect(plusMomentNeedsTime(act, a.values)).toBe(a.values.when);
    // a time said: nothing to ask
    const b = plusRead('afspraak morgen 14:00 tandarts');
    expect(plusMomentNeedsTime(act, b.values)).toBe(null);
    // a note has no moment: nothing to ask
    expect(plusMomentNeedsTime(PLUS_ACTS.find((x) => x.id === 'household.note'), { body: 'x' })).toBe(null);
  });
  it('a QUESTION that mentions a day is not an appointment (a question is not an act)', () => {
    for (const line of ['what is the weather tomorrow', 'wat is het weer morgen', 'is het morgen mooi weer?', 'hoe laat begint het morgen']) {
      expect(plusRead(line), line).toBe(null);
    }
    // an act word still names its act, question mark or not; a plain line with a day stays an appointment
    expect(plusRead('afspraak morgen 14:00 tandarts?')?.actId).toBe('calendar.calendar-event');
    expect(plusRead('tandarts vrijdag 10:30')?.actId).toBe('calendar.calendar-event');
  });
  it('a reading that names an act outside the sheet (a circle\'s list, the household\'s chores) is no reading', () => {
    expect(plusRead('zet melk op de boodschappen')).toBe(null);
  });
  it('whatever it reads compiles on the OWN scope — never a circle', () => {
    const r = plusRead('notitie: melk');
    expect(plusOp(r.actId, r.values).args.circleId).toBe(OWN_DEVICES_SCOPE);
  });
});

describe('the "+" free line read by the person\'s OWN model', () => {
  it('only the person\'s own route counts: none set (or only the deployment\'s) → no model', async () => {
    const { ownModelClient } = await import('../../src/v2/userLlmRuntime.js');
    const local = { invoke: async () => ({}) };
    expect(ownModelClient({ userCfg: { preset: 'off' }, providers: { local } })).toBe(null);
    expect(ownModelClient({ userCfg: null, providers: { local } }), 'the deployment\'s env route is not the person\'s').toBe(null);
    const cloud = { invoke: async () => ({}) };
    expect(ownModelClient({ userCfg: null, providers: { local, cloud } }), 'a circle\'s route present, no own route: the "+" stays without a model (gate only)').toBe(null);
    expect(ownModelClient({ userCfg: { preset: 'local-ollama' }, providers: { local } }), 'a preset without its address is no route').toBe(null);
    expect(ownModelClient({ userCfg: { preset: 'local-ollama', llmBaseUrl: 'http://127.0.0.1:11434' }, providers: { local } })).toBe(local);
    const { ownModelOf } = await import('../../src/v2/userLlmRuntime.js');
    expect(typeof ownModelOf({ preset: 'local-ollama', llmBaseUrl: 'http://127.0.0.1:11434' })?.invoke).toBe('function');
    expect(ownModelOf({ preset: 'off' })).toBe(null);
    expect(ownModelOf({ preset: 'confidential-proxy', llmBaseUrl: 'https://example.org' }), 'a refused confidential route is no model').toBe(null);
  });
});


describe('the "+" card in words: the own place asks to confirm the act, a choice of places asks which', () => {
  const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
  it('one choice, the own place: the act named, and Bevestigen; no "in which circle?"', () => {
    // the help's name for the act (circle.bot.help.ops.<app>.<op>), as the locale has it
    const t = (k, v) => (k === 'circle.bot.help.ops.lists.createList' ? 'een nieuwe lijst' : v ? `${k} ${JSON.stringify(v)}` : k);
    const card = { line: 'maak een lijstje voor de vakantie', to: [{ circleId: 'own', name: '', own: true }], command: { appOrigin: 'lists', opId: 'createList', args: { text: 'vakantie' } } };
    const w = plusCardWords(card, { t });
    expect(w.question).toContain('circle.vandaag.plus_own_confirm');
    expect(w.question).toContain('een nieuwe lijst');
    expect(w.question).not.toContain('plus_circle_ask');
    expect(w.labelFor(card.to[0])).toBe('circle.confirm.accept');
  });
  it('a choice of places: which circle, one button per place', () => {
    const card = { line: 'zet kaas op Boodschappen', to: [{ circleId: 'own', own: true }, { circleId: 'c1', name: 'Thuis' }], command: { opId: 'addToList' } };
    const w = plusCardWords(card, { t });
    expect(w.question).toContain('circle.vandaag.plus_circle_ask');
    expect(w.labelFor(card.to[1])).toContain('Thuis');
  });
});
