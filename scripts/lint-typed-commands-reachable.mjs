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
 * Handlers that exist and cannot be typed, pending L70. Dated so the list reads as debt, not design.
 * A DECLARED SCREEN COUNTS AS A DOOR (2026-09-01). The guard originally knew one kind — a typed command
 * in `CIRCLE_BUILTIN_COMMANDS` — because when it was written that was the only kind basis's ops had. An
 * op that declares `surfaces.ui` or `surfaces.page` is reached by tapping it, on both shells, through
 * the page projection; asking such an op to ALSO be typeable would be asking for a second door and
 * calling its absence a defect. So `find`, `brief` and `logs` leave the list by gaining a page, not by
 * being excused — which is the shrink this guard asks for, arriving in a shape it had not anticipated.
 *
 * SHRINK THIS by giving a command a door (add it to `CIRCLE_BUILTIN_COMMANDS` and wire both composers,
 * or declare `surfaces.ui`/`surfaces.page` on the op) or by deleting the handler. A new entry needs a
 * sentence saying why a person should not reach it.
 */
const UNREACHED = new Set([
  // Composer affordances the circle UI now does with buttons rather than typing.
  'embed', 'embed-file', 'embed-time', 'send-file', 'scanQr',
  // Still meaningful, no door since chat was folded into the circle view (2026-07) — the L70 set.
  'audit-tail', 'debug-dump', 'help', 'help-with',
  'lookup-peer', 'me', 'mute', 'muted', 'unmute', 'peer-connect', 'publish-peer', 'rotate-identity',
  'signin', 'signout', 'test-peer', 'whoami',
]);

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
 * Does this op declare a door of its own? Read off the manifest SOURCE rather than imported, so the
 * guard stays a cheap text check like its siblings and cannot be broken by an import cycle. A `page` or
 * a `ui` block inside the op's `surfaces` is a screen both shells project — tapping it is reaching it.
 */
const manifestSrc = read('apps/basis/manifest.js');
function hasOwnDoor(opId) {
  const at = manifestSrc.indexOf(`id:    '${opId}'`) >= 0
    ? manifestSrc.indexOf(`id:    '${opId}'`)
    : manifestSrc.indexOf(`id:   '${opId}'`);
  if (at < 0) return false;
  // The op's own literal: from its id to the end of its surfaces block, bounded by the next op's id.
  const nextId = manifestSrc.indexOf("id:    '", at + 10);
  const body = manifestSrc.slice(at, nextId > 0 ? nextId : manifestSrc.length);
  return /\bpage:\s*\{/.test(body) || /\bui:\s*\{/.test(body);
}

const problems = [];
const table = chatBuiltins();
if (table.length === 0) problems.push('could not read the chat builtins table — the parse needle moved');

for (const cmd of table) {
  if (circleSet.has(cmd) || UNREACHED.has(cmd) || hasOwnDoor(cmd)) continue;
  problems.push(`"${cmd}" is a handler a person cannot type: it is not in CIRCLE_BUILTIN_COMMANDS (which both shells run) and not declared unreached. Give it a door, or say why it should not have one.`);
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
console.log(`✓ lint-typed-commands-reachable: ${table.length} handlers — ${circleSet.size} reachable in both shells, ${UNREACHED.size} declared unreached (ledger L70).`);
