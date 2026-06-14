// Named-validator registry for the redaction engine.
//
// A rule may carry `validate: '<name>'`; the engine looks the name up here and
// only redacts a candidate match when the validator returns true. Validators are
// PURE predicates over the candidate string (the engine strips no separators —
// each validator decides what normalisation it needs). Keep them locale-agnostic
// *as code*: a validator encodes a checksum/format, not a country's policy. The
// caller selects which validators apply by referencing them from its rules.

/**
 * Dutch BSN (burgerservicenummer) 11-proef checksum over exactly 9 digits.
 * Separators are NOT stripped here — pass the bare digit run (the rule's pattern
 * decides what reaches the validator). ~10/11 of random 9-digit numbers fail.
 * @param {string} s
 * @returns {boolean}
 */
export function bsn11proef(s) {
  if (!/^\d{9}$/.test(s)) return false;
  const w = [9, 8, 7, 6, 5, 4, 3, 2, -1];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(s[i]) * w[i];
  return sum % 11 === 0;
}

/**
 * Dutch phone number, validated by digit-count + prefix after stripping all
 * non-digits from the candidate. Accepts 06xxxxxxxx / 0xx-xxxxxxx, 31 6xxxxxxxx,
 * and the typo-tolerant +31 0… form.
 * @param {string} s  raw candidate (may contain spaces / () . -)
 * @returns {boolean}
 */
export function nlPhone(s) {
  const digits = s.replace(/\D/g, '');
  return (digits.length === 10 && digits.startsWith('0'))      // 06xxxxxxxx / 0xx-xxxxxxx
      || (digits.length === 11 && digits.startsWith('31'))     // 31 6xxxxxxxx
      || (digits.length === 12 && digits.startsWith('310'));   // +31 0... (typo-tolerant)
}

/**
 * Luhn (mod-10) checksum — the check used by payment-card numbers and many other
 * identifier schemes. Strips non-digits before validating.
 * @param {string} s
 * @returns {boolean}
 */
export function luhn(s) {
  const digits = s.replace(/\D/g, '');
  if (digits.length < 2) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/**
 * IBAN check-digit validation (ISO 7064 mod-97-10). Strips spaces, requires the
 * 2-letter country + 2 check-digit head, moves the first 4 chars to the end,
 * converts letters to numbers (A=10 … Z=35) and checks mod 97 === 1.
 * @param {string} s
 * @returns {boolean}
 */
export function iban(s) {
  const c = s.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(c)) return false;
  const rearranged = c.slice(4) + c.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= 'A' && ch <= 'Z' ? (ch.charCodeAt(0) - 55).toString() : ch;
    for (const digit of code) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

// The registry. A rule's `validate` field names one of these keys.
export const VALIDATORS = {
  'bsn-11proef': bsn11proef,
  'nl-phone': nlPhone,
  iban,
  luhn,
};
