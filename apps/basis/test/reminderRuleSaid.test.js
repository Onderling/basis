/**
 * When the bot reminds, said once and the same in the welcome and in /help — and read from the reminder code, not typed
 * beside it (a household's log, 2026-10: someone expected a reminder the morning of an afternoon appointment, and did
 * not get the one they expected). The household's rules as they stand: everything of the day at the morning moment, an
 * appointment early the next morning also the evening before, anything with a time shortly before; and `/herinneringen`
 * changes it for the person.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initLocalisation, t } from '../src/localisation.js';
import { welcomeLines } from '../src/v2/botWelcome.js';
import { botHelpLines } from '../src/v2/botHelp.js';
import { templateLists } from '../src/v2/householdTemplate.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { scopeCatalogueToRole } from '../src/v2/botOpMap.js';
import { REMINDER_MOMENTS, EVENING_BEFORE_UNTIL } from '../src/v2/botReminders.js';
import { HOUSEHOLD_RULES_DEFAULT } from '../src/v2/botSettings.js';

const lead = Number(HOUSEHOLD_RULES_DEFAULT.find((r) => r.startsWith('before:')).split(':')[1]);
const ops = new Set(['addToList', 'claimTask', 'addEvent', 'weekOverview', 'assistant-reminders', 'assistant-overview']);
const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });

let welcome;
let help;
beforeAll(async () => {
  await initLocalisation({ lng: 'nl' });
  welcome = welcomeLines({ ops, lists: templateLists(t), role: 'member', settings: { reminders: 'on', quiet: '21:00-08:00', rules: [...HOUSEHOLD_RULES_DEFAULT] }, t });
  help = botHelpLines({ commandMenu: scopeCatalogueToRole(catalogue, 'member').commandMenu, opsById: catalogue.opsById, t, reminders: { on: true, rules: [...HOUSEHOLD_RULES_DEFAULT] } });
});

/** The line that says when reminders come: it names the morning moment and how to change it. */
const ruleLine = (lines) => lines.find((l) => l.includes(REMINDER_MOMENTS.morning) && l.includes('/herinneringen'));

describe('when the bot reminds, said as the code does it', () => {
  it('the welcome says it in one line, with the real moments: morning, the evening before (early appointments), shortly before', () => {
    const line = ruleLine(welcome);
    expect(line, welcome.join('\n')).toBeTruthy();
    expect(line).toContain(REMINDER_MOMENTS.evening);
    expect(line).toContain(EVENING_BEFORE_UNTIL);
    expect(line).toContain(String(lead));
  });

  it('/help says the same line', () => {
    expect(ruleLine(help), help.join('\n')).toBe(ruleLine(welcome));
  });

  it('the line follows the household\'s rules: without the evening before it does not promise one', () => {
    const only = welcomeLines({ ops, lists: templateLists(t), role: 'member', settings: { reminders: 'on', quiet: '21:00-08:00', rules: ['morning'] }, t });
    const line = ruleLine(only);
    expect(line).toBeTruthy();
    expect(line).not.toContain(REMINDER_MOMENTS.evening);
  });
});
