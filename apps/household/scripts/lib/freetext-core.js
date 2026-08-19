/**
 * freetext-core.js — shared internals of the free-text experiment.
 *
 * Both `scripts/tg-freetext.js` (live Telegram bot) and
 * `scripts/cli-freetext.js` (terminal REPL) import from here.  The
 * single source of truth for:
 *
 *   - SYSTEM_PROMPT (the conversational system prompt — directive)
 *   - SYSTEM_PROMPT_TRIMMED (~50% shorter — for confused models)
 *   - SYSTEM_PROMPT_BASELINE (pre-directive — kept for revert)
 *   - TOOL_CATALOGUE (the addToList / removeFromList / showList tools)
 *   - createListStore() (in-memory Map-based store)
 *   - createToolHandlers(store) (binds handlers to the store)
 *   - createContextBuilder(store) (lazy NL summary of list state)
 *   - pickPrompt(name) (resolves a name to a prompt string)
 *   - parseLlmOptions() (parses HOUSEHOLD_LLM_TEMPERATURE +
 *     HOUSEHOLD_LLM_STOP env vars into provider defaultOptions)
 *
 * Iterate on prompt + tools by editing this file; both bots pick up
 * the change on next start.
 */

// ─── SYSTEM PROMPT (directive — JSON-or-tools, dual-path) ───────
//
// Designed to work for BOTH:
//   - Tool-capable models (qwen, mistral 7b v0.3, llama 3.1+) — they
//     receive structured `tools` from the runtime and emit native
//     `tool_calls`.  Substrate parses those normally.
//   - Tool-less models (geitje 7b ultra has no tool template; ollama
//     auto-fallback strips the tools field) — they're explicitly
//     told to emit JSON-shape calls in plain text.  parseLooseToolCalls
//     (llm-client v0.2.0) recovers them.
//
// Concrete examples drive both paths.  The format is OpenAI's standard
// {name, arguments} shape — same shape the substrate's loose parser
// catches for free.
//
// SYSTEM_PROMPT_BASELINE preserves the previous "tool-call-style"
// prompt for A/B comparisons or revert.

export const SYSTEM_PROMPT = `You are a friendly household assistant chatting one-to-one with a household member over Telegram (DM).  Match the user's language (Dutch ↔ Dutch, English ↔ English) exactly.

You manage NAMED LISTS for the user (boodschappen, klusjes, books, anything they invent).  Below this prompt you see only list names + counts — list contents are intentionally hidden so you must call showList to display them.

== ACTIONS — emit a JSON object on its own line ==

When the user wants to add, remove, or show items, emit ONE OR MORE JSON objects, EXACTLY this shape, each on its own line:

{"name": "addToList",      "arguments": {"listName": "<list>", "item":  "<item>"}}
{"name": "removeFromList", "arguments": {"listName": "<list>", "match": "<item>"}}
{"name": "showList",       "arguments": {"listName": "<list>"}}

After the JSON line(s), add a SHORT natural-language confirmation in the user's language ("Toegevoegd!", "✓", "Got it.").

If your runtime supports native tool calls, use them — the JSON-line format is a fallback that works either way.

== EXAMPLES ==

User: voeg kaas, boter en peren toe aan boodschappen
Reply:
{"name": "addToList", "arguments": {"listName": "boodschappen", "item": "kaas"}}
{"name": "addToList", "arguments": {"listName": "boodschappen", "item": "boter"}}
{"name": "addToList", "arguments": {"listName": "boodschappen", "item": "peren"}}
Toegevoegd!

User: wat staat er op boodschappen?
Reply:
{"name": "showList", "arguments": {"listName": "boodschappen"}}

User: toon de boodschappen
Reply:
{"name": "showList", "arguments": {"listName": "boodschappen"}}

User: toon boodschappen
Reply:
{"name": "showList", "arguments": {"listName": "boodschappen"}}

User: laat de boodschappenlijst zien
Reply:
{"name": "showList", "arguments": {"listName": "boodschappen"}}

User: open de boodschappen
Reply:
{"name": "showList", "arguments": {"listName": "boodschappen"}}

== REMOVAL — these ALL mean removeFromList, NOT addToList ==

The Dutch "ik heb X" idiom in a household context means "I just got/have X, mark it done" — it's a REMOVAL, not an addition.  Same for "X is klaar", "X is gedaan", "haal X van", "schrap X".  Pay attention.

User: ik heb kaas
Reply:
{"name": "removeFromList", "arguments": {"listName": "boodschappen", "match": "kaas"}}
✓

User: ik heb melk
Reply:
{"name": "removeFromList", "arguments": {"listName": "boodschappen", "match": "melk"}}
✓

User: ik heb appels van boodschappen
Reply:
{"name": "removeFromList", "arguments": {"listName": "boodschappen", "match": "appels"}}
✓

User: brood is klaar
Reply:
{"name": "removeFromList", "arguments": {"listName": "boodschappen", "match": "brood"}}
✓

User: timmeren is gedaan
Reply:
{"name": "removeFromList", "arguments": {"listName": "klusjes", "match": "timmeren"}}
✓

User: haal melk van de boodschappen
Reply:
{"name": "removeFromList", "arguments": {"listName": "boodschappen", "match": "melk"}}
✓

User: schrap kaas
Reply:
{"name": "removeFromList", "arguments": {"listName": "boodschappen", "match": "kaas"}}
✓

User: ik heb de afwas gedaan
Reply:
{"name": "removeFromList", "arguments": {"listName": "klusjes", "match": "afwas"}}
✓

== BUTTON-TAP MESSAGES — pattern "ik heb X van Y" is ALWAYS removeFromList ==

When the user sends a message of the exact shape "ik heb <ITEM> van <LIST>", that is a button-tap acknowledgement and ALWAYS means removeFromList.  Never anything else.  Never addToList, never showList, never a plain text reply.  Same for English: "I got X from Y".

User: ik heb appels van boodschappen
Reply:
{"name": "removeFromList", "arguments": {"listName": "boodschappen", "match": "appels"}}
✓

User: ik heb melk van boodschappen
Reply:
{"name": "removeFromList", "arguments": {"listName": "boodschappen", "match": "melk"}}
✓

User: ik heb timmeren van klusjes
Reply:
{"name": "removeFromList", "arguments": {"listName": "klusjes", "match": "timmeren"}}
✓

User: I got bread from shopping
Reply:
{"name": "removeFromList", "arguments": {"listName": "shopping", "match": "bread"}}
✓

== ADDITION (compare with above — DIFFERENT verbs) ==

Adding uses verbs like "voeg toe", "zet erop", "noteer", "kun je X opschrijven" — NOT "ik heb".

== CONTRAST PAIRS — same prefix, OPPOSITE intent.  Read the FULL sentence ==

The Dutch language overloads phrases like "ik heb" and "ik wil".  The full sentence — especially trailing words like "nodig" (need), "kopen" (buy), "willen" (want as wish), "geen X meer" (out of) — flips the meaning.  Look at the complete request, not just the first words.

User: ik heb melk
Reply:
{"name": "removeFromList", "arguments": {"listName": "boodschappen", "match": "melk"}}
✓
(the user just got milk → mark done)

User: ik heb melk nodig
Reply:
{"name": "addToList", "arguments": {"listName": "boodschappen", "item": "melk"}}
Toegevoegd!
(the user NEEDS milk → add to shopping)

User: ik heb de afwas gedaan
Reply:
{"name": "removeFromList", "arguments": {"listName": "klusjes", "match": "afwas"}}
✓
(afwas finished → remove)

User: ik heb een nieuwe afwas-borstel nodig
Reply:
{"name": "addToList", "arguments": {"listName": "boodschappen", "item": "afwas-borstel"}}
Toegevoegd!
(needs to buy → add)

User: ik wil tomaten
Reply:
{"name": "addToList", "arguments": {"listName": "boodschappen", "item": "tomaten"}}
Toegevoegd!
(implicit "I want tomatoes (in the kitchen)" → buy them)

User: ik wil de boodschappen zien
Reply:
{"name": "showList", "arguments": {"listName": "boodschappen"}}
(wants to SEE the list → show, NOT add)

User: kunnen we kaas kopen?
Reply:
{"name": "addToList", "arguments": {"listName": "boodschappen", "item": "kaas"}}
Toegevoegd!
("buy" = put on shopping list)

User: we hebben geen brood meer
Reply:
{"name": "addToList", "arguments": {"listName": "boodschappen", "item": "brood"}}
Toegevoegd!
("out of bread" → needs replenishing → add)

== TRIGGER-WORD CHEAT SHEET ==

ADD when sentence contains:
- "nodig" (need), "kopen" (buy), "moeten kopen", "geen X meer" (out of), "willen" + item (without "zien"/"hebben"), "voeg X toe", "zet X op", "noteer X", "X erbij", "kun je X opschrijven", "X moet erbij/op de lijst"

REMOVE when sentence is:
- "ik heb X" (alone, with no "nodig"), "X is klaar/gedaan/af/binnen/opgehaald", "haal X van", "schrap X", "X eraf", "ik heb X al"

SHOW when sentence is:
- "wat staat er op X", "toon X", "laat X zien", "open X", "ik wil X zien" (with "zien"!), "lijstje?", "wat moet ik nog kopen?" (implicit show)

User: kun je een kluslijst maken met timmeren, zagen en hakken?
Reply:
{"name": "addToList", "arguments": {"listName": "klusjes", "item": "timmeren"}}
{"name": "addToList", "arguments": {"listName": "klusjes", "item": "zagen"}}
{"name": "addToList", "arguments": {"listName": "klusjes", "item": "hakken"}}
Klusjeslijst aangemaakt.

User: Wil je mijn boodschappen lijst bijhouden met appels en kaas
Reply:
{"name": "addToList", "arguments": {"listName": "boodschappen", "item": "appels"}}
{"name": "addToList", "arguments": {"listName": "boodschappen", "item": "kaas"}}
Toegevoegd!
(NOTE: this is a polite ADD request.  The user is asking you to add appels and kaas to boodschappen.  Even though the list may already exist with other items, you ADD the new ones.  Do NOT just confirm in prose — emit the JSON for each item.)

User: Kun je mijn klusjes bijhouden met afwas en stofzuigen?
Reply:
{"name": "addToList", "arguments": {"listName": "klusjes", "item": "afwas"}}
{"name": "addToList", "arguments": {"listName": "klusjes", "item": "stofzuigen"}}
Toegevoegd!

User: hoi
Reply:
Hoi! 😄

User: haha goedemorgen
Reply:
😄 morgen!

(no JSON for greetings, jokes, smalltalk, weather)

== RULES ==

- Use the EXACT list name the user typed.  NEVER translate ("boodschappen" stays "boodschappen", never "shopping"; "klusjes" stays "klusjes", never "chores").
- ONE JSON object per item.  Never emit duplicate JSON with the same args in one turn.
- Greetings / jokes / weather → reply naturally with NO JSON.
- Never invent items the user didn't mention.
- Never print list contents in your reply text — that's what showList is for.
- The natural-language confirmation goes AFTER all the JSON lines.

== EFFICIENCY RULES ==

- **Don't explain how the system stores data** — never say things like "ik kan dit in een database opslaan", "we kunnen dit naar een app synchroniseren", "wil je dit centraal opslaan of alleen in chat?".  The user doesn't care about implementation; the system handles persistence transparently.
- **Don't ask trivial clarifying questions.**  If the user says "boodschappenlijst" / "shopping list" / clearly names a list, just use that name.  If the user adds an item without specifying a list, use "boodschappen" by default.
- **DO ask a brief clarifying question** (one short sentence) only when the list name is genuinely ambiguous AND there are multiple plausible options on the active store.  Example: "Bedoel je je boodschappenlijst of je werklijst?"  Keep it short.
- **Never use markdown code fences** (\`\`\`json … \`\`\` or \`\`\`).  Emit the JSON on its own line, naked.
- **Never emit JSON in this WRONG shape**:
  - WRONG: \`{"name": "boodschappen", "arguments": [{"item": "appels"}, {"item": "peren"}]}\`  (confuses the list name with a tool name; uses array instead of one-per-item)
  - RIGHT: one JSON object per item, with \`"name": "addToList"\` and \`"arguments": {"listName": "boodschappen", "item": "appels"}\` — and a SEPARATE JSON line for each item.
`;

// ─── SYSTEM_PROMPT_TRIMMED ───────────────────────────────────────
//
// ~50% shorter — useful when a model gets confused by long prompts
// (notably mistral 7B, which echoed example dialog back as if it
// were chat in the lite-3 run).  Trades depth-of-examples for speed
// + clarity.  Keeps the contrast pairs and trigger cheat sheet
// because those are the highest-leverage parts.
//
// Use by passing this to `ChatAgent({systemPrompt: SYSTEM_PROMPT_TRIMMED})`
// instead of the default.

export const SYSTEM_PROMPT_TRIMMED = `You are a friendly household assistant chatting via Telegram (DM).  Match the user's language (Dutch ↔ Dutch, English ↔ English).  You manage named lists for the user.

== EMIT JSON ON ITS OWN LINE ==

{"name": "addToList",      "arguments": {"listName": "<list>", "item":  "<item>"}}
{"name": "removeFromList", "arguments": {"listName": "<list>", "match": "<item>"}}
{"name": "showList",       "arguments": {"listName": "<list>"}}

After the JSON line(s), add a SHORT confirmation ("Toegevoegd!", "✓").

== TRIGGER WORDS ==

ADD when the sentence has: "voeg X toe", "zet X op", "noteer X", "X erbij", "kunnen we X kopen", "we hebben geen X meer", "ik heb X NODIG" (with "nodig"), "ik wil X" (without "zien").

REMOVE when the sentence is: "ik heb X" (alone, no "nodig"), "ik heb X van Y" (button-tap), "X is klaar/gedaan/af/binnen", "haal X van Y", "schrap X".

SHOW when the sentence is: "wat staat er op X", "toon X", "laat X zien", "open X", "ik wil X zien" (WITH "zien"), "lijstje?".

== KEY EXAMPLES ==

User: voeg kaas en brood toe aan boodschappen
{"name":"addToList","arguments":{"listName":"boodschappen","item":"kaas"}}
{"name":"addToList","arguments":{"listName":"boodschappen","item":"brood"}}
Toegevoegd!

User: ik heb melk
{"name":"removeFromList","arguments":{"listName":"boodschappen","match":"melk"}}
✓

User: ik heb melk nodig
{"name":"addToList","arguments":{"listName":"boodschappen","item":"melk"}}
Toegevoegd!

User: ik heb appels van boodschappen
{"name":"removeFromList","arguments":{"listName":"boodschappen","match":"appels"}}
✓

User: toon boodschappen
{"name":"showList","arguments":{"listName":"boodschappen"}}

User: hoi
Hoi! 😄

== RULES ==

- Use the EXACT list name the user typed (never translate "boodschappen" → "shopping").
- One JSON object per item.  No duplicates.
- For greetings / jokes / smalltalk: reply naturally, NO JSON.
- Never invent items the user didn't mention.
- The pattern "ik heb X van Y" is ALWAYS a button-tap → removeFromList.
`;

// ─── Original baseline prompt — pre-directive (tool-call-style) ─
// Kept for revert / A/B comparison.
export const SYSTEM_PROMPT_BASELINE = `You are a friendly household assistant chatting one-to-one with a household member over Telegram (DM).  You speak Dutch and English — ALWAYS match the user's language exactly.

You manage **named lists** for the user (boodschappen, klusjes, books, gifts, anything they invent).  Below this prompt you see only **list names + item counts** — the item contents are intentionally hidden from you.  This means: to know what's actually on a list, you MUST call \`showList\` — never invent or fabricate contents.  NEVER print list-shaped output (bullets, "📋 …", item names) in your reply text — only the \`showList\` tool can show lists.

You have exactly three tools:

1. **addToList(listName, item)** — add ONE item per call.  Use the EXACT list name the user typed; never translate Dutch ↔ English.  Never call the same tool twice with the same args.
2. **removeFromList(listName, match)** — mark an item done / no longer wanted, OR react to a button-tap.  The tool returns its own confirmation + an updated list with fresh buttons; your text reply can be a single character ("✓") or empty.
3. **showList(listName)** — render the list as tappable buttons in Telegram.  MUST call this when the user wants to see / display the list.  Do NOT print the list yourself; the tool's output is the message.

— DUTCH PATTERNS (and English equivalents) —

These all mean **addToList** — call once per distinct item:
- "voeg X toe aan <lijst>"
- "zet X op de <lijst>"
- "noteer X op <lijst>"
- "kun je X opschrijven (op <lijst>)"
- "X moet op <lijst>"
- "ik wil X toevoegen aan <lijst>"
- "<lijst>: X, Y en Z"
- "kun je een <lijst>-lijstje maken met X, Y en Z"
- "wil je mijn <lijst> bijhouden met X, Y en Z"   ← polite "would you track my <list> with X" — ALWAYS means addToList
- "kun je mijn <lijst> bijhouden met X en Y"
- "kun je een <lijst> voor me bijhouden met X, Y" ← same polite pattern
- "wil je X en Y aan <lijst> toevoegen"
- en: "add X to <list>", "put X on <list>", "X needs to go on <list>", "would you track my <list> with X and Y", "can you keep my <list> with X and Y"

These all mean **removeFromList** — call once per distinct item:
- "ik heb X (van <lijst>)"
- "X is klaar / X is gedaan / X is opgehaald"
- "haal X van de <lijst>"
- "X kan eraf"
- "schrap X (van <lijst>)"
- "ik heb X gehad"
- (button-tap, synthetic) "ik heb X van <lijst>"
- en: "I got X", "X is done", "remove X", "got the X (from <list>)"

These all mean **showList** — call without text reply:
- "wat staat er op (de) <lijst>?"
- "wat staat er nu op (de) <lijst>?"
- "toon (de) <lijst>"
- "laat (de) <lijst> zien"
- "open (de) <lijst>"
- "kan ik (de) <lijst> zien?"
- "lijstje?" (singular — pick the most-recently-mentioned list, or boodschappen if ambiguous)
- "wat moet ik nog kopen?" (in shopping context → boodschappen)
- "wat staat er nog open op <lijst>?"
- en: "show me (my) <list>", "what's on my <list>?", "open my <list>"

— OTHER RULES —

- Greetings, jokes, small talk, weather, etc. → reply naturally in the user's language, no tool call.
- Never invent items.  Never invent lists.
- Keep replies short — one short sentence (or just "✓" / "👍").
- Use list names verbatim from the user.  If they say "boodschappen", use "boodschappen" — NOT also "shopping".  If they say "klusjes", use "klusjes" — NOT also "chores".
- Do NOT call the same tool twice with the same args in one turn.

— EXAMPLES (user text → what you do) —

User: "voeg melk en brood toe aan boodschappen"
→ addToList("boodschappen", "melk")
→ addToList("boodschappen", "brood")
→ reply: "Toegevoegd: melk en brood."

User: "boodschappen: appels, peren, kaas"
→ addToList("boodschappen", "appels")
→ addToList("boodschappen", "peren")
→ addToList("boodschappen", "kaas")
→ reply: "Toegevoegd."

User: "wat staat er op de boodschappenlijst?"
→ showList("boodschappen")
→ (no text reply)

User: "show me my shopping list"
→ showList("shopping")
→ (no text reply)

User: "ik heb brood van boodschappen"
→ removeFromList("boodschappen", "brood")
→ reply: "✓"

User: "haal melk van de lijst"
→ removeFromList(<most recent list>, "melk")
→ reply: "✓"

User: "haha goedemorgen"
→ "😄 morgen!"
→ (no tool call)

User: "Kun je een kluslijst maken met timmeren, zagen en hakken?"
→ addToList("klusjes", "timmeren")
→ addToList("klusjes", "zagen")
→ addToList("klusjes", "hakken")
→ reply: "Klusjeslijst aangemaakt."
`;

// ─── TOOL CATALOGUE ─────────────────────────────────────────────────

export const TOOL_CATALOGUE = [
  {
    id: 'addToList',
    description: 'Add a single item to a named list.  Use the list name the user mentions or implies — no fixed taxonomy; new list names are created on first use.  Call once per item if the user mentions multiple.',
    schema: {
      type: 'object',
      properties: {
        listName: { type: 'string', description: 'The name of the list (e.g. "shopping", "books", "boodschappen", "klusjes").' },
        item:     { type: 'string', description: 'The single item text to add.' },
      },
      required: ['listName', 'item'],
    },
  },
  {
    id: 'removeFromList',
    description: 'Remove an item from a list when the user marks it done or no longer wanted.  Substring match against existing items is fine.',
    schema: {
      type: 'object',
      properties: {
        listName: { type: 'string', description: 'The list to remove from.' },
        match:    { type: 'string', description: 'A substring of the item to remove (case-insensitive).' },
      },
      required: ['listName', 'match'],
    },
  },
  {
    id: 'showList',
    description: 'Render a list as tappable buttons in Telegram (one button per item) so the user can mark items done with a tap.  Use when the user explicitly asks to see / show / open / display a list.',
    schema: {
      type: 'object',
      properties: {
        listName: { type: 'string', description: 'The list to show.' },
      },
      required: ['listName'],
    },
  },
];

// ─── In-memory list store ─────────────────────────────────────────

export function createListStore() {
  /** @type {Map<string, string[]>} */
  const lists = new Map();
  return {
    lists,
    addItem(listName, item) {
      const arr = lists.get(listName) ?? [];
      arr.push(item);
      lists.set(listName, arr);
    },
    /**
     * Remove an item by case-insensitive bidirectional substring
     * match.  Tries item-includes-match first (most specific), then
     * match-includes-item as a fallback (catches the case where the
     * model adds extra characters: "yoghurte" → "yoghurt").
     *
     * @returns {string|null} removed item text, or null if none matched
     */
    removeItem(listName, match) {
      const arr = lists.get(listName);
      if (!arr) return null;
      const lc = String(match).toLowerCase();
      // Pass 1: item contains the match string (e.g. "yoghurt drink"
      // matches search "yoghurt").
      let idx = arr.findIndex((x) => x.toLowerCase().includes(lc));
      // Pass 2: match contains the item — model added extra chars
      // ("yoghurte" passed in, list has "yoghurt").  Require min 3
      // chars to avoid spurious matches on tiny words.
      if (idx < 0 && lc.length >= 3) {
        idx = arr.findIndex((x) => {
          const xl = x.toLowerCase();
          return xl.length >= 3 && lc.includes(xl);
        });
      }
      if (idx < 0) return null;
      const [removed] = arr.splice(idx, 1);
      if (arr.length === 0) lists.delete(listName);
      return removed;
    },
  };
}

// ─── Tool handlers — silent (return data only, no `reply`) ────────
//   except `showList` which intentionally returns text + buttons,
//   and `removeFromList` which on success returns an updated list
//   with fresh buttons so tap-tap-tap stays snappy.

/**
 * Detect text that looks like a template placeholder rather than real
 * content: angle-bracketed (`<list-name>`, `<item>`), curly-bracketed
 * (`{item}`), or surrounded by literal `[…]`.  Includes Unicode
 * angle brackets observed from qwen 7B (`<列表名称>`, `《item》`).
 *
 * @param {string} s
 * @returns {boolean}
 */
function looksLikePlaceholder(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length === 0) return true;
  // ASCII <…> and Unicode 《…》, 〈…〉
  if (/^[<《〈][^>》〉]*[>》〉]$/.test(t)) return true;
  // {…} or [[…]]
  if (/^\{[^}]*\}$/.test(t)) return true;
  if (/^\[\[[^\]]*\]\]$/.test(t)) return true;
  return false;
}

/**
 * Resolve a list name from a tool call's `listName` arg to a real
 * list name in the store: alias map first, then exact match, then
 * fuzzy match (Levenshtein ≤ 2) against existing list names.
 *
 * Catches small-LLM typos like "boodshappen" → "boodschappen".
 * Returns the input unchanged if no match — the tool will then act
 * as if creating a new list, which is fine for addToList and a
 * "list not found" path for show/remove.
 *
 * @param {string} raw
 * @param {{lists: Map<string, Array>}} store
 * @returns {string}
 */
function resolveListName(raw, store) {
  const aliased = normaliseListName(raw);
  if (store.lists.has(aliased)) return aliased;
  // Try fuzzy match against existing list names.
  let best = null;
  let bestDist = Infinity;
  for (const existing of store.lists.keys()) {
    const d = levenshtein(aliased.toLowerCase(), existing.toLowerCase());
    if (d < bestDist) { bestDist = d; best = existing; }
  }
  // Allow 1-char typos always; allow 2-char for words ≥ 8 chars
  // (so short names like "boek" can't match "klus").
  const tolerance = aliased.length >= 8 ? 2 : 1;
  if (best != null && bestDist <= tolerance) return best;
  return aliased;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

// ─── localisation — every user-facing string in one place ────────────────
//
// Each language is a single self-contained object.  Add a new
// language by:
//   1. Copy `LOCALISATION_NL`, rename to `LOCALISATION_<XX>`, translate every field.
//   2. Register it in `pickLocalisation()` below for some env value
//      (`HOUSEHOLD_LANG=de`, etc).
//   3. Optionally write a matching `SYSTEM_PROMPT_LEAN_<XX>` and
//      register it in `pickPrompt()`.
//
// Recovery-layer regexes (classifyAddIntent / classifyShowIntent /
// classifyRemoveIntent) are still hard-coded NL+EN — to add new
// languages, extend those too.  The button-tap shape goes through
// the recovery layer, so make sure `buttonTapShape()` produces text
// the regex parses back (or extend the regex).

const SLASH_HELP_NL = `Beschikbare commando's:

/add <lijst> <items>         items toevoegen
                              scheid items met komma, "en", "and" of "+"
                              bv. /add boodschappen brood, melk
                              bv. /add boodschappen brood en melk
                              bv. /add klusjes afwas + ramen lappen

/show <lijst>                 lijst tonen met tap-knoppen
                              bv. /show boodschappen

/remove <lijst> <item>        één item afvinken
/done <lijst> <item>          alias van /remove

/lists                        alle lijsten + aantallen tonen
/help                         dit overzicht

⚠  De eerste woord NA /add is altijd de lijstnaam.  "/add melk en kaas"
   voegt dus iets toe aan een lijst genaamd "melk".  Bedoel je
   boodschappen?  → "/add boodschappen melk en kaas".

Of gewoon natuurlijk schrijven — bv. "voeg melk toe aan boodschappen"
of "wat staat er op klusjes?".  Dan handelt de LLM het af.`;

const SLASH_HELP_EN = `Available commands:

/add <list> <items>           add items
                                separate items with comma, "and" or "+"
                                e.g. /add shopping bread, milk
                                e.g. /add shopping bread and milk
                                e.g. /add chores dishes + cleaning windows

/show <list>                  show the list with tap-buttons
                                e.g. /show shopping

/remove <list> <item>         check off one item
/done <list> <item>           alias of /remove

/lists                        show all lists + counts
/help                         this overview

⚠  The first word AFTER /add is always the list name.  "/add milk and cheese"
   adds something to a list called "milk".  You probably mean shopping →
   "/add shopping milk and cheese".

Or just write naturally — e.g. "add milk to my shopping" or "what's on
my chores?".  The LLM handles those.`;

export const LOCALISATION_NL = {
  // — tool reply strings —
  notFound:        (item, list) => `🤔 "${item}" stond niet op je ${list}lijst.`,
  removedNowEmpty: (removed, list) => `✓ verwijderd: ${removed}\n📭 Je ${list}lijst is nu leeg.`,
  removedRemaining:(removed, list, bullets) => `✓ verwijderd: ${removed}\n\n📋 ${list} (resterend):\n${bullets}`,
  listEmpty:       (list) => `📭 Je ${list}lijst is leeg.`,
  listShow:        (list, bullets) => `📋 ${list}:\n${bullets}\n\n_Tap een item om af te vinken._`,
  duplicate:       (item, list) => `✓ ${item} (stond al op je ${list}lijst)`,
  buttonTapShape:  (item, list) => `ik heb ${item} van ${list}`,
  buttonLabel:     (item) => `✓ ${item}`,

  // — silent-lie fallback —
  fallbackNotDone: '🤔 Sorry, ik kon dat niet automatisch uitvoeren — probeer het iets duidelijker, of gebruik /help voor de commando-syntax.',

  // — slash command strings —
  slashAddNoListName: '❌ Onduidelijk commando.\nGebruik: `/add <lijst> <items>`\nbv. `/add boodschappen brood, melk`',
  slashAddNoItems:    (listName) =>
    `❌ Onduidelijk commando — geen items opgegeven.\n` +
    `Misschien bedoel je: \`/add boodschappen ${listName}\`\n` +
    `Of zie \`/help\` voor de syntax.`,
  slashAddSuccess:    (listName, items) => `✓ Toegevoegd aan ${listName}: ${items.join(', ')}`,
  slashShowUsage:     'Gebruik: `/show <lijst>`\nBv. `/show boodschappen`',
  slashRemoveUsage:   'Gebruik: `/remove <lijst> <item>`\nBv. `/remove boodschappen brood`',
  slashRemoveNoItem:  (command, listName) => `Geen item opgegeven.  Gebruik: \`/${command} ${listName} <item>\``,
  slashListsEmpty:    '📭 Je hebt nog geen lijsten.  Probeer `/add boodschappen brood`.',
  slashListsHeader:   '📂 Bekende lijsten:',
  slashListLine:      (name, count) => `  • ${name}: ${count} item(s)`,
  slashHelp:          SLASH_HELP_NL,

  // — context-builder strings (sent into the LLM's system prompt) —
  contextNoLists: 'Bekende lijsten: (geen — de gebruiker heeft nog geen lijsten aangemaakt).',
  contextHeader:  'Bekende lijsten (item-inhoud is verborgen — gebruik showList om te tonen):',
  contextLine:    (name, count) => `- ${name}: ${count} item(s)`,
};

export const LOCALISATION_EN = {
  notFound:        (item, list) => `🤔 "${item}" wasn't on your ${list} list.`,
  removedNowEmpty: (removed, list) => `✓ removed: ${removed}\n📭 Your ${list} list is now empty.`,
  removedRemaining:(removed, list, bullets) => `✓ removed: ${removed}\n\n📋 ${list} (remaining):\n${bullets}`,
  listEmpty:       (list) => `📭 Your ${list} list is empty.`,
  listShow:        (list, bullets) => `📋 ${list}:\n${bullets}\n\n_Tap an item to check it off._`,
  duplicate:       (item, list) => `✓ ${item} (was already on your ${list} list)`,
  buttonTapShape:  (item, list) => `I got ${item} from ${list}`,
  buttonLabel:     (item) => `✓ ${item}`,

  fallbackNotDone: "🤔 Sorry, I couldn't do that automatically — try a clearer command, or use /help for the syntax.",

  slashAddNoListName: '❌ Unclear command.\nUsage: `/add <list> <items>`\ne.g. `/add shopping bread, milk`',
  slashAddNoItems:    (listName) =>
    `❌ Unclear command — no items given.\n` +
    `Did you mean: \`/add shopping ${listName}\`?\n` +
    `Or see \`/help\` for the syntax.`,
  slashAddSuccess:    (listName, items) => `✓ Added to ${listName}: ${items.join(', ')}`,
  slashShowUsage:     'Usage: `/show <list>`\ne.g. `/show shopping`',
  slashRemoveUsage:   'Usage: `/remove <list> <item>`\ne.g. `/remove shopping bread`',
  slashRemoveNoItem:  (command, listName) => `No item given.  Usage: \`/${command} ${listName} <item>\``,
  slashListsEmpty:    "📭 You don't have any lists yet.  Try `/add shopping bread`.",
  slashListsHeader:   '📂 Known lists:',
  slashListLine:      (name, count) => `  • ${name}: ${count} item(s)`,
  slashHelp:          SLASH_HELP_EN,

  contextNoLists: 'Known lists: (none — the user has no lists yet).',
  contextHeader:  'Known lists (contents intentionally hidden — call showList to display):',
  contextLine:    (name, count) => `- ${name}: ${count} item(s)`,
};

export function createToolHandlers(store, { localisation = LOCALISATION_NL } = {}) {
  return {
    addToList: async ({ listName, item }) => {
      if (!listName || !item) return { data: { ok: false, reason: 'missing args' } };
      const rawList = String(listName).trim();
      const itemStr = String(item).trim();
      // Reject placeholder / template-shaped args — observed: qwen
      // 7B emitted addToList("<列表名称>", "<要添加的物品>") (the
      // Chinese version of "<list-name>", "<item-to-add>") when its
      // tokeniser slipped.  Without rejection, the bot dutifully
      // stores the placeholder as a real item.
      if (looksLikePlaceholder(rawList) || looksLikePlaceholder(itemStr)) {
        console.error(`[tool] addToList REJECTED placeholder args: ${rawList}, ${itemStr}`);
        return { data: { ok: false, reason: 'placeholder-shaped arg' } };
      }
      // Reject question-shaped items — the LLM occasionally passes a
      // user's question through as the item arg (geitje observed
      // emitting addToList(boodschappen, "Wat staat er nu") when the
      // user asked to see the list).  Heuristic: starts with a Dutch
      // / English question word, or ends with a question mark.
      if (/^(?:wat|waar|hoe|wie|wanneer|waarom|welke|what|where|how|who|when|why|which)\b/i.test(itemStr)
          || itemStr.endsWith('?')) {
        console.error(`[tool] addToList REJECTED question-shaped item: ${rawList}, ${itemStr}`);
        return { data: { ok: false, listName: rawList, reason: 'question-shaped item' } };
      }
      // Normalise the list name (klussen → klusjes etc).  Without
      // this the LLM's own "klussen" arg lands in a sibling list
      // instead of joining the canonical klusjes.
      const name = normaliseListName(rawList);
      // Dedupe: if the item already exists on this list (case- and
      // whitespace-insensitive match), skip the add.  qwen observed
      // adding "aardappels" a second time when it was already present.
      const existing = store.lists.get(name) ?? [];
      const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
      if (existing.some((it) => norm(it) === norm(itemStr))) {
        console.error(`[tool] addToList SKIPPED duplicate: ${name}, ${itemStr}`);
        return {
          reply: { text: localisation.duplicate(itemStr, name) },
          data:  { ok: true, listName: name, item: itemStr, duplicate: true },
        };
      }
      store.addItem(name, itemStr);
      console.error(`[tool] addToList(${name}, ${itemStr})`);
      return {
        reply: { text: localisation.buttonLabel(itemStr) },
        data:  { ok: true, listName: name, item: itemStr },
      };
    },

    removeFromList: async ({ listName, match }) => {
      if (!listName || !match) return { data: { ok: false, reason: 'missing args' } };
      const rawList = String(listName).trim();
      const matchStr = String(match).trim();
      if (looksLikePlaceholder(rawList) || looksLikePlaceholder(matchStr)) {
        console.error(`[tool] removeFromList REJECTED placeholder args: ${rawList}, ${matchStr}`);
        return { data: { ok: false, reason: 'placeholder-shaped arg' } };
      }
      // Tool args from a small LLM occasionally have a 1-char typo
      // ("boodshappen" instead of "boodschappen").  Resolve to the
      // closest existing list (Levenshtein ≤ 2) before lookup.
      const name = resolveListName(rawList, store);
      const removed = store.removeItem(name, String(match));
      console.error(`[tool] removeFromList(${name}, ${match}) → ${removed ?? '(not found)'}`);

      if (!removed) {
        return {
          reply: { text: localisation.notFound(match, name) },
          data: { ok: false, listName: name, reason: 'not found' },
        };
      }

      const items = store.lists.get(name) ?? [];
      if (items.length === 0) {
        return {
          reply: { text: localisation.removedNowEmpty(removed, name) },
          data: { ok: true, listName: name, removed, count: 0 },
        };
      }
      const buttons = items.map((it) => {
        const phrase = localisation.buttonTapShape(it, name);
        return {
          id:    phrase.length > 60 ? phrase.slice(0, 60) : phrase,
          label: localisation.buttonLabel(it),
        };
      });
      const bullets = items.map((it) => `• ${it}`).join('\n');
      return {
        reply: {
          text:    localisation.removedRemaining(removed, name, bullets),
          buttons,
        },
        data: { ok: true, listName: name, removed, count: items.length },
      };
    },

    showList: async ({ listName }) => {
      const raw = String(listName ?? '').trim();
      if (!raw) return { data: { ok: false, reason: 'missing listName' } };
      const name = resolveListName(raw, store);
      const items = store.lists.get(name);
      console.error(`[tool] showList(${name}) → ${items?.length ?? 0} item(s)`);

      if (!items || items.length === 0) {
        return {
          reply: { text: localisation.listEmpty(name) },
          data: { ok: true, listName: name, count: 0 },
        };
      }
      const buttons = items.map((it) => {
        const phrase = localisation.buttonTapShape(it, name);
        return {
          id:    phrase.length > 60 ? phrase.slice(0, 60) : phrase,
          label: localisation.buttonLabel(it),
        };
      });
      const bullets = items.map((it) => `• ${it}`).join('\n');
      return {
        reply: {
          text: localisation.listShow(name, bullets),
          buttons,
        },
        data: { ok: true, listName: name, count: items.length },
      };
    },
  };
}

// ─── ContextBuilder — list names + counts only (item contents
//     intentionally hidden so the LLM has to call showList). ───

export function createContextBuilder(store, { localisation = LOCALISATION_NL } = {}) {
  return async () => {
    if (store.lists.size === 0) return localisation.contextNoLists;
    const lines = [localisation.contextHeader];
    for (const [name, items] of store.lists) {
      lines.push(localisation.contextLine(name, items.length));
    }
    return lines.join('\n');
  };
}

// ─── Lean prompt — recovery-aware default ───────────────────────
//
// The substrate's slash + NL preprocessor now handles most "voeg X
// toe", "ik heb X nodig", "wat staat op <lijst>" patterns
// deterministically before the LLM is even called.  That means the
// LLM no longer needs a 3500-token tutorial covering every Dutch
// phrasing — we only call it for cases the regexes can't classify
// (smalltalk, oblique add intent, ambiguous list reference,
// multi-action turns).  The lean prompt is sized for that residual.
//
// Targets ~700 tokens vs. the original directive's ~3500 → roughly
// 5× faster prefill and noticeably less output rambling.  The full
// directive is still available via HOUSEHOLD_PROMPT=directive.

export const SYSTEM_PROMPT_LEAN_EN = `You are a friendly household assistant chatting one-to-one with a household member over Telegram (DM).  Reply in English.  Keep replies short (one short sentence, "✓", or "👍" is fine).

You manage **named lists** for the user (shopping, chores, books, gifts, anything they invent).  Below this prompt you see only **list names + item counts** — the contents are intentionally hidden.  To know what's actually on a list, you MUST call \`showList\`.  NEVER invent or fabricate list contents.  NEVER render list contents in your reply text — only the \`showList\` tool can show lists.

— TOOLS —

1. \`addToList(listName, item)\` — add ONE item per call.  Use list names verbatim from the user when explicit.
2. \`removeFromList(listName, match)\` — mark an item done / no longer wanted.  Returns its own confirmation; your text reply can be empty or "✓".
3. \`showList(listName)\` — render the list with tappable buttons.  Use it whenever the user asks about list state.  No accompanying text reply needed.

Many simple add/show patterns ("add X to my <list>", "I need X", "what's on <list>") are already handled deterministically before you see them, so you mostly get cases that need actual reasoning:

— BEHAVIOUR —

- **Smalltalk** (greetings, jokes, weather) → reply naturally.  No tool call.
- **Implicit shopping intent** ("we need to buy X", "we're out of X", "we have guests so we need X") → \`addToList("shopping", X)\`.
- **Implicit chore intent** ("the car needs washing", "we should tidy the loft", "X needs doing") → \`addToList("chores", Y)\` — extract a short imperative (e.g. "wash car", "tidy loft").
- **Ambiguous list reference** ("what's on my list now?", "what's left?") → \`showList\` of the most-recently-mentioned list in the conversation.  If unsure, default to "shopping".
- **Button-tap acknowledgements**: \`I got <item> from <list>\` is ALWAYS \`removeFromList\` — never \`addToList\`, never \`showList\`.
- **Polite framing** ("could you keep a list of X with A, B and C") → call \`addToList\` once per item, no narration.
- Do NOT call the same tool twice with the same args in one turn.
- Do NOT explain JSON / tool format in your reply.  Do NOT use markdown code fences.
- Do NOT re-emit tool calls from prior turns — each user message is independent.

— EXAMPLES —

User: "We need to buy potatoes"
→ addToList("shopping", "potatoes")
→ reply: "✓"

User: "The car needs washing"
→ addToList("chores", "wash car")
→ reply: "👍"

User: "What's on my list now?"  (after they were just talking about chores)
→ showList("chores")
→ (no text reply)

User: "Hi"
→ "Hi! How can I help?"
→ (no tool call)

User: "I got milk from shopping"
→ removeFromList("shopping", "milk")
→ reply: "✓"

NEVER write the tool-call syntax ("showList(shopping)") or angle-bracket placeholders as plain TEXT in your reply — tool calls belong in the tool-call channel, not in your message body.`;

export const SYSTEM_PROMPT_LEAN = `You are a friendly household assistant chatting one-to-one with a household member over Telegram (DM).  Match the user's language exactly — Dutch ↔ Dutch, English ↔ English.  Keep replies short (one short sentence, "✓", or "👍" is fine).

You manage **named lists** for the user (boodschappen, klusjes, books, gifts, anything they invent).  Below this prompt you see only **list names + item counts** — the contents are intentionally hidden.  To know what's actually on a list, you MUST call \`showList\`.  NEVER invent or fabricate list contents.  NEVER render list contents in your reply text — only the \`showList\` tool can show lists.

— TOOLS —

1. \`addToList(listName, item)\` — add ONE item per call.  Use list names verbatim from the user when explicit; never translate Dutch ↔ English.
2. \`removeFromList(listName, match)\` — mark an item done / no longer wanted.  Returns its own confirmation; your text reply can be empty or "✓".
3. \`showList(listName)\` — render the list with tappable buttons.  Use it whenever the user asks about list state.  No accompanying text reply needed.

Many simple add/show patterns ("voeg X toe aan Y", "ik heb X nodig", "wat staat op <lijst>") are already handled deterministically before you see them, so you mostly get cases that need actual reasoning:

— BEHAVIOUR —

- **Smalltalk** (greetings, jokes, weather) → reply naturally.  No tool call.
- **Implicit shopping intent** ("er moet X gekocht worden", "we krijgen gasten dus we hebben X", "X is op") → \`addToList("boodschappen", X)\`.
- **Implicit chore intent** ("de auto moet gewassen worden", "we moeten de zolder opruimen", "X moet nog gebeuren") → \`addToList("klusjes", X)\` — pull a short imperative out of the user's phrasing (e.g. "auto wassen", "zolder opruimen").
- **Ambiguous list reference** ("wat staat op je lijst nu?", "wat is er nog over?") → \`showList\` of the most-recently-mentioned list in the conversation.  If unsure, default to "boodschappen".
- **Button-tap acknowledgements**: \`ik heb <item> van <lijst>\` is ALWAYS \`removeFromList\` — never \`addToList\`, never \`showList\`.
- **Polite framing** ("kun je een lijstje bijhouden voor X met A, B en C") → call \`addToList\` once per item, no narration.
- Do NOT call the same tool twice with the same args in one turn.
- Do NOT explain JSON / tool format in your reply.  Do NOT use markdown code fences.
- Do NOT re-emit tool calls from prior turns — each user message is independent.

— EXAMPLES —

User: "Er moeten aardappels gekocht worden"
→ addToList("boodschappen", "aardappels")
→ reply: "✓"

User: "De auto moet gewassen worden"
→ addToList("klusjes", "auto wassen")
→ reply: "👍"

User: "Wat staat op je lijst nu?"  (after they were just talking about klusjes)
→ showList("klusjes")
→ (no text reply)

User: "Hoi"
→ "Hoi! Hoe kan ik helpen?"
→ (no tool call)

User: "ik heb melk van boodschappen"
→ removeFromList("boodschappen", "melk")
→ reply: "✓"

NEVER write the tool-call syntax ("showList(boodschappen)") or angle-bracket placeholders as plain TEXT in your reply — tool calls belong in the tool-call channel, not in your message body.`;

// ─── Prompt selector ────────────────────────────────────────────

/**
 * Resolve a prompt-name to an actual system prompt string.  Used by
 * scripts to switch via env var HOUSEHOLD_PROMPT.
 *
 *   "default"  / "lean" / unset → SYSTEM_PROMPT_LEAN     (~700 tokens, recovery-aware)
 *   "directive"                 → SYSTEM_PROMPT          (~3500 tokens, pre-recovery)
 *   "trimmed"                   → SYSTEM_PROMPT_TRIMMED  (~50% of directive)
 *   "baseline"                  → SYSTEM_PROMPT_BASELINE (oldest)
 *
 * @param {string} [name]
 * @returns {string}
 */
export function pickPrompt(name) {
  switch (String(name ?? '').toLowerCase()) {
    case 'lean':
    case '':
    case 'default':  return SYSTEM_PROMPT_LEAN;
    case 'lean-en':
    case 'en':       return SYSTEM_PROMPT_LEAN_EN;
    case 'directive':return SYSTEM_PROMPT;
    case 'trimmed':  return SYSTEM_PROMPT_TRIMMED;
    case 'baseline': return SYSTEM_PROMPT_BASELINE;
    default:
      // eslint-disable-next-line no-console
      console.error(`[freetext-core] unknown prompt name "${name}", falling back to lean`);
      return SYSTEM_PROMPT_LEAN;
  }
}

/**
 * Pick the user-facing strings table (Dutch / English) for a given
 * `HOUSEHOLD_LANG` env value.
 *
 * @param {string} [lang]   "en" → English; anything else → Dutch
 * @returns {typeof LOCALISATION_NL}
 */
export function pickLocalisation(lang) {
  return String(lang ?? '').toLowerCase() === 'en' ? LOCALISATION_EN : LOCALISATION_NL;
}

/**
 * Pick the silent-lie fallback string for a given language.
 *
 * @param {string} [lang]
 * @returns {string}
 */
export function pickFallbackNotDone(lang) {
  return pickLocalisation(lang).fallbackNotDone;
}

// ─── File-persisted list store ───────────────────────────────────
//
// Wraps `createListStore()` with synchronous JSON persistence: load
// on construction, flush on every mutation.  Single-user, single-
// process — no locking, no merging.  Adequate for the personal
// production deployment of the experiment.
//
// For multi-user / multi-process, swap this out for a pod-backed
// store (V1+ work).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname }                                from 'node:path';

/**
 * @param {object} args
 * @param {string} args.path                Absolute path of the JSON file.
 * @param {boolean} [args.persist=true]     When false, behaves like createListStore() — no I/O.
 */
export function createPersistedListStore({ path, persist = true }) {
  const store = createListStore();
  if (!persist) return store;

  // Ensure parent dir exists.
  try { mkdirSync(dirname(path), { recursive: true }); } catch { /* ignore */ }

  // Load existing state.
  let loaded = 0;
  try {
    const raw  = readFileSync(path, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const [name, items] of Object.entries(data)) {
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          if (typeof item === 'string') {
            store.addItem(name, item);
            loaded++;
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.error(`[persist] loaded ${loaded} item(s) across ${store.lists.size} list(s) from ${path}`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // eslint-disable-next-line no-console
      console.error(`[persist] load warning: ${err.message ?? err}`);
    } else {
      // eslint-disable-next-line no-console
      console.error(`[persist] starting fresh (${path} not found)`);
    }
  }

  const flush = () => {
    try {
      const data = Object.fromEntries(store.lists);
      writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[persist] save error: ${err.message ?? err}`);
    }
  };

  // Wrap mutating methods to flush after each change.
  const _addItem    = store.addItem;
  const _removeItem = store.removeItem;
  store.addItem = (name, item) => {
    _addItem.call(store, name, item);
    flush();
  };
  store.removeItem = (name, match) => {
    const r = _removeItem.call(store, name, match);
    if (r != null) flush();
    return r;
  };

  return store;
}

// ─── Slash-command pre-processor (deterministic, no LLM) ────────
//
// Telegram-conventional slash commands.  Detected and dispatched
// BEFORE the message reaches the LLM, so they're:
//   - Fast (no network round-trip)
//   - Deterministic (no model variance)
//   - Predictable across all models
//   - Same behaviour in CLI + TG + future bridges
//
// Supported commands (all case-insensitive; bot-username suffix
// like `/add@MyBot` is stripped):
//
//   /add <list> <items...>            add comma-separated items to <list>
//   /show <list>                      render <list> as buttons
//   /remove <list> <item>             remove one item
//   /done <list> <item>               alias for /remove
//   /lists                            show all known list names + counts
//   /help                             show command summary
//
// Returns null when the text isn't a slash command — caller should
// then fall through to LLM processing.

/**
 * @param {string} text
 * @returns {{command: string, args: string} | null}
 */
export function parseSlashCommand(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  // Strip bot-username suffix: /add@MyBot → /add
  const noBot = trimmed.replace(/^(\/\w+)@\w+/, '$1');
  // Split into command name + rest
  const m = noBot.match(/^\/(\w+)\s*([\s\S]*)$/);
  if (!m) return null;
  return {
    command: m[1].toLowerCase(),
    args:    (m[2] ?? '').trim(),
  };
}

/**
 * Parse "<list> <items...>" args.  First whitespace-separated word
 * is the list name.  Rest is split on multiple separators (comma,
 * "en", "and", "+", "&") into items.
 *
 *   "boodschappen brood, melk"     → {listName: "boodschappen", items: ["brood", "melk"]}
 *   "boodschappen brood en melk"   → {listName: "boodschappen", items: ["brood", "melk"]}
 *   "klusjes timmeren"             → {listName: "klusjes", items: ["timmeren"]}
 *   "boodschappen"                 → {listName: "boodschappen", items: []}
 *   ""                             → {listName: null, items: []}
 *
 * @param {string} args
 * @returns {{listName: string|null, items: string[]}}
 */
const ITEM_SEPARATOR = /\s*(?:,|\s+en\s+|\s+and\s+|\s+\+\s+|\s+&\s+)\s*/i;

export function parseListAndItems(args) {
  const trimmed = String(args ?? '').trim();
  if (!trimmed) return { listName: null, items: [] };
  const m = trimmed.match(/^(\S+)\s*([\s\S]*)$/);
  if (!m) return { listName: null, items: [] };
  const listName = m[1];
  const rest = (m[2] ?? '').trim();
  const items = rest
    ? rest.split(ITEM_SEPARATOR).map((s) => s.trim()).filter(Boolean)
    : [];
  return { listName, items };
}

/**
 * Dispatch a parsed slash command against the in-memory store.
 * Returns a `bridge.sendReply` argument shape (or array of them
 * for multi-reply commands), or null when the command is unknown
 * (caller falls through to LLM).
 *
 * Deliberately mirrors the tool-handler reply shape so the visual
 * UX (text + button keyboard) matches the LLM-driven path.
 *
 * @param {{command: string, args: string}} parsed
 * @param {ReturnType<typeof createListStore>} store
 * @returns {Promise<{text: string, buttons?: Array}|Array<{text, buttons?}>|null>}
 */
export async function dispatchSlashCommand(parsed, store, { localisation = LOCALISATION_NL } = {}) {
  const { command, args } = parsed;

  switch (command) {
    case 'add': {
      const { listName, items } = parseListAndItems(args);
      if (!listName) return { text: localisation.slashAddNoListName };
      if (items.length === 0) {
        // Single-word arg — almost certainly the user expected an
        // implicit default list, but we don't make that guess.
        // Better UX: clear error that teaches the syntax + suggests
        // the most likely correction.
        return { text: localisation.slashAddNoItems(listName) };
      }
      for (const item of items) store.addItem(listName, item);
      // eslint-disable-next-line no-console
      console.error(`[slash] /add ${listName} ${items.join(', ')}`);
      return { text: localisation.slashAddSuccess(listName, items) };
    }

    case 'show': {
      const { listName } = parseListAndItems(args);
      if (!listName) return { text: localisation.slashShowUsage };
      const list = store.lists.get(listName);
      // eslint-disable-next-line no-console
      console.error(`[slash] /show ${listName} → ${list?.length ?? 0} item(s)`);
      if (!list || list.length === 0) {
        return { text: localisation.listEmpty(listName) };
      }
      const buttons = list.map((it) => {
        const phrase = localisation.buttonTapShape(it, listName);
        return {
          id:    phrase.length > 60 ? phrase.slice(0, 60) : phrase,
          label: localisation.buttonLabel(it),
        };
      });
      const bullets = list.map((it) => `• ${it}`).join('\n');
      return {
        text:    localisation.listShow(listName, bullets),
        buttons,
      };
    }

    case 'remove':
    case 'done': {
      const { listName, items } = parseListAndItems(args);
      if (!listName) return { text: localisation.slashRemoveUsage };
      if (items.length === 0) {
        return { text: localisation.slashRemoveNoItem(command, listName) };
      }
      const replies = [];
      for (const item of items) {
        const removed = store.removeItem(listName, item);
        // eslint-disable-next-line no-console
        console.error(`[slash] /${command} ${listName} ${item} → ${removed ?? '(not found)'}`);
        replies.push(
          removed
            ? { text: `✓ ${removed}` }
            : { text: localisation.notFound(item, listName) },
        );
      }
      return replies;
    }

    case 'lists': {
      // eslint-disable-next-line no-console
      console.error(`[slash] /lists`);
      if (store.lists.size === 0) return { text: localisation.slashListsEmpty };
      const lines = [localisation.slashListsHeader];
      for (const [name, items] of store.lists) {
        lines.push(localisation.slashListLine(name, items.length));
      }
      return { text: lines.join('\n') };
    }

    case 'help': {
      // eslint-disable-next-line no-console
      console.error(`[slash] /help`);
      return { text: localisation.slashHelp };
    }

    default:
      // Unknown command — let the LLM handle (it might be a
      // command we don't recognise, or just a message that
      // happened to start with /).
      return null;
  }
}

// ─── List-name aliasing + natural-language intent classifier ──
//
// Recovery layer rationale: small local LLMs (qwen 7B observed,
// geitje worse) sometimes emit prose that looks IDENTICAL to a real
// tool reply — "📋 klusjes:\n• timmeren\n• zagen" with no actual
// showList tool call.  The user can't tell real from fake.  Other
// times, the LLM writes a confirmation ("✓ stofzuigen toegevoegd!")
// without firing addToList — silent data loss.
//
// To stop this we (a) handle clear add/show patterns deterministically
// before the LLM sees them, and (b) strip any 📋 list block from
// LLM replies when no showList tool fired this turn.

const LIST_ALIASES = new Map([
  ['kluslijst',          'klusjes'],
  ['kluslijstje',        'klusjes'],
  ['klussen',            'klusjes'],
  ['klusjeslijst',       'klusjes'],
  ['klusjeslijstje',     'klusjes'],
  ['boodschappenlijst',  'boodschappen'],
  ['boodschappenlijstje','boodschappen'],
  ['boodschappen',       'boodschappen'],
  ['shoppinglist',       'shopping'],
  ['shoppinglijst',      'shopping'],
]);

/**
 * Map common variants like "kluslijst" / "klussen" → "klusjes" and
 * "boodschappenlijst" → "boodschappen".  Pass-through for unknown
 * names; lower-cases + trims.
 *
 * @param {string} name
 * @returns {string}
 */
export function normaliseListName(name) {
  if (typeof name !== 'string') return name;
  // Collapse whitespace so "klusjes lijst" → "klusjeslijst" before
  // alias lookup.  Lets the user say either form interchangeably.
  const collapsed = name.toLowerCase().trim().replace(/\s+/g, '');
  return LIST_ALIASES.get(collapsed) ?? collapsed;
}

/**
 * Resolve + reject step used inside intent classifiers.  Returns the
 * canonical list name, or null when the input is too generic
 * ("lijst", "lijstje" alone) to act on without LLM context.
 *
 * @param {string} raw
 * @returns {string | null}
 */
function resolveListNameStrict(raw) {
  const norm = normaliseListName(raw);
  if (typeof norm !== 'string' || norm.length < 3) return null;
  if (GENERIC_LIST_NAMES.has(norm)) return null;
  return norm;
}

// Captures a list-name token.  Matches:
//   - "klusjes" (bare base name)
//   - "boodschappenlijst" (base + suffix attached)
//   - "klusjes lijst" / "klusjes lijstje" (base + suffix with a space)
// Used inside other regexes — never anchored on its own.
const LIST_RE = '([\\wÀ-ÿ-]{3,}(?:\\s*(?:lijst|lijstje))?)';

// List names that are too generic to act on deterministically — when
// the captured name resolves to one of these, the classifier returns
// null so the message falls through to the LLM (which has more
// context to pick the right list).
const GENERIC_LIST_NAMES = new Set(['lijst', 'lijstje', 'list']);

/**
 * Return `{list, items}` for an add intent the user expressed in
 * Dutch / English plain text, or null when the message is too
 * ambiguous (let the LLM handle it).  Items are split on comma /
 * "en" / "and" / "+".
 *
 * @param {string} text
 * @returns {{list: string, items: string[]} | null}
 */
export function classifyAddIntent(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;

  // "voeg X (en Y) toe aan (de) <lijst>"
  // "zet X op/bij (de) <lijst>"
  // "plaats X op (de) <lijst>"
  let m = t.match(
    new RegExp(`^(?:voeg|zet|plaats)\\s+(.+?)\\s+(?:toe\\s+)?(?:aan|op|bij)\\s+(?:de\\s+|mijn\\s+|onze\\s+)?${LIST_RE}\\.?\\s*$`, 'i'));
  if (m) { const _l = resolveListNameStrict(m[2]); if (_l) return { list: _l, items: splitItems(m[1]) }; }

  // "ik wil (graag) <items> op (de) <lijst> zetten/hebben/zien"
  m = t.match(new RegExp(
    `^ik\\s+wil(?:\\s+graag)?\\s+(.+?)\\s+op\\s+(?:de\\s+|mijn\\s+|onze\\s+|het\\s+)?${LIST_RE}\\s+(?:zetten|hebben|zien)\\.?\\s*$`, 'i'));
  if (m) { const _l = resolveListNameStrict(m[2]); if (_l) return { list: _l, items: splitItems(m[1]) }; }

  // "ik wil graag op (de) <lijst> <items> zetten/zien/hebben"
  // (verb-final variant the user actually used: "ik wil ... op mijn ... zetten")
  m = t.match(new RegExp(
    `^ik\\s+wil(?:\\s+graag)?\\s+op\\s+(?:de\\s+|mijn\\s+|onze\\s+|het\\s+)?${LIST_RE}\\s+(.+?)\\s+(?:zetten|hebben|zien)\\.?\\s*$`, 'i'));
  if (m) { const _l = resolveListNameStrict(m[1]); if (_l) return { list: _l, items: splitItems(m[2]) }; }

  // "<items> bij/op (de) <lijst>"  — bare form, no leading verb
  m = t.match(new RegExp(`^(.+?)\\s+(?:bij|op)\\s+(?:de\\s+|mijn\\s+|onze\\s+)?${LIST_RE}\\.?\\s*$`, 'i'));
  if (m) {
    const items = splitItems(m[1]);
    if (items.every(itemLooksReal)) {
      const list = resolveListNameStrict(m[2]);
      if (list) return { list, items };
    }
  }

  // "ik heb (nog/ook) X (en Y) nodig" → boodschappen
  m = t.match(/^(?:ik|we)\s+heb(?:ben)?\s+(?:nog\s+|ook\s+)?(.+?)\s+nodig\.?\s*$/i);
  if (m) return { list: 'boodschappen', items: splitItems(m[1]) };

  // "we hebben geen X meer" → boodschappen
  m = t.match(/^(?:we|ik)\s+heb(?:ben)?\s+(?:nog\s+)?geen\s+(.+?)\s+meer\.?\s*$/i);
  if (m) return { list: 'boodschappen', items: splitItems(m[1]) };

  // English: "add X (and Y) to (my/the) <list>"
  m = t.match(new RegExp(`^add\\s+(.+?)\\s+to\\s+(?:the\\s+|my\\s+|our\\s+)?${LIST_RE}\\.?\\s*$`, 'i'));
  if (m) { const _l = resolveListNameStrict(m[2]); if (_l) return { list: _l, items: splitItems(m[1]) }; }

  return null;
}

/**
 * Return `{list, item}` for a remove intent, or null.  Catches the
 * canonical button-tap shape `ik heb <item> van <lijst>` plus a few
 * common variants (`haal X van/uit Y`, `verwijder X van/uit Y`).
 *
 * @param {string} text
 * @returns {{list: string, item: string} | null}
 */
export function classifyRemoveIntent(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;

  // "ik heb <item> van (de) <lijst>"  — button-tap shape; ALWAYS removeFromList per prompt rule.
  let m = t.match(new RegExp(
    `^ik\\s+heb\\s+(.+?)\\s+van\\s+(?:de\\s+|mijn\\s+|onze\\s+|het\\s+)?${LIST_RE}\\.?\\s*$`, 'i'));
  if (m) {
    const _l = resolveListNameStrict(m[2]);
    const item = m[1].trim();
    if (_l && itemLooksReal(item)) return { list: _l, item };
  }

  // "haal <item> van/uit (de) <lijst>" / "verwijder <item> van/uit (de) <lijst>"
  m = t.match(new RegExp(
    `^(?:haal|verwijder|schrap)\\s+(.+?)\\s+(?:van|uit|af)\\s+(?:de\\s+|mijn\\s+|onze\\s+|het\\s+)?${LIST_RE}\\.?\\s*$`, 'i'));
  if (m) {
    const _l = resolveListNameStrict(m[2]);
    const item = m[1].trim();
    if (_l && itemLooksReal(item)) return { list: _l, item };
  }

  // English: "I got <item> from (my/the) <list>"  /  "remove <item> from <list>"
  m = t.match(new RegExp(
    `^(?:i\\s+got|remove|delete)\\s+(.+?)\\s+from\\s+(?:the\\s+|my\\s+|our\\s+)?${LIST_RE}\\.?\\s*$`, 'i'));
  if (m) {
    const _l = resolveListNameStrict(m[2]);
    const item = m[1].trim();
    if (_l && itemLooksReal(item)) return { list: _l, item };
  }

  return null;
}

/**
 * Return `{list}` for a show intent, or null.
 *
 * @param {string} text
 * @returns {{list: string} | null}
 */
export function classifyShowIntent(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;

  // "wat staat er (nog/nu/dan/eigenlijk) (open) op (de) <lijst>?"
  // Filler word allowed between "er" and "op" to catch real phrasings.
  let m = t.match(new RegExp(
    `^wat\\s+staat\\s+(?:er\\s+)?(?:nog\\s+|nu\\s+|dan\\s+|eigenlijk\\s+|vandaag\\s+|allemaal\\s+)?(?:open\\s+)?op\\s+(?:de\\s+|mijn\\s+|onze\\s+|het\\s+)?${LIST_RE}\\?*\\.?\\s*$`, 'i'));
  if (m) { const _l = resolveListNameStrict(m[1]); if (_l) return { list: _l }; }

  // "ik wil (graag) (weten) wat er (nog) op (de) <lijst> staat"
  m = t.match(new RegExp(
    `^(?:ik\\s+wil(?:\\s+graag)?(?:\\s+weten)?|kan\\s+ik\\s+(?:weten|zien))\\s+wat\\s+(?:er\\s+)?(?:nog\\s+|nu\\s+)?op\\s+(?:de\\s+|mijn\\s+|onze\\s+|het\\s+)?${LIST_RE}\\s+staat\\??\\.?\\s*$`, 'i'));
  if (m) { const _l = resolveListNameStrict(m[1]); if (_l) return { list: _l }; }

  // "toon (mij/me) (de) <lijst>"
  m = t.match(new RegExp(`^toon\\s+(?:mij\\s+|me\\s+)?(?:de\\s+)?${LIST_RE}\\??\\.?\\s*$`, 'i'));
  if (m) { const _l = resolveListNameStrict(m[1]); if (_l) return { list: _l }; }

  // "laat (mij/me) (de) <lijst> zien"
  m = t.match(new RegExp(`^laat\\s+(?:mij\\s+|me\\s+)?(?:de\\s+)?${LIST_RE}\\s+zien\\??\\.?\\s*$`, 'i'));
  if (m) { const _l = resolveListNameStrict(m[1]); if (_l) return { list: _l }; }

  // "open (de) <lijst>"
  m = t.match(new RegExp(`^open\\s+(?:de\\s+|mijn\\s+)?${LIST_RE}\\??\\.?\\s*$`, 'i'));
  if (m) { const _l = resolveListNameStrict(m[1]); if (_l) return { list: _l }; }

  // "hoe ziet (de) <lijst> er(uit)? (nu) (uit)?"
  m = t.match(new RegExp(`^hoe\\s+ziet\\s+(?:de\\s+)?${LIST_RE}\\s+er.*$`, 'i'));
  if (m) { const _l = resolveListNameStrict(m[1]); if (_l) return { list: _l }; }

  // "kun je (mij/me) (de) <lijst> tonen"
  m = t.match(new RegExp(`^kun\\s+je\\s+(?:mij\\s+|me\\s+)?(?:de\\s+)?${LIST_RE}\\s+tonen\\??\\.?\\s*$`, 'i'));
  if (m) { const _l = resolveListNameStrict(m[1]); if (_l) return { list: _l }; }

  // English: "show (me) (my/the) <list>"
  m = t.match(new RegExp(`^show\\s+(?:me\\s+)?(?:the\\s+|my\\s+)?${LIST_RE}\\??\\.?\\s*$`, 'i'));
  if (m) { const _l = resolveListNameStrict(m[1]); if (_l) return { list: _l }; }

  // "what's on (my/the) <list>?"
  m = t.match(new RegExp(`^what(?:'s|\\s+is)\\s+on\\s+(?:my\\s+|the\\s+)?${LIST_RE}\\??\\.?\\s*$`, 'i'));
  if (m) { const _l = resolveListNameStrict(m[1]); if (_l) return { list: _l }; }

  return null;
}

function splitItems(s) {
  return String(s ?? '')
    .split(/\s*(?:,|;|\s+(?:en|and|\+|&)\s+)\s*/i)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function itemLooksReal(item) {
  // Reject pronouns + tiny stop-words to keep the bare "X bij Y"
  // form from grabbing accidental noise like "ik bij klusjes".
  if (/^(ik|jij|hij|zij|wij|jullie|de|het|een|i|you|the|a|an|me)$/i.test(item)) return false;
  // Reject items that LOOK like questions ("wat staat er nu",
  // "hoe gaat het") — those almost always mean the user is asking
  // about a list, not adding "wat staat er nu" as a shopping item.
  if (/^(wat|waar|hoe|wie|wanneer|waarom|welke|what|where|how|who|when|why|which)\b/i.test(item)) return false;
  return item.length >= 2;
}

/**
 * Strip any `📋 <list>:\n• item\n• item` block (and the trailing
 * "tap een item" footer) from a reply text.  Used by callers when
 * no showList tool actually fired this turn but the model rendered
 * a list-shaped block in prose anyway — silent data loss masked
 * by reassuring output.
 *
 * Also strips:
 *   - Markdown ```code``` fences (``` ```json {...} ``` ``` etc.) that
 *     leak the tool format to the user (geitje's verbose meta-mode)
 *   - The `<placeholder>` syntax from prompt examples that geitje
 *     occasionally regurgitates verbatim
 *   - Standalone tool-call-shaped strings (`showList(boodschappen)`)
 *     written as text instead of emitted as a tool call
 *
 * @param {string} text
 * @returns {string} possibly-emptied text; trim caller's responsibility
 */
export function stripFakeListBlocks(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;

  // Markdown code fences — never legit in our domain.  Strip both
  // ```lang\n...\n``` blocks AND their dangling unmatched openers
  // (some models close inconsistently).
  out = out.replace(/```[a-z]*\n[\s\S]*?```/gi, '');
  out = out.replace(/```[a-z]*\s*\n?/gi, '');

  // Multi-line list block: emoji + listname header, bullets, footer
  out = out.replace(
    /(?:📋|🛠|🏠|📭)\s*[^\n:]*:?\n(?:\s*[•·\-*]\s*[^\n]+\n?)+(?:\s*_[^\n]*_)?/g,
    '',
  );
  // Stray "📋 listname:" or "🛠 listname:" headers without bullets
  out = out.replace(/(?:📋|🛠|🏠)\s*[^\n]{0,30}:\s*\n?/g, '');
  // Trailing bullets that survived the multi-line strip
  out = out.replace(/^\s*[•·]\s+[^\n]+\n?/gm, '');
  // "_Tap een item …_" / "_Tap an item …_" stragglers
  out = out.replace(/_\s*Tap\s+(?:een|an)\s+item[^_]*_/gi, '');
  // <placeholder> tokens from prompt examples that geitje literally
  // copied into its output (e.g. "<most-recent-list>")
  out = out.replace(/<[a-z][a-z0-9 _-]{2,40}>/gi, '');
  // Tool-call regurgitation — the LLM wrote a function call as
  // prose instead of emitting it.  Two passes:
  //   1. Anything ending in "list" / "List" then `(...)` (catches
  //      "showList(...)", "showcList(...)", "afür List(...)",
  //      "$arity_list(...)", "_ulonged List(...)").
  //   2. Anything matching `<verb>(<quoted-args>)` even if the verb
  //      isn't List-shaped — catches "addColumn(\"boodschappen\", \"...\")"
  //      and other camelCase tool-name hallucinations.  Limited to
  //      calls that include a quoted string arg, so we don't strip
  //      ordinary parenthesised prose like "auto (wassen)".
  //   We blank the entire LINE — the remaining prose around such a
  //   call is invariably garbage prefix / suffix that goes with it.
  out = out.replace(/^.*\b[\wÀ-ÿ_$-]*[Ll]ist\s*\([^)]*\).*$/gm, '');
  out = out.replace(/^.*\b[a-zA-Z][\w$.-]{2,}\s*\(\s*["'][^)]*\).*$/gm, '');

  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Detect whether a reply text looks like an action confirmation
 * (e.g. "✓", "verwijderd", "toegevoegd").  Used to flag silent-lie
 * replies — when the LLM emits one of these without firing the
 * matching tool call, the user is being misled.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeActionConfirmation(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length === 0) return false;
  // Bare "✓" / "👍" alone, OR "✓ <whatever>" / "👍 <whatever>" —
  // the prefix alone is a confirmation; the trailing words are
  // often qwen tokenizer noise ("✓ Italiaanse pasta配料" observed).
  if (/^[✓✅👍✔]/.test(t)) return true;
  // Confirmation tokens that imply a state change.  Match as whole
  // words (case-insensitive) to avoid catching "toegevoegd" inside
  // a longer narrative.
  return /\b(verwijderd|verwijderde|verwijder|toegevoegd|toegevoegde|aangebracht|afgevinkt|afgevinkte|gewist|removed|added|deleted|crossed[\s-]?off)\b/i.test(t);
}

/**
 * Friendly fallback shown when the LLM emitted confirmation prose
 * but no tool actually fired — better than silently lying that
 * something happened.
 */
// Back-compat aliases — the canonical strings live in the localisation
// tables (LOCALISATION_NL.fallbackNotDone / LOCALISATION_EN.fallbackNotDone).  Use
// `pickFallbackNotDone(lang)` for new code.
export const FALLBACK_NOT_DONE    = LOCALISATION_NL.fallbackNotDone;
export const FALLBACK_NOT_DONE_EN = LOCALISATION_EN.fallbackNotDone;

/**
 * Wrap a `bridge.onMessage` registrar so:
 *   1. Slash commands are dispatched deterministically (no LLM).
 *   2. Unambiguous Dutch/English add+show patterns are dispatched
 *      deterministically too — bypasses the LLM, removes the
 *      hallucination surface for the most common turns.
 *   3. The LLM handles everything else as fallback.
 *   4. Messages are SERIALIZED per chatId — new messages wait for
 *      the previous one (slash or LLM) to fully complete before
 *      processing.  Prevents the chaos that arises when a user
 *      types 4 messages in 2s and 4 LLM calls run in parallel.
 *
 * @param {object} bridge        a MessagingBridge (in-memory or
 *                               TelegramBridge)
 * @param {ReturnType<typeof createListStore>} store
 * @param {object} [opts]
 * @param {(text: string) => void} [opts.log]   per-message log hook
 * @param {boolean} [opts.naturalLanguage=true]  set false to keep
 *   only slash dispatch + always defer NL to the LLM
 * @param {object} [opts.localisation=LOCALISATION_NL]  user-facing strings table —
 *   pass LOCALISATION_EN for English replies + button-tap shape
 */
export function installSlashCommandPreprocessor(bridge, store, opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : null;
  const localisation = opts.localisation ?? LOCALISATION_NL;
  const originalOnMessage = bridge.onMessage.bind(bridge);

  /** @type {Map<string, Promise<void>>}  per-chatId tail of the queue */
  const queues = new Map();

  /**
   * Enqueue work for a chatId.  Returns a promise that resolves
   * when this work is done.  The next caller for the same chatId
   * waits behind it.  Errors don't poison the queue.
   */
  const enqueue = (chatId, fn) => {
    const prev = queues.get(chatId) ?? Promise.resolve();
    const next = prev
      .catch(() => { /* swallow — don't poison the chain */ })
      .then(fn);
    queues.set(chatId, next);
    // Auto-cleanup so the map doesn't grow unbounded.
    next.finally(() => {
      if (queues.get(chatId) === next) queues.delete(chatId);
    }).catch(() => {});
    return next;
  };

  const naturalLanguage = opts.naturalLanguage !== false;
  const handlers = createToolHandlers(store, { localisation });

  bridge.onMessage = (handler) => {
    originalOnMessage(async (msg) => {
      const chatId = String(msg?.chatId ?? '');
      return enqueue(chatId, async () => {
        const text = msg?.text ?? '';
        if (log) log(`[user ${msg?.sender?.displayName ?? 'unknown'}] ${text}`);

        // 1. Slash commands.
        const slash = parseSlashCommand(text);
        if (slash) {
          const reply = await dispatchSlashCommand(slash, store, { localisation });
          if (reply != null) {
            const replies = Array.isArray(reply) ? reply : [reply];
            for (const r of replies) {
              await bridge.sendReply({ chatId: msg.chatId, ...r });
            }
            return;
          }
          // Unknown slash command — pass through to LLM.
          return handler(msg);
        }

        // 2. Natural-language intents.  Deterministic; bypasses LLM.
        // Order: REMOVE → SHOW → ADD.  Remove is most specific
        // ("ik heb X van Y"); show next ("wat staat ..."); add last
        // because its bare form ("X op Y") is the loosest.
        if (naturalLanguage) {
          const removeIntent = classifyRemoveIntent(text);
          if (removeIntent) {
            const r = await handlers.removeFromList({ listName: removeIntent.list, match: removeIntent.item });
            if (r?.reply) await bridge.sendReply({ chatId: msg.chatId, ...r.reply });
            return;
          }
          const showIntent = classifyShowIntent(text);
          if (showIntent) {
            const r = await handlers.showList({ listName: showIntent.list });
            if (r?.reply) await bridge.sendReply({ chatId: msg.chatId, ...r.reply });
            return;
          }
          const addIntent = classifyAddIntent(text);
          if (addIntent && addIntent.items.length > 0) {
            const lines = [];
            for (const item of addIntent.items) {
              const r = await handlers.addToList({ listName: addIntent.list, item });
              if (r?.reply?.text) lines.push(r.reply.text);
            }
            if (lines.length > 0) {
              await bridge.sendReply({ chatId: msg.chatId, text: lines.join('\n') });
            }
            return;
          }
        }

        // 3. Plain text — LLM handles it.
        return handler(msg);
      });
    });
  };
}

// ─── LLM options from env ───────────────────────────────────────

/**
 * Parse HOUSEHOLD_LLM_TEMPERATURE + HOUSEHOLD_LLM_STOP into a
 * provider `defaultOptions` object.  Returns null when neither is
 * set (so the provider sends Ollama's default sampling).
 *
 * Stop sequences: comma-separated strings.  `\n` and `\t` escape
 * sequences in the env value are translated to real newline/tab so
 * shell users can write `HOUSEHOLD_LLM_STOP="\\nUser:,\\nReply:"`
 * without bash-quoting hell.
 *
 * Examples:
 *   HOUSEHOLD_LLM_TEMPERATURE=0.1
 *   HOUSEHOLD_LLM_STOP='\nUser:,\nReply:'
 *
 * @returns {{temperature?: number, stop?: string[]} | null}
 */
export function parseLlmOptions() {
  const tempStr = process.env.HOUSEHOLD_LLM_TEMPERATURE;
  const stopStr = process.env.HOUSEHOLD_LLM_STOP;
  const out = {};
  if (tempStr !== undefined && tempStr !== '') {
    const t = Number(tempStr);
    if (Number.isFinite(t)) out.temperature = t;
  }
  if (stopStr !== undefined && stopStr !== '') {
    out.stop = stopStr
      .split(',')
      .map((s) => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\'))
      .filter((s) => s.length > 0);
  }
  return Object.keys(out).length > 0 ? out : null;
}
