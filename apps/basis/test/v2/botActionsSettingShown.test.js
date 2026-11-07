/**
 * "HOW THE BOT SHOWS ACTIONS" ONLY FOR A PERSON WITH A BOT THAT ACTS.
 *
 * A walk saw the setting on a phone with no bot of its own. The Help contact ('Onderling') is a bot every person has,
 * but it only answers; the setting is about a bot that acts (buttons, screens, confirms in words). Fable's rule: shown
 * only when the contact book holds a bot other than Help.
 */
import { describe, it, expect } from 'vitest';
import { showsBotActionsSetting } from '../../src/v2/surfacePref.js';
import { withHelpContact } from '../../src/v2/helpContact.js';
import { ONDERLING_BOT_WEBID } from '../../src/v2/helpCircle.js';

const person = { contactId: 'webid:bea', name: 'Bea', isBot: false };
const houseBot = { contactId: 'webid:huis-bot', name: 'Huis', isBot: true };

describe('showsBotActionsSetting', () => {
  it('is off with only people and Help', () => {
    expect(showsBotActionsSetting(withHelpContact([person], { available: true }))).toBe(false);
    expect(showsBotActionsSetting([{ contactId: ONDERLING_BOT_WEBID, isBot: true }])).toBe(false);
    expect(showsBotActionsSetting([])).toBe(false);
  });
  it('is on with a bot the person added', () => {
    expect(showsBotActionsSetting(withHelpContact([person, houseBot], { available: true }))).toBe(true);
  });
});
