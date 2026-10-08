/**
 * gatePhrases — the gate's words as phrase TEMPLATES, compiled once (Fable, 2026-10-01; ledger L174).
 *
 * A translator (a person, or a model) writes "zet {items} op (de|het)? {list}", never a regular expression. This
 * compiles such a template into a test that hands back its slots. The grammar is small on purpose:
 *   - words are literal (case aside); punctuation written against a word stays against it ("{person}:");
 *   - `(a|b|c d)` is an alternation of literal phrases; `( … )?` makes it optional;
 *   - `{slot}` is typed: `{list}` one of the household's list words (with -lijst / -lijstje / list allowed), `{person}`
 *     one word, `{day}` / `{time}` what the bounded date reader reads, `{span}` a span from now ("over 10 minuten"), `{any}` a gap that captures nothing, and any
 *     other declared text slot (`{item}`, `{items}`, `{text}`, `{name}`, `{title}`) some words;
 *   - the whole line must match; trailing ".!?" is allowed.
 * A template it cannot read throws at compile time: a typo in a translation must not silently never match.
 */

const TEXT_SLOTS = new Set(['item', 'items', 'text', 'name', 'title', 'what', 'shop']);
const DAY_RE = '(?:volgende week|next week)\\s+(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|overmorgen|the day after tomorrow|morgen|tomorrow|vandaag|today|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const TIME_RE = '(?:om\\s+half\\s+\\d{1,2}(?:\\s+uur)?|(?:om\\s+|at\\s+)?\\d{1,2}[:.]\\d{2}(?:\\s*(?:am|pm)|\\s+uur)?|(?:om|at)\\s+\\d{1,2}(?:\\s*(?:am|pm))?(?:\\s+uur)?)';
// a span from now: "over 10 minuten", "in 10 minutes", "over een uur"
const SPAN_RE = '(?:over|in)\\s+(?:\\d{1,3}\\s*(?:minuten|minuut|min|minutes|minute)|(?:een|an|1)\\s+(?:uur|hour))';
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phrase = (p) => p.trim().split(/\s+/).map(esc).join('\\s+');

/**
 * @param {string} template
 * @param {{list?: string[]}} [slots]  the words a `{list}` slot may be
 * @returns {{template: string, re: RegExp, slots: string[], match: (text: string) => Record<string, string>|null}}
 */
export function compilePhrase(template, slots = {}) {
  const src = String(template ?? '');
  const bad = (why) => { throw new Error(`gate template "${src}": ${why}`); };
  const names = [];
  const slotRe = (name) => {
    if (name === 'any') return '.*?';
    if (name === 'list') {
      const words = [...(slots.list ?? [])].map((w) => String(w).toLowerCase()).filter(Boolean).sort((a, b) => b.length - a.length).map(esc);
      if (!words.length) bad('a {list} slot with no list words');
      names.push('list');
      return `(?<list>${words.join('|')})(?:[-\\s]?(?:lijstje|lijst|list))?`;
    }
    if (name === 'person') { names.push('person'); return '(?<person>[^\\s:,]+)'; }
    if (name === 'day') { names.push('day'); return `(?<day>${DAY_RE})`; }
    if (name === 'time') { names.push('time'); return `(?<time>${TIME_RE})`; }
    if (name === 'span') { names.push('span'); return `(?<span>${SPAN_RE})`; }
    if (TEXT_SLOTS.has(name)) {
      if (names.includes(name)) bad(`slot {${name}} twice`);
      names.push(name);
      return `(?<${name}>.+?)`;
    }
    return bad(`unknown slot {${name}}`);
  };

  // chunks: runs of parts written together; a chunk that is only an optional group is optional as a whole
  const chunks = [];
  let cur = null;
  const push = (part) => { if (!cur) { cur = { parts: [] }; chunks.push(cur); } cur.parts.push(part); };
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (/\s/.test(c)) { cur = null; i += 1; continue; }
    if (c === '(') {
      const end = src.indexOf(')', i);
      if (end < 0 || src.slice(i + 1, end).includes('(')) bad('a "(" without its ")"');
      const alts = src.slice(i + 1, end).split('|').map((a) => a.trim());
      if (!alts.length || alts.some((a) => !a || /[{}]/.test(a))) bad('an empty alternative, or a slot inside ( )');
      const optional = src[end + 1] === '?';
      push({ re: `(?:${alts.map(phrase).join('|')})`, optional });
      i = end + (optional ? 2 : 1);
      continue;
    }
    if (c === '{') {
      const end = src.indexOf('}', i);
      if (end < 0 || /[\s{(]/.test(src.slice(i + 1, end))) bad('a "{" without its "}"');
      const slot = src.slice(i + 1, end).trim();
      // a gap on its own may be empty: it is optional as a chunk
      push({ re: slotRe(slot), optional: slot === 'any' });
      i = end + 1;
      continue;
    }
    if (c === ')' || c === '}' || c === '|') bad(`a stray "${c}"`);
    let j = i;
    while (j < src.length && !/[\s({)}|]/.test(src[j])) j += 1;
    push({ re: esc(src.slice(i, j)), optional: false });
    i = j;
  }
  if (!chunks.length) bad('nothing in it');

  let re = '^\\s*';
  let started = false;
  for (const ch of chunks) {
    const optionalChunk = ch.parts.length === 1 && ch.parts[0].optional;
    const body = ch.parts.map((p) => (p.optional && !optionalChunk ? `${p.re}?` : p.re)).join('');
    if (optionalChunk) re += started ? `(?:\\s+${body})?` : `(?:${body}\\s+)?`;
    else { re += (started ? '\\s+' : '') + body; started = true; }
  }
  re += '\\s*[.!?]*\\s*$';
  const compiled = new RegExp(re, 'i');
  return {
    template: src, re: compiled, slots: names,
    match(text) {
      const m = compiled.exec(String(text ?? '').trim());
      if (!m) return null;
      const out = {};
      for (const n of names) if (m.groups?.[n] !== undefined) out[n] = n === 'list' ? m.groups[n].toLowerCase() : m.groups[n].trim();
      return out;
    },
  };
}
