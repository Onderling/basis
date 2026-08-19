// @vitest-environment happy-dom
//
// Verification (happy-dom) — the circle composer dispatches the unified send op,
// and an inbound `circle-chat-message` wire envelope (the conforming shape the
// reliable-path fan-out now emits, carrying top-level `text`) renders into the
// circle bubble list. Uses the real renderers/substrate — no invented UI.
import { describe, it, expect, vi } from 'vitest';

import { renderCircleView } from '../../web/v2/circleView.js';
import { buildCircleStream } from '../../src/v2/circleStream.js';
import { createChatMessageInbox } from '../../src/v2/chatMessageInbox.js';
import { circleChatMessageEvent, broadcastCircleFanOut } from '@onderling/kring-host/circleBroadcast';

const t = (key) => key;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }
const circle = { id: 'g1', name: 'Selwerd', memberCount: 3 };

describe('circle chat · composer dispatches the unified send op', () => {
  it('composer submit fans out the SIGNED statement (the op that routes through reliableSend)', async () => {
    const el = mount();
    const events = [];
    const rawCallSkill = vi.fn(async () => ({ sent: 1, attempted: 1, errors: [] }));
    let seq = 0;

    // The real composer→send wiring: append optimistic bubble, then fan out.
    const onSend = (text) => {
      const msgId = `circle-g1-${(seq += 1)}`;
      const ts = Date.now();
      events.push(circleChatMessageEvent({ msgId, ts, circleId: 'g1', actor: 'me', text }));
      broadcastCircleFanOut({
        rawCallSkill, circleId: 'g1', msgId, text, ts,
        deliveryStateMap: { set() {} },
        signStatement: async () => ({ body: { hash: 'h1' }, sig: 's1' }),   // the rail's sign-the-entry hook
      });
    };

    renderCircleView(el, { circle, rows: [], t, onSend });
    const input = el.querySelector('.circle-circle__composer-input');
    input.value = 'Hoi buurt!';
    el.querySelector('.circle-circle__composer').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Optimistic bubble appended locally.
    expect(events).toHaveLength(1);
    expect(events[0].payload.text).toBe('Hoi buurt!');
    // The unified send op dispatched (basis wires this stoop op to the reliable sender).
    await Promise.resolve(); await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));   // the sign hook adds a microtask hop before the fan
    expect(rawCallSkill).toHaveBeenCalledTimes(1);
    const [app, op, args] = rawCallSkill.mock.calls[0];
    expect([app, op]).toEqual(['stoop', 'broadcastCircleChatStatement']);
    expect(args).toMatchObject({ groupId: 'g1', event: { sig: 's1' } });   // the statement rides, not plain text
    expect(typeof args.msgId).toBe('string');
  });
});

describe('circle chat · inbound reliable-path envelope renders into the circle list', () => {
  it('ingests a conforming circle-chat-message (top-level text) and renders a bubble', async () => {
    const events = [];
    const inbox = createChatMessageInbox({
      eventLog: { append: (e) => events.push(e) },
      logger:   { warn() {}, info() {}, debug() {} },
    });

    // The exact wire shape the reliable fan-out now emits (text, not body).
    const wire = {
      type: 'p2p-chat', subtype: 'circle-chat-message',
      circleId: 'g1', msgId: 'm-in-1', ts: Date.now(),
      text: 'hallo vanaf een peer', fromActor: 'Pieter', fromWebid: 'Pieter',
    };
    const r = await inbox.ingestChatMessage(wire, { source: 'receiver', fromPeerAddr: 'peer-addr' });
    expect(r.result).toBe('inserted');

    // A `body`-only envelope (the OLD chat.send shape) is rejected — proving the
    // reliable-path `text` envelope is what this receiver requires.
    const bad = await inbox.ingestChatMessage(
      { type: 'p2p-chat', subtype: 'circle-chat-message', circleId: 'g1', msgId: 'm-bad', ts: Date.now(), body: 'oops' },
      { source: 'receiver', fromPeerAddr: 'peer-addr' },
    );
    expect(bad.result).toBe('rejected');

    // The appended event flows through the real stream builder + renderer into a bubble.
    const rows = buildCircleStream({ events, circles: [circle], circleId: 'g1' });
    const el = mount();
    renderCircleView(el, { circle, rows, t });
    const bubbles = el.querySelectorAll('.circle-circle__bubble');
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].querySelector('.circle-circle__bubble-text').textContent).toBe('hallo vanaf een peer');
  });
});
