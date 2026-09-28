/**
 * The assistant's system prompt: one voice, one order, one budget.
 *
 * One voice: the household app's background used to carry its own protocol ("Default to NOISE … reply the literal
 * single word: noise"), while the shared prompt says to reply briefly and naturally. The model got both, and a
 * greeting or an out-of-scope question fell silent ("Kun je ook sokken stoppen" → nothing, 2026-09-28 baseline).
 *
 * One order: stable sections first (the rules, the apps' backgrounds, the phrasing hints), then a marker, then what
 * changes every turn (the language line, the retrieved items, the date), so the provider's prefix cache can hit.
 *
 * One budget: the retrieved items are cut at `assistant.contextMaxChars`, and the prompt says so when they are.
 */
import { describe, it, expect } from 'vitest';
import { mergeManifests } from '../../src/manifestMerge.js';
import { householdManifest } from '../../../household/manifest.js';
import { listsManifest } from '../../../lists/manifest.js';
import { createAssistantEngine } from '../../src/v2/assistantEngine.js';
import { interpretToCommand, TURN_MARKER } from '../../src/v2/interpretCommand.js';

const catalogue = mergeManifests([{ manifest: householdManifest }, { manifest: listsManifest }]);

/** Run one private-door turn through the shared engine; return the system prompt the model received. */
async function promptFor(text, items = []) {
  let system = null;
  const llm = { invoke: async (req) => { system = req.system; return { toolCall: null, replyText: 'Goedemorgen!' }; } };
  const engine = createAssistantEngine({
    catalogue, lang: 'nl', llm, interpret: interpretToCommand,
    loadItems: async () => items.map((t, i) => ({ id: `i${i}`, type: 'shopping', text: t })),
    dispatch: () => {}, onUnhandled: async () => 'hint', onLlmUnavailable: () => {}, onNoMatch: () => {},
  });
  await engine.ask('t', text);
  return system;
}

describe('the assistant prompt — one voice', () => {
  it('the household background carries no protocol of its own', async () => {
    const system = await promptFor('goedemorgen');
    expect(system).toBeTruthy();
    expect(system).not.toMatch(/literal single word: noise/i);
    expect(system).not.toMatch(/Default to NOISE/);
  });
});

describe('the assistant prompt — stable first, then what changes every turn', () => {
  const at = (system, needle) => {
    const i = typeof needle === 'string' ? system.indexOf(needle) : system.search(needle);
    expect(i, `missing from the prompt: ${needle}`).toBeGreaterThanOrEqual(0);
    return i;
  };

  it('through the engine: rules, backgrounds and phrasing above the marker; the language and the date below it', async () => {
    const system = await promptFor('goedemorgen, hoe gaat het met je');   // a line the language counter can place
    expect(typeof TURN_MARKER).toBe('string');
    const base = at(system, 'You are the assistant in a shared circle');
    const background = at(system, 'How to choose the type for addItem');
    const phrasing = at(system, '"zet … op"');
    const marker = at(system, TURN_MARKER);
    const rule = at(system, "Reply in the member's language");
    const language = at(system, 'The member wrote in: nl');
    const date = at(system, /Today is \d{4}-\d{2}-\d{2}/);
    expect(rule).toBeLessThan(marker);
    expect(base).toBeLessThan(background);
    expect(background).toBeLessThan(marker);
    expect(phrasing).toBeLessThan(marker);
    expect(marker).toBeLessThan(language);
    expect(language).toBeLessThan(date);
  });

  it('below the marker: the hints for this turn, then the retrieved items, then the date', async () => {
    let system = null;
    const llm = { invoke: async (req) => { system = req.system; return { toolCall: null, replyText: 'ok' }; } };
    await interpretToCommand('hoe zit het met de kaas', {
      catalogue, llm, hints: ['The member wrote in: nl.'], context: ['oude kaas'], now: () => Date.UTC(2026, 8, 28),
    });
    const marker = at(system, TURN_MARKER);
    const language = at(system, 'The member wrote in: nl');
    const items = at(system, 'Relevant items already in this circle');
    const date = at(system, 'Today is 2026-09-28');
    expect(system).toContain('You do not know the current time.');   // a date alone made the model invent a clock time
    expect(marker).toBeLessThan(language);
    expect(language).toBeLessThan(items);
    expect(items).toBeLessThan(date);
  });
});

describe('the assistant prompt — one budget', () => {
  it('forty retrieved items are cut at the budget, and the prompt says some were left out', async () => {
    let system = null;
    const llm = { invoke: async (req) => { system = req.system; return { toolCall: null, replyText: 'ok' }; } };
    const context = Array.from({ length: 40 }, (_, i) => `kaas nummer ${i} — een tamelijk lange omschrijving van dit item`);
    await interpretToCommand('hoe zit het met de kaas', { catalogue, llm, context });
    const block = system.slice(system.indexOf('Relevant items already in this circle'));
    const listed = block.split('\n').filter((l) => l.startsWith('- kaas nummer'));
    expect(listed.join('\n').length).toBeLessThanOrEqual(2000);
    expect(listed.length).toBeLessThan(40);
    expect(system).toMatch(/some items were left out; ask to list them/);
  });

  it('a short context is kept whole, with no notice', async () => {
    let system = null;
    const llm = { invoke: async (req) => { system = req.system; return { toolCall: null, replyText: 'ok' }; } };
    await interpretToCommand('hoe zit het met de kaas', { catalogue, llm, context: ['oude kaas', 'jonge kaas'] });
    expect(system).toContain('- oude kaas');
    expect(system).not.toMatch(/left out/);
  });
});
