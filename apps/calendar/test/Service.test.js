/**
 * createCalendarService — §1b op→atom adapter (PLAN-capability-arc §1b · #65b "collapse the rest").
 *
 * Proves `createCalendarService().callCapability(atom, noun, args, ctx)` invokes a calendar op by its
 * ATOM + NOUN (the stable vocabulary) instead of the bespoke op-id — BESPOKE-OP-FIRST, over the REAL
 * calendar skills (`registerCalendarSkills`), with no change to any per-op logic. calendar isn't
 * store-dissolved, so this rides the legacy DataPart path via a register-collector (see Service.js header).
 */
import { describe, it, expect } from 'vitest';
import { createCalendarService } from '../src/Service.js';

// Each calendar handler returns `[DataPart({...})]`; read the first part's data.
const data = (parts) => parts?.[0]?.data ?? {};
// `listEvents` reads the UPCOMING window from now. A fixed date rots the moment the calendar passes it — these
// tests went red on 2026-08-01 with nothing else changed — so the fixtures are always tomorrow and the day after.
const soon = (days) => new Date(Date.now() + days * 86_400_000).toISOString();

describe('createCalendarService — legacy callSkill (DataPart wrapper over registerCalendarSkills)', () => {
  it('wraps args in a single DataPart and reaches the real handler; unknown op throws', async () => {
    const svc = createCalendarService();
    const added = data(await svc.callSkill('addEvent', { title: 'Standup', when: soon(1) }));
    expect(added.ok).toBe(true);
    expect(typeof added.itemId).toBe('string');           // real handler ran + stored
    const listed = data(await svc.callSkill('listEvents', {}));
    expect(listed.items.map((i) => i.label).join(' ')).toContain('Standup');
    await expect(svc.callSkill('noSuchOp', {})).rejects.toThrow(/unknown op/);
  });
});

describe('createCalendarService — callCapability atom-dispatch over the real skills (§1b)', () => {
  it('(a) representative bespoke ops route THROUGH their op (via:op, correct opId)', async () => {
    const svc = createCalendarService();

    // add·calendar-event → addEvent (bespoke-first, really stores)
    const added = await svc.callCapability('add', 'calendar-event', { title: 'Beer', when: soon(2) });
    expect(added).toMatchObject({ ok: true, via: 'op', opId: 'addEvent' });
    const id = data(added.result).itemId;
    expect(typeof id).toBe('string');

    // list·calendar-event → listEvents (listEvents precedes getEventSnapshot, so it wins)
    const listed = await svc.callCapability('list', 'calendar-event', {});
    expect(listed).toMatchObject({ ok: true, via: 'op', opId: 'listEvents' });
    expect(data(listed.result).items.map((i) => i.label).join(' ')).toContain('Beer');

    // claim·calendar-event → rsvpAccept
    const accepted = await svc.callCapability('claim', 'calendar-event', { id, actor: 'webid:anne' });
    expect(accepted).toMatchObject({ ok: true, via: 'op', opId: 'rsvpAccept' });
    expect(data(accepted.result).ok).toBe(true);

    // reject·calendar-event → rsvpDecline
    const declined = await svc.callCapability('reject', 'calendar-event', { id, actor: 'webid:bob' });
    expect(declined).toMatchObject({ ok: true, via: 'op', opId: 'rsvpDecline' });

    // submit·calendar-event → rsvpTentative
    const tentative = await svc.callCapability('submit', 'calendar-event', { id, actor: 'webid:cara' });
    expect(tentative).toMatchObject({ ok: true, via: 'op', opId: 'rsvpTentative' });

    // remove·calendar-event → cancelEvent
    const cancelled = await svc.callCapability('remove', 'calendar-event', { id });
    expect(cancelled).toMatchObject({ ok: true, via: 'op', opId: 'cancelEvent' });
    expect(data(cancelled.result).ok).toBe(true);
  });

  it('(b) an atom ALIAS canonicalises to the same op (create → add → addEvent, delete → remove → cancelEvent)', async () => {
    const svc = createCalendarService();
    const added = await svc.callCapability('create', 'calendar-event', { title: 'Lunch', when: soon(3) });
    expect(added).toMatchObject({ ok: true, via: 'op', opId: 'addEvent' });
    const id = data(added.result).itemId;
    const removed = await svc.callCapability('delete', 'calendar-event', { id });   // alias of remove
    expect(removed).toMatchObject({ ok: true, via: 'op', opId: 'cancelEvent' });
  });

  it('(c) an undeclared/unimplemented (atom × noun) returns {ok:false, code:unimplemented} — generic never fires', async () => {
    const svc = createCalendarService();
    // `calendar-event` declares add/list/remove/claim/submit/reject — NOT complete/archive; ghost noun undeclared.
    expect(await svc.callCapability('complete', 'calendar-event', {})).toMatchObject({ ok: false, code: 'unimplemented' });
    expect(await svc.callCapability('add', 'ghost', {})).toMatchObject({ ok: false, code: 'unimplemented' });
  });

  it('(d) backward-compat: the same op via the legacy callSkill path returns the same result as via callCapability', async () => {
    const svc = createCalendarService();
    await svc.callSkill('addEvent', { title: 'Parity', when: soon(4) });
    const legacy = data(await svc.callSkill('listEvents', {}));
    const viaCap = await svc.callCapability('list', 'calendar-event', {});
    expect(viaCap).toMatchObject({ ok: true, via: 'op', opId: 'listEvents' });
    expect(data(viaCap.result).items.map((i) => i.label)).toEqual(legacy.items.map((i) => i.label));
  });
});
