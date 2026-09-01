#!/usr/bin/env node
/**
 * lint-typed-commands-reachable — a command a person can TYPE must have a door, in both shells.
 *
 * basis has two builtin tables and only one of them is reachable:
 *
 *   • `CIRCLE_BUILTIN_COMMANDS` (src/v2/circleComposerBuiltins.js) — the circle composer's set. Both
 *     shells classify and execute it, and two fitness tests pin that parity.
 *   • `createLocalBuiltins` (src/core/localBuiltins.js) — 36 handlers from the chat shell. Web never
 *     mounts the table at all (it imports one function); mobile mounts it in `ChatScreen`, which
 *     `App.js` renders behind the launcher with `pointerEvents="none"` and a comment saying so.
 *
 * So thirty-one commands are dependency-injected, covered by ~60 test call sites, and typeable by
 * nobody. Not a web≢mobile drift — parity is technically satisfied, since neither shell reaches them.
 * That is why every parity guard stayed green: they compare the shells to each other, and both are
 * equally shut. What was missing is the question underneath, "can a person get to this at all"
 * (CLAUDE.md: DONE = declared · implemented · tested · REACHED).
 *
 * This guard asks it. A handler in the chat table is either reachable — in the circle set, which both
 * shells run — or listed below with a reason and a date. The list may shrink; adding to it is the
 * thing to argue about in review, which is the point.
 *
 * → the product decision this waits on is ledger L70 in REMAINING-WORK.md.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Handlers that exist and cannot be typed. EMPTY since 2026-09-01, and the emptiness is the point.
 *
 * The list used to hold 24 names because "typeable" meant "in `CIRCLE_BUILTIN_COMMANDS`" — five commands
 * each shell hand-parsed and hand-dispatched, because basis's ops were not on the agent's waist and a
 * shell had to do something bespoke to reach them. With the ops mounted (`realAgent`'s `basis` branch),
 * both circle composers dispatch the GENERAL case through the shared seam: `composerCommands.parse` reads
 * the line against the manifest — the op's own `body` rule, so `/logs --app=stoop` and `/block alice`
 * mean what they always meant — and the shell calls `callSkill('basis', opId, args)`.
 *
 * So reachability is no longer a list to maintain: an op is typeable BECAUSE it declares a slash command.
 * This guard therefore checks the two things that could stop being true — that each shell still wires the
 * general route, and that every handler still declares a command — and only falls back to the hardcoded
 * five if a shell has dropped its route, which is the regression worth failing over.
 *
 * A new entry here needs a sentence saying why a person should not be able to type that op.
 */
const UNREACHED = new Set([]);

/**
 * Does this shell still dispatch ANY declared basis command, or only the hand-written five? Two things
 * must both be present: the seam that reads the line (`composerCommands`), and the waist call that runs
 * it. Either one missing means that shell has quietly gone back to five.
 */
function shellRoutesEveryCommand(rel) {
  const src = read(rel);
  return /composerCommands|createComposerCommands/.test(src)
    && /appOrigin === 'basis'/.test(src);
}
const GENERAL_ROUTE = [
  'apps/basis/web/v2/circleApp.js',
  'apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js',
].filter((f) => !shellRoutesEveryCommand(f));

/** The command keys of the chat builtins table — the first object `createLocalBuiltins` returns. */
function chatBuiltins() {
  const src = read('apps/basis/src/core/localBuiltins.js');
  const start = src.indexOf('return {', src.indexOf('export function createLocalBuiltins'));
  let depth = 0, end = start;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  return [...src.slice(start, end).matchAll(/^\s{2,6}'?([a-zA-Z][\w-]*)'?:\s*(?:async\s*)?\(/gm)].map((m) => m[1]);
}

const circleSet = new Set(
  [...read('apps/basis/src/v2/circleComposerBuiltins.js')
    .slice(0, read('apps/basis/src/v2/circleComposerBuiltins.js').indexOf(']);'))
    .matchAll(/'([a-z][a-z-]*)'/g)].map((m) => m[1]),
);

/**
 * Do the shells actually ROUTE this op — is there code that opens its screen? A declared surface is a
 * claim; this is the check that the claim was honoured. Cheap text search over the two shells' own
 * sources, in the spirit of the rest of this guard.
 */
const shellSrc = [
  'apps/basis/web/v2/circleApp.js',
  'apps/basis/web/v2/circleSettings.js',
  'apps/basis/web/v2/circleProfile.js',
  'apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js',
  'apps/basis-mobile/src/screens/v2/CircleSettingsScreen.js',
  'apps/basis-mobile/src/core/wizardRegistry.js',
].map(read).join('\n');
const routedInAShell = (opId) => new RegExp(`['\`"]${opId}['\`"]`).test(shellSrc);

/**
 * Does this op have a door of its own? Read off the manifest SOURCE rather than imported, so the guard
 * stays a cheap text check like its siblings and cannot be broken by an import cycle — but a declared
 * `page`/`ui` only counts when a shell routes it, or the declaration becomes a way to silence the guard
 * while REMOVING the op from the drawer that was painting it. That is not a hypothetical; see above.
 */
const manifestSrc = read('apps/basis/manifest.js');
/**
 * Does this op declare a slash command? Read off its OWN block, because the command is not the op id —
 * `mute` is typed `/block`, `muted` is `/blocked`, `scanQr` is `/scan-qr`. Matching the two by name is
 * the mistake that would make this guard demand commands that already exist.
 */
function declaresSlashCommand(opId) {
  const at = manifestSrc.indexOf(`id:    '${opId}'`) >= 0
    ? manifestSrc.indexOf(`id:    '${opId}'`)
    : manifestSrc.indexOf(`id:   '${opId}'`);
  if (at < 0) return false;
  const nextId = manifestSrc.indexOf("id:    '", at + 10);
  const body = manifestSrc.slice(at, nextId > 0 ? nextId : manifestSrc.length);
  return /slash:\s*\{\s*command:\s*'\//.test(body);
}
function hasOwnDoor(opId) {
  const at = manifestSrc.indexOf(`id:    '${opId}'`) >= 0
    ? manifestSrc.indexOf(`id:    '${opId}'`)
    : manifestSrc.indexOf(`id:   '${opId}'`);
  if (at < 0) return false;
  // The op's own literal: from its id to the end of its surfaces block, bounded by the next op's id.
  const nextId = manifestSrc.indexOf("id:    '", at + 10);
  const body = manifestSrc.slice(at, nextId > 0 ? nextId : manifestSrc.length);
  const declares = /\bpage:\s*\{/.test(body) || /\bui:\s*\{/.test(body);
  return declares && routedInAShell(opId);
}

const problems = [];
const table = chatBuiltins();
if (table.length === 0) problems.push('could not read the chat builtins table — the parse needle moved');

for (const shell of GENERAL_ROUTE) {
  problems.push(`${shell} no longer dispatches the general typed command (the composerCommands seam + the basis waist call). Without it only the five hand-written builtins can be typed there, and this guard's list goes back to 24.`);
}

const typeable = (cmd) => {
  if (circleSet.has(cmd)) return true;                       // hand-written, dispatched by both shells
  if (GENERAL_ROUTE.length > 0) return false;                // a shell dropped the route — five only
  return declaresSlashCommand(cmd);
};

for (const cmd of table) {
  if (typeable(cmd) || UNREACHED.has(cmd) || hasOwnDoor(cmd)) continue;
  problems.push(`"${cmd}" is a handler a person cannot type: it declares no slash command, and is not declared unreached. Give it one, or say why it should not have one.`);
}
for (const cmd of UNREACHED) {
  if (circleSet.has(cmd)) problems.push(`"${cmd}" is declared unreached AND present in CIRCLE_BUILTIN_COMMANDS — it has a door now, so remove it from UNREACHED.`);
  else if (!table.includes(cmd)) problems.push(`"${cmd}" is declared unreached but no longer exists as a handler — remove the stale entry.`);
}

if (problems.length) {
  console.error(`✖ lint-typed-commands-reachable — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  • ${p}`);
  process.exit(1);
}
const typeableCount = table.filter(typeable).length;
console.log(`✓ lint-typed-commands-reachable: ${table.length} handlers — ${typeableCount} typeable in both shells (${circleSet.size} hand-written + the general route), ${UNREACHED.size} declared unreached.`);
