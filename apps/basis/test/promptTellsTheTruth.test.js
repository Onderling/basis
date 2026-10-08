/**
 * What the model is told must agree with what the bot does. Two places it did not (a household's log, 2026-10-05):
 * - the prompt said only the admin makes or removes lists, while the gate lets every member do both — so the model would
 *   refuse what the member may do;
 * - asked to show the week differently, the model answered "I'll do it like that from now on" — a promise it cannot
 *   keep: how the bot answers is its code, not the model's choice. It says so plainly instead, and who can take it up.
 */
import { describe, it, expect } from 'vitest';
import { HOUSEHOLD_TEMPLATE } from '../src/v2/householdTemplate.js';
import { BOT_OP_MAP } from '../src/v2/botOpMap.js';

const prompt = HOUSEHOLD_TEMPLATE.promptLines.join('\n');

describe('the household prompt tells the model the truth', () => {
  it('who makes and removes lists: as the gate says', () => {
    expect(BOT_OP_MAP.member).toEqual(expect.arrayContaining(['lists.createList', 'lists.removeList', 'lists.restoreList']));
    expect(prompt).not.toMatch(/alleen de beheerder (maakt|verwijdert)[^.]*lijst/i);
  });
  it('never a promise to change how the bot works', () => {
    expect(prompt).toMatch(/Beloof NOOIT/);
    expect(prompt).toMatch(/beheerder/);
  });
});
