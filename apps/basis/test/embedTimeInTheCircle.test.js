/**
 * An appointment made from a circle's + (`/embed-time`) is the CIRCLE's: it is added to that circle's Agenda — not
 * to the maker's own calendar — and its card carries the appointment as the calendar reads it back (the snapshot
 * answers `{ ok, event }`). Found by the attach walk failing on every tail after the old calendar path was retired.
 */
import { describe, it, expect } from 'vitest';
import { createLocalBuiltins } from '../src/core/localBuiltins.js';

describe('/embed-time in a circle', () => {
  it('adds to the circle it was made in and builds the card from the calendar\'s own read-back', async () => {
    const calls = [];
    const callSkill = async (app, op, args) => {
      calls.push({ app, op, args });
      if (op === 'addEvent') return { ok: true, itemId: 'e1' };
      if (op === 'getEventSnapshot') return { ok: true, event: { id: 'e1', type: 'calendar-event', title: 'Koffie', startsAt: '2026-10-20T11:00:00.000Z', endsAt: '2026-10-20T12:00:00.000Z' } };
      return { ok: false };
    };
    const builtins = createLocalBuiltins({ t: (k) => k, callSkill, localActor: 'me', catalogue: { ops: [] } });
    const reply = await builtins['embed-time']({ title: 'Koffie', when: '2026-10-20T11:00:00.000Z', circleId: 'c-plus' });
    const add = calls.find((c) => c.op === 'addEvent');
    expect(add?.args?.circleId, 'the appointment goes to the circle it was made in').toBe('c-plus');
    expect(calls.find((c) => c.op === 'getEventSnapshot')?.args?.circleId).toBe('c-plus');
    const embed = reply?.embed ?? reply?.payload?.embed ?? reply;
    const flat = JSON.stringify(embed);
    expect(flat).toContain('"id":"e1"');
    expect(flat).toContain('"title":"Koffie"');
  });
});

describe('the composer hands a circle-writing op its circle', () => {
  it('an op that writes into the circle gets the open circle; any other op, or one naming its own, is left as it is', async () => {
    const { composerArgs } = await import('../src/v2/createdCard.js');
    const writes = { id: 'embed-time', writes: { scope: 'circle' } };
    expect(composerArgs(writes, { title: 'x' }, 'c1')).toEqual({ title: 'x', circleId: 'c1' });
    expect(composerArgs(writes, { title: 'x', circleId: 'c2' }, 'c1')).toEqual({ title: 'x', circleId: 'c2' });
    expect(composerArgs({ id: 'whoami' }, { a: 1 }, 'c1')).toEqual({ a: 1 });
    expect(composerArgs(writes, { title: 'x' }, null)).toEqual({ title: 'x' });
  });
});
