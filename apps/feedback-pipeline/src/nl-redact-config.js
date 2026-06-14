// NL redaction config — the Dutch-specific DATA the generic @canopy/redaction
// engine consumes. This is the locale content that USED to be hard-coded inside
// redact.js + names.js: the ordered structured rules, the placeholder strings,
// the first-name gazetteer and the honorific/relational/job-title prefixes.
//
// The engine (packages/redaction) carries NO NL content; it applies whatever
// rules/gazetteer this file declares. Shipping this object IS how feedback
// supplies its redaction policy as data (DESIGN §1.3 RedactConfig).
//
// Behaviour is intentionally IDENTICAL to the pre-extraction redact.js/names.js
// — every comment below preserves the reasoning that justified each pattern.

// ── placeholders ────────────────────────────────────────────────────
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

export const PLACEHOLDER_NAME = '[naam]';

// Dutch street-name suffixes. Street names are capitalised, so we keep the
// leading-capital requirement to avoid matching words like "onderweg 5 minuten"
// while still catching "Kerkstraat 12".
const STREET = 'straat|laan|weg|plein|gracht|kade|hof|dreef|steeg|dijk|pad|baan|singel|markt|hage|hout|berg|veld';

// ── structured rules (ordered) ──────────────────────────────────────
// ORDER MATTERS: url/email/iban consume their digit runs before the phone pass,
// so they can't be mis-read as phone numbers. The trailing BSN/phone rules carry
// validators (looked up by name in @canopy/redaction's registry).
export const STRUCTURED_RULES = [
  { type: 'url',      pattern: /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/gi },
  { type: 'email',    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  // OBFUSCATED email ("jan dot devries at gmail dot com") — caught BEFORE the
  // LLM so it can't reconstruct it into a working address (stress-test G1).
  { type: 'email',    pattern: /\b\w+(?:\s+(?:dot|\[dot\])\s+\w+)*\s+(?:at|\[at\]|@)\s+\w+(?:\s+(?:dot|\[dot\])\s+\w+)+\b/gi },
  // International phone (+49 171 2345678 …) — NL-only validator missed these.
  { type: 'phone',    pattern: /\+\d{1,3}[\s().-]{0,2}\d(?:[\d\s().-]{6,})\d/g },
  // IBAN: format only (NO checksum — preserves the SKU false-positive behaviour).
  { type: 'iban',     pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g },
  // Dutch postcode 1234 AB (uppercase letters required → avoids "2024 in").
  { type: 'postcode', pattern: /\b\d{4}[ ]?[A-Z]{2}\b/g },
  // numeric date (dd-mm-yyyy / yyyy-mm-dd) — DOB + appointment dates → [datum].
  { type: 'date',     pattern: /\b\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)\d{2}\b|\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g },
  // labelled case/dossier/student number ("dossiernummer is 84422190", …).
  { type: 'dossier',  pattern: /\b(?:dossiernummer|zaaknummer|klachtnummer|pati[eë]ntnummer|studentnummer|leerlingnummer|kenmerk|referentienummer|case\s*(?:number|no\.?|#)|reference\s*(?:number|no\.?|#)|student\s*(?:number|id|no\.?)|file\s*(?:number|no\.?))(?:\s*(?:is|:|nummer|number|=|#))?\s*\d{4,12}\b/gi },
  // Dutch licence plate (kenteken) — the main dash-separated sidecodes.
  { type: 'kenteken', pattern: /\b(?:[A-Z]{2}-\d{2}-\d{2}|\d{2}-\d{2}-[A-Z]{2}|\d{2}-[A-Z]{2}-\d{2}|[A-Z]{2}-\d{2}-[A-Z]{2}|[A-Z]{2}-[A-Z]{2}-\d{2}|\d{2}-[A-Z]{2}-[A-Z]{2}|\d{2}-[A-Z]{3}-\d|\d-[A-Z]{3}-\d{2}|[A-Z]-\d{3}-[A-Z]{2}|[A-Z]{3}-\d{2}-[A-Z])\b/g },
  // Capitalised street name ending in a known suffix, followed by a number.
  { type: 'address',  pattern: new RegExp(`\\b[A-ZÀ-Ý][a-zà-ÿ]*?(?:${STREET})\\s+\\d+[a-zA-Z]?\\b`, 'g') },

  // Labelled BSN ("mijn BSN is 184729356", "BSN eindigt op 7781") — redact the
  // number regardless of the 11-proef (a number the writer CALLS their BSN is
  // identifying even if they fat-fingered it). Keeps the word "BSN" for context.
  { type: 'bsn', captureGroup: 1,
    pattern: /\bBSN\b\s*(?:is|:|nummer|=|eindigt op|eindigend op)?\s*(\d[\d\s.\-]{2,11}\d)/gi },

  // Spaced/grouped BSN ("1234 56 789") — strip separators, validate 11-proef.
  { type: 'bsn', validate: 'bsn-11proef', normalize: 'strip-spaces',
    pattern: /\b\d[\d\s]{7,}\d\b/g },

  // Bare 9-digit BSN — redact deterministically (11-proef), don't leave to LLM.
  { type: 'bsn', validate: 'bsn-11proef',
    pattern: /\b\d{9}\b/g },

  // Phone candidate — validated by digit-count/prefix (a date/amount/id is left).
  { type: 'phone', validate: 'nl-phone',
    pattern: /\+?\d[\d\s().-]{7,}\d/g },
];

// ── name gazetteer ──────────────────────────────────────────────────
// A modest list of common Dutch + English first names. Deliberately includes
// ambiguous ones (Mark, Will, Roos, Storm, May, Grace, Hope, Floor, Beer, …) —
// removing them would cut false positives but is itself an arbitrary line.
export const NAMES = [
  // NL
  'jan', 'peter', 'lisa', 'sanne', 'sophie', 'daan', 'sem', 'bram', 'lotte',
  'anne', 'emma', 'julia', 'lieke', 'thomas', 'lars', 'ruben', 'bas', 'tim',
  'niels', 'sven', 'guus', 'roos', 'storm', 'lente', 'bloem', 'floor', 'fleur',
  'joost', 'maud', 'tess', 'jasper', 'wouter', 'sander', 'eva', 'noa', 'finn',
  'luuk', 'mees', 'teun', 'stijn', 'pieter', 'henk', 'kees', 'wil', 'beer',
  'linda', 'marco', 'karin', 'monique', 'ahmed',
  // ordinary residents/bystanders from the civic run (NOT 'patrick' — the
  // accused raadslid is a powerful individual the keep-policy surfaces).
  'annelies', 'riet', 'hennie', 'annie', 'anja', 'pieter', 'yusuf',
  // EN
  'john', 'sarah', 'mark', 'mary', 'james', 'will', 'bill', 'rose', 'may',
  'june', 'grace', 'hope', 'faith', 'joy', 'mike', 'dave', 'tom', 'jack',
  'lily', 'daisy', 'sunny', 'sue', 'pat', 'frank', 'brook', 'heath',
];

// Surname particles allowed inside a name ("Henk de Vries", "van der Berg").
export const PARTICLES = ['van', 'de', 'der', 'den', 'ten', 'ter'];

// TITLE prefixes — each a regex SOURCE that matches+captures the title group; the
// engine appends the capitalised name-tail and redacts only the name, keeping the
// title. No `i` flag is used by the engine (it would case-fold \p{Lu} and eat the
// following ordinary word), so case alternatives are spelled out explicitly.
//
//   honorific  — academic/social titles (meneer/dr/…). Fixes the zorg-B leak
//                where "mevrouw Linda Brouwer" + "dr. Vermeer" reached the summary.
//   jobtitle   — PRIVATE workplace/care roles only. Public/elected officials
//                (minister/wethouder/…) are EXCLUDED — the keep-policy surfaces
//                powerful public individuals by name for accountability.
//   neighbour  — neighbour titles are unambiguous → allowed bare.
//   relative   — family roles are homographs ("als vrouw voel ik me…") → require a
//                possessive to be safe.
export const TITLE_PATTERNS = [
  // honorific
  "(?:[Dd]e\\s+heer|[Dd]en\\s+heer|[Mm]eneer|[Mm]evrouw|[Mm]evr|[Mm]w|[Dd]hr|[Dd]r|[Dd]rs|[Ii]r|[Ii]ng|[Pp]rof|[Mm]r|[Mm]rs|[Mm]s|[Ss]ir)\\.?\\s+",
  // jobtitle (private roles)
  "(?:[Mm]anager|[Tt]eamleider|[Aa]fdelingshoofd|[Ll]eidinggevende|[Cc]hef|[Dd]okter|[Aa]rts|[Hh]uisarts|[Cc]hirurg|[Ss]pecialist|[Vv]erpleegkundige|[Dd]octor|[Nn]urse|[Ss]upervisor)\\s+",
  // neighbour
  "(?:[Bb]uurman|[Bb]uurvrouw|[Bb]uurjongen|[Bb]uurmeisje|[Bb]uurtgenoot|[Hh]uisgenoot|[Nn]eighbou?r)\\s+",
  // relative (possessive-gated)
  "(?:mijn|m'n|m’n|onze|m[ij]n|our|my)\\s+(?:vrouw|man|echtgenoot|echtgenote|partner|zoon|dochter|moeder|vader|broer|zus|zusje|broertje|collega|vriend|vriendin|schoonmoeder|schoonvader|oma|opa|tante|oom|wife|husband|son|daughter|mother|father|brother|sister|colleague|friend|neighbou?r)\\s+",
];

// The gazetteer block of the RedactConfig.
export const NL_GAZETTEER = {
  names: NAMES,
  placeholder: PLACEHOLDER_NAME,
  particles: PARTICLES,
  titlePatterns: TITLE_PATTERNS,
};

// ── assembled RedactConfig views ────────────────────────────────────
// Structured-only (the old redact()): regex rules, NO gazetteer.
export const NL_STRUCTURED_CONFIG = {
  rules: STRUCTURED_RULES,
  placeholders: PLACEHOLDER,
};

// Gazetteer-only (the old redactNames()): no structured rules, names pass only.
export const NL_NAMES_CONFIG = {
  rules: [],
  placeholders: PLACEHOLDER,
  gazetteer: NL_GAZETTEER,
};

// Full NL policy (structured + names) for callers that want both in one pass.
export const NL_REDACT_CONFIG = {
  rules: STRUCTURED_RULES,
  placeholders: PLACEHOLDER,
  gazetteer: NL_GAZETTEER,
};
