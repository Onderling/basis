/**
 * The profile key an offering is kept under: its text (or, without one, its tags), folded and capped — so the same
 * offering written twice lands on one key.
 * @param {{text?: string, tags?: string}} o
 * @returns {string}
 */
export function offeringKeyFor({ text, tags }) {
  return (text || tags).trim().toLowerCase().slice(0, 40);
}
