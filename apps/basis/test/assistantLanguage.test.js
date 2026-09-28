/**
 * The assistant replies in the MEMBER's language, not the door's.
 *
 * The prompt said "Always reply in Dutch" on a Dutch door, so an English question got a Dutch answer. It now says
 * to reply in the member's language (the door's language only when that cannot be told), and each turn carries a
 * hint of what the member wrote in. The hint comes from a small function-word counter: on the household lines and
 * the eval's fixtures it was never wrong (83 right, 7 undecided, 0 wrong of 90), where eld and tinyld each named a
 * language wrongly on a short line — and a wrong hint pushes the reply into the wrong language.
 */
import { describe, it, expect } from 'vitest';
import { mergeManifests } from '../src/manifestMerge.js';
import { householdManifest } from '../../household/manifest.js';
import { listsManifest } from '../../lists/manifest.js';
import { createAssistantEngine } from '../src/v2/assistantEngine.js';
import { interpretToCommand, TURN_MARKER } from '../src/v2/interpretCommand.js';
import { detectLang } from '../src/v2/assistantLanguage.js';

const catalogue = mergeManifests([{ manifest: householdManifest }, { manifest: listsManifest }]);

async function promptFor(text, lang = 'nl') {
  let system = null;
  const llm = { invoke: async (req) => { system = req.system; return { toolCall: null, replyText: 'ok' }; } };
  const engine = createAssistantEngine({
    catalogue, lang, llm, interpret: interpretToCommand,
    dispatch: () => {}, onUnhandled: async () => 'hint', onLlmUnavailable: () => {}, onNoMatch: () => {},
  });
  await engine.ask('t', text);
  return system;
}

describe('the member\'s language', () => {
  it('an English line on a Dutch door: reply in the member\'s language, and the hint says English', async () => {
    const system = await promptFor('could you tell me what we still need to buy');   // no fixed rule matches: the model runs
    expect(system).toMatch(/Reply in the member's language/);
    expect(system).not.toMatch(/Always reply in Dutch/);
    const hint = system.indexOf('The member wrote in: en');
    expect(hint).toBeGreaterThan(system.indexOf(TURN_MARKER));
  });

  it('a Dutch line: the hint says Dutch', async () => {
    expect(await promptFor('kun je me vertellen wat we nog moeten kopen')).toContain('The member wrote in: nl');
  });

  it('a line the counter cannot place: no hint, and the door\'s language is the fallback the rule names', async () => {
    const system = await promptFor('Maii');
    expect(system).not.toMatch(/The member wrote in/);
    expect(system).toMatch(/when you cannot tell, in Dutch/);
  });

  it('the counter names a language only on a clear margin', () => {
    expect(detectLang('zet kaas op de lijst')).toBe('nl');
    expect(detectLang('add bread to the shopping list')).toBe('en');
    expect(detectLang('ok')).toBeNull();
    expect(detectLang('')).toBeNull();
    expect(detectLang('kaas')).toBeNull();
  });
});
