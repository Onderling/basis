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
import * as governanceVote from './journeys/governanceVote.journey.mjs';
import * as attachments   from './journeys/attachments.journey.mjs';
import * as eviction      from './journeys/eviction.journey.mjs';
import * as keyRotation   from './journeys/keyRotation.journey.mjs';
import * as absence       from './journeys/absence.journey.mjs';
import * as custody       from './journeys/custody.journey.mjs';
import * as receipts      from './journeys/receipts.journey.mjs';
import * as taskSession   from './journeys/taskSession.journey.mjs';
import * as lastAdmin     from './journeys/lastAdmin.journey.mjs';
import * as scope         from './journeys/scope.journey.mjs';
import * as doors         from './journeys/doors.journey.mjs';
import * as promotion     from './journeys/promotion.journey.mjs';

const ALL = [twoParty, offline, circle, sealedInbox, noticeboard, companion, taskClaim, security, notifications, feedback, manage, bot, keyexchange, telegram, media, removal, mute, governance, reachability, membership, roles, offerings, appComposition, podModes, governanceVote, attachments, eviction, keyRotation, absence, custody, receipts, taskSession, lastAdmin, scope, doors, promotion];
const KEY = (n) => n.split(' ')[0].toLowerCase().replace(/[^a-z-]/g, ''); // "two-party messaging" -> "two-party"

const { readFile, writeFile } = await import('node:fs/promises');

const args = process.argv.slice(2);
const urlArg = args.find((a) => a.includes('://'));
const UPDATE_BASELINE = args.includes('--update-baseline');
const filters = args.filter((a) => !a.includes('://') && !a.startsWith('--')).map((s) => s.toLowerCase());

/**
 * KNOWN FAILURES — the checks that are red because of an OPEN FINDING, not a regression.
 *
 * Without this the suite is red forever and CI teaches people to ignore it, which is the exact
 * habit a gate exists to prevent. With it, red means "something changed", which is the only kind of
 * red worth having. The file doubles as the open-findings list, in the words of the checks that
 * prove them.
 *
 * It SHRINKS on its own: a baselined check that starts passing fails the run and asks to be
 * removed. A baseline that only grows is debt with a green light on it.
 *
 * Refresh with `node run.mjs --update-baseline` — and read the diff before committing it.
 */
const BASELINE_PATH = new URL('./known-failures.json', import.meta.url);
let BASELINE = {};
try { BASELINE = JSON.parse(await readFile(BASELINE_PATH, 'utf8')); } catch { BASELINE = {}; }
const baselinedFor = (journey) => new Set(BASELINE[journey] ? Object.keys(BASELINE[journey]) : []);
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
  const known = baselinedFor(j.name);
  for (const r of res) {
    const mark = r.ok ? '✅' : (known.has(r.name) ? '🔸' : '❌');
    const why  = (!r.ok && known.has(r.name)) ? `  [known: ${BASELINE[j.name][r.name]}]` : '';
    console.log(`   ${mark} ${r.name}${r.detail ? '  — ' + r.detail : ''}${why}`);
  }
  const passed    = res.filter((r) => r.ok).length;
  const surprises = res.filter((r) => !r.ok && !known.has(r.name)).map((r) => r.name);
  // A baselined check that now PASSES is how the list shrinks — say so, and mean it.
  const fixed     = res.filter((r) => r.ok && known.has(r.name)).map((r) => r.name);
  console.log(`   → ${passed}/${res.length}\n`);
  summary.push({
    name: j.name, passed, total: res.length,
    ok: passed === res.length && res.length > 0,
    surprises, fixed,
    failures: Object.fromEntries(res.filter((r) => !r.ok).map((r) => [r.name, BASELINE[j.name]?.[r.name] ?? 'open finding — name it'])),
  });
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

if (UPDATE_BASELINE) {
  const next = {};
  for (const s of ran) if (Object.keys(s.failures ?? {}).length) next[s.name] = s.failures;
  await writeFile(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n');
  console.log(`\n  ✍️  baseline written — ${Object.values(next).reduce((a, o) => a + Object.keys(o).length, 0)} known failure(s).`);
  console.log('     Read the diff before committing: every entry is a claim that a red is EXPECTED.\n');
  process.exit(0);
}

const surprises = ran.flatMap((s) => (s.surprises ?? []).map((n) => `${s.name} → ${n}`));
const fixed     = ran.flatMap((s) => (s.fixed ?? []).map((n) => `${s.name} → ${n}`));
const surprisesEarly = ran.flatMap((s) => s.surprises ?? []);
const fixedEarly     = ran.flatMap((s) => s.fixed ?? []);
// The headline states the VERDICT, not the arithmetic: a red that is entirely known is not a
// failure of this run, and saying "FAILURES" while exiting 0 is the mixed signal a gate must not
// send. `allOk` still means every check passed; the middle state gets its own words.
const verdict = allOk ? '✅ ALL GREEN'
  : (surprisesEarly.length || fixedEarly.length) ? '❌ FAILURES'
  : '🔸 NO REGRESSIONS';
console.log(`\n  ${verdict} — ${totPass}/${totAll} checks across ${ran.length} journeys${skipNote}`);

if (surprises.length) {
  console.log(`\n  ❌ ${surprises.length} UNEXPECTED failure(s) — not on the known-failures list:`);
  for (const n of surprises) console.log(`     • ${n}`);
}
if (fixed.length) {
  console.log(`\n  🎉 ${fixed.length} known failure(s) now PASS — take them off the list:`);
  for (const n of fixed) console.log(`     • ${n}`);
  console.log('     (run with --update-baseline, then read the diff)');
}
const knownCount = totAll - totPass - surprises.length;
if (!surprises.length && !fixed.length) {
  console.log(knownCount ? `\n  🔸 ${knownCount} known failure(s), all accounted for by open findings.\n` : '\n');
}
// Red ONLY when something changed: a new failure, or a baselined one that started passing.
process.exit(surprises.length || fixed.length ? 1 : 0);
