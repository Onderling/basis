/**
 * Bundle calendar cross-peer — outbound hook coverage.
 */
import { describe, it, expect, vi } from 'vitest';
import { makeCalendarOutboundHook } from '../../src/core/handlers/calendarOutbound.js';

function deps(overrides = {}) {
  return {
    callSkill: vi.fn(async (app, op, args) => {
      if (op === 'getEventSnapshot') {
        return {
          id:       args.id,
          title:    'Dinner',
          startAt:  '2026-06-01T19:00:00Z',
          endAt:    '2026-06-01T22:00:00Z',
          location: 'Anne\'s place',
          fields:   { organiser: 'webid:alice', attendees: 'webid:bob, webid:carol' },
        };
      }
      return { ok: true };
    }),
    sendPeer:        vi.fn(async () => {}),
    isPeerConnected: () => true,
    publishEvent:    vi.fn(),
    logger:          { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
}

describe('makeCalendarOutboundHook — required deps', () => {
  it('throws when callSkill missing', () => {
    expect(() => makeCalendarOutboundHook({ sendPeer: vi.fn() })).toThrow(/callSkill required/);
  });
  it('throws when sendPeer missing', () => {
    expect(() => makeCalendarOutboundHook({ callSkill: vi.fn() })).toThrow(/sendPeer required/);
  });
});

describe('makeCalendarOutboundHook — pass-through', () => {
  it('no-ops for non-calendar appOrigins', async () => {
    const d = deps();
    const hook = makeCalendarOutboundHook(d);
    await hook('pinboard', 'postRequest', {}, { ok: true });
    expect(d.callSkill).not.toHaveBeenCalled();
    expect(d.sendPeer).not.toHaveBeenCalled();
  });

  it('no-ops when result is not ok', async () => {
    const d = deps();
    const hook = makeCalendarOutboundHook(d);
    await hook('calendar', 'addEvent', { 'attendees-addr': 'app.abc' }, { ok: false });
    expect(d.sendPeer).not.toHaveBeenCalled();
  });

  it('addEvent without attendees-addr → no fan-out', async () => {
    const d = deps();
    const hook = makeCalendarOutboundHook(d);
    await hook('calendar', 'addEvent', { title: 'x' }, { ok: true, itemId: 'e1' });
    expect(d.sendPeer).not.toHaveBeenCalled();
  });
});

describe('makeCalendarOutboundHook — addEvent invite fan-out', () => {
  it('sends calendar-invite to each comma-separated attendee', async () => {
    const d = deps();
    const hook = makeCalendarOutboundHook(d);
    await hook('calendar', 'addEvent',
      { 'attendees-addr': 'app.alice, app.bob' },
      { ok: true, itemId: 'e1' });
    expect(d.sendPeer).toHaveBeenCalledTimes(2);
    expect(d.sendPeer).toHaveBeenNthCalledWith(1, 'app.alice', expect.objectContaining({
      subtype: 'calendar-invite',
      event:   expect.objectContaining({ id: 'e1', title: 'Dinner' }),
    }));
    expect(d.sendPeer).toHaveBeenNthCalledWith(2, 'app.bob', expect.anything());
  });

  it('publishes a notification per successful send', async () => {
    const d = deps();
    const hook = makeCalendarOutboundHook(d);
    await hook('calendar', 'addEvent',
      { 'attendees-addr': 'app.alice app.bob' },
      { ok: true, itemId: 'e1' });
    expect(d.publishEvent).toHaveBeenCalledTimes(2);
    expect(d.publishEvent.mock.calls[0][0].payload.message).toMatch(/📤 invite sent/);
  });

  it('publishes a failure notification when sendPeer rejects', async () => {
    const d = deps({
      sendPeer: vi.fn(async () => { throw new Error('NKN down'); }),
    });
    const hook = makeCalendarOutboundHook(d);
    await hook('calendar', 'addEvent',
      { 'attendees-addr': 'app.alice' },
      { ok: true, itemId: 'e1' });
    expect(d.publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        message: expect.stringContaining('❌ invite send failed'),
      }),
    }));
  });

  it('skips fan-out when peer transport is down', async () => {
    const d = deps({ isPeerConnected: () => false });
    const hook = makeCalendarOutboundHook(d);
    await hook('calendar', 'addEvent',
      { 'attendees-addr': 'app.alice' },
      { ok: true, itemId: 'e1' });
    expect(d.sendPeer).not.toHaveBeenCalled();
  });

  it('skips fan-out when getEventSnapshot throws', async () => {
    const d = deps({
      callSkill: vi.fn(async () => { throw new Error('substrate down'); }),
    });
    const hook = makeCalendarOutboundHook(d);
    await hook('calendar', 'addEvent',
      { 'attendees-addr': 'app.alice' },
      { ok: true, itemId: 'e1' });
    expect(d.sendPeer).not.toHaveBeenCalled();
  });
});

describe('makeCalendarOutboundHook — RSVP fan-out', () => {
  it.each([
    ['rsvpAccept',    'accepted'],
    ['rsvpDecline',   'declined'],
    ['rsvpTentative', 'tentative'],
  ])('sends calendar-rsvp with response=%s', async (opId, expectedResponse) => {
    const d = deps({
      callSkill: vi.fn(async () => ({
        id: 'e1', fields: { organiser: 'app.alice' },
      })),
    });
    const hook = makeCalendarOutboundHook(d);
    await hook('calendar', opId, { id: 'e1' }, { ok: true });
    expect(d.sendPeer).toHaveBeenCalledWith('app.alice', expect.objectContaining({
      subtype:  'calendar-rsvp',
      eventId:  'e1',
      response: expectedResponse,
    }));
  });

  it('skips RSVP fan-out when organiser is a webid (not NKN)', async () => {
    const d = deps({
      callSkill: vi.fn(async () => ({
        id: 'e1', fields: { organiser: 'webid:alice' },
      })),
    });
    const hook = makeCalendarOutboundHook(d);
    await hook('calendar', 'rsvpAccept', { id: 'e1' }, { ok: true });
    expect(d.sendPeer).not.toHaveBeenCalled();
  });

  it('skips RSVP fan-out when organiser missing', async () => {
    const d = deps({
      callSkill: vi.fn(async () => ({ id: 'e1', fields: {} })),
    });
    const hook = makeCalendarOutboundHook(d);
    await hook('calendar', 'rsvpAccept', { id: 'e1' }, { ok: true });
    expect(d.sendPeer).not.toHaveBeenCalled();
  });

  it('skips RSVP fan-out when peer transport is down', async () => {
    const d = deps({ isPeerConnected: () => false });
    const hook = makeCalendarOutboundHook(d);
    await hook('calendar', 'rsvpAccept', { id: 'e1' }, { ok: true });
    expect(d.sendPeer).not.toHaveBeenCalled();
  });
});

describe('makeCalendarOutboundHook — cancelEvent', () => {
  it('publishes a notification placeholder (peer-propagation TBD)', async () => {
    const d = deps();
    const hook = makeCalendarOutboundHook(d);
    await hook('calendar', 'cancelEvent', { id: 'e1' }, { ok: true });
    expect(d.publishEvent).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        message: expect.stringContaining('event cancelled'),
      }),
    }));
    expect(d.sendPeer).not.toHaveBeenCalled();
  });
});
