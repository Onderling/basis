/**
 * screenActing — who a connected screen acts AS, on a household bot (Fable, setup brief §7).
 *
 * A screen (the person's own app, connected to the bot) reaches the bot's ops as kernel skills (`renderA2A`), with a
 * capability token the bot minted for it. The token says "this screen may call this op"; it does not say "as whom".
 * On a person's own agent that is fine — the screen IS the owner. On a bot it is not: run as the host, a screen's call
 * would skip every rule the door applies to a person (the role map, the names ceiling, who may give chores, who may
 * cancel). So the bot answers a screen AS the person in the token's signed `actingAs`, through the door's own call —
 * the same gate as that person's typed line — and refuses a call with no person, or a person not in its book.
 */

import { renderA2A } from '@onderling/app-manifest';
import { MAX_ENVELOPE_BYTES } from '@onderling/core';
import { scopeCatalogueToRole } from './botOpMap.js';
import { synthesizeGenericOps } from '../genericOpSynth.js';

/** The bot's ops a screen never reaches, whatever token it holds: restoring an export, or pairing more screens. */
export const BOT_SCREEN_NEVER = Object.freeze([
  'assistant.assistant-import',   // restoring writes the whole household and opens a sealed file: never on a screen
  'assistant.assistant-screen',
  'assistant.assistant-screens',
  'assistant.assistant-screen-confirm',
  'assistant.assistant-screen-paste',
  'assistant.assistant-screen-approve',   // the yes to a screen's request is said in the private chat, never by a screen
  // who a person is (their Basis identity) is linked from their private chat, never by a screen
  'assistant.assistant-link',
  'assistant.assistant-link-confirm',
  'assistant.assistant-unlink',
  // …and emptying their thread with the bot: their act, in their own chat
  'assistant.assistant-forget',
  // …and the household in their own app: an invite to their key, asked for in the private chat
  'assistant.assistant-inapp',
  // the household's companion is handed over from the admin's own app (a device statement over the card), never a screen
  'assistant.assistant-companion',
  // the planned Sunday overview is sent by the host's runner, as the person whose row it is — not a button
  'assistant.sendWeekOverview',
  // …and what a change tells others is the host's own act, as the household — never a person's button
  'assistant.announceChange',
  // a greeting is a line typed in the chat, answered there — not a button
  'assistant.assistant-hello',
  // a reminder a person set is said by the host's runner, as them, at its moment — not a button
  'assistant.sayReminder',
  // "meer" pages the list a chat thread was shown (the keeper is per thread): a screen has no such thread, so it never
  // holds the op and its management screen paints no button that could only answer "that list is gone"
  'tools.moreThings',
]);

/**
 * Ops a screen HOLDS and may call, but the management screen paints NO button for: a toolbox's tool (`useTool`) is
 * called by a toolbox's own page (L1035) and by its word in the chat; a button with fields for a toolbox, a tool
 * and an input object means nothing to a person. Not the same as `BOT_SCREEN_NEVER` (not callable by a screen at all).
 */
export const SCREEN_NO_BUTTON = Object.freeze([
  'tools.useTool',
]);

/**
 * A screen's answer as it may travel: one relay envelope holds `MAX_ENVELOPE_BYTES` AFTER sealing (the JSON grows ~4/3 in
 * base64, plus the envelope around it), so an answer above ~70% of it is refused with a clear code, never cut: the page
 * asks for less (fewer things, details in smaller groups). Everything else passes unchanged.
 * @param {object} result
 * @returns {object}
 */
export function screenAnswerFits(result) {
  let bytes = 0;
  try { bytes = new TextEncoder().encode(JSON.stringify(result ?? null)).length; } catch { return result; }
  const limit = Math.floor(MAX_ENVELOPE_BYTES * 0.7);
  return bytes > limit ? { ok: false, code: 'answer-too-large', error: 'answer-too-large', bytes, limit } : result;
}

/**
 * The admin's own assistant ops a screen may have: the reads, the household's settings and an export. What admits
 * people, removes them or changes what they may do (the ops declaring `stepUp: 'private-door'`) is on the screen too,
 * and runs only after a yes in the admin's own chat (the door's call holds it); `/apps` stays in the chat.
 */
export const SCREEN_ADMIN_OPS = Object.freeze([
  'assistant.assistant-status',
  'assistant.assistant-users',
  'assistant.assistant-exports',
  'assistant.assistant-settings',
  'assistant.assistant-export',
  // the export key's set and unlock: ops that exist for a screen alone (each after the chat's yes)
  'assistant.assistant-export-key-set',
  'assistant.assistant-export-key-unlock',
]);

/**
 * The ops a person's screen is granted: their ROLE COLUMN as the door composes it (`scopeCatalogueToRole` over the
 * door's catalogue — the same ops their typed line reaches), as skill ids (`app.op`), without what a screen never gets
 * and of the admin's own assistant ops only `SCREEN_ADMIN_OPS`.
 * @param {object} catalogue  the door's merged catalogue
 * @param {string|null} role  the person's role on the bot
 * @param {'standard'|'flat'} [preset]  the bot's roles preset (`assistant.roles`)
 * @returns {string[]}
 */
export function screenColumnFor(catalogue, role, preset = 'standard') {
  // no role (not in the book, revoked): nothing — never a default column
  if (typeof role !== 'string' || !role) return [];
  const scoped = scopeCatalogueToRole(catalogue, role, preset);
  const out = [];
  for (const [, entry] of scoped?.opsById ?? []) {
    const id = `${entry?.appOrigin}.${entry?.op?.id}`;
    if (!entry?.appOrigin || !entry?.op?.id || out.includes(id)) continue;
    if (BOT_SCREEN_NEVER.includes(id)) continue;
    if (entry.appOrigin === 'assistant' && entry.op.visibility === 'trusted' && !SCREEN_ADMIN_OPS.includes(id) && entry.op.stepUp !== 'private-door') continue;
    out.push(id);
  }
  return out;
}

/**
 * The `ctxFor` for `renderA2A` on a bot: the verified call's token's `actingAs`, when that person is in the book AND the
 * token is ACTIVE on the grants lane for that same person — an allow-list: a token the lane never saw (signed with the
 * bot's key, but not granted), or one dropped by `/schermen los`, is refused here as well as by the revocation check.
 * @param {{list: () => Promise<Array<{id: string, hidden?: boolean}>>}} users  the bot's book (revoked rows are not listed)
 * @param {object} a
 * @param {(tokenId: string) => Promise<{viewPubKey: string, actingAs: string|null}|null>} a.activeEntry  the lane's answer
 * @returns {(handlerCtx: object) => Promise<{caller: string, threadId: string}|null>}
 */
export function screenActsAs(users, { activeEntry } = {}) {
  if (typeof activeEntry !== 'function') throw new TypeError('screenActsAs: the grants lane (activeEntry) is required');
  return async (hctx) => {
    const token = hctx?.envelope?.payload?._token ?? null;
    const actingAs = token?.constraints?.actingAs;
    if (typeof actingAs !== 'string' || !actingAs) return null;
    const entry = await activeEntry(token?.id);
    if (!entry || entry.actingAs !== actingAs || entry.viewPubKey !== token?.subject) return null;
    const row = ((await users.list()) ?? []).find((u) => u?.id === actingAs && !u.hidden);
    // marked as a screen's, with its key and name: an op that needs the private chat's yes is held, and the screen told
    return row ? { caller: actingAs, threadId: actingAs, via: 'screen', viewPubKey: entry.viewPubKey, screenLabel: entry.label ?? null } : null;
  };
}

/**
 * A bot exposes its door to connected screens: the door's ops as kernel skills (`renderA2A` over the door's call), each
 * acting as the person its token names (`screenActsAs`, the grants lane as allow-list), the withheld ones as `never`,
 * and only the ops on the bot's map (any role's) — an unmapped op is an unknown skill to a screen.
 * @param {object} a
 * @param {object} a.agent      the bot's agent (`exposeToPeers`, `surfaceTokenEntry`)
 * @param {object} a.catalogue  the door's catalogue as composed
 * @param {object[]} a.manifests the door's manifests
 * @param {Function} a.doorCall the door's call (`withAssistantOps` over the host gate)
 * @param {object} a.users      the bot's book
 * @returns {number} how many skills were exposed
 */
export function exposeDoorToScreens({ agent, catalogue, manifests, doorCall, users }) {
  const mapped = new Set([...screenColumnFor(catalogue, 'admin'), ...screenColumnFor(catalogue, 'member'), ...screenColumnFor(catalogue, 'observer'), ...BOT_SCREEN_NEVER]);
  // the generic ops a noun's declaration brings ("declare a noun → get CRUD free") are ops of the manifest too: the same
  // synthesis the catalogue merges, so a screen reaches a mapped generic op (household's notes) like any other
  const withGeneric = manifests.map((m) => ({ ...m, operations: [...(m.operations ?? []), ...synthesizeGenericOps(m)] }));
  // every answer to a screen fits one envelope, or is refused in a clear code (never cut, never a silent timeout)
  const screenCall = async (...a) => screenAnswerFits(await doorCall(...a));
  const defs = renderA2A(withGeneric, { callSkill: screenCall }, {
    ctxFor: screenActsAs(users, { activeEntry: (id) => agent.surfaceTokenEntry(id) }), never: BOT_SCREEN_NEVER,
  }).filter((d) => mapped.has(d.id));
  return agent.exposeToPeers(defs);
}
