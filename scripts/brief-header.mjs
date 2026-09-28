/**
 * brief-header — the status line every brief in plans/briefs/ opens with, read in ONE place.
 *
 * Briefs are short, dated, task-shaped docs written between Frits, Fable and Opus. They multiply (seventeen in a
 * month) and nothing said which were still open, so each carries a header just below its title:
 *
 *   > **Status:** open · **Asks:** Fable · **From:** Opus · **Retire when:** the answer is built and green.
 *
 * `Status` is one of four words: open (waiting for an answer) · answered (answered, not yet acted on) · building
 * (the answer is being built) · done (it can go to plans/archive/<YYYY-MM>/). `Retire when` says when "done" is
 * true. `Asks` and `From` are free. The plans checker (lint-plans-structure) and the index (gen-plan-index) both
 * read the header through this module, so they cannot disagree about what a brief says about itself.
 */

/** The four states a brief can be in, in order. */
export const BRIEF_STATUSES = Object.freeze(['open', 'answered', 'building', 'done']);

/**
 * The header of a brief, from the first lines of its text.
 * @param {string} text
 * @returns {{status: string|null, asks: string|null, retireWhen: string|null}|null}  null when there is no header
 */
export function briefHeader(text) {
  const head = String(text ?? '').split('\n').slice(0, 12).join('\n');
  const status = /\*\*Status:\*\*\s*([A-Za-z]+)/.exec(head)?.[1]?.toLowerCase() ?? null;
  if (!status) return null;
  const field = (name) => new RegExp(`\\*\\*${name}:\\*\\*\\s*([^·\\n]+)`).exec(head)?.[1]?.trim() ?? null;
  return { status, asks: field('Asks'), retireWhen: field('Retire when') };
}
