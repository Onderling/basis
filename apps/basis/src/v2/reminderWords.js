/**
 * reminderWords — how a person says their reminders (either language), and how the household's list is kept.
 *
 *   "60" → `before:60` · "ochtend"/"morning" → `morning` · "avond"/"evening" → `evening-before` · "7:30" → `at:07:30`
 *   (the rules themselves are understood too). "ook"/"also" ADDS to what applies; without it the words REPLACE it;
 *   "geen"/"none" is none at all. One word it does not know, and nothing is set — never half a list.
 *
 * The household's own rules are one list param (`assistant.reminderRules`), today's rhythm by default; the household's
 * "lead" (`/huishouden lead 15`) is that list's `before:` rule.
 */
import { parseReminderRule } from '@onderling/item-types';
import { REMINDER_RULES_KEY, HOUSEHOLD_RULES_DEFAULT, REMINDER_RULES_PARAM } from './botSettings.js';

// the household's list is one of the household's settings; kept with them, read here
export { REMINDER_RULES_KEY, HOUSEHOLD_RULES_DEFAULT, REMINDER_RULES_PARAM };

const WORDS = Object.freeze({
  ochtend: 'morning', morgens: 'morning', "'s-ochtends": 'morning', morning: 'morning',
  avond: 'evening-before', 'avond-ervoor': 'evening-before', evening: 'evening-before', 'evening-before': 'evening-before',
});
const ADD = new Set(['ook', 'also', '+']);
const NONE = new Set(['geen', 'none']);

/** One word as a rule, or null. */
function ruleOf(word) {
  const w = word.toLowerCase();
  if (WORDS[w]) return WORDS[w];
  if (/^\d{1,5}$/.test(w)) return parseReminderRule(`before:${Number(w)}`)?.rule ?? null;
  const time = /^(\d{1,2})[:.](\d{2})$/.exec(w);
  if (time) return parseReminderRule(`at:${time[1].padStart(2, '0')}:${time[2]}`)?.rule ?? null;
  return parseReminderRule(w)?.rule ?? null;
}

/** @returns {{mode: 'replace'|'add', rules: string[]}|null} */
export function reminderLayerFromWords(text) {
  const words = String(text ?? '').split(/[\s,]+/).filter(Boolean);
  if (!words.length) return null;
  if (words.length === 1 && NONE.has(words[0].toLowerCase())) return { mode: 'replace', rules: [] };
  const add = ADD.has(words[0].toLowerCase());
  const rest = add ? words.slice(1) : words;
  if (!rest.length) return null;
  const rules = [];
  for (const w of rest) { const r = ruleOf(w); if (!r) return null; if (!rules.includes(r)) rules.push(r); }
  return { mode: add ? 'add' : 'replace', rules };
}


/** The household's list from its stored value; `none` is an empty list, anything unreadable the default. */
export function reminderRulesFrom(v) {
  if (v === 'none') return [];
  if (typeof v !== 'string' || !v.trim()) return [...HOUSEHOLD_RULES_DEFAULT];
  const rules = v.split(',').map((s) => s.trim()).filter(Boolean);
  return rules.every((r) => parseReminderRule(r)) ? [...new Set(rules)] : [...HOUSEHOLD_RULES_DEFAULT];
}
/** The list as it is stored. */
export const reminderRulesValue = (rules) => (rules.length ? rules.join(',') : 'none');
/** The household's lead: the minutes of its `before:` rule, 0 when it has none. */
export const leadOf = (rules) => parseReminderRule(rules.find((r) => r.startsWith('before:')) ?? '')?.minutes ?? 0;
/** The list with its `before:` rule set to `n` minutes (0 = none), in its place. */
export function withLead(rules, n) {
  const i = rules.findIndex((r) => r.startsWith('before:'));
  const next = rules.filter((r) => !r.startsWith('before:'));
  if (n > 0) next.splice(i < 0 ? next.length : i, 0, `before:${n}`);
  return next;
}

/** Rules in a person's words (`circle.bot.rule_*`), in the order given; none → "geen". */
export function describeRules(rules, tp) {
  if (!rules.length) return tp('circle.bot.rules_none');
  return rules.map((r) => {
    const p = parseReminderRule(r);
    if (!p) return r;
    if (p.kind === 'morning') return tp('circle.bot.rule_morning');
    if (p.kind === 'evening-before') return tp('circle.bot.rule_evening');
    if (p.kind === 'before') return tp('circle.bot.rule_before', { n: p.minutes });
    return tp('circle.bot.rule_at', { time: p.time });
  }).join(', ');
}
