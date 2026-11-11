/**
 * THE INBOUND WIRING — the one handler map every shell composes (src/v2/inboundWiring.js).
 *
 * What it must hold: the lane table untouched (no entry of its own may shadow a lane's), an entry only where its
 * dependency or hook is given (absent stays absent, as a shell that never registered the subtype), and a peer's file
 * or post reply handed to the shell's one thread hook in the shape each handler delivered before.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { buildInboundWiring } from '../../src/v2/inboundWiring.js';

const contactChannel = {
  subtypes: { out: 'contact-msg', in: 'contact-reply' },
  replyHandler: (fn) => (from, p) => fn(p),
  messageHandler: (fn) => (from, p) => fn(p),
};
const every = () => ({
  contactChannel, onContactReply: vi.fn(),
  pendingRedeems: new Map(),
  applyIncomingReceipt: vi.fn(),
  nearbyRoom: { handlers: { 'nearby-chat': () => {} }, onReceipt: vi.fn() },
  recipe: { pendingStore: { set: vi.fn() } },
  rules: { pendingStore: { set: vi.fn() } },
  calendar: { addMainBubble: vi.fn() },
  deliverToContactThread: vi.fn(),
  sharedWithMeStore: { add: vi.fn() },
  govRail: { ingest: vi.fn() },
});

describe('the inbound wiring', () => {
  it('with nothing but an agent: the lane table plus the join handshake and the address announce, nothing else', () => {
    const { handlers, lanes } = buildInboundWiring({ agent: {}, callSkill: vi.fn() });
    for (const k of Object.keys(lanes.handlers)) expect(handlers[k], `lane entry ${k}`).toBe(lanes.handlers[k]);
    const own = Object.keys(handlers).filter((k) => !(k in lanes.handlers)).sort();
    expect(own).toEqual(['circle-address-announce', 'group-redeem-request']);
  });

  it('with every hook: every shared entry is there', () => {
    const { handlers } = buildInboundWiring({ agent: {}, callSkill: vi.fn(), ...every() });
    for (const k of ['contact-msg', 'contact-reply', 'group-redeem-request', 'group-redeem-response', 'circle-address-announce',
      'delivery-receipt', 'circle-recipe-broadcast', 'circle-rules-broadcast', 'calendar-invite',
      'calendar-rsvp', 'calendar-cancel', 'file-share', 'chat-message', 'shared-copy', 'circle-governance-broadcast', 'nearby-chat']) {
      expect(typeof handlers[k], k).toBe('function');
    }
  });

  it('no entry of its own shadows a lane entry, whatever is passed', () => {
    const { handlers, lanes } = buildInboundWiring({ agent: {}, callSkill: vi.fn(), ...every() });
    for (const k of Object.keys(lanes.handlers)) expect(handlers[k], `lane entry ${k} was replaced`).toBe(lanes.handlers[k]);
  });

  it('the delivery receipt reaches the room and the reducer, in that order of arguments', () => {
    const hooks = every();
    const { handlers } = buildInboundWiring({ agent: {}, callSkill: vi.fn(), ...hooks });
    handlers['delivery-receipt']('addr:bea', { msgId: 'm1' });
    expect(hooks.nearbyRoom.onReceipt).toHaveBeenCalledWith('addr:bea', { msgId: 'm1' });
    expect(hooks.applyIncomingReceipt).toHaveBeenCalledWith({ msgId: 'm1' }, 'addr:bea');
  });

  it('the noticeboard landing hook is set only when asked', () => {
    const agent = { setNoticeboardLandedHook: vi.fn() };
    buildInboundWiring({ agent, callSkill: vi.fn() });
    expect(agent.setNoticeboardLandedHook).not.toHaveBeenCalled();
    buildInboundWiring({ agent, callSkill: vi.fn(), noticeboardLanded: true });
    expect(agent.setNoticeboardLandedHook).toHaveBeenCalledTimes(1);
  });
});
