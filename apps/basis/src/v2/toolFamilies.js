/**
 * The tools a turn is offered, narrowed by the line's own words. A one-line "zet kaas op de boodschappen" was sent all
 * 25 of the member's tools — the agenda's and the chores app's schemas and backgrounds included — and the prompt's
 * size is the floor of every turn's time. A family leaves the offered tools only when none of its cue words is in the
 * line AND another family's is; the lists always stay (a chore is a list entry, "nieuwe taak voor Bert" is an add);
 * a line no family claims keeps every tool. Words alone decide — never a second model call. The cue words are the
 * gate files' (`_family`, every language side by side, as the gate reads its lines); a day or a time is the agenda's.
 */
import { GATE_WORDS } from './gateWords.js';
import { DAY_RE, TIME_RE } from './gatePhrases.js';

/** The family that is never dropped. */
const ALWAYS = 'lists';

/** Per family, one matcher over every language's cue words (whole words; a cue may be several). */
function familyMatchers(words = GATE_WORDS) {
  const cues = {};
  for (const entries of Object.values(words)) {
    for (const [family, list] of Object.entries(entries?._family ?? {})) {
      if (!Array.isArray(list)) continue;   // the entry's `doc`
      (cues[family] ??= new Set());
      for (const w of list) cues[family].add(String(w).toLowerCase());
    }
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = {};
  for (const [family, set] of Object.entries(cues)) {
    const alts = [...set].sort((a, b) => b.length - a.length).map(esc);
    if (family === 'calendar') alts.push(DAY_RE, TIME_RE);
    out[family] = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${alts.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu');
  }
  return out;
}
const MATCHERS = familyMatchers();

/**
 * @param {{opsById: Map<string, {appOrigin?: string}>}} catalogue  the catalogue the turn would offer
 * @param {string} text  the member's line (lines collected into one turn: joined)
 * @returns {object} the same catalogue, or a copy without the families the line does not concern
 */
export function narrowCatalogueForLine(catalogue, text) {
  if (!catalogue || !catalogue.opsById || typeof catalogue.opsById.forEach !== 'function') return catalogue;
  const line = String(text ?? '');
  const claimed = new Set(Object.entries(MATCHERS).filter(([, re]) => re.test(line)).map(([f]) => f));
  if (claimed.size === 0) return catalogue;
  const known = new Set(Object.keys(MATCHERS));
  const drop = (family) => known.has(family) && family !== ALWAYS && !claimed.has(family);
  const opsById = new Map();
  for (const [k, entry] of catalogue.opsById) if (!drop(entry && entry.appOrigin)) opsById.set(k, entry);
  if (opsById.size === catalogue.opsById.size) return catalogue;
  const commandMenu = Array.isArray(catalogue.commandMenu)
    ? catalogue.commandMenu.filter((e) => !drop(e && e.appOrigin))
    : catalogue.commandMenu;
  return { ...catalogue, opsById, commandMenu };
}
