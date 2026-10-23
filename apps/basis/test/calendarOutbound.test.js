/**
 * withCalendarOutbound — the shared seam that fans a successful calendar
 * dispatch out over the peer transport (invite / RSVP envelopes). Used by the
 * v2 web launcher + mobile so they reach parity with the classic web shell.
 */
import { describe, it, expect, vi } from 'vitest';
import { withCalendarOutbound } from '../src/core/handlers/calendarOutbound.js';

// A callSkill that returns canned results, and answers getEventSnapshot.
function fakeCallSkill(snapshot) {
  return vi.fn(async (appOrigin, opId) => {
    if (opId === 'getEventSnapshot') return snapshot;
    if (opId === 'addEvent') return { ok: true, itemId: 'e-1' };
    if (opId === 'rsvpAccept') return { ok: true };
    return { ok: true };
  });
}

describe('withCalendarOutbound', () => {
  it('fans out a calendar-invite to each attendees-addr after addEvent', async () => {
    const sendPeer = vi.fn(async () => {});
    const cs = withCalendarOutbound(
      fakeCallSkill({ id: 'e-1', title: 'Lunch', startAt: 1, endAt: 2, fields: {} }),
      { sendPeer, isPeerConnected: () => true },
    );
    const r = await cs('calendar', 'addEvent', { title: 'Lunch', 'attendees-addr': 'addrA, addrB' });
    expect(r).toEqual({ ok: true, itemId: 'e-1' });
    expect(sendPeer).toHaveBeenCalledTimes(2);
    expect(sendPeer.mock.calls[0][0]).toBe('addrA');
    expect(sendPeer.mock.calls[0][1]).toMatchObject({ subtype: 'calendar-invite', event: { id: 'e-1', title: 'Lunch' } });
    expect(sendPeer.mock.calls[1][0]).toBe('addrB');
  });

  it('sends a calendar-rsvp back to an NKN organiser after rsvpAccept', async () => {
    const sendPeer = vi.fn(async () => {});
    const cs = withCalendarOutbound(
      fakeCallSkill({ id: 'e-1', fields: { organiser: 'organiserAddr' } }),
      { sendPeer, isPeerConnected: () => true },
    );
    await cs('calendar', 'rsvpAccept', { id: 'e-1' });
    expect(sendPeer).toHaveBeenCalledTimes(1);
    expect(sendPeer.mock.calls[0][0]).toBe('organiserAddr');
    expect(sendPeer.mock.calls[0][1]).toMatchObject({ subtype: 'calendar-rsvp', eventId: 'e-1', response: 'accepted' });
  });

  it('does NOT fan out when the peer transport is down (still returns the result)', async () => {
    const sendPeer = vi.fn(async () => {});
    const cs = withCalendarOutbound(
      fakeCallSkill({ id: 'e-1', fields: {} }),
      { sendPeer, isPeerConnected: () => false },
    );
    const r = await cs('calendar', 'addEvent', { 'attendees-addr': 'addrA' });
    expect(r.ok).toBe(true);
    expect(sendPeer).not.toHaveBeenCalled();
  });

  it('fans out a calendar-cancel to the persisted attendeeAddrs after cancelEvent', async () => {
    const sendPeer = vi.fn(async () => {});
    const cs = withCalendarOutbound(
      fakeCallSkill({ id: 'e-1', title: 'Lunch', fields: { attendeeAddrs: 'addrA, addrB' } }),
      { sendPeer, isPeerConnected: () => true },
    );
    await cs('calendar', 'cancelEvent', { id: 'e-1' });
    expect(sendPeer).toHaveBeenCalledTimes(2);
    expect(sendPeer.mock.calls[0][1]).toMatchObject({ subtype: 'calendar-cancel', eventId: 'e-1', title: 'Lunch' });
    expect(sendPeer.mock.calls.map((c) => c[0])).toEqual(['addrA', 'addrB']);
  });

  it('cancelEvent with no persisted attendeeAddrs notifies nobody (no send)', async () => {
    const sendPeer = vi.fn(async () => {});
    const cs = withCalendarOutbound(
      fakeCallSkill({ id: 'e-1', title: 'Solo', fields: {} }),
      { sendPeer, isPeerConnected: () => true },
    );
    await cs('calendar', 'cancelEvent', { id: 'e-1' });
    expect(sendPeer).not.toHaveBeenCalled();
  });

  it('passes non-calendar ops straight through (no fan-out)', async () => {
    const sendPeer = vi.fn(async () => {});
    const inner = vi.fn(async () => ({ ok: true, items: [] }));
    const cs = withCalendarOutbound(inner, { sendPeer, isPeerConnected: () => true });
    const r = await cs('pinboard', 'listOpenRequests', {});
    expect(r).toEqual({ ok: true, items: [] });
    expect(inner).toHaveBeenCalledWith('pinboard', 'listOpenRequests', {});
    expect(sendPeer).not.toHaveBeenCalled();
  });

  it('a fan-out error never breaks the dispatch (result still returned)', async () => {
    const sendPeer = vi.fn(async () => { throw new Error('nkn down'); });
    const cs = withCalendarOutbound(
      fakeCallSkill({ id: 'e-1', fields: {} }),
      { sendPeer, isPeerConnected: () => true, logger: { warn: vi.fn(), error: vi.fn() } },
    );
    const r = await cs('calendar', 'addEvent', { 'attendees-addr': 'addrA' });
    expect(r).toEqual({ ok: true, itemId: 'e-1' });   // dispatch result survives the send failure
  });

  it('requires a callSkill', () => {
    expect(() => withCalendarOutbound(null, { sendPeer: () => {} })).toThrow(/callSkill required/);
  });
});
