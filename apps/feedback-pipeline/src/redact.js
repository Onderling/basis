// Step 1 of the local filter pipeline — deterministic redaction.
//
// Strips STRUCTURED identifiers (phone, email, IBAN, postcode, URL,
// street+number) with plain regex. These are exactly the things the
// local LLMs leak inconsistently (see ../docs/FINDINGS.md), so we do
// NOT trust a model with them — a regex is 100% reliable, instant and
// free. Names and profanity are fuzzy and language-dependent, so they
// are deliberately left to the LLM (step 2, ./prompts.js).
//
// This split is the architectural guarantee the product leans on
// ("drempel ingebouwd" / "het kan architectonisch niet anders" —
// Project Files/Aanpak/commerciele_verkenning.md, pipeline step 3).
//
// Pure, synchronous, dependency-free, language-agnostic. Returns the
// redacted text plus a list of hits (type + original value) so the
// caller can audit what was removed without re-deriving it.

export const PLACEHOLDER = {
  email:    '[e-mailadres]',
  url:      '[link]',
  iban:     '[rekeningnummer]',
  phone:    '[telefoonnummer]',
  postcode: '[postcode]',
  address:  '[adres]',
  bsn:      '[bsn]',
  date:     '[datum]',
  dossier:  '[dossiernummer]',
  kenteken: '[kenteken]',
};

// BSN (Dutch burgerservicenummer) — a personal national ID, so it's redacted
// regardless of the "keep organisation names" policy. 9 digits validated by
// the 11-proef checksum, which filters out ~10/11 random 9-digit numbers and
// keeps the false-positive rate low (an order/customer number that happens to
// pass the checksum is a rare residual FP — see test/redact.test.js).
function isValidBsn(s) {
  if (!/^\d{9}$/.test(s)) return false;
  const w = [9, 8, 7, 6, 5, 4, 3, 2, -1];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(s[i]) * w[i];
  return sum % 11 === 0;
}

// Dutch street-name suffixes. Street names are capitalised, so we keep
// the leading-capital requirement to avoid matching words like
// "onderweg 5 minuten" while still catching "Kerkstraat 12".
const STREET = 'straat|laan|weg|plein|gracht|kade|hof|dreef|steeg|dijk|pad|baan|singel|markt|hage|hout|berg|veld';

// Simple single-pass replacements. ORDER MATTERS: url/email/iban consume
// their digit runs before the phone pass, so they can't be mis-read as
// phone numbers.
const RULES = [
  { type: 'url',      re: /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/gi },
  { type: 'email',    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  // OBFUSCATED email ("jan dot devries at gmail dot com") — caught BEFORE the
  // LLM so it can't reconstruct it into a working address (stress-test G1).
  // Structure: word (dot word)* at word (dot word)+ — tight, so it doesn't
  // swallow preceding words.
  { type: 'email',    re: /\b\w+(?:\s+(?:dot|\[dot\])\s+\w+)*\s+(?:at|\[at\]|@)\s+\w+(?:\s+(?:dot|\[dot\])\s+\w+)+\b/gi },
  // International phone (+49 171 2345678 …) — NL-only validator missed these.
  { type: 'phone',    re: /\+\d{1,3}[\s().-]{0,2}\d(?:[\d\s().-]{6,})\d/g },
  // IBAN: 2 letters + 2 check digits + 11-30 BBAN chars, spaces allowed in
  // any grouping (incl. a short trailing group like the "89" in
  // "NL12 RABO 0123 4567 89").
  { type: 'iban',     re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g },
  // Dutch postcode 1234 AB (uppercase letters required → avoids "2024 in").
  { type: 'postcode', re: /\b\d{4}[ ]?[A-Z]{2}\b/g },
  // numeric date (dd-mm-yyyy / yyyy-mm-dd) — DOB + appointment dates → [datum].
  { type: 'date', re: /\b\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)\d{2}\b|\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g },
  // labelled case/dossier/student number ("dossiernummer is 84422190", "student number 1234567",
  // "case no. 84422"). The keyword prefix keeps the false-positive rate low. (M4 scenario floors.)
  { type: 'dossier', re: /\b(?:dossiernummer|zaaknummer|klachtnummer|pati[eë]ntnummer|studentnummer|leerlingnummer|kenmerk|referentienummer|case\s*(?:number|no\.?|#)|reference\s*(?:number|no\.?|#)|student\s*(?:number|id|no\.?)|file\s*(?:number|no\.?))(?:\s*(?:is|:|nummer|number|=|#))?\s*\d{4,12}\b/gi },
  // Dutch licence plate (kenteken) — the main dash-separated sidecodes. Uppercase + the specific
  // letter/digit arrangements keep the false-positive rate low; the `date` rule above already consumed
  // dd-mm-yyyy so a plate like 12-34-AB (no 4-digit tail) can't be mis-read as a date.
  { type: 'kenteken', re: /\b(?:[A-Z]{2}-\d{2}-\d{2}|\d{2}-\d{2}-[A-Z]{2}|\d{2}-[A-Z]{2}-\d{2}|[A-Z]{2}-\d{2}-[A-Z]{2}|[A-Z]{2}-[A-Z]{2}-\d{2}|\d{2}-[A-Z]{2}-[A-Z]{2}|\d{2}-[A-Z]{3}-\d|\d-[A-Z]{3}-\d{2}|[A-Z]-\d{3}-[A-Z]{2}|[A-Z]{3}-\d{2}-[A-Z])\b/g },
  // Capitalised street name ending in a known suffix, followed by a number.
  { type: 'address',  re: new RegExp(`\\b[A-ZÀ-Ý][a-zà-ÿ]*?(?:${STREET})\\s+\\d+[a-zA-Z]?\\b`, 'g') },
];

// Phone needs validation (digit count), so it gets its own pass.
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{7,}\d/g;

function isDutchPhone(digits) {
  return (digits.length === 10 && digits.startsWith('0'))      // 06xxxxxxxx / 0xx-xxxxxxx
      || (digits.length === 11 && digits.startsWith('31'))     // 31 6xxxxxxxx
      || (digits.length === 12 && digits.startsWith('310'));   // +31 0... (typo-tolerant)
}

/**
 * Redact structured identifiers from a single message.
 * @param {string} text
 * @returns {{ text: string, hits: Array<{type:string, value:string}> }}
 */
export function redact(text) {
  const hits = [];
  let out = text;

  for (const { type, re } of RULES) {
    out = out.replace(re, (m) => {
      hits.push({ type, value: m });
      return PLACEHOLDER[type];
    });
  }

  // Labelled BSN ("mijn BSN is 184729356", "BSN eindigt op 7781") — redact the
  // number regardless of the 11-proef (a number the writer CALLS their BSN is
  // identifying even if they fat-fingered it). Keeps the word "BSN" for context.
  out = out.replace(/\bBSN\b\s*(?:is|:|nummer|=|eindigt op|eindigend op)?\s*(\d[\d\s.\-]{2,11}\d)/gi, (m, num) => {
    hits.push({ type: 'bsn', value: num.trim() });
    return m.replace(num, PLACEHOLDER.bsn);
  });

  // Spaced/grouped BSN ("1234 56 789") — strip separators, validate 11-proef.
  out = out.replace(/\b\d[\d\s]{7,}\d\b/g, (m) => {
    const digits = m.replace(/\s/g, '');
    if (digits.length !== 9 || !isValidBsn(digits)) return m;
    hits.push({ type: 'bsn', value: m.trim() });
    return PLACEHOLDER.bsn;
  });

  // BSN before phone: a 9-digit BSN isn't a valid NL phone, but redact it
  // deterministically (with checksum) rather than leave it to the LLM.
  out = out.replace(/\b\d{9}\b/g, (m) => {
    if (!isValidBsn(m)) return m;              // fails 11-proef — not a BSN
    hits.push({ type: 'bsn', value: m });
    return PLACEHOLDER.bsn;
  });

  out = out.replace(PHONE_CANDIDATE, (m) => {
    const digits = m.replace(/\D/g, '');
    if (!isDutchPhone(digits)) return m;       // a date / amount / id — leave it
    hits.push({ type: 'phone', value: m.trim() });
    return PLACEHOLDER.phone;
  });

  return { text: out, hits };
}

/** Convenience: just the redacted text. */
export function redactText(text) {
  return redact(text).text;
}
