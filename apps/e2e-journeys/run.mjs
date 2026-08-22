#!/usr/bin/env node
/**
 * onderling e2e journey harness — runs the flagship user journeys against a relay,
 * in one process, with the REAL SDK + app code (not stubs).
 *
 *   node run.mjs                       # self-contained: starts a local relay, runs all
 *   node run.mjs wss://your-relay      # against a deployed relay (or set RELAY_URL)
 *   node run.mjs wss://url two-party offline   # only the named journeys
 *
 * Exit 0 = every journey fully green, 1 = something failed, 2 = usage.
 *
 * Each journey module exports { name, run({ relayUrl }) -> [{name, ok, detail}] }.
 * Journeys run sequentially against the same relay (fresh identities each, so no
 * collision) — the shared relay is the point: this exercises one endpoint end-to-end.
 */
import { startRelay } from '@onderling/relay';
import * as twoParty    from './journeys/twoParty.journey.mjs';
import * as offline     from './journeys/offline.journey.mjs';
import * as circle      from './journeys/circle.journey.mjs';
import * as sealedInbox from './journeys/sealedInbox.journey.mjs';
import * as noticeboard from './journeys/noticeboard.journey.mjs';
import * as companion   from './journeys/companion.journey.mjs';
import * as taskClaim   from './journeys/taskClaim.journey.mjs';
import * as security    from './journeys/security.journey.mjs';
import * as notifications from './journeys/notifications.journey.mjs';
import * as feedback     from './journeys/feedback.journey.mjs';
import * as manage       from './journeys/manage.journey.mjs';
import * as bot          from './journeys/bot.journey.mjs';
import * as keyexchange  from './journeys/keyexchange.journey.mjs';
import * as telegram     from './journeys/telegram.journey.mjs';
import * as media        from './journeys/media.journey.mjs';
import * as removal      from './journeys/removal.journey.mjs';
import * as mute         from './journeys/mute.journey.mjs';
import * as governance   from './journeys/governance.journey.mjs';
import * as reachability  from './journeys/reachability.journey.mjs';
import * as membership    from './journeys/membership.journey.mjs';
import * as roles         from './journeys/roles.journey.mjs';
import * as offerings     from './journeys/offerings.journey.mjs';
import * as appComposition from './journeys/appComposition.journey.mjs';
import * as podModes      from './journeys/podModes.journey.mjs';

const ALL = [twoParty, offline, circle, sealedInbox, noticeboard, companion, taskClaim, security, notifications, feedback, manage, bot, keyexchange, telegram, media, removal, mute, governance, reachability, membership, roles, offerings, appComposition, podModes];
const KEY = (n) => n.split(' ')[0].toLowerCase().replace(/[^a-z-]/g, ''); // "two-party messaging" -> "two-party"

const args = process.argv.slice(2);
const urlArg = args.find((a) => a.includes('://'));
const filters = args.filter((a) => !a.includes('://')).map((s) => s.toLowerCase());
const relayUrlGiven = urlArg || process.env.RELAY_URL;

let selected = ALL;
if (filters.length) {
  selected = ALL.filter((j) => filters.some((f) => KEY(j.name).includes(f) || j.name.toLowerCase().includes(f)));
  if (!selected.length) {
    console.error(`no journeys matched ${JSON.stringify(filters)}. available: ${ALL.map((j) => KEY(j.name)).join(', ')}`);
    process.exit(2);
  }
}

let localRelay = null;
let relayUrl = relayUrlGiven;
if (!relayUrl) {
  localRelay = await startRelay({ port: 0 });
  relayUrl = `ws://127.0.0.1:${localRelay.port}`;
  console.log(`(no relay URL given → started a local relay at ${relayUrl})`);
}

console.log(`\n╔══ onderling e2e journeys → ${relayUrl}`);
console.log(`╚══ ${selected.length} ${selected.length === 1 ? 'journey' : 'journeys'}\n`);

const summary = [];
for (const j of selected) {
  console.log(`── ${j.name} ──`);
  let res;
  try {
    res = await j.run({ relayUrl });
  } catch (e) {
    res = [{ name: 'journey crashed', ok: false, detail: e?.message ?? String(e) }];
  }
  if (res && !Array.isArray(res) && res.skipped) {
    console.log(`   ⏭️  skipped — ${res.reason}\n`);
    summary.push({ name: j.name, skipped: true });
    continue;
  }
  for (const r of res) console.log(`   ${r.ok ? '✅' : '❌'} ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  const passed = res.filter((r) => r.ok).length;
  console.log(`   → ${passed}/${res.length}\n`);
  summary.push({ name: j.name, passed, total: res.length, ok: passed === res.length && res.length > 0 });
}

if (localRelay) await localRelay.stop().catch(() => {});

console.log('══ summary ══');
for (const s of summary) {
  if (s.skipped) { console.log(`  ⏭️  ${s.name}: skipped`); continue; }
  console.log(`  ${s.ok ? '✅' : '❌'} ${s.name}: ${s.passed}/${s.total}`);
}
const ran     = summary.filter((s) => !s.skipped);
const skipped = summary.filter((s) => s.skipped).length;
const totPass = ran.reduce((a, s) => a + s.passed, 0);
const totAll  = ran.reduce((a, s) => a + s.total, 0);
const allOk   = ran.every((s) => s.ok);
const skipNote = skipped ? ` (${skipped} skipped)` : '';
console.log(`\n  ${allOk ? '✅ ALL GREEN' : '❌ FAILURES'} — ${totPass}/${totAll} checks across ${ran.length} journeys${skipNote}\n`);
process.exit(allOk ? 0 : 1);
