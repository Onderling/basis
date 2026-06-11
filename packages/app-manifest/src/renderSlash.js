/**
 * Render the deterministic, generic slash-grammar matcher.
 *
 * `parse(text)` returns the same shape household's `regexParse` does:
 *     null                                  (no match — caller falls back)
 *   | { skillId, args }
 *   | Array<{ skillId, args }>              (multi-item, when an op opts
 *                                            into splitItems)
 *
 * Drop-in for the SP-1 byte-equivalence gate (PLAN §1.4).
 *
 * Driven by:
 *   - manifest.slashGrammar              (addressedPrefixes, specials,
 *                                          typeAliases, defaultType)
 *   - per-op surfaces.slash.match        (verbs, body, splitItems, onEmpty)
 *
 * Pure.  Deterministic.  Verbs / operations tried in declaration order;
 * first match wins.  Patterns compiled once per `renderSlash` call so
 * `parse` stays cheap.
 *
 * Per PLAN flag #13 (F-SP1-b, locked 2026-05-19): the grammar spec is
 * rich enough to encode household's regexParse — EN/NL aliases, multiword
 * verb phrases ('voeg toe'), special forms ('what do we need'), item
 * splitting on `,`/` and `/` en ` with quote handling, peel-type +
 * default-type fallback, trailing-punct strip, addressed-prefix strip.
 *
 * @param {import('./schema.js').Manifest} manifest
 */
export function renderSlash(manifest) {
  const grammar     = manifest?.slashGrammar ?? {};
  const prefixes    = (grammar.addressedPrefixes ?? []).map((src) => new RegExp(`^${src}`, 'i'));
  const specials    = (grammar.specials ?? []).map((s) => ({
    re:      new RegExp(s.pattern, s.flags ?? 'i'),
    skillId: s.skillId,
    args:    s.args ?? {},
  }));
  const typeAliases = grammar.typeAliases ?? {};
  const defaultType = grammar.defaultType;

  const ops      = Array.isArray(manifest?.operations) ? manifest.operations : [];
  const matchers = [];
  for (const op of ops) {
    const m = op?.surfaces?.slash?.match;
    if (!m || !Array.isArray(m.verbs) || m.verbs.length === 0) continue;
    const verbRes = m.verbs.map((v) => {
      const tokens = Array.isArray(v) ? v : [v];
      const head   = tokens.map(escapeRe).join('\\s+');
      return new RegExp(`^${head}\\b\\s*(.*)$`, 'i');
    });
    matchers.push({
      skillId:    op.id,
      verbRes,
      body:       m.body ?? 'none',
      splitItems: !!m.splitItems,
      onEmpty:    m.onEmpty ?? null,
      // F-SP2 (2026-06-11): two additive options so canopy-chat's task ops project cleanly —
      //   arg          — target the body at a custom arg name (e.g. 'id' for completeTask/claimTask
      //                  whose param is `id`, not the default 'match'/'text').
      //   dropTrailing — strip a trailing connector clause ("add milk TO THE LIST" → "milk").
      // Both inert unless declared, so household's slash byte-equivalence is untouched.
      arg:          typeof m.arg === 'string' ? m.arg : null,
      dropTrailing: Array.isArray(m.dropTrailing) && m.dropTrailing.length ? m.dropTrailing : null,
    });
  }

  return {
    parse(text) {
      if (typeof text !== 'string') return null;
      let s = text.replace(/\s+/g, ' ').trim();
      if (!s) return null;

      // Strip ONE leading prefix.
      for (const re of prefixes) {
        const m = s.match(re);
        if (m) { s = s.slice(m[0].length).trim(); break; }
      }
      if (!s) return null;

      // Specials are matched against the post-prefix-strip text.
      for (const sp of specials) {
        if (sp.re.test(s)) {
          return { skillId: sp.skillId, args: { ...sp.args } };
        }
      }

      // Per-op verb matching — declaration order, first match wins.
      for (const mch of matchers) {
        for (const re of mch.verbRes) {
          const m = s.match(re);
          if (!m) continue;
          const body = (m[1] ?? '').trim();
          return applyBody(mch, body, { typeAliases, defaultType });
        }
      }
      return null;
    },
  };
}

function applyBody(mch, body, ctx) {
  switch (mch.body) {
    case 'none':
      return { skillId: mch.skillId, args: {} };

    case 'match': {
      const trimmed = dropTrailing(body.replace(TRAILING_PUNCT_RE, '').trim(), mch.dropTrailing);
      if (!trimmed) return mch.onEmpty ? cloneCall(mch.onEmpty) : null;
      const key = mch.arg ?? 'match';
      if (mch.splitItems) {
        const items = splitItems(trimmed);
        if (items.length === 0) return mch.onEmpty ? cloneCall(mch.onEmpty) : null;
        if (items.length === 1) return { skillId: mch.skillId, args: { [key]: items[0] } };
        return items.map((it) => ({ skillId: mch.skillId, args: { [key]: it } }));
      }
      return { skillId: mch.skillId, args: { [key]: trimmed } };
    }

    case 'type-only': {
      const trimmed = body.replace(TRAILING_PUNCT_RE, '').trim();
      if (!trimmed) return mch.onEmpty ? cloneCall(mch.onEmpty) : null;
      const { type } = peelType(trimmed, ctx.typeAliases, ctx.defaultType);
      return { skillId: mch.skillId, args: { type } };
    }

    case 'type+text': {
      if (!body) return mch.onEmpty ? cloneCall(mch.onEmpty) : null;
      const peeled = peelType(body, ctx.typeAliases, ctx.defaultType);
      const type = peeled.type;
      const rest = dropTrailing(peeled.rest, mch.dropTrailing);
      if (!rest) return mch.onEmpty ? cloneCall(mch.onEmpty) : null;
      const key = mch.arg ?? 'text';
      if (mch.splitItems) {
        const items = splitItems(rest);
        if (items.length === 0) return mch.onEmpty ? cloneCall(mch.onEmpty) : null;
        if (items.length === 1) return { skillId: mch.skillId, args: { type, [key]: items[0] } };
        return items.map((it) => ({ skillId: mch.skillId, args: { type, [key]: it } }));
      }
      return { skillId: mch.skillId, args: { type, [key]: rest } };
    }

    // F-SP2-a (locked 2026-05-20): body is the whole `text` arg, no
    // type prefix.  Used by ops like `addTask` and `registerName` whose
    // slash form is "<verb> <text>" (no type slot).  `splitItems`
    // honoured the same way as 'match' / 'type+text'.
    case 'text-only': {
      const trimmed = dropTrailing(body.replace(TRAILING_PUNCT_RE, '').trim(), mch.dropTrailing);
      if (!trimmed) return mch.onEmpty ? cloneCall(mch.onEmpty) : null;
      const key = mch.arg ?? 'text';
      if (mch.splitItems) {
        const items = splitItems(trimmed);
        if (items.length === 0) return mch.onEmpty ? cloneCall(mch.onEmpty) : null;
        if (items.length === 1) return { skillId: mch.skillId, args: { [key]: items[0] } };
        return items.map((it) => ({ skillId: mch.skillId, args: { [key]: it } }));
      }
      return { skillId: mch.skillId, args: { [key]: trimmed } };
    }

    default:
      throw new Error(`renderSlash: unknown body kind "${mch.body}"`);
  }
}

function cloneCall(c) { return { skillId: c.skillId, args: { ...(c.args ?? {}) } }; }

/**
 * Strip a trailing connector clause: given words like ['to','aan','op'], turn
 * "milk to the list" → "milk".  No-op when `words` is null (the default), so
 * ops that don't declare `dropTrailing` are unchanged.
 */
function dropTrailing(text, words) {
  if (!words) return text;
  const alt = words.map(escapeRe).join('|');
  return text.replace(new RegExp(`\\s+(?:${alt})\\b.*$`, 'i'), '').trim();
}

const TRAILING_PUNCT_RE = /[!?.,;:]+$/;

/**
 * Peel the optional type-alias prefix.  Returns the canonical type and
 * the remaining text.  When `s` doesn't start with an alias, falls back
 * to `defaultType` and leaves the body intact.
 *
 * @param {string} s
 * @param {Record<string,string>} typeAliases
 * @param {string|undefined} defaultType
 * @returns {{ type: string|undefined, rest: string }}
 */
function peelType(s, typeAliases, defaultType) {
  const m = s.match(/^(\S+)(?:\s+(.*))?$/);
  if (!m) return { type: defaultType, rest: '' };
  const head    = m[1].toLowerCase().replace(TRAILING_PUNCT_RE, '');
  const aliased = typeAliases[head];
  if (aliased) return { type: aliased, rest: (m[2] ?? '').trim() };
  return { type: defaultType, rest: s.trim() };
}

/**
 * Split a body into items on `,`, ` and `, ` en `.  Quoted substrings
 * (`"..."`) are kept whole.  Trailing punctuation stripped per item.
 * Empty items dropped.
 *
 * @param {string} body
 * @returns {string[]}
 */
function splitItems(body) {
  const parts = [];
  let cur     = '';
  let i       = 0;
  while (i < body.length) {
    const ch = body[i];

    if (ch === '"') {
      const end = body.indexOf('"', i + 1);
      if (end === -1) { cur += body.slice(i + 1); i = body.length; }
      else            { cur += body.slice(i + 1, end); i = end + 1; }
      continue;
    }

    if (ch === ',') { parts.push(cur); cur = ''; i += 1; continue; }

    const tail = body.slice(i);
    const andM = tail.match(/^\s+and\s+/i);
    if (andM) { parts.push(cur); cur = ''; i += andM[0].length; continue; }
    const enM = tail.match(/^\s+en\s+/i);
    if (enM)  { parts.push(cur); cur = ''; i += enM[0].length;  continue; }

    cur += ch;
    i   += 1;
  }
  parts.push(cur);

  return parts
    .map((p) => p.trim().replace(TRAILING_PUNCT_RE, '').trim())
    .filter((p) => p.length > 0);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
