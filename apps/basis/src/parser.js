/**
 * basis — input parser.
 *
 * Three parse modes, in priority order:
 *
 *   1. **Slash** — input starts with `/`; look up the slash token in
 *      the merged manifest's `commandMenu`.  When matched, emit
 *      `{kind: 'slash', opId, args, threadId}`.
 *
 *   2. **LLM** — v0.8+ deferred.  v0.1 stubs return `unknown` for
 *      anything that isn't a slash match.
 *
 *   3. **Free text** — fall-through.  v0.1 returns `unknown` with the
 *      raw text so the chat shell can render a "didn't understand"
 *      reply.
 *
 * Phase v0.1 per `/Project Files/basis/coding-plan.md`.
 */

/**
 * @typedef {object} SlashParseResult
 * @property {'slash'}      kind
 * @property {string}       opId       resolved op id
 * @property {object}       args       parsed args (per body-parse rules)
 * @property {string|null}  threadId   thread id from caller context (passed through)
 * @property {string}       command    the slash token actually matched (e.g. '/done')
 * @property {string}       body       raw body string (whatever followed the slash)
 */

/**
 * @typedef {object} UnknownParseResult
 * @property {'unknown'}    kind
 * @property {string}       text       raw input
 * @property {string|null}  threadId
 */

/**
 * @typedef {object} AmbiguousParseResult
 * @property {'ambiguous'}  kind
 * @property {string}       command    the colliding bare command (e.g. '/done')
 * @property {string}       body       raw body after the command (preserved for a re-issued qualified command)
 * @property {Array<{command:string, appId:string}>} choices  the app-qualified alternatives to offer
 * @property {string[]}     appIds     the apps that declared this command
 * @property {string|null}  threadId
 */

/**
 * @typedef {SlashParseResult | AmbiguousParseResult | UnknownParseResult} ParseResult
 */

/**
 * @typedef {object} MergedCatalogueLite
 * @property {Array<{ command: string, opId: string, body?: 'match' | 'reject' | 'flags' }>} commandMenu
 *   Each entry maps a slash command (e.g. '/done') to an opId.  `body`
 *   is the body-parse rule:
 *     - `'match'`   — body parses as a single positional arg (the
 *                     manifest's first required param)
 *     - `'reject'`  — any body after the slash is a parse error
 *     - `'flags'`   — body parses as `--key=value` flags (v0.4+ J2)
 *   Default when absent: `'match'`.
 */

/**
 * Parse user input.  Pure function — no I/O, no state.
 *
 * @param {string}             rawInput   the user's message text
 * @param {MergedCatalogueLite}  catalogue    merged manifest commandMenu
 * @param {object}             [ctx]
 * @param {string|null}        [ctx.threadId=null]  thread id from caller (passes through to result)
 * @returns {ParseResult}
 */
export function parseInput(rawInput, catalogue, ctx = {}) {
  const threadId = ctx.threadId ?? null;
  const text     = String(rawInput ?? '');
  const trimmed  = text.trim();

  if (trimmed.startsWith('/')) {
    const slashResult = parseSlash(trimmed, catalogue, { threadId });
    if (slashResult) return slashResult;
    // unmatched slash → fall through to unknown
  }

  // v0.1: no LLM, no free-text dispatch — just report unknown.
  return { kind: 'unknown', text: trimmed, threadId };
}

/**
 * Attempt to parse a slash-prefixed input against the catalogue.
 *
 * @param {string}             trimmed   input with leading whitespace stripped
 * @param {MergedCatalogueLite}  catalogue
 * @param {object}             [ctx]
 * @param {string|null}        [ctx.threadId=null]
 * @returns {SlashParseResult | null}  null if no command matches
 */
export function parseSlash(trimmed, catalogue, ctx = {}) {
  const threadId = ctx.threadId ?? null;
  if (!trimmed.startsWith('/')) return null;
  if (!catalogue || !Array.isArray(catalogue.commandMenu)) return null;

  // Split off the command token (first whitespace-separated chunk).
  const spaceIdx = trimmed.indexOf(' ');
  const command  = spaceIdx === -1 ? trimmed       : trimmed.slice(0, spaceIdx);
  const body     = spaceIdx === -1 ? ''            : trimmed.slice(spaceIdx + 1);

  // Lookup — case-sensitive match (matches Telegram conventions +
  // existing manifests' command declarations).
  const entry = catalogue.commandMenu.find((e) => e.command === command);
  if (!entry) return null;

  // Objective D — a colliding bare command with no per-host override winner is
  // AMBIGUOUS (prefix-all policy): don't silently fire one app — hand back the
  // app-qualified choices so the caller can offer them. The qualified forms
  // (`/tasks:done`) are ordinary commandMenu entries and parse as normal slash.
  if (entry.ambiguous) {
    return {
      kind:     'ambiguous',
      command,
      body,
      choices:  Array.isArray(entry.choices) ? entry.choices : [],
      appIds:   Array.isArray(entry.appIds) ? entry.appIds : [],
      threadId,
    };
  }

  const bodyRule = entry.body ?? 'match';
  const args     = parseBody(body, bodyRule);

  return {
    kind: 'slash',
    opId:    entry.opId,
    // Carry the command's declared owner so resolveDispatch can pick the
    // RIGHT app when two apps declare the same op id under DISTINCT commands
    // (e.g. tasks `/addtask` vs household `/task`, both op id `addTask`).
    // Without this, resolveDispatch re-resolved the bare op id to the
    // first-mounted owner, hijacking the command (Part G household swap).
    appOrigin: entry.appOrigin,
    args,
    threadId,
    command,
    body,
  };
}

/**
 * Parse the body string per the rule the manifest declared.
 *
 * @param {string}                          body
 * @param {'match' | 'reject' | 'flags'}    rule
 * @returns {object}
 */
function parseBody(body, rule) {
  const trimmed = body.trim();

  if (rule === 'reject') {
    // Per the manifest, this op accepts NO positional body.  v0.1
    // ignores trailing junk silently; future versions may surface a
    // parse warning.  Empty result.
    return {};
  }

  if (rule === 'flags') {
    return parseFlags(trimmed);
  }

  // rule === 'match' (default).  Body is a single positional value
  // intended for the op's first required param.  v0.1 emits it as
  // `_match` — the router uses paramsSchema to bind the right name.
  if (trimmed === '') return {};
  return { _match: trimmed };
}

/**
 * Parse `--key=value` flags + bare-word positional args.
 * Designed for the J2 path: `/addtask --due=friday "fix back door"`.
 *
 * @param {string} body
 * @returns {object}
 */
function parseFlags(body) {
  const out = {};
  const positional = [];

  // Tokenize on whitespace BUT respect simple double-quoted spans.
  const tokens = tokenize(body);
  for (const tok of tokens) {
    if (tok.startsWith('--')) {
      const eq    = tok.indexOf('=');
      const key   = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
      const value = eq === -1 ? true         : tok.slice(eq + 1);
      out[key] = value;
    } else {
      positional.push(tok);
    }
  }
  if (positional.length > 0) {
    // v0.5.1 — for flags-body parsers, ALSO surface the first
    // positional as the canonical id field convention; the router's
    // _match-binding picks it up automatically for the op's first
    // required non-boolean param.  Older callers using `_match`
    // continue to work.
    out._match = positional.join(' ');
  }
  return out;
}

/**
 * Tokenize a string respecting double-quoted spans.  Each quote span
 * is one token; bare words split on whitespace.
 *
 * Lightweight v0.1 implementation — does NOT support escapes, single
 * quotes, or nested quotes.  Sufficient for J2-style command bodies.
 *
 * @param {string} s
 * @returns {string[]}
 */
function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && s[i] === ' ') i++;     // skip whitespace
    if (i >= s.length) break;

    // v0.7.-followup 2026-05-23 (5th pass): handle both styles AND
    // quoted values AFTER --key= boundaries.  Cases:
    //   "foo bar"              → one token: 'foo bar'
    //   'foo bar'              → one token: 'foo bar'
    //   --key=value            → one token: '--key=value'
    //   --key="foo bar"        → one token: '--key=foo bar'
    //   --key='foo bar'        → one token: '--key=foo bar'
    //   bareword               → one token: 'bareword'
    //
    // Token-starts with a quote → simple quoted span (existing).
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i];
      const end = s.indexOf(quote, i + 1);
      if (end === -1) {                            // unterminated → take rest
        out.push(s.slice(i + 1));
        break;
      }
      out.push(s.slice(i + 1, end));
      i = end + 1;
      continue;
    }

    // Otherwise: bareword scanner that's quote-aware.  Read until
    // an unquoted space.  Inside quotes, spaces are part of the token
    // and the quotes themselves are stripped from the output.
    let buf = '';
    while (i < s.length && s[i] !== ' ') {
      const ch = s[i];
      if (ch === '"' || ch === "'") {
        const close = s.indexOf(ch, i + 1);
        if (close === -1) {            // unterminated; take rest verbatim
          buf += s.slice(i + 1);
          i = s.length;
          break;
        }
        buf += s.slice(i + 1, close);   // strip quotes
        i = close + 1;
      } else {
        buf += ch;
        i++;
      }
    }
    out.push(buf);
  }
  return out;
}
