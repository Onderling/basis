/**
 * WHO IS TOLD WHEN A KEY FORKS (Frits 2026-09-25, ledger L133): the person whose key it is — a fork almost always means
 * their key was stolen, and they are the one who must act — and the circle's admins, for an admin's fork and a member's
 * alike. Not the whole group as a message: they see the roster change, and an alarm reads as an accusation.
 *
 * A notification is an EVENT IN THE LOG: the fork is already there — two signed membership statements off one parent —
 * so the notice is RENDERED from them, like every membership notice, never appended; one row per fork, a stable id.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, signSpine } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { forkNoticeRows, FORK_NOTICE_KEYS } from '../../src/v2/membershipNotices.js';

const CIRCLE = 'g1';
const t = (key, args = {}) => `${key}${args.name ? `(${args.name})` : ''}`;

/** A fork by `bea` (her circle key signs two statements off one parent) as the device log holds it. */
async function forkedLog() {
  const beaKey = await AgentIdentity.generate(new VaultMemory());
  const root = signSpine(beaKey, { kind: 'role', circleId: CIRCLE, subject: 'webid:bea', payload: { role: 'admin' } });
  const a = signSpine(beaKey, { kind: 'evict', circleId: CIRCLE, subject: 'webid:cor', parent: root.body.hash });
  const b = signSpine(beaKey, { kind: 'role', circleId: CIRCLE, subject: 'webid:ann', parent: root.body.hash, payload: { role: 'member' } });
  const ev = (id, ts, s) => ({ id, ts, type: 'membership', circleId: CIRCLE, actor: 'webid:bea', payload: s });
  return [ev('e0', 10, root), ev('e1', 20, a), ev('e2', 30, b)];
}
const members = [
  { webid: 'webid:ann', handle: 'ann', role: 'admin' },
  { webid: 'webid:cor', handle: 'cor', role: 'member' },
  { webid: 'webid:bea', handle: 'bea', role: 'member' },
];

describe('fork notices — rendered from the log', () => {
  it('the person whose key forked is told, on their own device: their key may be in someone else\'s hands', async () => {
    const rows = forkNoticeRows({ events: await forkedLog(), circleId: CIRCLE, viewerId: 'webid:bea', members, t });
    expect(rows).toHaveLength(1);
    expect(rows[0].event.payload.text).toBe(FORK_NOTICE_KEYS.you);
    expect(rows[0].event.payload.scope).toBe('self');
  });

  it('an admin is told, named', async () => {
    const rows = forkNoticeRows({ events: await forkedLog(), circleId: CIRCLE, viewerId: 'webid:ann', members, t });
    expect(rows).toHaveLength(1);
    expect(rows[0].event.payload.text).toBe(`${FORK_NOTICE_KEYS.member}(@bea)`);
  });

  it('a plain member is not — they see the roster change, not an alarm', async () => {
    expect(forkNoticeRows({ events: await forkedLog(), circleId: CIRCLE, viewerId: 'webid:cor', members, t })).toEqual([]);
  });

  it('one row per fork, with a stable id — the same log says it once, and again the same way after a reload', async () => {
    const log = await forkedLog();
    const a = forkNoticeRows({ events: log, circleId: CIRCLE, viewerId: 'webid:ann', members, t });
    const b = forkNoticeRows({ events: [...log].reverse(), circleId: CIRCLE, viewerId: 'webid:ann', members, t });
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(a[0].ts, 'dated when the fork became visible: the later of the two').toBe(30);
  });

  it('a clean chain says nothing', async () => {
    const log = (await forkedLog()).slice(0, 2);
    expect(forkNoticeRows({ events: log, circleId: CIRCLE, viewerId: 'webid:ann', members, t })).toEqual([]);
  });
});

describe('…and it reaches the conversation both shells paint', () => {
  it('chatRows carries the admin\'s fork line (the projection web and mobile read)', async () => {
    const { chatRows } = await import('../../src/v2/circleStream.js');
    const rows = chatRows({ events: await forkedLog(), circleId: CIRCLE, viewerId: 'webid:ann', members, t });
    expect(rows.some((r) => r.event?.payload?.notice === 'memberKeyForked'), JSON.stringify(rows.map((r) => r.id))).toBe(true);
  });
});
