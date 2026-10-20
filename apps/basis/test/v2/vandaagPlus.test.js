/**
 * Vandaag's "+": an own note or an own appointment — into the person's own store (the own-devices scope), never a
 * circle. One shared model both shells paint: the two acts, their fields, and the op each compiles to.
 */
import { describe, it, expect } from 'vitest';
import { decodeGenericOpId } from '@onderling/app-manifest';
import { PLUS_ACTS, plusActs, plusOp, plusFollowUp, plusEditFor, plusSaveOp, plusRemoveOp, plusShareOp, plusShareTargets, plusRead, plusReadWithModel, plusModelAsk } from '../../src/v2/vandaagPlus.js';
import { OWN_DEVICES_SCOPE } from '../../src/v2/grantsManifest.js';

describe('Vandaag — the "+"', () => {
  it('offers the own-scope attach entries the composed manifests declare — each with its fields', () => {
    expect(PLUS_ACTS.map((a) => a.id)).toEqual(['household.note', 'calendar.calendar-event']);
    expect(PLUS_ACTS[1].fields.map((f) => f.name)).toEqual(['title', 'when']);
  });

  it('an entry not declared for the own scope never appears on Vandaag (a circle composer entry stays a circle\'s)', () => {
    const acts = plusActs({ manifestsByOrigin: {
      lists: { app: 'lists', operations: [{ id: 'createList', surfaces: { attach: { label: 'x' } } }] },
      calendar: { app: 'calendar', operations: [{ id: 'addEvent', appliesTo: { type: 'calendar-event' }, surfaces: { attach: { label: 'y', scopes: ['own'] } }, params: [] }] },
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
    const tomorrow = new Date(Date.now() + 86_400_000);
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
  it('a reading that names an act outside the sheet (a circle\'s list, the household\'s chores) is no reading', () => {
    expect(plusRead('zet melk op de boodschappen')).toBe(null);
  });
  it('whatever it reads compiles on the OWN scope — never a circle', () => {
    const r = plusRead('notitie: melk');
    expect(plusOp(r.actId, r.values).args.circleId).toBe(OWN_DEVICES_SCOPE);
  });
  it('a model is asked with the sheet\'s acts and the own scope only, and never widens either', async () => {
    let asked = null;
    const ok = await plusReadWithModel('iets', { ask: async (line, bounds) => { asked = bounds; return { actId: 'household.note', values: { body: 'x', circleId: 'kring' } }; } });
    expect(asked.scope).toBe(OWN_DEVICES_SCOPE);
    expect(asked.acts.map((a) => a.actId)).toEqual(['household.note', 'calendar.calendar-event']);
    expect(ok).toEqual({ actId: 'household.note', values: { body: 'x' } });
    expect(await plusReadWithModel('iets', { ask: async () => ({ actId: 'household.addItem', values: { text: 'x' } }) })).toBe(null);
  });
});

describe('the "+" free line read by the person\'s OWN model', () => {
  it('only the person\'s own route counts: none set (or only the deployment\'s) → no model', async () => {
    const { ownModelClient } = await import('../../src/v2/userLlmRuntime.js');
    const local = { invoke: async () => ({}) };
    expect(ownModelClient({ userCfg: { preset: 'off' }, providers: { local } })).toBe(null);
    expect(ownModelClient({ userCfg: null, providers: { local } }), 'the deployment\'s env route is not the person\'s').toBe(null);
    expect(ownModelClient({ userCfg: { preset: 'local-ollama' }, providers: { local } }), 'a preset without its address is no route').toBe(null);
    expect(ownModelClient({ userCfg: { preset: 'local-ollama', llmBaseUrl: 'http://127.0.0.1:11434' }, providers: { local } })).toBe(local);
    const { ownModelOf } = await import('../../src/v2/userLlmRuntime.js');
    expect(typeof ownModelOf({ preset: 'local-ollama', llmBaseUrl: 'http://127.0.0.1:11434' })?.invoke).toBe('function');
    expect(ownModelOf({ preset: 'off' })).toBe(null);
    expect(ownModelOf({ preset: 'confidential-proxy', llmBaseUrl: 'https://example.org' }), 'a refused confidential route is no model').toBe(null);
  });

  it('the ask sends the line only, with the acts and the own scope as bounds, and reads the JSON answer back', async () => {
    let sent = null;
    const client = { invoke: async (req) => { sent = req; return { replyText: 'Sure: {"actId":"calendar.calendar-event","values":{"title":"kapper","when":"2026-10-20T10:00"}}' }; } };
    const r = await plusReadWithModel('morgen 10 uur kapper', { ask: plusModelAsk(client) });
    expect(r).toEqual({ actId: 'calendar.calendar-event', values: { title: 'kapper', when: '2026-10-20T10:00' } });
    expect(sent.messages).toEqual([{ role: 'user', content: 'morgen 10 uur kapper' }]);
    expect(sent.system).toContain('household.note');
    expect(sent.system).toContain(OWN_DEVICES_SCOPE);
    expect(sent.tools ?? null).toBe(null);
    // an unreadable answer is no reading
    expect(await plusReadWithModel('x', { ask: plusModelAsk({ invoke: async () => ({ replyText: 'geen idee' }) }) })).toBe(null);
    expect(plusModelAsk(null)).toBe(null);
  });
});

