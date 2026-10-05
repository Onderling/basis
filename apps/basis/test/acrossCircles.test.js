/**
 * One projection across every circle, for any item type: the type's own `list` per circle (the bespoke op where the
 * manifest declares one, else the generic store handler), each row tagged with its circle, filtered to "mine" by the
 * type's presenter, merged, sorted by its moment, capped. One circle that does not answer does not empty the view.
 */
import { describe, it, expect } from 'vitest';
import { acrossCircles } from '../src/v2/acrossCircles.js';

const calendarManifest = { app: 'calendar', nouns: { 'calendar-event': { atoms: ['list'] } }, operations: [{ id: 'listEvents', verb: 'list', appliesTo: { type: 'calendar-event' }, surfaces: { chat: {} } }] };
const notesManifest = { app: 'household', nouns: { note: { atoms: ['list'] } }, operations: [] };

describe('acrossCircles', () => {
  it('appointments: the bespoke list per circle, tagged, mine only, soonest first', async () => {
    const calls = [];
    const r = await acrossCircles({
      circles: [{ id: 'home', name: 'Thuis' }, { id: 'club', name: 'Club' }, { id: 'dead' }],
      noun: 'calendar-event', scope: 'mine', me: 'frits',
      manifests: [{ appOrigin: 'household', manifest: notesManifest }, { appOrigin: 'calendar', manifest: calendarManifest }],
      callSkill: async (app, op, args) => {
        calls.push([app, op, args.circleId]);
        if (args.circleId === 'dead') throw new Error('offline');
        return { ok: true, items: args.circleId === 'home'
          ? [{ id: 'a', title: 'tandarts', startsAt: '2026-10-08T10:00:00Z', createdBy: 'frits' }, { id: 'b', title: 'van ann', startsAt: '2026-10-07T09:00:00Z', createdBy: 'ann' }]
          : [{ id: 'c', title: 'training', startsAt: '2026-10-07T19:00:00Z', attendees: [{ webid: 'frits' }] }] };
      },
    });
    expect(calls.map((c) => c.slice(0, 2))).toEqual([['calendar', 'listEvents'], ['calendar', 'listEvents'], ['calendar', 'listEvents']]);
    expect(r.ok).toBe(true);
    expect(r.items.map((i) => [i.title, i.circleName])).toEqual([['training', 'Club'], ['tandarts', 'Thuis']]);
  });

  it('a noun with no bespoke list: the generic handler over each circle\'s store', async () => {
    const r = await acrossCircles({
      circles: [{ id: 'home', name: 'Thuis' }],
      noun: 'note', manifests: [{ appOrigin: 'household', manifest: notesManifest }],
      callSkill: async () => { throw new Error('no op should be called'); },
      genericFor: (cid) => ({ list: async (noun) => [{ id: 'n1', text: `${noun} in ${cid}`, createdAt: 1 }] }),
    });
    expect(r.items).toEqual([expect.objectContaining({ id: 'n1', text: 'note in home', circleId: 'home' })]);
  });

  it('every circle failing is a failure, said; some failing is a partial answer, with the errors', async () => {
    const down = async () => { throw new Error('offline'); };
    const all = await acrossCircles({ circles: [{ id: 'a' }, { id: 'b' }], noun: 'calendar-event', manifests: [{ appOrigin: 'calendar', manifest: calendarManifest }], callSkill: down });
    expect(all).toEqual({ ok: false, reason: 'unreachable', error: 'offline' });
    const some = await acrossCircles({ circles: [{ id: 'a' }, { id: 'b' }], noun: 'calendar-event', manifests: [{ appOrigin: 'calendar', manifest: calendarManifest }],
      callSkill: async (app, op, args) => { if (args.circleId === 'a') throw new Error('offline'); return { items: [{ id: 'x', startsAt: '2026-10-08T10:00:00Z' }] }; } });
    expect(some).toMatchObject({ ok: true, errors: ['offline'] });
    expect(some.items).toHaveLength(1);
  });

  it('a noun nobody lists, or without a presenter: said, not guessed', async () => {
    expect(await acrossCircles({ circles: [], noun: 'note', manifests: [], callSkill: async () => ({}) })).toEqual({ ok: false, reason: 'no-list' });
    expect(await acrossCircles({ circles: [], noun: 'circle', manifests: [], callSkill: async () => ({}) })).toEqual({ ok: false, reason: 'no-presenter' });
  });
});
