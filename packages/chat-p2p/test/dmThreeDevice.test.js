/**
 * 1:1 DM delivery across THREE devices — story 4.1 of `plans/NOTE-multi-device-user-stories.md`.
 *
 * wireChat's addressed send now prefers a host-injected hold-forward sender, so a DM to a briefly-offline
 * peer is HELD and flushed on reconnect instead of soft-failing. `wireChat.test.js` proves the seam with a
 * single sender/recipient pair; the properties that need a third device are:
 *   • the held message reaches the intended peer EXACTLY ONCE after reconnect (no loss, no duplicate), and
 *   • the UNINVOLVED third party never sees it — a hold-and-flush must not turn a DM into a broadcast.
 *
 * Cast: Anna (sender) · Bram (uninvolved third party) · Cato (the offline recipient).
 */
import { describe, it, expect, vi } from 'vitest';
import { wireChat } from '../index.js';

/**
 * A tiny bus with per-peer hold-forward, mirroring `sa.peer.sendTo(..., {guarantee:'hold-forward'})`:
 * an unreachable peer's message is queued and returned as `{held:true}` (never thrown), then flushed on
 * reconnect. Every delivered wire is recorded PER RECIPIENT so we can assert who did and didn't receive it.
 */
function bus() {
  const online = { bram: true, cato: true };
  const held = { bram: [], cato: [] };
  const inbox = { bram: [], cato: [] };
  return {
    online, inbox,
    reliableSend: vi.fn(async (to, wire) => {
      if (online[to]) { inbox[to].push(wire); return { held: false, delivered: true, msgId: `m${inbox[to].length}` }; }
      held[to].push(wire);
      return { held: true, delivered: false, msgId: `h${held[to].length}`, pending: held[to].length };
    }),
    partition: (who) => { online[who] = false; },
    reconnect: (who) => {
      online[who] = true;
      for (const w of held[who].splice(0, held[who].length)) inbox[who].push(w);   // presence-flush
    },
  };
}

function annaChat(reliableSend) {
  const addItems = vi.fn(async (drafts) => drafts.map((d, i) => ({ id: `id-${i}`, ...d })));
  const transport = { sendOneWay: vi.fn(async () => { throw new Error('bare transport must not be used'); }) };
  const ctrl = wireChat({
    agent: { on: () => {}, off: () => {}, emit: vi.fn(), transport, transportFor: vi.fn(async () => transport) },
    itemStore: { addItems, getById: vi.fn(), listOpen: vi.fn(async () => []) },
    members: { resolveByWebid: vi.fn(async () => null), resolveByStableId: vi.fn(async () => null) },
    muted: new Set(),
    metrics: { record: vi.fn() },
    localActor: 'urn:anna',
    localStableId: 'anna',
    reliableSend,
  });
  return { ctrl, addItems, transport };
}

const bodiesIn = (wires) => wires.map((w) => w.parts[0].data.body);

describe('4.1 — a DM to an offline peer is held, flushed once, and never leaks to a third party', () => {
  it('Cato offline: the DM is HELD (not lost, not failed) and Bram sees nothing', async () => {
    const b = bus();
    const { ctrl, addItems } = annaChat(b.reliableSend);
    b.partition('cato');

    const res = await ctrl.send({ toPubKey: 'cato', threadId: 't1', body: 'hoi Cato', subtype: 'chat-message' });

    expect(res.ok).toBe(true);              // held counts as sent — the sender is not told it failed
    expect(addItems).toHaveBeenCalled();    // and the turn is durable locally straight away
    expect(b.inbox.cato).toEqual([]);       // nothing delivered yet
    expect(b.inbox.bram).toEqual([]);       // the third party is never addressed
  });

  it('on reconnect Cato receives it EXACTLY ONCE, still nothing for Bram', async () => {
    const b = bus();
    const { ctrl } = annaChat(b.reliableSend);
    b.partition('cato');
    await ctrl.send({ toPubKey: 'cato', threadId: 't1', body: 'hoi Cato', subtype: 'chat-message' });

    b.reconnect('cato');

    expect(bodiesIn(b.inbox.cato)).toEqual(['hoi Cato']);   // once — not zero, not twice
    expect(b.inbox.bram).toEqual([]);
  });

  it('several DMs queued while offline flush IN ORDER, exactly once each', async () => {
    const b = bus();
    const { ctrl } = annaChat(b.reliableSend);
    b.partition('cato');
    await ctrl.send({ toPubKey: 'cato', threadId: 't1', body: 'een', subtype: 'chat-message' });
    await ctrl.send({ toPubKey: 'cato', threadId: 't1', body: 'twee', subtype: 'chat-message' });
    await ctrl.send({ toPubKey: 'cato', threadId: 't1', body: 'drie', subtype: 'chat-message' });

    b.reconnect('cato');

    expect(bodiesIn(b.inbox.cato)).toEqual(['een', 'twee', 'drie']);
    expect(b.inbox.bram).toEqual([]);
  });

  it('a DM to the ONLINE third party is unaffected by the other peer being partitioned', async () => {
    const b = bus();
    const { ctrl } = annaChat(b.reliableSend);
    b.partition('cato');

    await ctrl.send({ toPubKey: 'cato', threadId: 't1', body: 'voor Cato', subtype: 'chat-message' });
    await ctrl.send({ toPubKey: 'bram', threadId: 't2', body: 'voor Bram', subtype: 'chat-message' });

    expect(bodiesIn(b.inbox.bram)).toEqual(['voor Bram']);   // delivered immediately
    expect(b.inbox.cato).toEqual([]);                        // still held
    b.reconnect('cato');
    expect(bodiesIn(b.inbox.cato)).toEqual(['voor Cato']);   // and the held one is not misrouted
  });

  it('the bare per-peer transport is never used when a reliable sender is wired', async () => {
    const b = bus();
    const { ctrl, transport } = annaChat(b.reliableSend);
    await ctrl.send({ toPubKey: 'cato', threadId: 't1', body: 'hoi', subtype: 'chat-message' });
    expect(transport.sendOneWay).not.toHaveBeenCalled();     // it throws if reached — belt and braces
  });
});
