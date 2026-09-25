/**
 * WHICH PERSONA A CONTACT SEES YOU AS — the lens, not a second you.
 *
 * Today ONE identity runs. Every `deriveAgentSeed(` in the running agent says `'default'`, the join records
 * its membership under `'default'` whatever persona was chosen, and a contact's pair circle is always
 * `pairCircleIdFor(default.webid, other)`. A persona is a named DISCLOSURE LENS over that one identity: which
 * name, face and properties a given circle or contact receives. Same key, same address, same pair id — only
 * the release differs.
 *
 * Say it that way on every surface: *"dit contact ziet je als …"*, never *"dit contact kent een andere jij"*.
 * A persona as a separate person on the wire is designed and NOT built — that is ledger L123, after the
 * runtime arc, and it is key-sensitive work with its own sitting. Promising it in the UI before it exists
 * would be a privacy claim the code does not keep.
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
 * @param {object} a
 * @param {Array<object>} a.rows            contact rows
 * @param {string} a.selfWebid              this device's default chat webid
 * @param {(contactId: string, persona: string) => Promise<*>} a.setPersona
 * @returns {Promise<{written: number, skipped: number, mismatched: number, mismatches: string[]}>}
 */
export async function backfillContactPersonas({ rows = [], selfWebid, setPersona } = {}) {
  const out = { written: 0, skipped: 0, mismatched: 0, mismatches: [] };
  if (!Array.isArray(rows) || typeof selfWebid !== 'string' || !selfWebid || typeof setPersona !== 'function') {
    return out;
  }
  for (const row of rows) {
    const contactId = typeof row?.contactId === 'string' ? row.contactId : null;
    if (!contactId) { out.skipped += 1; continue; }
    if (personaOfContact(row)) { out.skipped += 1; continue; }          // already recorded — nothing to do
    const pairId = typeof row?.pairCircleId === 'string' ? row.pairCircleId : '';
    if (!pairId) { out.skipped += 1; continue; }                        // no pair circle yet: no fact to check
    let expected = null;
    try { expected = pairCircleIdFor(selfWebid, contactId); } catch { expected = null; }
    if (!expected || expected !== pairId) {
      // Not the default identity's pair circle. Do not guess what it is.
      out.mismatched += 1;
      out.mismatches.push(contactId);
      continue;
    }
    try { await setPersona(contactId, DEFAULT_PERSONA); out.written += 1; }
    catch { out.mismatched += 1; out.mismatches.push(contactId); }
  }
  return out;
}
