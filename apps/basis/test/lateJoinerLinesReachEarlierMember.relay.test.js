/**
 * A MEMBER WHO JOINED EARLIER TAKES THE LINES OF A MEMBER WHO JOINS AFTER IT (the phone session of
 * 2026-11-20). On the Samsung, the phone joined each circle FIRST; afterwards 14 members joined through the founder and
 * wrote; the phone held every line of most senders and NONE of the last ones, and no sender was told.
 *
 * Measured cause (2026-11-20): nothing is refused at the receiver. The founder's relay socket runs over the relay's rate
 * limit from about the sixth join (its fan per join grows with the circle: the membership fan, the re-tells to the
 * newcomer, the address propagation), the refused frames are re-sent paced, and the late joiners' address
 * announcements land only after the lines: a late joiner's line goes to 'no-address' for everyone but the founder, and
 * an earlier member's line misses the late joiners. Three members was green (no over-rate); this size was red.
 *
 * The fix: a re-tell to a member whose address arrived after the fan goes to THAT member, not to the whole circle again
 * (membershipLateRecipient.js, `only`). Measured here at 12 members: 503 frames refused as over-rate before, 0 after;
 * at 14 members and 200 lines, 0 of 4935 and every line held.
 *
 * The shape is the seed's own calls (bootPeople, the founder's invites); P is helped by nothing the product does not do
 * at a join: it registers its circle address, as the app does after every join, and no harness key binding.
 * Sizes for a one-off run at the seed's size: LATE_JOINER_MEMBERS=14 LATE_JOINER_LINES=200.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { startRelay } from '@onderling/relay';
import { bootPeople, rosterOf, untilTrue } from '../../e2e-journeys/journeys/_app.mjs';
import { createCircle, joinExistingCircle, bindCircleAddresses, sendCircleChat } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { CHAT_LANE } from '../src/v2/chatManifest.js';
import { createRequire } from 'node:module';

// the relay's OWN copy of `ws` (it resolves its own; the app's copy never sees a relay frame)
const fromHere = createRequire(import.meta.url);
const WebSocket = createRequire(fromHere.resolve('@onderling/relay'))('ws');

// how often the relay refused a frame as over its rate, over the whole run (test-only: counted where the in-process
// relay sends the refusal). The ruling's acceptance prints it; 0 is the aim
let overRate = 0;
let framesSeen = 0;   // every frame the wrap saw: 0 would mean it is not the relay's socket class (a probe that names its branch)
const wsSend = WebSocket.prototype.send;
WebSocket.prototype.send = function countOverRate(data, ...rest) {
  framesSeen += 1;
  if (typeof data === 'string' && data.includes('"OVER_RATE"')) overRate += 1;
  return wsSend.call(this, data, ...rest);
};

const GROUP = 'late-joiner-lines';
const MEMBERS = Number(process.env.LATE_JOINER_MEMBERS ?? 12);
const LINES = Number(process.env.LATE_JOINER_LINES ?? MEMBERS + 1);   // by default one line from each writer
let relay = null;
afterAll(async () => { await relay?.stop?.(); WebSocket.prototype.send = wsSend; });

const heldBy = (node) => new Set(node.chatEventLog.query({}).filter((e) => e?.type === CHAT_LANE && e?.payload?.circleId === GROUP).map((e) => e.id));

describe('lines of a member who joins after you', () => {
  it('the member who joined first holds the lines of every member who joined after it', async () => {
    relay = await startRelay({ port: 0 });
    const relayUrl = `ws://127.0.0.1:${relay.port}`;
    const [F, P, ...Ms] = await bootPeople({ relayUrl, handles: ['founder', 'early', ...Array.from({ length: MEMBERS }, (_, i) => `m${i + 1}`)] });
    await createCircle(F, { groupId: GROUP, name: 'Laat', inviteMaxRedemptions: MEMBERS + 6 });
    await bindCircleAddresses([F], GROUP);
    const pJoin = await joinExistingCircle(F, P, { groupId: GROUP, handle: 'early' });
    expect(pJoin?.joined?.ok, 'P joined').toBe(true);
    await bindCircleAddresses([P], GROUP);   // what the app does after every join (registerCirclePresence)
    for (const [k, m] of Ms.entries()) {
      const r = await joinExistingCircle(F, m, { groupId: GROUP, handle: `m${k + 1}` });
      expect(r?.joined?.ok, `m${k + 1} joined: ${JSON.stringify(r?.joined ?? r)}`).toBe(true);
    }
    // the harness binds the WRITERS as the seed does; P gets nothing beyond what its own join did
    const writers = [F, ...Ms];
    await bindCircleAddresses(writers, GROUP);
    await Promise.all(writers.map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: GROUP })));
    expect((await rosterOf(F, GROUP)).length).toBe(MEMBERS + 2);
    // as the seed: line i from writer i % writers, a breath every 20
    for (let i = 0; i < LINES; i += 1) {
      const r = await sendCircleChat(writers[i % writers.length], { groupId: GROUP, msgId: `${GROUP}-m${i}`, text: `regel ${i}`, ts: Date.now() });
      expect(r?.error ?? null, `line ${i} left`).toBeNull();
      if (i % 20 === 19) await new Promise((res) => setTimeout(res, 300));
    }
    const want = Array.from({ length: LINES }, (_, i) => `${GROUP}-m${i}`);
    await untilTrue(() => want.every((id) => heldBy(P).has(id)), 20000, 250);
    console.info(`[late-joiner] ${MEMBERS} members, ${LINES} lines: the relay refused ${overRate} frame(s) as over-rate (of ${framesSeen} frames seen)`);
    const held = heldBy(P);
    const missingByWriter = {};
    for (const [i, id] of want.entries()) if (!held.has(id)) missingByWriter[`w${i % writers.length}`] = (missingByWriter[`w${i % writers.length}`] ?? 0) + 1;
    expect(missingByWriter, 'lines P does not hold, by writer (w0 = the founder)').toEqual({});
  }, 600000);
});
