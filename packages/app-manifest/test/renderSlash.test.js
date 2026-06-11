import { describe, it, expect } from 'vitest';
import { renderSlash } from '../src/index.js';

// Household-shaped fixture, exercising every capability F-SP1-b requires.
const fixture = {
  app:       'demo',
  itemTypes: ['shopping', 'errand', 'repair', 'schedule'],
  slashGrammar: {
    addressedPrefixes: ['@household\\s+', '/', '!'],
    specials: [{
      pattern: '^(?:what\\s+do\\s+we\\s+need|wat\\s+hebben\\s+we\\s+nodig)\\b.*$',
      skillId: 'listOpen',
      args:    { type: 'shopping' },
    }],
    typeAliases: {
      shopping: 'shopping',  groceries: 'shopping', boodschappen: 'shopping',
      errand:   'errand',    klusje:    'errand',
      repair:   'repair',    reparatie: 'repair',
    },
    defaultType: 'shopping',
  },
  operations: [
    {
      id: 'addItem', verb: 'add',
      surfaces: { slash: { command: '/add', match: {
        verbs:      ['add', ['voeg', 'toe']],
        body:       'type+text',
        splitItems: true,
        onEmpty:    { skillId: 'help', args: {} },
      }}},
    },
    {
      id: 'listOpen', verb: 'list',
      surfaces: { slash: { command: '/list', match: {
        verbs:   ['list', 'show', 'lijst', 'toon'],
        body:    'type-only',
        onEmpty: { skillId: 'help', args: {} },
      }}},
    },
    {
      id: 'markComplete', verb: 'complete',
      surfaces: { slash: { command: '/done', match: {
        verbs:      ['done', 'complete', 'klaar', 'gedaan'],
        body:       'match',
        splitItems: true,
        onEmpty:    { skillId: 'help', args: {} },
      }}},
    },
    {
      id: 'help', verb: 'list',
      surfaces: { slash: { command: '/help', match: { verbs: ['help', 'hulp'], body: 'none' }}},
    },
  ],
};

const r = renderSlash(fixture);

describe('renderSlash — basics', () => {
  it('non-string returns null', () => {
    expect(r.parse(null)).toBe(null);
    expect(r.parse(undefined)).toBe(null);
    expect(r.parse(42)).toBe(null);
  });
  it('empty / whitespace-only returns null', () => {
    expect(r.parse('')).toBe(null);
    expect(r.parse('   ')).toBe(null);
  });
  it('addressed-prefix `/` is stripped before verb matching', () => {
    expect(r.parse('/add shopping milk')).toEqual(
      { skillId: 'addItem', args: { type: 'shopping', text: 'milk' } },
    );
  });
  it('addressed-prefix `@household` is stripped', () => {
    expect(r.parse('@household add shopping milk')).toEqual(
      { skillId: 'addItem', args: { type: 'shopping', text: 'milk' } },
    );
  });
  it('unknown verb returns null (LLM fallback)', () => {
    expect(r.parse('philosophise about life')).toBe(null);
  });
});

describe('renderSlash — type+text + splitItems + aliases + defaultType', () => {
  it('alias resolves (groceries → shopping)', () => {
    expect(r.parse('add groceries milk')).toEqual(
      { skillId: 'addItem', args: { type: 'shopping', text: 'milk' } },
    );
  });
  it('alias case-insensitive', () => {
    expect(r.parse('add BOODSCHAPPEN milk')).toEqual(
      { skillId: 'addItem', args: { type: 'shopping', text: 'milk' } },
    );
  });
  it('no alias → falls back to defaultType, body stays intact', () => {
    expect(r.parse('add milk')).toEqual(
      { skillId: 'addItem', args: { type: 'shopping', text: 'milk' } },
    );
  });
  it('multi-item: comma-separated → array', () => {
    expect(r.parse('add shopping milk, bread')).toEqual([
      { skillId: 'addItem', args: { type: 'shopping', text: 'milk' } },
      { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } },
    ]);
  });
  it('multi-item: " and " / " en " separators', () => {
    expect(r.parse('add shopping milk and bread')).toEqual([
      { skillId: 'addItem', args: { type: 'shopping', text: 'milk' } },
      { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } },
    ]);
    expect(r.parse('add shopping melk en brood')).toEqual([
      { skillId: 'addItem', args: { type: 'shopping', text: 'melk' } },
      { skillId: 'addItem', args: { type: 'shopping', text: 'brood' } },
    ]);
  });
  it('quotes keep separators intact', () => {
    expect(r.parse('add shopping "milk, fresh" and bread')).toEqual([
      { skillId: 'addItem', args: { type: 'shopping', text: 'milk, fresh' } },
      { skillId: 'addItem', args: { type: 'shopping', text: 'bread' } },
    ]);
  });
  it('empty body → onEmpty fallback to help', () => {
    expect(r.parse('add')).toEqual({ skillId: 'help', args: {} });
    expect(r.parse('add shopping')).toEqual({ skillId: 'help', args: {} });
  });
});

describe('renderSlash — multi-word verb phrase', () => {
  it('["voeg","toe"] matches "voeg toe"', () => {
    expect(r.parse('voeg toe shopping melk')).toEqual(
      { skillId: 'addItem', args: { type: 'shopping', text: 'melk' } },
    );
  });
  it('case-insensitive', () => {
    expect(r.parse('Voeg Toe shopping melk')).toEqual(
      { skillId: 'addItem', args: { type: 'shopping', text: 'melk' } },
    );
  });
});

describe('renderSlash — type-only body (list <type>)', () => {
  it('list shopping → listOpen', () => {
    expect(r.parse('list shopping')).toEqual(
      { skillId: 'listOpen', args: { type: 'shopping' } },
    );
  });
  it('alias works', () => {
    expect(r.parse('toon klusje')).toEqual(
      { skillId: 'listOpen', args: { type: 'errand' } },
    );
  });
  it('empty body → onEmpty help', () => {
    expect(r.parse('list')).toEqual({ skillId: 'help', args: {} });
  });
});

describe('renderSlash — match body (done/remove)', () => {
  it('single-item', () => {
    expect(r.parse('done eggs')).toEqual(
      { skillId: 'markComplete', args: { match: 'eggs' } },
    );
  });
  it('multi-item', () => {
    expect(r.parse('done eggs and bread')).toEqual([
      { skillId: 'markComplete', args: { match: 'eggs' } },
      { skillId: 'markComplete', args: { match: 'bread' } },
    ]);
  });
});

describe('renderSlash — specials', () => {
  it('"what do we need" → listOpen shopping (fixed Call)', () => {
    expect(r.parse('what do we need?')).toEqual(
      { skillId: 'listOpen', args: { type: 'shopping' } },
    );
  });
  it('NL variant', () => {
    expect(r.parse('wat hebben we nodig vandaag?')).toEqual(
      { skillId: 'listOpen', args: { type: 'shopping' } },
    );
  });
});

describe('renderSlash — text-only body (F-SP2-a)', () => {
  const textOnly = renderSlash({
    app: 'demo',
    itemTypes: ['task'],
    operations: [
      {
        id: 'addTask',
        verb: 'add',
        surfaces: { slash: { command: '/task', match: {
          verbs:      ['task', 'taak'],
          body:       'text-only',
          splitItems: true,
          onEmpty:    { skillId: 'help', args: {} },
        }}},
      },
      {
        id: 'registerName',
        verb: 'register',
        surfaces: { slash: { command: '/register', match: {
          verbs:   ['register'],
          body:    'text-only',
          onEmpty: { skillId: 'help', args: {} },
        }}},
      },
    ],
  });

  it('single-item body becomes args.text', () => {
    expect(textOnly.parse('task paint the hallway')).toEqual(
      { skillId: 'addTask', args: { text: 'paint the hallway' } },
    );
  });
  it('multiword verb with text-only also works', () => {
    expect(textOnly.parse('register Frits')).toEqual(
      { skillId: 'registerName', args: { text: 'Frits' } },
    );
  });
  it('splitItems honoured', () => {
    expect(textOnly.parse('task buy paint and clean the brushes')).toEqual([
      { skillId: 'addTask', args: { text: 'buy paint' } },
      { skillId: 'addTask', args: { text: 'clean the brushes' } },
    ]);
  });
  it('quote keeps separators intact', () => {
    expect(textOnly.parse('task "buy paint, fresh" and brushes')).toEqual([
      { skillId: 'addTask', args: { text: 'buy paint, fresh' } },
      { skillId: 'addTask', args: { text: 'brushes' } },
    ]);
  });
  it('empty body → onEmpty fallback (help)', () => {
    expect(textOnly.parse('task')).toEqual({ skillId: 'help', args: {} });
    expect(textOnly.parse('register')).toEqual({ skillId: 'help', args: {} });
  });
  it('trailing punctuation stripped', () => {
    expect(textOnly.parse('register Frits!')).toEqual(
      { skillId: 'registerName', args: { text: 'Frits' } },
    );
  });
});

describe('renderSlash — none body (help)', () => {
  it('plain "help" returns help Call', () => {
    expect(r.parse('help')).toEqual({ skillId: 'help', args: {} });
  });
});

describe('renderSlash — trailing-verb pass (per-locale, opt-in)', () => {
  const trailFixture = {
    app: 'tasks',
    operations: [{
      id: 'completeTask', verb: 'complete',
      surfaces: { slash: { command: '/done', match: {
        verbs: ['done', 'klaar'], body: 'match', arg: 'id', trailing: 'complete',
      } } },
    }],
  };
  // nl deliberately carries the code-switched english "done".
  const LEX = { en: { complete: ['done', 'finished'] }, nl: { complete: ['klaar', 'gedaan', 'done'] } };

  it('matches the verb TRAILING the object when locale + lexicon are supplied', () => {
    const rs = renderSlash(trailFixture, { locale: 'en', trailLexicon: LEX });
    expect(rs.parse('the dishes done')).toEqual({ skillId: 'completeTask', args: { id: 'the dishes' } });
    expect(rs.parse('the dishes finished')).toEqual({ skillId: 'completeTask', args: { id: 'the dishes' } });
  });

  it('a LEADING verb still wins (leading pass runs first)', () => {
    const rs = renderSlash(trailFixture, { locale: 'en', trailLexicon: LEX });
    expect(rs.parse('done the dishes')).toEqual({ skillId: 'completeTask', args: { id: 'the dishes' } });
  });

  it('per-locale: nl trailing verbs incl. code-switched english', () => {
    const rs = renderSlash(trailFixture, { locale: 'nl', trailLexicon: LEX });
    expect(rs.parse('afwas klaar')).toEqual({ skillId: 'completeTask', args: { id: 'afwas' } });
    expect(rs.parse('afwas done')).toEqual({ skillId: 'completeTask', args: { id: 'afwas' } });
  });

  it('is INERT without opts — trailing not matched, leading unchanged (slash callers untouched)', () => {
    const rs = renderSlash(trailFixture);
    expect(rs.parse('the dishes done')).toBeNull();
    expect(rs.parse('done the dishes')).toEqual({ skillId: 'completeTask', args: { id: 'the dishes' } });
  });

  it('only single-word lexicon verbs trail, and a non-empty body is required', () => {
    const rs = renderSlash({ ...trailFixture }, { locale: 'en', trailLexicon: { en: { complete: ['done', 'all done'] } } });
    expect(rs.parse('milk done')).toEqual({ skillId: 'completeTask', args: { id: 'milk' } });
    expect(rs.parse('all done')).toEqual({ skillId: 'completeTask', args: { id: 'all' } });   // matches single 'done', body 'all'
  });
});
