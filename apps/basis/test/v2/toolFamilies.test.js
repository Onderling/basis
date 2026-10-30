/**
 * The tools a one-line turn is offered: narrowed per family by words alone (never a second model call). A family
 * leaves the list only when none of its cue words is in the line and another family's is; the lists always stay; a
 * line no family claims keeps every tool. The gate on it is the assistant's own corpus: no line that expects an op
 * may lose that op's tool.
 */
import { describe, it, expect } from 'vitest';
import { composeAssistantCatalogue } from '../../src/telegram/assistantCatalogue.js';
import { scopeCatalogueToRole } from '../../src/v2/botOpMap.js';
import { HOUSEHOLD_TEMPLATE } from '../../src/v2/householdTemplate.js';
import { FIXTURES } from '../../scripts/assistant-eval.fixtures.mjs';
import { narrowCatalogueForLine } from '../../src/v2/toolFamilies.js';

const { catalogue: bot } = composeAssistantCatalogue({ apps: [...HOUSEHOLD_TEMPLATE.apps], slim: true });
const catalogue = scopeCatalogueToRole(bot, 'member');
const families = (c) => [...new Set([...c.opsById.values()].map((e) => e.appOrigin))].sort();

describe('the tools a line is offered, narrowed by its words', () => {
  it('no corpus line loses the tool it expects', () => {
    const lost = [];
    for (const f of FIXTURES) {
      const op = f.expect?.op;
      if (!op || !catalogue.opsById.has(op)) continue;   // a reply, or an op the member's model is not offered at all
      const text = f.text ?? (f.lines ?? []).join('\n');
      if (!narrowCatalogueForLine(catalogue, text).opsById.has(op)) lost.push(`${f.id}: "${text}" lost ${op}`);
    }
    expect(lost).toEqual([]);
  });

  it('a plain list line keeps the lists and drops the agenda and the chores app', () => {
    for (const line of ['zet kaas op de boodschappen', 'add bread to the shopping list']) {
      const kept = families(narrowCatalogueForLine(catalogue, line));
      expect(kept).toContain('lists');
      expect(kept).not.toContain('calendar');
      expect(kept).not.toContain('tasks');
    }
  });

  it('a day or a time keeps the agenda; who-does-what keeps the chores app', () => {
    expect(families(narrowCatalogueForLine(catalogue, 'tandarts morgen om 10 uur'))).toContain('calendar');
    expect(families(narrowCatalogueForLine(catalogue, 'wie doet de lamp'))).toContain('tasks');
  });

  it('a line no family claims keeps every tool', () => {
    expect(narrowCatalogueForLine(catalogue, 'hoe gaat het').opsById.size).toBe(catalogue.opsById.size);
  });
});

describe('the engine offers the narrowed tools', () => {
  it('a list line reaches the model without the agenda\'s tools; a line no family claims gets them all', async () => {
    const { createAssistantEngine } = await import('../../src/v2/assistantEngine.js');
    const { interpretToCommand } = await import('../../src/v2/interpretCommand.js');
    const seen = [];
    const llm = { invoke: async (req) => { seen.push(req.tools.map((t) => t.id)); return { toolCall: null, replyText: 'ok' }; } };
    const engine = createAssistantEngine({ collectMs: 0, catalogue, lang: 'nl', llm, interpret: interpretToCommand,
      dispatch: () => {}, onUnhandled: async () => 'hint', onLlmUnavailable: () => {}, onNoMatch: () => {} });
    await engine.ask('t', 'kun je ook nog wat kaas en eieren erbij doen voor het weekend');
    await engine.ask('t2', 'hoe gaat het met je vandaag');
    expect(seen[0]).not.toContain('addEvent');
    expect(seen[0]).toContain('addToList');
    expect(seen[1]).toContain('addEvent');
  });
});
