#!/usr/bin/env node
/**
 * SEED A PHONE TO THE ALPHA SIZE, for the cold-start measure (ledger L619; Fable's ruling 2026-11-19).
 *
 * A founder and 14 members, booted as a shell composes a device (`bootPeople`, the device log on), on a LOCAL relay
 * the phone reaches through `adb reverse` (nothing on the live relay). The founder makes 5 circles; the PHONE joins
 * each first, by the invite's own link opened over adb (the invite carries the local relay, so the phone adopts it as
 * its connection point); then the 14 join each through the real invite + redeem; then ~200 chat lines per circle,
 * spread over the 15 senders, fan to the phone live (the app in the foreground), so nothing leans on backfill.
 * Everything goes over the relay: no shortcut writes into a store.
 *
 * The relay stays UP when seeding is done (the cold starts are measured with it reachable); stop with Ctrl-C.
 *
 *   node apps/e2e-journeys/seed-alpha-size.mjs --serial RFCT504SRZH [--circles 5] [--members 14] [--lines 200] [--port 8799]
 *
 * Every sender's `undelivered` reports (the relay gave up on a line it was holding) are counted per sender and per
 * circle and printed at the end, and each later one as it comes (the relay stays up): 'sent' is what left, not what
 * arrived; the phone's own count is read on the phone.
 *
 * The phone's join wizard is tapped through by hand (or Detox); the script waits for the founder's roster to hold
 * the phone before it goes on, and says which step it is on.
 */
import { execFileSync } from 'node:child_process';
import { startRelay } from '@onderling/relay';
import { bootPeople, rosterOf, untilTrue } from './journeys/_app.mjs';
import { createCircle, joinExistingCircle, bindCircleAddresses, sendCircleChat } from '../basis/test/support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../basis/src/v2/householdRosterPairing.js';
import { buildCircleInviteUri } from '../basis/src/v2/circleInvite.js';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const serial = arg('serial', null);
const CIRCLES = Number(arg('circles', 5));
const MEMBERS = Number(arg('members', 14));
const LINES = Number(arg('lines', 200));
const PORT = Number(arg('port', 8799));
if (!serial) { console.error('--serial <adb serial> is required (the phone is free to wipe: the Samsung)'); process.exit(2); }

const adb = (...a) => execFileSync('adb', ['-s', serial, ...a], { encoding: 'utf8' });
const step = (s) => console.log(`\n── ${s}`);
const WORDS = ['melk', 'brood', 'morgen', 'vergadering', 'fiets', 'sleutel', 'tuin', 'koffie', 'om tien uur', 'de buren', 'boodschappen', 'het feest'];
const line = (i) => `${WORDS[i % WORDS.length]} ${WORDS[(i * 7 + 3) % WORDS.length]} (${i + 1})`;

step(`a local relay on :${PORT}, reached by the phone through adb reverse`);
const relay = await startRelay({ port: PORT });
const relayUrl = `ws://127.0.0.1:${relay.port}`;
adb('reverse', `tcp:${relay.port}`, `tcp:${relay.port}`);
console.log(`relay ${relayUrl}; adb reverse tcp:${relay.port} set`);

step(`boot the founder and ${MEMBERS} members`);
const handles = ['founder', ...Array.from({ length: MEMBERS }, (_, i) => `member-${i + 1}`)];
const undelivered = [];   // {handle, circle, reason, msgId}
let seeded = false;
const circleOfMsg = (id) => (/^(seed-\d+)-m\d+/.exec(String(id ?? ''))?.[1] ?? '?');
const onUndelivered = (handle, info) => {
  const row = { handle, circle: circleOfMsg(info?.msgId), reason: info?.reason ?? 'unknown', msgId: info?.msgId ?? null };
  undelivered.push(row);
  if (seeded) console.log(`undelivered (late): ${row.handle} ${row.circle} ${row.msgId} (${row.reason})`);
};
const people = await bootPeople({ relayUrl, handles, onUndelivered });
const [founder, ...members] = people;
console.log(`${people.length} booted`);

const held = { circles: 0, members: 0, lines: 0 };
for (let c = 1; c <= CIRCLES; c += 1) {
  const circleId = `seed-${c}`;
  step(`circle ${c}/${CIRCLES} (${circleId}): made by the founder`);
  // one invite admits the whole group: the ceiling the create wizard asks for, set as a person would for 16 people
  await createCircle(founder, { groupId: circleId, name: `Proefkring ${c}`, inviteMaxRedemptions: MEMBERS + 6 });
  await bindCircleAddresses([founder], circleId);

  step(`circle ${c}: the PHONE joins first, by the invite's link`);
  const before = (await rosterOf(founder, circleId)).length;
  const invite = await buildCircleInviteUri({
    callSkill: (app, op, a) => founder.agent.callSkill(app, op, a), circleId,
    adminPeerAddr: founder.agent.circleSelf?.(circleId)?.webid ?? founder.pubKey, relayUrl,
  });
  if (invite?.error || !invite?.uri) throw new Error(`the invite for ${circleId} was not built: ${JSON.stringify(invite)}`);
  adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', invite.uri, 'org.onderling.basis');
  console.log('opened on the phone: tap through the join (rules, name, join); waiting for the founder\'s roster…');
  const phoneIn = await untilTrue(async () => (await rosterOf(founder, circleId)).length > before, 10 * 60_000, 1000);
  if (!phoneIn) throw new Error(`the phone did not join ${circleId} within 10 minutes (roster still ${before})`);
  console.log(`phone in: roster ${(await rosterOf(founder, circleId)).length}`);

  step(`circle ${c}: ${MEMBERS} members join through the real invite + redeem`);
  for (let i = 0; i < members.length; i += 1) {
    const r = await joinExistingCircle(founder, members[i], { groupId: circleId, handle: handles[i + 1] });
    if (!r?.joined?.ok) throw new Error(`join failed for ${handles[i + 1]} in ${circleId}: ${JSON.stringify(r?.joined)}`);
  }
  const all = [founder, ...members];
  await bindCircleAddresses(all, circleId);
  await Promise.all(all.map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId })));
  const roster = (await rosterOf(founder, circleId)).length;
  console.log(`roster ${roster} (founder + phone + ${MEMBERS} expected = ${MEMBERS + 2})`);

  step(`circle ${c}: ${LINES} chat lines over ${all.length} senders`);
  let sent = 0;
  for (let i = 0; i < LINES; i += 1) {
    const from = all[i % all.length];
    const r = await sendCircleChat(from, { groupId: circleId, msgId: `${circleId}-m${i}`, text: line(i), ts: Date.now() });
    if (r?.error) console.log(`line ${i} from ${from.handle ?? i % all.length}: ${JSON.stringify(r.error)}`); else sent += 1;
    if (i % 20 === 19) await new Promise((res) => setTimeout(res, 300));   // let the fan-out breathe
  }
  console.log(`${sent}/${LINES} sent`);
  held.circles += 1; held.members = Math.max(held.members, roster); held.lines += sent;
}

step('SEEDED');
console.log(`sent: ${held.circles} circles, up to ${held.members} members each, ${held.lines} chat lines in all`);
const tally = (key) => undelivered.reduce((m, r) => m.set(r[key], (m.get(r[key]) ?? 0) + 1), new Map());
console.log(`undelivered reports so far: ${undelivered.length}`);
for (const [k, n] of tally('circle')) console.log(`  circle ${k}: ${n}`);
for (const [k, n] of tally('handle')) console.log(`  sender ${k}: ${n}`);
for (const [k, n] of tally('reason')) console.log(`  reason ${k}: ${n}`);
seeded = true;
console.log('the relay stays UP for the cold starts; Ctrl-C stops it (then: adb reverse --remove-all).');
const stop = async () => { try { adb('reverse', '--remove-all'); } catch { /* the phone may be gone */ } await relay.stop?.(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
