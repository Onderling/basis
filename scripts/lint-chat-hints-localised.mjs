#!/usr/bin/env node
/**
 * lint-chat-hints-localised — every op the household assistant can be asked for has a Dutch hint.
 *
 * The model picks a tool by its description. A Dutch member's line matched against English-only hints is where
 * "zet … op" went to the wrong tool; the hint in the member's language, first, is part of the fix (`chatHints.js`).
 * So every op with a chat surface in the household scope (household, lists, tasks, the door's own) must have
 * `<app>.<opId>` in `apps/basis/src/locales/chat-hints.nl.json`, in the `{text, doc}` shape. The English is the
 * manifest's own hint — there is no English copy.
 *
 * The ALLOW list holds what is not translated yet (the tasks ops, until tasks on the box keeps its chat subset). It
 * only SHRINKS: an entry that has its hint is stale and red, so the list is cleaned as hints land.
 *
 * Usage: node scripts/lint-chat-hints-localised.mjs   (runs inside `npm run guards`)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
export const SCOPE = Object.freeze(['household', 'lists', 'tasks', 'assistant']);

// Not translated yet. Shrinks only.
export const ALLOW = new Set([
  'tasks:addTask', 'tasks:confirmClaim', 'tasks:removeTask', 'tasks:attachTaskGrant',
  'tasks:reassignTask', 'tasks:submitTask', 'tasks:approveTask', 'tasks:rejectTask', 'tasks:revokeTask',
  'tasks:listClaimable', 'tasks:listClaimConflicts', 'tasks:resolveClaim', 'tasks:listAwaitingApproval',
  'tasks:listMyMasteredTasks', 'tasks:listMyPendingClaims', 'tasks:listMyInbox', 'tasks:clearInboxItem',
  'tasks:approveSubtaskRequest', 'tasks:declineSubtaskRequest', 'tasks:approveSubtaskProposal', 'tasks:declineSubtaskProposal',
  'tasks:clearInbox', 'tasks:getDagTree', 'tasks:archiveCircle', 'tasks:unarchiveCircle', 'tasks:editTask', 'tasks:provisionMyCircle',
  'tasks:myInbox', 'tasks:getMyAvailability', 'tasks:setMyAvailability', 'tasks:setAvailabilityOptIn', 'tasks:suggestSchedule',
  'tasks:acceptSchedule', 'tasks:getMyCircles', 'tasks:listMyTasksAcrossCircles', 'tasks:getCircleConfig', 'tasks:listCircleMembers',
  'tasks:pauseCircle', 'tasks:unpauseCircle', 'tasks:issueInvite', 'tasks:redeemInvite', 'tasks:addSubtask', 'tasks:proposeSubtask',
  'tasks:forceSpawnSubtask',
]);

/**
 * @param {object[]} manifests
 * @param {object} nlBundle  the Dutch hints (`chat-hints.nl.json`)
 * @param {Set<string>} [allow]
 * @returns {{missing: string[], badShape: string[], stale: string[]}}
 */
export function auditHints(manifests, nlBundle, allow = ALLOW) {
  const missing = []; const badShape = []; const stale = [];
  for (const m of manifests) {
    if (!SCOPE.includes(m.app)) continue;
    for (const op of m.operations ?? []) {
      if (!op?.surfaces?.chat) continue;
      const key = `${m.app}:${op.id}`;
      const leaf = nlBundle?.[m.app]?.[op.id];
      const good = leaf && typeof leaf === 'object' && typeof leaf.text === 'string' && leaf.text.trim() && typeof leaf.doc === 'string';
      if (leaf && !good) badShape.push(key);
      if (!leaf && !allow.has(key)) missing.push(key);
      if (good && allow.has(key)) stale.push(key);
    }
  }
  return { missing, badShape, stale };
}

const NL = 'apps/basis/src/locales/chat-hints.nl.json';
const SELF = 'scripts/lint-chat-hints-localised.mjs';

/** The red lines for an audit: what is wrong, where (file:line where a file holds it), and what to do instead. */
export function hintMessages({ missing, badShape, stale }, { nlText = '', selfText = '' } = {}) {
  const lineOf = (text, needle) => { const i = String(text).split('\n').findIndex((l) => l.includes(needle)); return i < 0 ? 1 : i + 1; };
  const out = [];
  if (missing.length) {
    out.push('✖ lint:chat-hints — no Dutch hint for these chat ops (declared in their manifest; the hints file has no entry yet):');
    for (const k of missing) out.push(`  ${k}`);
    out.push(`  Fix: add "<app>": { "<opId>": { "text": "…", "doc": "…" } } for each to ${NL}.`);
  }
  if (badShape.length) {
    out.push('✖ lint:chat-hints — a hint that is not {text, doc}:');
    for (const k of badShape) out.push(`  ${NL}:${lineOf(nlText, `"${k.split(':')[1]}"`)}: ${k}`);
    out.push('  Fix: make each entry an object { "text": "<the hint>", "doc": "<what the op does>" }.');
  }
  if (stale.length) {
    out.push('✖ lint:chat-hints — translated, but still on ALLOW:');
    for (const k of stale) out.push(`  ${SELF}:${lineOf(selfText, `'${k}'`)}: ${k}`);
    out.push('  Fix: take each off ALLOW (the list only shrinks).');
  }
  return out;
}

async function main() {
  const { catalogueManifests, DOOR_MANIFESTS } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/v2/manifestSources.js')).href);
  const nlText = readFileSync(path.join(ROOT, NL), 'utf8');
  const nl = JSON.parse(nlText);
  const { missing, badShape, stale } = auditHints([...catalogueManifests(), ...DOOR_MANIFESTS], nl);
  if (missing.length || badShape.length || stale.length) {
    const selfText = readFileSync(path.join(ROOT, SELF), 'utf8');
    for (const l of hintMessages({ missing, badShape, stale }, { nlText, selfText })) console.error(l);
    process.exit(1);
  }
  console.log(`✓ lint:chat-hints: every household-scope chat op has its Dutch hint (${ALLOW.size} still allowed, shrinking).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
