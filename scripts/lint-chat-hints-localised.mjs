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
  'tasks:addTask', 'tasks:claimTask', 'tasks:confirmClaim', 'tasks:completeTask', 'tasks:removeTask', 'tasks:attachTaskGrant',
  'tasks:reassignTask', 'tasks:submitTask', 'tasks:approveTask', 'tasks:rejectTask', 'tasks:revokeTask', 'tasks:listOpen',
  'tasks:listMine', 'tasks:listClaimable', 'tasks:listClaimConflicts', 'tasks:resolveClaim', 'tasks:listAwaitingApproval',
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

async function main() {
  const { catalogueManifests, DOOR_MANIFESTS } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/v2/manifestSources.js')).href);
  const nl = JSON.parse(readFileSync(path.join(ROOT, 'apps/basis/src/locales/chat-hints.nl.json'), 'utf8'));
  const { missing, badShape, stale } = auditHints([...catalogueManifests(), ...DOOR_MANIFESTS], nl);
  if (missing.length || badShape.length || stale.length) {
    if (missing.length) console.error(`✖ lint:chat-hints — no Dutch hint (chat-hints.nl.json <app>.<opId>) for:\n  ${missing.join('\n  ')}`);
    if (badShape.length) console.error(`✖ lint:chat-hints — not {text, doc}:\n  ${badShape.join('\n  ')}`);
    if (stale.length) console.error(`✖ lint:chat-hints — translated, so take it off ALLOW:\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`✓ lint:chat-hints: every household-scope chat op has its Dutch hint (${ALLOW.size} still allowed, shrinking).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
