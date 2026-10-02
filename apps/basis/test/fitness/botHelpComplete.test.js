/**
 * FITNESS: every command a household bot offers has a person-facing `/help` line in every language
 * (`circle.bot.help.ops.<app>.<op>`), and no line names an op the bot does not offer. Offered = a command in its chat
 * menu, or a button on a connected screen (a screen paints the same line, else the bare op id). A new op on the bot's
 * map is red here until someone words it for a person — the manifest's hint is for the model, not for `/help`.
 */
import { describe, it, expect } from 'vitest';
import { composeAssistantCatalogue } from '../../src/telegram/assistantCatalogue.js';
import { scopeCatalogueToRole } from '../../src/v2/botOpMap.js';
import { screenColumnFor } from '../../src/v2/screenActing.js';
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };
import en from '../../src/locales/circle.en.json' with { type: 'json' };

const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });
const commands = (scopeCatalogueToRole(catalogue, null).commandMenu ?? []).map((e) => {
  const entry = catalogue.opsById.get(e.opId);
  return `${entry?.appOrigin}.${entry?.op?.id}`;
});
const onScreens = ['admin', 'member', 'observer'].flatMap((role) => screenColumnFor(catalogue, role));
const offered = [...new Set([...commands, ...onScreens])].sort();

describe('FITNESS: the bot\'s /help lines', () => {
  for (const [lang, bundle] of [['nl', nl], ['en', en]]) {
    it(`${lang}: one line per offered command, none for a command the bot does not offer`, () => {
      const ops = bundle.bot.help.ops;
      const have = Object.entries(ops).flatMap(([app, byOp]) => Object.keys(byOp).map((op) => `${app}.${op}`)).sort();
      expect(offered.filter((id) => !have.includes(id)), `${lang} lacks`).toEqual([]);
      expect(have.filter((id) => !offered.includes(id)), `${lang} words a command the bot does not offer`).toEqual([]);
      for (const s of ['lists', 'chores', 'agenda', 'you', 'admin']) expect(typeof bundle.bot.help.sections[s]).toBe('string');
    });
  }
});
