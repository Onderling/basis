/**
 * botPrompt — everything a household bot tells its model about its household, in ONE place: the template's lines, the
 * reminder lines, and who may do what — the last GENERATED from the map the host gate reads (`opMapPromptLines`), never
 * a hand list beside it. The box reads it, and so does the eval: "the eval composes the bot as it ships" stays true by
 * construction (`test/fitness/botPromptLinesOnce.test.js`).
 */
import { HOUSEHOLD_TEMPLATE, promptLinesFor } from './householdTemplate.js';
import { reminderPromptLines } from './botReminders.js';
import { opMapPromptLines } from './botOpMap.js';

/**
 * @param {(key: string) => string} t
 * @param {object} [template]
 * @returns {string[]}  LLM-facing
 */
export function botPromptLines(t, template = HOUSEHOLD_TEMPLATE) {
  return [...promptLinesFor(t, template), ...reminderPromptLines(), ...opMapPromptLines()];
}
