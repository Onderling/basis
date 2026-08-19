/**
 * byte/behaviour-equivalence gate.
 *
 * Proves that the new `apps/household/manifest.js` + `@onderling/app-manifest`
 * projectors produce output identical to the existing hand-catalogues:
 *
 *   - `renderChat(manifest).toolCatalogue`     ≡  `V0_TOOL_CATALOGUE`
 *     (`src/skills/classifyAndExtract.js`)
 *   - `renderChat(manifest).systemPrompt`    ≡  `SYSTEM_PROMPT_CLASSIFY`
 *     (`src/llm/prompts.js`)
 *   - `renderSlash(manifest).parse(input)`   ≡  `regexParse(input)`
 *     across a corpus (`src/parsers/regexCommands.js`)
 *
 * Round A keeps the originals in place; the gate is the diff.  Round B
 * swaps `HouseholdAgent` to the projector output and deletes the
 * originals.  Per PLAN §1.4 + §1.6: parse + toolCatalogue are byte-equal;
 * the system prompt is byte-equal here because the manifest re-exports
 * the verbatim string (F-SP1-d).
 */

import { describe, it, expect } from 'vitest';

import { renderChat, renderSlash } from '@onderling/app-manifest';

import { householdManifest }       from '../manifest.js';
import { V0_TOOL_CATALOGUE }         from '../src/skills/classifyAndExtract.js';
import { SYSTEM_PROMPT_CLASSIFY }  from '../src/llm/prompts.js';
import { regexParse }              from '../src/parsers/regexCommands.js';
import * as Skills                 from '../src/skills/index.js';

// renderChat needs a skillRegistry + toSkillCtx; their actual behaviour
// doesn't matter for the toolCatalogue/systemPrompt byte-equality check.
const noopRegistry = {
  addItem:      Skills.addItem,
  listOpen:     Skills.listOpen,
  markComplete: Skills.markComplete,
  removeItem:   Skills.removeItem,
  help:         Skills.help,
};
const noopCtxAdapter = (toolCtx) => ({ ...toolCtx });

describe('SP-1 equivalence: toolCatalogue === V0_TOOL_CATALOGUE', () => {
  // grew the manifest with new ops (addTask, listTasks, claim,
  // reassign, registerName). The byte-equivalence still holds
  // we filter to the original five op ids.  The remaining toolCatalogue
  // entries beyond the set are the additions.
  const SP1_IDS = new Set(['addItem', 'listOpen', 'markComplete', 'removeItem', 'help']);

  it('byte-equal JSON (filtered to the SP-1 op ids)', () => {
    const out = renderChat(householdManifest, {
      skillRegistry: noopRegistry,
      toSkillCtx:    noopCtxAdapter,
    });
    const filtered = out.toolCatalogue.filter((t) => SP1_IDS.has(t.id));
    expect(JSON.stringify(filtered, null, 2))
      .toBe(JSON.stringify(V0_TOOL_CATALOGUE, null, 2));
  });

  it('SP-1 entries appear first, in declaration order', () => {
    const out = renderChat(householdManifest, {
      skillRegistry: noopRegistry,
      toSkillCtx:    noopCtxAdapter,
    });
    expect(out.toolCatalogue.slice(0, 5).map((t) => t.id))
      .toEqual(['addItem', 'listOpen', 'markComplete', 'removeItem', 'help']);
  });
});

describe('SP-1 equivalence: systemPrompt === SYSTEM_PROMPT_CLASSIFY', () => {
  it('verbatim byte-equal', () => {
    const out = renderChat(householdManifest, {
      skillRegistry: noopRegistry,
      toSkillCtx:    noopCtxAdapter,
    });
    expect(out.systemPrompt).toBe(SYSTEM_PROMPT_CLASSIFY);
  });
});

describe('SP-1 equivalence: renderSlash.parse === regexParse (corpus)', () => {
  const slash = renderSlash(householdManifest);

  const corpus = [
    // empty / whitespace
    '',
    '   ',
    // grammar.md examples
    'add shopping bread',
    'voeg toe shopping melk',
    '/add errand pick up dry cleaning friday',
    'list shopping',
    'lijst shopping',
    'show shopping',
    'toon shopping',
    'what do we need?',
    'wat hebben we nodig?',
    'wat hebben we nodig in de supermarkt?',
    'done bread',
    'klaar melk',
    'bought eggs and bread',
    'remove bread',
    'verwijder melk',
    'help',
    'hulp',
    // edge cases per grammar.md §"Edge cases"
    'add',                  // verb only → help
    'list',                 // verb only → help
    'done',                 // verb only → help
    'remove',               // verb only → help
    'add bread',            // no alias prefix → default 'shopping'
    'add shopping milk, bread, eggs',
    'add shopping milk and bread',
    'add shopping melk en brood',
    'add shopping "tomato passata"',     // quoted item kept whole
    'add bread!',                         // trailing punctuation
    'done bread.',
    // case-insensitivity
    'Add Shopping Bread',
    'ADD SHOPPING BREAD',
    // addressed-mode prefixes (all three; case-insensitive variant)
    '/add shopping milk',
    '!add shopping milk',
    '@household add shopping milk',
    '@Household add shopping milk',
    '@HOUSEHOLD add shopping milk',
    // type-alias coverage (EN + NL)
    'add groceries milk',
    'add boodschappen melk',
    'add buy milk',
    'add winkel melk',
    'add klusje dishes',
    'add task dishes',
    'add todo dishes',
    'add boodschap dishes',
    'add repair tap',
    'add fix tap',
    'add reparatie kraan',
    'add repareren kraan',
    'add schedule dentist',
    'add event dentist',
    'add appointment dentist',
    'add agenda dentist',
    'add afspraak dentist',
    // unknown verb → null (LLM slow-path fallback)
    'philosophise about life',
    'good morning',
    'goedemorgen',
    'haha that\'s funny',
    // empty after prefix strip
    '/',
    '!',
    '@household',
  ];

  it.each(corpus)('parse(%j) byte-equal to regexParse', (input) => {
    expect(JSON.stringify(slash.parse(input)))
      .toBe(JSON.stringify(regexParse(input)));
  });
});
