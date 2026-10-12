/**
 * WHICH PERSONA A CONTACT SEES YOU AS — the lens, not a second you.
 *
 * Today ONE identity runs. Every `deriveAgentSeed(` in the running agent says `'default'`, the join records
 * its membership under `'default'` whatever persona was chosen, and a contact's pair circle is always
 * `pairCircleIdFor(default.webid, other)`. A persona is a named DISCLOSURE LENS over that one identity: which
 * name, face and properties a given circle or contact receives. Same key, same address, same pair id — only
 * the release differs.
 *
 * ON THE WIRE (2026-10-12, persona step d1): a contact filed under a persona this device runs now talks to THAT
 * persona — its turns are authored by and sent as the persona, the pair circle is the persona's with them
 * (`pairCircleIdFor(persona.webid, other)`, founded AS it), and nothing of the default rides along (no default card,
 * seal, linked-bot statement or own-device fan). What is NOT yet per persona: the card and the identity-link offer a
 * contact first learns you from (step d2). Until that lands, keep saying *"dit contact ziet je als …"* on every
 * surface — the promise *"dit contact kent een andere jij"* flips in the PR that makes the card the persona's too.
 *
 * The persona lives on the CONTACT ROW because the founding needs it before the pair circle exists; once the
 * circle exists, the release on its roster is the derived truth. One input, one projection — not two facts.
 * When L123 lands, the truth moves to the profile's `circleMemberships` and this field becomes a pointer to
 * it, which is why it is named for what it will still mean then: the profile this contact was made through.
 */
import { pairCircleIdFor } from './pairCircleId.js';

/** The profile every contact made before personas had a surface was made through. */
export const DEFAULT_PERSONA = 'default';

/**
 * The persona a contact row records — or `null` when it records none.
 *
 * Deliberately NOT defaulting. A missing value means "this row predates the field", which is a different
 * thing from "this contact sees the default persona", and only the backfill below may turn one into the
 * other — after checking. A read path that quietly supplies `default` is how the persona picker stayed
 * broken for weeks: `mijLoader` synthesised the row that was missing, so the hole was filled before anyone
 * could see it.
 */
export function personaOfContact(row) {
  const p = row?.persona;
  return (typeof p === 'string' && p.trim()) ? p.trim() : null;
}

/**
 * Write `default` onto the contact rows that predate this field — ONCE, EXPLICITLY, and only where it can be
 * PROVEN.
 *
 * The proof is the pair circle id. A contact made before this shipped holds the default identity's card, so
 * its pair circle is `pairCircleIdFor(default.webid, them)` — recomputable here. Where that matches, `default`
 * is a fact about the row and writing it records something true. Where it does not, the premise is false for
 * that row: it is reported and left alone, because writing `default` onto it would record something untrue.
 *
 * A row with no pair circle yet (card-only, never written to) is skipped: it has no fact to check against,
 * and it will get its persona from the add flow when it is first used.
 *
 * The rows are the contact BOOK's rows as stored (`listContacts` → `contacts`), keyed by `webid` — the key the
 * persona is written under. Not the Contacten projection (`contactId`, no `persona`): that view cannot tell a
 * row that predates the field from one that has it.
 *
 * @param {object} a
 * @param {Array<object>} a.rows            contact book rows (`{ webid, pairCircleId?, persona? }`)
 * @param {string} a.selfWebid              this device's default chat webid
 * @param {(webid: string, persona: string) => Promise<*>} a.setPersona
 * @returns {Promise<{written: number, skipped: number, mismatched: number, mismatches: string[]}>}
 */
export async function backfillContactPersonas({ rows = [], selfWebid, setPersona } = {}) {
  const out = { written: 0, skipped: 0, mismatched: 0, mismatches: [] };
  if (!Array.isArray(rows) || typeof selfWebid !== 'string' || !selfWebid || typeof setPersona !== 'function') {
    return out;
  }
  for (const row of rows) {
    const webid = typeof row?.webid === 'string' && row.webid ? row.webid : null;
    if (!webid) { out.skipped += 1; continue; }
    if (personaOfContact(row)) { out.skipped += 1; continue; }          // already recorded — nothing to do
    const pairId = typeof row?.pairCircleId === 'string' ? row.pairCircleId : '';
    if (!pairId) { out.skipped += 1; continue; }                        // no pair circle yet: no fact to check
    let expected = null;
    try { expected = pairCircleIdFor(selfWebid, webid); } catch { expected = null; }
    if (!expected || expected !== pairId) {
      // Not the default identity's pair circle. Do not guess what it is.
      out.mismatched += 1;
      out.mismatches.push(webid);
      continue;
    }
    try { await setPersona(webid, DEFAULT_PERSONA); out.written += 1; }
    catch { out.mismatched += 1; out.mismatches.push(webid); }
  }
  return out;
}
