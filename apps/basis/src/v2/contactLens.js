/**
 * WHAT A CONTACT SEES OF YOU — chosen when you add them, changeable on their thread (L125, Frits 2026-09-24: "both").
 *
 * Every add path recorded the default persona and none let a person choose. The paths a person is PRESENT for —
 * a scan, a link, the add box — now ask first, with the default persona and your usual level prefilled; the thread
 * header can change either later. A card arriving with a message still records the default: nobody is there to ask.
 * This module is the whole of the logic; the shells paint a sheet and a control over it.
 *
 * The lens, not a second you (see `contactPersona.js`): the contact talks to the same identity whatever is picked —
 * a persona as its own person on the wire is ledger L123. What the choice changes is the RELEASE on the pair circle:
 * the LEVEL sets the persona's disclosure for that circle's context, the PERSONA picks whose release the pair roster
 * says there. Say it that way on every surface: "dit contact ziet je als …".
 *
 * The pair circle's id is computable before the circle exists (`pairCircleIdFor`), so the level can be set at add
 * time for a circle that is founded only at the first exchange — and the founding then says a release that
 * already honours it.
 */
import { decodeContactCard } from './contactCardLink.js';
import { pairCircleIdFor } from './pairCircleId.js';
import { DEFAULT_PERSONA, personaOfContact } from './contactPersona.js';
import { personaPresetKeys } from './memberCards.js';
import {
  loadPersonas, loadPersonalRevealDefault, applyJoinRevealState, REVEAL_PRESETS,
} from '../core/wizards/joinGroupState.js';

/**
 * The pair circle's id for a contact. The shell hands in the pair roster's own `pairCircleIdFor` — the one that
 * founds the circle, so the two can never disagree about which circle "theirs" is; `whoAmI` is only the fallback.
 */
async function pairIdFor(contactWebid, { pairCircleIdOf = null, callSkill } = {}) {
  if (typeof contactWebid !== 'string' || !contactWebid) return null;
  if (typeof pairCircleIdOf === 'function') { try { return pairCircleIdOf(contactWebid) ?? null; } catch { return null; } }
  let me = null;
  try { me = (await callSkill('stoop', 'whoAmI', {}))?.webid ?? null; } catch { me = null; }
  if (typeof me !== 'string' || !me || me === contactWebid) return null;
  try { return pairCircleIdFor(me, contactWebid); } catch { return null; }
}

/**
 * The level a persona's disclosure for one context amounts to: the highest preset whose keys (and every lower
 * tier's) are all enabled. Nothing enabled is the floor, `handle` — the level a pseudonym is always at. A tier with
 * no persona keys of its own (`full` today) cannot be told from the one below it, so the read stops there: that is
 * why the contact row RECORDS the chosen level, and this is only the fallback for a row that records none.
 * @param {Record<string, {enabled?: boolean}>} ctx  `disclosure.perContext[contextId]`
 */
export function presetFromDisclosure(ctx) {
  const on = (k) => ctx?.[k]?.enabled === true;
  let level = REVEAL_PRESETS[0];
  for (let i = 0; i < REVEAL_PRESETS.length; i += 1) {
    const keys = personaPresetKeys(REVEAL_PRESETS[i]);
    if (!keys.length || !keys.every(on)) break;
    level = REVEAL_PRESETS[i];
  }
  return level;
}

/**
 * What the add sheet shows: who the card names, the personas to choose from, and the two prefills — the default
 * persona and your usual level. `null` when the payload is not a contact card (the shell adds nothing).
 * @returns {Promise<null|{payload: string, webid: string, name: string, personas: Array<{id,name}>, persona: string, revealPreset: string, presets: string[]}>}
 */
export async function contactAddSheetModel({ payload, callSkill } = {}) {
  const card = decodeContactCard(payload);
  if (!card) return null;
  const [personas, revealPreset] = await Promise.all([
    loadPersonas({ callSkill }).catch(() => []),
    loadPersonalRevealDefault({ callSkill }),
  ]);
  return {
    payload,
    webid: card.webid,
    name: card.displayName || card.handle || card.webid,
    personas,
    persona: DEFAULT_PERSONA,
    revealPreset,
    presets: [...REVEAL_PRESETS],
  };
}

/**
 * Add the contact AS the chosen persona, at the chosen level. The level is set for the pair circle's context
 * FIRST, so whatever founds that circle later says a release that already honours it; then the row is written
 * with the persona. A level that fails to set does not stop the add — the default disclosure is strict.
 */
export async function addContactAs({ callSkill, payload, persona = DEFAULT_PERSONA, revealPreset = null, pairCircleIdOf = null } = {}) {
  const card = decodeContactCard(payload);
  const chosen = typeof persona === 'string' && persona ? persona : DEFAULT_PERSONA;
  const pairId = card ? await pairIdFor(card.webid, { pairCircleIdOf, callSkill }) : null;
  if (pairId && revealPreset) {
    await applyJoinRevealState({ state: { persona: chosen, revealPreset }, callSkill, contextId: pairId }).catch(() => {});
  }
  return callSkill('stoop', 'addContactFromQr', { payload, persona: chosen, ...(revealPreset ? { revealPreset } : {}) });
}

/**
 * What the thread header shows: the persona the row records (a row that records none shows the default — the
 * value the backfill writes where it can prove it) and the level that persona's disclosure for the pair circle
 * amounts to.
 */
export async function contactLensModel({ callSkill, row, pairCircleIdOf = null } = {}) {
  const webid = row?.webid ?? row?.contactId ?? null;
  const persona = personaOfContact(row) ?? DEFAULT_PERSONA;
  const personas = await loadPersonas({ callSkill }).catch(() => []);
  const pairId = await pairIdFor(webid, { pairCircleIdOf, callSkill });
  let revealPreset = REVEAL_PRESETS.includes(row?.revealPreset) ? row.revealPreset : null;
  if (!revealPreset && pairId) {
    try {
      const view = await callSkill('agents', 'getPersonaView', { id: persona });
      revealPreset = presetFromDisclosure(view?.disclosure?.perContext?.[pairId] ?? {});
    } catch { revealPreset = null; }
  }
  if (!revealPreset) revealPreset = await loadPersonalRevealDefault({ callSkill });
  return { webid, persona, personas, revealPreset, presets: [...REVEAL_PRESETS] };
}

/**
 * Change what a contact sees: record the persona on the row (it travels to the person's other devices), set the
 * level for the pair circle, and — when the pair circle exists — say the new persona's release there. A release
 * replaces the previous one whole (`member-props` clears what the new release does not say), so a narrower persona
 * narrows what the roster shows. What the contact already saw, they saw.
 * @param {object} a
 * @param {boolean} [a.pairCircleExists]  whether this device holds the pair circle; asked of `listMyCircles` when not said
 * @param {(circleId: string, personaId: string) => Promise<*>} [a.shareRelease]
 */
export async function changeContactLens({
  callSkill, contactId, persona, revealPreset = null, shareRelease = null, pairCircleExists = undefined, pairCircleIdOf = null,
} = {}) {
  const chosen = typeof persona === 'string' && persona ? persona : DEFAULT_PERSONA;
  const row = await callSkill('stoop', 'setContactPersona', { webid: contactId, persona: chosen, ...(revealPreset ? { revealPreset } : {}) });
  if (row?.error) return { error: row.error, releaseShared: false };
  const pairId = await pairIdFor(contactId, { pairCircleIdOf, callSkill });
  if (pairId && revealPreset) {
    await applyJoinRevealState({ state: { persona: chosen, revealPreset }, callSkill, contextId: pairId }).catch(() => {});
  }
  let exists = pairCircleExists;
  if (exists === undefined && pairId) {
    try {
      const r = await callSkill('stoop', 'listMyCircles', {});
      exists = (Array.isArray(r?.circles) ? r.circles : []).some((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id)) === pairId);
    } catch { exists = false; }
  }
  let releaseShared = false;
  if (pairId && exists && typeof shareRelease === 'function') {
    try { await shareRelease(pairId, chosen); releaseShared = true; } catch { releaseShared = false; }
  }
  return { contact: row?.contact ?? null, releaseShared };
}
