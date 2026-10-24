/**
 * regexCommands.js — Path 2 fast path.
 *
 * Pure module.  Tries to parse `text` as a structured command per
 * the locked grammar in `grammar.md`.  Returns:
 *
 *   { skillId, args }            on a single match
 *   [{ skillId, args }, ...]     on a multi-item `add` (one entry per item)
 *   null                          when nothing matches — the agent
 *                                 falls through to the LLM (Phase 3).
 *
 * The bridge has already verified the message is addressed.  This
 * parser does not gate on that.
 *
 * English + Dutch verbs and type aliases are both supported per the
 * grammar table.  Case-insensitive on the verb; whitespace is
 * collapsed before matching.
 */

/**
 * Type alias → canonical ItemType.  Order matters only insofar as
 * collisions are concerned, and the grammar is unambiguous.
 *
 * "boodschappen" (plural) → shopping.  "boodschap" (singular) → errand.
 *  Both are in the grammar table; the regex below uses word
 *  boundaries, so "boodschappen" matches `boodschappen` and not
 *  `boodschap`.
 *
 * @type {Record<string, import('../types.js').ItemType>}
 */
const TYPE_ALIASES = {
  // shopping
  shopping:     'shopping',
  groceries:    'shopping',
  buy:          'shopping',
  boodschappen: 'shopping',
  winkel:       'shopping',
  // errand
  errand:       'errand',
  task:         'errand',
  todo:         'errand',
  klusje:       'errand',
  boodschap:    'errand',
  // repair
  repair:       'repair',
  fix:          'repair',
  reparatie:    'repair',
  repareren:    'repair',
  // schedule
  schedule:     'schedule',
  event:        'schedule',
  appointment:  'schedule',
  agenda:       'schedule',
  afspraak:     'schedule',
};

// Verb synonyms.  All are matched case-insensitively.  Multi-word
// verbs (`voeg toe`) are matched as phrases below.
const ADD_VERBS_SINGLE = ['add', 'toevoegen', 'noteer'];
const ADD_VERBS_PHRASE = [['voeg', 'toe']];                       // `voeg toe`

const LIST_VERBS = ['list', 'show', 'lijst', 'toon'];

const DONE_VERBS = [
  'done', 'complete', 'bought', 'did', 'finished',
  'klaar', 'gedaan', 'gekocht',
];

const REMOVE_VERBS = [
  'remove', 'delete', 'cancel', 'nope',
  'verwijder', 'weg',
];


// "what do we need [in/at <where>]?" / "wat hebben we nodig [in/op <waar>]?"
// Both forms always map to listOpen({ type: 'shopping' }).
const WHAT_DO_WE_NEED_RE =
  /^(?:what\s+do\s+we\s+need|wat\s+hebben\s+we\s+nodig)\b.*$/i;

// Addressed-mode prefix.  Strip ONE leading prefix.  The grammar
// names three: `@Household ` (case-insensitive), `/`, `!`.
const ADDRESSED_PREFIX_RE = /^(?:@household\s+|\/|!)/i;

// Trailing punctuation we strip (after splitting items, per item).
const TRAILING_PUNCT_RE = /[!?.,;:]+$/;

/**
 * @param {string} text
 * @returns {{ skillId: string, args: object } | Array<{ skillId: string, args: object }> | null}
 */
export function regexParse(text) {
  if (typeof text !== 'string') return null;

  // Whitespace-collapse + trim.
  let s = text.replace(/\s+/g, ' ').trim();
  if (!s) return null;

  // Strip ONE leading prefix.
  s = s.replace(ADDRESSED_PREFIX_RE, '').trim();
  if (!s) return null;

  // The "what do we need" form is special — match anywhere on the
  // line and ignore the suffix.
  if (WHAT_DO_WE_NEED_RE.test(s)) {
    return { skillId: 'listOpenItems', args: { type: 'shopping' } };
  }

  // Try multi-word add verbs first ("voeg toe").
  for (const phrase of ADD_VERBS_PHRASE) {
    const re = new RegExp(`^${phrase.join('\\s+')}\\b\\s*(.*)$`, 'i');
    const m = s.match(re);
    if (m) return parseAdd(m[1] ?? '');
  }

  // Single-word add verbs.
  for (const v of ADD_VERBS_SINGLE) {
    const re = new RegExp(`^${escapeRe(v)}\\b\\s*(.*)$`, 'i');
    const m = s.match(re);
    if (m) return parseAdd(m[1] ?? '');
  }

  // List verbs.
  for (const v of LIST_VERBS) {
    const re = new RegExp(`^${escapeRe(v)}\\b\\s*(.*)$`, 'i');
    const m = s.match(re);
    if (m) return parseList(m[1] ?? '');
  }

  // Done verbs.
  for (const v of DONE_VERBS) {
    const re = new RegExp(`^${escapeRe(v)}\\b\\s*(.*)$`, 'i');
    const m = s.match(re);
    if (m) return parseMatchVerb('markComplete', m[1] ?? '');
  }

  // Remove verbs.
  for (const v of REMOVE_VERBS) {
    const re = new RegExp(`^${escapeRe(v)}\\b\\s*(.*)$`, 'i');
    const m = s.match(re);
    if (m) return parseMatchVerb('removeItem', m[1] ?? '');
  }

  // Help verbs.

  // Unknown leading word — fall through to the LLM.
  return null;
}

/**
 * `add` body parser.  Extracts the optional type-alias prefix and
 * splits the remaining text into one or more items.
 *
 * @param {string} body  the text after the verb
 * @returns {{ skillId: 'addItem', args: { type: string, text: string } }
 *          | Array<{ skillId: 'addItem', args: { type: string, text: string } }>
 *          | null}
 */
function parseAdd(body) {
  const trimmed = body.trim();
  if (!trimmed) return null;

  const { type, rest } = peelType(trimmed);
  if (!rest) return null;

  const items = splitItems(rest);
  if (items.length === 0) return null;

  if (items.length === 1) {
    return { skillId: 'addItem', args: { type, text: items[0] } };
  }
  return items.map((t) => ({
    skillId: 'addItem',
    args: { type, text: t },
  }));
}

/**
 * `list <type>` body parser.  Empty body → null, nothing to do (per the grammar's
 * "edge cases — just the verb").
 *
 * @param {string} body
 */
function parseList(body) {
  const trimmed = body.trim().replace(TRAILING_PUNCT_RE, '').trim();
  if (!trimmed) return null;
  const { type } = peelType(trimmed);
  return { skillId: 'listOpenItems', args: { type } };
}

/**
 * Body parser for verbs that take a single `match` argument
 * (`done`, `remove`).  Empty body → null.
 *
 * @param {'markComplete'|'removeItem'} skillId
 * @param {string} body
 */
function parseMatchVerb(skillId, body) {
  const trimmed = body.trim().replace(TRAILING_PUNCT_RE, '').trim();
  if (!trimmed) return null;

  // Multi-item form (`bought eggs and bread`) — return an array of
  // skill calls so the agent can fan them out.
  const items = splitItems(trimmed);
  if (items.length === 1) {
    return { skillId, args: { match: items[0] } };
  }
  return items.map((m) => ({ skillId, args: { match: m } }));
}

/**
 * Peel the optional type-alias prefix off `s`.  Returns the
 * canonical `type` and the remaining text.  When `s` doesn't start
 * with a type alias, defaults to `shopping` and leaves `s` intact.
 *
 * @param {string} s
 * @returns {{ type: import('../types.js').ItemType, rest: string }}
 */
function peelType(s) {
  // Match the first whitespace-delimited word.
  const m = s.match(/^(\S+)(?:\s+(.*))?$/);
  if (!m) return { type: 'shopping', rest: '' };

  const first = m[1].toLowerCase().replace(TRAILING_PUNCT_RE, '');
  const aliased = TYPE_ALIASES[first];
  if (aliased) {
    return { type: aliased, rest: (m[2] ?? '').trim() };
  }
  return { type: 'shopping', rest: s.trim() };
}

/**
 * Split a body into items on `,`, ` and `, ` en `.  Quoted
 * substrings ("...") are kept whole.  Trailing punctuation is
 * stripped from each item.  Empty items are dropped.
 *
 * @param {string} body
 * @returns {string[]}
 */
function splitItems(body) {
  // Handle quotes: anything inside double quotes is one item.
  // We do a single linear scan so we don't accidentally split on a
  // separator that lives inside quotes.
  const parts = [];
  let cur = '';
  let i = 0;
  while (i < body.length) {
    const ch = body[i];

    if (ch === '"') {
      // Read up to the closing quote (or end of string).
      const end = body.indexOf('"', i + 1);
      if (end === -1) {
        // Unterminated quote — keep everything as one chunk.
        cur += body.slice(i + 1);
        i = body.length;
      } else {
        cur += body.slice(i + 1, end);
        i = end + 1;
      }
      continue;
    }

    if (ch === ',') {
      parts.push(cur);
      cur = '';
      i += 1;
      continue;
    }

    // ` and ` / ` en ` separators — only at word boundaries with
    // surrounding spaces.
    const tail = body.slice(i);
    const andM = tail.match(/^\s+and\s+/i);
    if (andM) {
      parts.push(cur);
      cur = '';
      i += andM[0].length;
      continue;
    }
    const enM = tail.match(/^\s+en\s+/i);
    if (enM) {
      parts.push(cur);
      cur = '';
      i += enM[0].length;
      continue;
    }

    cur += ch;
    i += 1;
  }
  parts.push(cur);

  return parts
    .map((p) => p.trim().replace(TRAILING_PUNCT_RE, '').trim())
    .filter((p) => p.length > 0);
}

/**
 * Escape `s` for use as a literal in a RegExp.
 * @param {string} s
 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
