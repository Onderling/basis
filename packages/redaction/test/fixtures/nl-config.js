// A self-contained NL-equivalent RedactConfig for the engine tests. Mirrors the
// real feedback NL config (apps/feedback-pipeline/src/nl-redact-config.js) so the
// package suite exercises the engine on realistic data WITHOUT importing the app
// (the package must stay independent / locale-agnostic).

export const PLACEHOLDER = {
  email: '[e-mailadres]', url: '[link]', iban: '[rekeningnummer]',
  phone: '[telefoonnummer]', postcode: '[postcode]', address: '[adres]',
  bsn: '[bsn]', date: '[datum]', dossier: '[dossiernummer]', kenteken: '[kenteken]',
};

const STREET = 'straat|laan|weg|plein|gracht|kade|hof|dreef|steeg|dijk|pad|baan|singel|markt|hage|hout|berg|veld';

export const RULES = [
  { type: 'url',      pattern: /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/gi },
  { type: 'email',    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: 'email',    pattern: /\b\w+(?:\s+(?:dot|\[dot\])\s+\w+)*\s+(?:at|\[at\]|@)\s+\w+(?:\s+(?:dot|\[dot\])\s+\w+)+\b/gi },
  { type: 'phone',    pattern: /\+\d{1,3}[\s().-]{0,2}\d(?:[\d\s().-]{6,})\d/g },
  { type: 'iban',     pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g },
  { type: 'postcode', pattern: /\b\d{4}[ ]?[A-Z]{2}\b/g },
  { type: 'date',     pattern: /\b\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)\d{2}\b|\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g },
  { type: 'dossier',  pattern: /\b(?:dossiernummer|zaaknummer|klachtnummer|pati[eë]ntnummer|studentnummer|leerlingnummer|kenmerk|referentienummer|case\s*(?:number|no\.?|#)|reference\s*(?:number|no\.?|#)|student\s*(?:number|id|no\.?)|file\s*(?:number|no\.?))(?:\s*(?:is|:|nummer|number|=|#))?\s*\d{4,12}\b/gi },
  { type: 'kenteken', pattern: /\b(?:[A-Z]{2}-\d{2}-\d{2}|\d{2}-\d{2}-[A-Z]{2}|\d{2}-[A-Z]{2}-\d{2}|[A-Z]{2}-\d{2}-[A-Z]{2}|[A-Z]{2}-[A-Z]{2}-\d{2}|\d{2}-[A-Z]{2}-[A-Z]{2}|\d{2}-[A-Z]{3}-\d|\d-[A-Z]{3}-\d{2}|[A-Z]-\d{3}-[A-Z]{2}|[A-Z]{3}-\d{2}-[A-Z])\b/g },
  { type: 'address',  pattern: new RegExp(`\\b[A-ZÀ-Ý][a-zà-ÿ]*?(?:${STREET})\\s+\\d+[a-zA-Z]?\\b`, 'g') },
  { type: 'bsn', captureGroup: 1, pattern: /\bBSN\b\s*(?:is|:|nummer|=|eindigt op|eindigend op)?\s*(\d[\d\s.\-]{2,11}\d)/gi },
  { type: 'bsn', validate: 'bsn-11proef', normalize: 'strip-spaces', pattern: /\b\d[\d\s]{7,}\d\b/g },
  { type: 'bsn', validate: 'bsn-11proef', pattern: /\b\d{9}\b/g },
  { type: 'phone', validate: 'nl-phone', pattern: /\+?\d[\d\s().-]{7,}\d/g },
];

export const NAMES = [
  'jan', 'peter', 'lisa', 'sanne', 'mark', 'lars', 'henk', 'roos', 'storm',
  'floor', 'beer', 'will', 'may', 'june', 'grace', 'hope', 'linda', 'marco',
  'annelies', 'anja', 'annie', 'yusuf', 'john', 'sarah', 'bloem',
  // NB: 'karim' is deliberately NOT a standalone gazetteer name (mirrors the real
  // NL config) — "Manager Karim" is caught by the job-title pass, while
  // "Wethouder Karim" is KEPT (the keep-policy surfaces public officials).
];

export const TITLE_PATTERNS = [
  "(?:[Dd]e\\s+heer|[Dd]en\\s+heer|[Mm]eneer|[Mm]evrouw|[Mm]evr|[Mm]w|[Dd]hr|[Dd]r|[Dd]rs|[Ii]r|[Ii]ng|[Pp]rof|[Mm]r|[Mm]rs|[Mm]s|[Ss]ir)\\.?\\s+",
  "(?:[Mm]anager|[Tt]eamleider|[Aa]fdelingshoofd|[Ll]eidinggevende|[Cc]hef|[Dd]okter|[Aa]rts|[Hh]uisarts|[Cc]hirurg|[Ss]pecialist|[Vv]erpleegkundige|[Dd]octor|[Nn]urse|[Ss]upervisor)\\s+",
  "(?:[Bb]uurman|[Bb]uurvrouw|[Bb]uurjongen|[Bb]uurmeisje|[Bb]uurtgenoot|[Hh]uisgenoot|[Nn]eighbou?r)\\s+",
  "(?:mijn|m'n|m’n|onze|m[ij]n|our|my)\\s+(?:vrouw|man|echtgenoot|echtgenote|partner|zoon|dochter|moeder|vader|broer|zus|zusje|broertje|collega|vriend|vriendin|schoonmoeder|schoonvader|oma|opa|tante|oom|wife|husband|son|daughter|mother|father|brother|sister|colleague|friend|neighbou?r)\\s+",
];

export const GAZETTEER = {
  names: NAMES, placeholder: '[naam]',
  particles: ['van', 'de', 'der', 'den', 'ten', 'ter'],
  titlePatterns: TITLE_PATTERNS,
};

export const STRUCTURED_CONFIG = { rules: RULES, placeholders: PLACEHOLDER };
export const NAMES_CONFIG = { rules: [], placeholders: PLACEHOLDER, gazetteer: GAZETTEER };
