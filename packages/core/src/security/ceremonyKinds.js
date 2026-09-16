/**
 * The CEREMONY kinds — membership statements only the owner root may make, and the root exists only inside a
 * ceremony (the typed phrase), never on a device. They bind by a ROOT REVEAL against the row's ceremony
 * commitment (identity/ceremonyCommitment.js), not by the author's per-circle key: a stolen device, enrolled
 * or not, holds nothing that can make one.
 *
 * Every verifier that asks "is this a ceremony kind, and what must its reveal cover?" asks HERE, so a kind
 * added to the set is a ceremony kind at every door at once — the rail's verifier and the roster's author
 * resolver both read this module.
 */
import { personKeyFacts, PERSON_KEY_KIND } from './personKeyFold.js';

export const ADDRESS_REVOKE_KIND = 'address-revoke';

/** The kinds whose statements bind by root reveal. */
export const CEREMONY_KINDS = Object.freeze(new Set([ADDRESS_REVOKE_KIND, PERSON_KEY_KIND]));

export const isCeremonyKind = (kind) => CEREMONY_KINDS.has(kind);

/**
 * The extra binding material a kind's reveal must cover, beyond (circle, kind, subject, author). `null` where
 * the subject IS the whole fact. A verifier hands this to `verifyCeremonyReveal` as `facts`; the ceremony
 * that mints the statement hands the same to `signCeremonyReveal`.
 * @param {{ kind?: string, payload?: object }} body
 * @returns {string|null}
 */
export function ceremonyRevealFacts(body) {
  if (body?.kind === PERSON_KEY_KIND) return personKeyFacts(body.payload);
  return null;
}
