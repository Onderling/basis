/**
 * regexCommands.test.js — Stream 1b unit tests.
 *
 * Table-driven coverage of every row of the verb + type tables in
 * `src/parsers/grammar.md`.  Locks the contract so other streams
 * can rely on it without re-reading the regex.
 */
import { describe, it, expect } from 'vitest';
import { regexParse } from '../../src/parsers/regexCommands.js';

/**
 * Each row: [name, input, expected].
 *
 * `expected` is whatever `regexParse` should return.  Object,
 * array, or `null`.
 */
const cases = [
  // ──────────────────────────────────────────────────────────────
  // English `add`
  // ──────────────────────────────────────────────────────────────
  ['add + alias + text → addItem',
    'add shopping bread',
    { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } }],
  ['add + groceries alias',
    'add groceries milk',
    { skillId: 'addItem', args: { type: 'shopping', text: 'milk' } }],
  ['add + buy alias',
    'add buy eggs',
    { skillId: 'addItem', args: { type: 'shopping', text: 'eggs' } }],
  ['add + errand alias',
    'add errand pick up dry cleaning',
    { skillId: 'addItem', args: { type: 'errand', text: 'pick up dry cleaning' } }],
  ['add + task alias',
    'add task call plumber',
    { skillId: 'addItem', args: { type: 'errand', text: 'call plumber' } }],
  ['add + todo alias',
    'add todo water plants',
    { skillId: 'addItem', args: { type: 'errand', text: 'water plants' } }],
  ['add + repair alias',
    'add repair leaky tap',
    { skillId: 'addItem', args: { type: 'repair', text: 'leaky tap' } }],
  ['add + fix alias',
    'add fix bike chain',
    { skillId: 'addItem', args: { type: 'repair', text: 'bike chain' } }],
  ['add + schedule alias',
    'add schedule pick up kids friday',
    { skillId: 'addItem', args: { type: 'schedule', text: 'pick up kids friday' } }],
  ['add + event alias',
    'add event birthday party',
    { skillId: 'addItem', args: { type: 'schedule', text: 'birthday party' } }],
  ['add + appointment alias',
    'add appointment dentist 9am',
    { skillId: 'addItem', args: { type: 'schedule', text: 'dentist 9am' } }],
  ['add without alias defaults to shopping',
    'add bread',
    { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } }],

  // ──────────────────────────────────────────────────────────────
  // Dutch `add`
  // ──────────────────────────────────────────────────────────────
  ['voeg toe + alias + text',
    'voeg toe shopping melk',
    { skillId: 'addItem', args: { type: 'shopping', text: 'melk' } }],
  ['voeg toe + boodschappen alias',
    'voeg toe boodschappen brood',
    { skillId: 'addItem', args: { type: 'shopping', text: 'brood' } }],
  ['voeg toe + winkel alias',
    'voeg toe winkel appels',
    { skillId: 'addItem', args: { type: 'shopping', text: 'appels' } }],
  ['voeg toe + klusje alias',
    'voeg toe klusje stofzuigen',
    { skillId: 'addItem', args: { type: 'errand', text: 'stofzuigen' } }],
  ['voeg toe + boodschap alias (singular = errand)',
    'voeg toe boodschap pakket ophalen',
    { skillId: 'addItem', args: { type: 'errand', text: 'pakket ophalen' } }],
  ['voeg toe + reparatie alias',
    'voeg toe reparatie kraan',
    { skillId: 'addItem', args: { type: 'repair', text: 'kraan' } }],
  ['voeg toe + repareren alias',
    'voeg toe repareren fiets',
    { skillId: 'addItem', args: { type: 'repair', text: 'fiets' } }],
  ['voeg toe + agenda alias',
    'voeg toe agenda tandarts vrijdag',
    { skillId: 'addItem', args: { type: 'schedule', text: 'tandarts vrijdag' } }],
  ['voeg toe + afspraak alias',
    'voeg toe afspraak kapper',
    { skillId: 'addItem', args: { type: 'schedule', text: 'kapper' } }],
  ['toevoegen verb',
    'toevoegen melk',
    { skillId: 'addItem', args: { type: 'shopping', text: 'melk' } }],
  ['noteer verb',
    'noteer brood',
    { skillId: 'addItem', args: { type: 'shopping', text: 'brood' } }],

  // ──────────────────────────────────────────────────────────────
  // English `list`
  // ──────────────────────────────────────────────────────────────
  ['list + shopping',
    'list shopping',
    { skillId: 'listOpenItems', args: { type: 'shopping' } }],
  ['list + errand',
    'list errand',
    { skillId: 'listOpenItems', args: { type: 'errand' } }],
  ['list + repair',
    'list repair',
    { skillId: 'listOpenItems', args: { type: 'repair' } }],
  ['list + schedule',
    'list schedule',
    { skillId: 'listOpenItems', args: { type: 'schedule' } }],
  ['show + groceries',
    'show groceries',
    { skillId: 'listOpenItems', args: { type: 'shopping' } }],

  // ──────────────────────────────────────────────────────────────
  // Dutch `list`
  // ──────────────────────────────────────────────────────────────
  ['lijst + boodschappen',
    'lijst boodschappen',
    { skillId: 'listOpenItems', args: { type: 'shopping' } }],
  ['toon + agenda',
    'toon agenda',
    { skillId: 'listOpenItems', args: { type: 'schedule' } }],

  // ──────────────────────────────────────────────────────────────
  // "what do we need" / "wat hebben we nodig"
  // ──────────────────────────────────────────────────────────────
  ['what do we need? → shopping',
    'what do we need?',
    { skillId: 'listOpenItems', args: { type: 'shopping' } }],
  ['what do we need at the supermarket?',
    'what do we need at the supermarket?',
    { skillId: 'listOpenItems', args: { type: 'shopping' } }],
  ['what do we need in the kitchen',
    'what do we need in the kitchen',
    { skillId: 'listOpenItems', args: { type: 'shopping' } }],
  ['wat hebben we nodig?',
    'wat hebben we nodig?',
    { skillId: 'listOpenItems', args: { type: 'shopping' } }],
  ['wat hebben we nodig in de supermarkt?',
    'wat hebben we nodig in de supermarkt?',
    { skillId: 'listOpenItems', args: { type: 'shopping' } }],

  // ──────────────────────────────────────────────────────────────
  // English `done`
  // ──────────────────────────────────────────────────────────────
  ['done + keyword',
    'done bread',
    { skillId: 'markComplete', args: { match: 'bread' } }],
  ['complete + keyword',
    'complete milk',
    { skillId: 'markComplete', args: { match: 'milk' } }],
  ['bought + keyword',
    'bought eggs',
    { skillId: 'markComplete', args: { match: 'eggs' } }],
  ['did + keyword',
    'did dishes',
    { skillId: 'markComplete', args: { match: 'dishes' } }],
  ['finished + keyword',
    'finished homework',
    { skillId: 'markComplete', args: { match: 'homework' } }],

  // ──────────────────────────────────────────────────────────────
  // Dutch `done`
  // ──────────────────────────────────────────────────────────────
  ['klaar + keyword',
    'klaar melk',
    { skillId: 'markComplete', args: { match: 'melk' } }],
  ['gedaan + keyword',
    'gedaan was',
    { skillId: 'markComplete', args: { match: 'was' } }],
  ['gekocht + keyword',
    'gekocht brood',
    { skillId: 'markComplete', args: { match: 'brood' } }],

  // ──────────────────────────────────────────────────────────────
  // English `remove`
  // ──────────────────────────────────────────────────────────────
  ['remove + keyword',
    'remove bread',
    { skillId: 'removeItem', args: { match: 'bread' } }],
  ['delete + keyword',
    'delete milk',
    { skillId: 'removeItem', args: { match: 'milk' } }],
  ['cancel + keyword',
    'cancel dentist',
    { skillId: 'removeItem', args: { match: 'dentist' } }],
  ['nope + keyword',
    'nope homework',
    { skillId: 'removeItem', args: { match: 'homework' } }],

  // ──────────────────────────────────────────────────────────────
  // Dutch `remove`
  // ──────────────────────────────────────────────────────────────
  ['verwijder + keyword',
    'verwijder melk',
    { skillId: 'removeItem', args: { match: 'melk' } }],
  ['weg + keyword',
    'weg brood',
    { skillId: 'removeItem', args: { match: 'brood' } }],

  // ──────────────────────────────────────────────────────────────
  // Help
  // ──────────────────────────────────────────────────────────────
  ['help → nothing (the help is basis\'s)',
    'help',
    null],
  ['hulp',
    'hulp',
    null],

  // ──────────────────────────────────────────────────────────────
  // Addressed-mode prefix stripping
  // ──────────────────────────────────────────────────────────────
  ['@Household prefix',
    '@Household add bread',
    { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } }],
  ['@HOUSEHOLD ADD (mixed case prefix + verb)',
    '@HOUSEHOLD ADD bread',
    { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } }],
  ['/add prefix',
    '/add bread',
    { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } }],
  ['!add prefix',
    '!add bread',
    { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } }],
  ['/help slash command → nothing (basis owns /help)',
    '/help',
    null],
  ['@Household + Dutch verb',
    '@Household voeg toe melk',
    { skillId: 'addItem', args: { type: 'shopping', text: 'melk' } }],

  // ──────────────────────────────────────────────────────────────
  // Multi-item add (English `,`, ` and `; Dutch ` en `)
  // ──────────────────────────────────────────────────────────────
  ['comma-separated multi-item add',
    'add bread, milk, eggs',
    [
      { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } },
      { skillId: 'addItem', args: { type: 'shopping', text: 'milk' } },
      { skillId: 'addItem', args: { type: 'shopping', text: 'eggs' } },
    ]],
  ['comma-separated with explicit type',
    'add shopping bread, milk, eggs',
    [
      { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } },
      { skillId: 'addItem', args: { type: 'shopping', text: 'milk' } },
      { skillId: 'addItem', args: { type: 'shopping', text: 'eggs' } },
    ]],
  ['"and"-separated multi-item add',
    'add bread and milk and eggs',
    [
      { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } },
      { skillId: 'addItem', args: { type: 'shopping', text: 'milk' } },
      { skillId: 'addItem', args: { type: 'shopping', text: 'eggs' } },
    ]],
  ['Dutch "en" multi-item add',
    'voeg toe brood en melk en eieren',
    [
      { skillId: 'addItem', args: { type: 'shopping', text: 'brood' } },
      { skillId: 'addItem', args: { type: 'shopping', text: 'melk' } },
      { skillId: 'addItem', args: { type: 'shopping', text: 'eieren' } },
    ]],
  ['multi-item done ("bought eggs and bread")',
    'bought eggs and bread',
    [
      { skillId: 'markComplete', args: { match: 'eggs' } },
      { skillId: 'markComplete', args: { match: 'bread' } },
    ]],

  // ──────────────────────────────────────────────────────────────
  // Quoted strings
  // ──────────────────────────────────────────────────────────────
  ['quoted item is preserved as one',
    'add shopping "tomato passata"',
    { skillId: 'addItem', args: { type: 'shopping', text: 'tomato passata' } }],
  ['quoted item with comma inside stays single',
    'add shopping "salt, pepper"',
    { skillId: 'addItem', args: { type: 'shopping', text: 'salt, pepper' } }],
  ['quoted + plain mix',
    'add "tomato passata", milk',
    [
      { skillId: 'addItem', args: { type: 'shopping', text: 'tomato passata' } },
      { skillId: 'addItem', args: { type: 'shopping', text: 'milk' } },
    ]],

  // ──────────────────────────────────────────────────────────────
  // Trailing punctuation
  // ──────────────────────────────────────────────────────────────
  ['add bread! → strip !',
    'add bread!',
    { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } }],
  ['done bread. → strip .',
    'done bread.',
    { skillId: 'markComplete', args: { match: 'bread' } }],
  ['list shopping. → strip .',
    'list shopping.',
    { skillId: 'listOpenItems', args: { type: 'shopping' } }],

  // ──────────────────────────────────────────────────────────────
  // Whitespace tolerance / case
  // ──────────────────────────────────────────────────────────────
  ['extra interior whitespace collapsed',
    'add   shopping    bread',
    { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } }],
  ['leading/trailing whitespace trimmed',
    '   add bread   ',
    { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } }],
  ['ADD upper-case verb',
    'ADD bread',
    { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } }],

  // ──────────────────────────────────────────────────────────────
  // Edge cases — just-the-verb / null
  // ──────────────────────────────────────────────────────────────
  ['just \"add\" → nothing (no help skill: basis answers an empty command)',
    'add',
    null],
  ['just \"list\" → nothing (no help skill: basis answers an empty command)',
    'list',
    null],
  ['just \"done\" → nothing (no help skill: basis answers an empty command)',
    'done',
    null],
  ['just \"remove\" → nothing (no help skill: basis answers an empty command)',
    'remove',
    null],
  ['empty string → null',
    '',
    null],
  ['whitespace-only → null',
    '   \t\n   ',
    null],
  ['nonsense → null',
    'sjkdhfksjdhf',
    null],
  ['question that is not the canonical form → null',
    'where did the cat go?',
    null],
];

describe('regexParse — table-driven', () => {
  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(regexParse(input)).toEqual(expected);
    });
  }
});

// A few extra targeted tests that don't fit the table cleanly.
describe('regexParse — non-string input', () => {
  it('returns null for non-string input', () => {
    expect(regexParse(undefined)).toBeNull();
    expect(regexParse(null)).toBeNull();
    expect(regexParse(42)).toBeNull();
  });
});
