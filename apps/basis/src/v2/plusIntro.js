/**
 * THE "+" SAYS WHAT IT IS — the assistant plan's step B (ledger L1025), shared by both sheets, which only paint it.
 *
 * - The first open of a self's conversation: three lines with no model call: what it is, that a circle's things go
 *   through the card, and examples to try, built from what the person HAS (one of their own lists, a circle they are
 *   in), filled with fixed ones. A tap on an example puts the line in the field; it does not send. Every example is a
 *   line the "+" reads here (tested through the door itself): an example that does nothing would contradict it.
 * - A later open: one line for each circle joined since the person was last told (`plusNews`), then never again for
 *   it. A circle whose name has not arrived yet is not news until it has one: then it is told once, by name. A circle that went away says nothing; "help" shows what is there now. The Help circle is never news: the "+"
 *   never offers it.
 *
 * What the person was told is a set of circle ids the shell keeps per self on this device (not an act; nothing about
 * it leaves the device). The acts a bot or an app added since ("Nieuw door …") wait for step C's descriptions: a
 * manifest names no source a person would recognise yet.
 */
import { HELP_CIRCLE_ID } from './helpCircle.js';

const FIXED_EXAMPLES = Object.freeze(['circle.vandaag.plus_intro_ex_note', 'circle.vandaag.plus_intro_ex_appt', 'circle.vandaag.plus_intro_ex_plan']);

/**
 * The first open's lines and examples.
 * @param {{ownLists?: Array<{name?: string}>, circles?: Array<{id?: string, name?: string}>, t: Function, helpCircleId?: string}} o
 * @returns {{lines: string[], tryLabel: string, examples: string[]}}
 */
export function plusIntro({ ownLists = [], circles = [], t, helpCircleId = HELP_CIRCLE_ID } = {}) {
  if (typeof t !== 'function') throw new TypeError('plusIntro: t required');
  const examples = [];
  const add = (line) => { if (line && !examples.includes(line) && examples.length < 3) examples.push(line); };
  const list = (Array.isArray(ownLists) ? ownLists : []).find((l) => typeof l?.name === 'string' && l.name.trim());
  if (list) add(t('circle.vandaag.plus_intro_ex_list', { list: list.name.trim() }));
  const circle = (Array.isArray(circles) ? circles : []).find((c) => c?.id && c.id !== helpCircleId && typeof c?.name === 'string' && c.name.trim());
  if (circle) add(t('circle.vandaag.plus_intro_ex_circle', { circle: circle.name.trim() }));
  for (const key of FIXED_EXAMPLES) add(t(key));
  return {
    lines: [t('circle.vandaag.plus_intro_own'), t('circle.vandaag.plus_intro_circle')],
    tryLabel: t('circle.vandaag.plus_intro_try'),
    examples,
  };
}

/**
 * What changed since the person was last told: one line for the circles joined since, or null. `told` is what the
 * shell kept last time (`null` the first time: then the intro speaks and this only remembers). Returns the set to keep.
 * @param {{told?: {circles?: string[]}|null, circles?: Array<{id?: string, name?: string}>, t: Function, helpCircleId?: string}} o
 * @returns {{line: string|null, told: {circles: string[]}}}
 */
export function plusNews({ told = null, circles = [], t, helpCircleId = HELP_CIRCLE_ID } = {}) {
  const now = (Array.isArray(circles) ? circles : []).filter((c) => c?.id && c.id !== helpCircleId);
  // a circle whose name has not arrived yet (a fresh join) is not news yet: it is left out of the line AND of what is
  // kept, so it is told once, by its name, when that arrives; a circle told before stays told while its name is missing
  const named = (c) => typeof c?.name === 'string' && c.name.trim() !== '';
  const known = new Set(Array.isArray(told?.circles) ? told.circles : []);
  const keep = { circles: now.filter((c) => named(c) || known.has(c.id)).map((c) => c.id) };
  if (!told || !Array.isArray(told.circles)) return { line: null, told: keep };
  const joined = now.filter((c) => !known.has(c.id) && named(c));
  if (!joined.length || typeof t !== 'function') return { line: null, told: keep };
  return { line: t('circle.vandaag.plus_news_circle', { circle: joined.map((c) => c.name.trim()).join(', ') }), told: keep };
}

export const PLUS_TOLD_KIND = 'plus-told';

/**
 * What a self's "+" last told them, read from this device's log: `{circles}` or null (never told, or forgotten). One
 * entry per self (its id is the self's conversation), so the newest is the only one.
 * @param {{entryById?: Function, query?: Function}} log @param {string} key   the self's conversation id
 */
export function readPlusTold(log, key) {
  if (!key || !log) return null;
  const id = `${PLUS_TOLD_KIND}:${key}`;
  let e = null;
  try { e = typeof log.entryById === 'function' ? log.entryById(id) : (log.query?.() ?? []).find((x) => x?.id === id) ?? null; } catch { e = null; }
  return Array.isArray(e?.payload?.circles) ? { circles: e.payload.circles.slice() } : null;
}

/**
 * Keep what the "+" told a self (`told` null: forgotten, so the next open is a first open again). Replaces the self's
 * one entry. Best-effort: a log that refuses never breaks the sheet.
 * @param {{append: Function}} log @param {string} key @param {{circles: string[]}|null} told
 */
export function writePlusTold(log, key, told, { now = Date.now } = {}) {
  if (!key || typeof log?.append !== 'function') return;
  try {
    log.append({ id: `${PLUS_TOLD_KIND}:${key}`, type: PLUS_TOLD_KIND, ts: now(), silent: true,
      payload: { circles: Array.isArray(told?.circles) ? told.circles.slice() : null } });
  } catch { /* the sheet still opens */ }
}

