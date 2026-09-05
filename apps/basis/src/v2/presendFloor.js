/**
 * presendFloor — redact on THIS device before a turn leaves it, for a contact that asks for it.
 *
 * The floor is a property of the CONTACT, declared on its card (`x-onderling.redact`) and carried on
 * the peer record as `redact`. Basis honours it with @onderling/redaction: either the platform default
 * ruleset (the card says `'pre-send'`) or the ruleset the card ships as data (`{ mode:'pre-send',
 * rules, placeholders }` — the engine is locale-agnostic, every pattern is data). Nothing here knows
 * which bot is on the other side. A bot that runs its own floor after receipt (Telegram, a hosted
 * service) simply does not declare it; the participant's echo then shows what actually left.
 *
 * Pure. Web and mobile share it through the contact-thread channel.
 */
import { redact } from '@onderling/redaction';

/**
 * The platform default: structured identifiers a person types without thinking — a citizen number
 * (with the 11-proef so an order number survives), an IBAN, a Dutch mobile number, an e-mail address.
 * Names are NOT here: a gazetteer is locale content a contact ships itself.
 */
export const PRESEND_DEFAULT_CONFIG = Object.freeze({
  rules: [
    { type: 'iban',  pattern: '\\b[A-Z]{2}\\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\\b', validate: 'iban', normalize: 'strip-spaces' },
    { type: 'bsn',   pattern: '\\b\\d{9}\\b', validate: 'bsn-11proef' },
    { type: 'phone', pattern: '(?:\\+31|0031|\\b0)6[ -]?\\d{4}[ -]?\\d{4}\\b', validate: 'nl-phone' },
    { type: 'email', pattern: '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b' },
  ],
  placeholders: { iban: '[iban]', bsn: '[id]', phone: '[phone]', email: '[email]' },
});

/**
 * The floor a contact record declares, or null.
 * @param {object|null} peer  a PeerGraph record or a roster row carrying `redact`
 * @returns {{rules:Array, placeholders?:object}|null}
 */
export function presendFloorFor(peer) {
  const r = peer?.redact ?? null;
  if (r === 'pre-send') return PRESEND_DEFAULT_CONFIG;
  if (r && typeof r === 'object' && r.mode === 'pre-send') {
    if (Array.isArray(r.rules) && r.rules.length) {
      return { rules: r.rules, placeholders: r.placeholders ?? {}, ...(r.gazetteer ? { gazetteer: r.gazetteer } : {}) };
    }
    return PRESEND_DEFAULT_CONFIG;
  }
  return null;
}

/**
 * Apply a floor to one text.
 * @returns {{ text: string, hits: Array<{type:string, value:string}> }}
 */
export function applyPresendFloor(text, config) {
  if (!config) return { text: String(text ?? ''), hits: [] };
  const r = redact(String(text ?? ''), config);
  return { text: r.text, hits: Array.isArray(r.hits) ? r.hits : [] };
}
