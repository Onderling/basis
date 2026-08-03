// Shared scope + extraction helpers for the codename naming-hygiene guard
// (scripts/lint-codenames.mjs) and its fitness test.
//
// WHAT COUNTS AS "IN SCOPE":
//   - Source-code COMMENTS only (// line, /* */ block, JSDoc) in tracked
//     .js/.jsx under packages/ and apps/ — never code, strings, or identifiers.
//   - Prose in tracked public DOCS: docs/**, root README/QUICKSTART/CLAUDE/
//     AGENTS/CONTRIBUTING .md, apps/*/docs/**, and any CHANGELOG*.md — minus
//     fenced/inline code so codenames inside code samples aren't flagged.
//   - The PUBLIC API surface the appendix generator produces + consumes:
//     the generated reference under docs/api/** (the projection of every wave-1
//     package's EXPORTED-symbol JSDoc) and each wave-1 package.json `description`
//     (emitted verbatim into that reference). These are scanned with a FULLER
//     pattern set (base + PUBLIC_SURFACE_PATTERNS) because a fresh reader of the
//     published docs meets these strings first — a "Phase 52.2.x" or "§1b" that
//     leaks through the generator is exactly the class task #26 chased. Guarding
//     the projection (not every internal comment) keeps false positives low:
//     internal working-note comments that never reach the public docs are left
//     to the conservative base patterns.
//
// OUT OF SCOPE (never scanned): node_modules, vendored bundles (**/vendor/**,
//   *.min.js), private working notes (plans/**, _archive/**, root PLAN-*/
//   DESIGN-*/REMAINING-WORK.md — gitignored anyway), locale JSON data
//   (values, not comments), non-wave-1 package.json descriptions, and
//   non-.js/.jsx assets.

import { execSync } from 'node:child_process';

export const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

const isVendored = (f) => /(^|\/)vendor\//.test(f) || /\.min\.js$/.test(f);

/** A tracked .js/.jsx source file whose COMMENTS we scan. */
export function isScopedCode(f) {
  if (!/^(packages|apps)\/.*\.(js|jsx)$/.test(f)) return false;
  if (f.includes('/node_modules/') || isVendored(f)) return false;
  return true;
}

/** A tracked markdown DOC whose prose we scan. */
export function isScopedDoc(f) {
  if (f.includes('/node_modules/')) return false;
  if (/^docs\//.test(f)) return true;
  if (/^apps\/[^/]+\/docs\//.test(f)) return true;
  if (/(^|\/)CHANGELOG[^/]*\.md$/i.test(f)) return true;
  if (['README.md', 'QUICKSTART.md', 'CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md'].includes(f)) return true;
  return false;
}

// The wave-1 packages whose public API is generated into docs/api/ and whose
// package.json `description` is emitted verbatim into that reference. Kept in
// sync with WAVE1 in scripts/api-appendix.mjs (the generator).
export const WAVE1_PACKAGES = [
  'sdk', 'core', 'transports', 'vault', 'pod-client', 'redaction', 'pseudo-pod',
  'item-types', 'item-store', 'app-manifest', 'app-scaffold', 'attribute-charter',
  'logger', 'oidc-session', 'agent-registry',
];

/** A generated public API-reference doc (docs/api/**) — the projection of wave-1 source JSDoc. */
export function isPublicApiDoc(f) {
  return /^docs\/api\/.*\.md$/.test(f);
}

/** A wave-1 package.json whose `description` is emitted verbatim into the public API reference. */
export function isWave1PkgJson(f) {
  const m = f.match(/^packages\/([^/]+)\/package\.json$/);
  return !!m && WAVE1_PACKAGES.includes(m[1]);
}

export function tracked() {
  return sh('git ls-files').split('\n').filter(Boolean);
}

/**
 * Extract only the COMMENT regions of a JS/JSX source, preserving line numbers
 * (non-comment characters are blanked to spaces, newlines kept). A small
 * hand-rolled scanner that respects '…', "…", `…` strings and // + /* * /
 * comments so a codename token inside a string literal is never mistaken for a
 * comment. Regex literals are not fully tokenised, but our codename patterns do
 * not occur inside regex literals in this tree.
 */
export const BLANK = '\x00'; // sentinel for non-comment/non-prose chars (lets the fixer isolate comment spans)

export function commentMask(src) {
  const out = new Array(src.length).fill(BLANK);
  let i = 0;
  const n = src.length;
  let state = 'code'; // code | line | block | sq | dq | tpl
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '\n') { out[i] = '\n'; i++; if (state === 'line') state = 'code'; continue; }
    switch (state) {
      case 'code':
        if (c === '/' && c2 === '/') { state = 'line'; i += 2; }
        else if (c === '/' && c2 === '*') { state = 'block'; i += 2; }
        else if (c === "'") { state = 'sq'; i++; }
        else if (c === '"') { state = 'dq'; i++; }
        else if (c === '`') { state = 'tpl'; i++; }
        else i++;
        break;
      case 'line':
        out[i] = c; i++;
        break;
      case 'block':
        out[i] = c;
        if (c === '*' && c2 === '/') { out[i + 1] = '/'; i += 2; state = 'code'; }
        else i++;
        break;
      case 'sq':
        if (c === '\\') i += 2;
        else { if (c === "'") state = 'code'; i++; }
        break;
      case 'dq':
        if (c === '\\') i += 2;
        else { if (c === '"') state = 'code'; i++; }
        break;
      case 'tpl':
        if (c === '\\') i += 2;
        else { if (c === '`') state = 'code'; i++; }
        break;
    }
  }
  return out.join('');
}

/**
 * Blank out fenced ``` blocks and inline `code` in markdown, preserving line
 * numbers, so codenames shown in code samples are not flagged as prose.
 */
export function docProseMask(src) {
  let s = src.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, BLANK));
  s = s.replace(/`[^`\n]*`/g, (m) => BLANK.repeat(m.length));
  return s;
}

/**
 * Keep ONLY the `description` string value of a package.json, preserving line
 * numbers (everything else → BLANK). Lets the description be scanned for
 * codenames without flagging package names, dep specifiers, or script bodies.
 */
export function pkgDescriptionMask(src) {
  const out = new Array(src.length).fill(BLANK);
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') out[i] = '\n';
  const m = src.match(/"description"\s*:\s*"/);
  if (m) {
    for (let i = m.index + m[0].length; i < src.length; i++) {
      if (src[i] === '\\') { out[i] = src[i]; if (src[i + 1] !== '\n') out[i + 1] = src[i + 1]; i++; continue; }
      if (src[i] === '"') break;
      if (src[i] !== '\n') out[i] = src[i];
    }
  }
  return out.join('');
}

// The curated codename patterns (the SPEC). Each entry: a stable id and a
// GLOBAL regex. Tuned to the actual internal planning codenames that leaked
// into this tree, and verified to have a low false-positive rate (see the
// fitness test). Deliberately conservative — ambiguous single-letter cluster
// tags (bare "B ·"), milestone "M<n>", "objective L"/"L<n>", and 1–2 digit
// "#<n>" ordinals are LEFT alone rather than risk false positives.
// `codeOnly` patterns are enforced in source COMMENTS only, not in doc prose.
// A bare `#123` is planning noise in a code comment, but in prose docs a `#123`
// is routinely a legitimate issue/tracker CITATION (e.g. a traceability matrix
// keyed by issue number) — stripping those would destroy the doc, so we leave
// them (conservative: when a token is legit in context, don't flag it).
export const CODENAME_PATTERNS = [
  { id: 'cluster-K', re: /\bcluster[ ·–—-]+K\d*\b/gi },
  { id: 'K-spike',   re: /\bK[12]\b/g },
  { id: 'SP-n',      re: /\bSP-\d+(?:\.\d+)*[a-z]?\b/g },
  { id: 'board-n',   re: /\bboard \d+[A-Za-z]?\b/gi },
  { id: 'Q-n',       re: /#?\bQ\d+\b/g },
  { id: 'P-phase',   re: /\bP[0-6](?:\.(?:M\d+|\d+[a-z]?|[a-z]))*\b/g },
  { id: 'issue-ref', re: /#\d{3,}(?:\.\d+[a-z]?)*\b/g, codeOnly: true },
  { id: 'slice-n',   re: /\bslice[ ]+(?:\d|[A-Z]\.)/gi },
  { id: 'V-tag',     re: /\bV\d+\.\d+\b/g },
  // Journey tags (2026-08-02, Frits: "the code must be readable standalone").
  // `J-CS8`, `J-R4`, `J-NP3` mean nothing without the private JOURNEYS.md — and that file is gitignored,
  // so for a public reader they are unresolvable by construction. Name what the journey CHECKS.
  //
  { id: 'journey-id',   re: /\bJ-[A-Z]{1,3}\d{1,2}(?:\.\d+)?\b/g },

  // Checklist ids in LABEL position — `B4 — `, `M1-S3: `, `L1b — ` (2026-08-03).
  //
  // This was previously recorded here as impossible: matching checklist ids flagged 899 sites, because
  // `B1`/`C3`/`L4` collide with legitimate identifiers everywhere, and a guard that cannot tell a plan
  // reference from a variable is worse than the written rule — its noise trains people to ignore it.
  //
  // That reasoning holds for a BARE token and only for a bare token. The label FORM does not collide,
  // because what identifies it is not the token but the punctuation after it: an id followed by an
  // em-dash or a colon and a space is a comment introducing a section, never an expression. `B4 — ` is
  // a label; `B4` in `const B4 = …` or `roster.B4` is not, and this pattern does not see it.
  //
  // Requiring the separator is the whole trick, so do not relax it to a bare `\b<id>\b`: that is the
  // 899-site version, and it is the reason this guard did not exist for a year.
  //
  // KNOWN false positives, both carried in the baseline rather than special-cased — the shapes are too
  // rare to be worth complicating the regex, and each is obvious on sight:
  //   • `R2/S3 — ` in blob-gateway/sigv4.js — Cloudflare R2 and Amazon S3, the storage products.
  //   • `circle Y on R2 — ` in relay/test/twoRelaysNoLinkage — the second RELAY in that test.
  // If a third appears in the same family (a product or a local label that happens to look like an id),
  // prefer adding it to the baseline over loosening the pattern.
  { id: 'plan-label',   re: /\b(?:[A-FLNRS]\d{1,2}[a-z]?|M\d+-S\d{1,2})\s*(?:—|–|--|:)\s+/g },

  // The same thing spelled out (2026-08-03, found by grepping for what `plan-label` MISSED — the first
  // sweep reported the web shell clean, and these were sitting in the files it had just rewritten).
  // `OBJ-2`, `Objective D`, `Track C` are planning buckets wherever they appear, and unlike the bare
  // checklist ids they do not collide with anything, so they need no separator to be unambiguous.
  // NB `Phase <n>` is deliberately NOT here: it is enforced on the public API surface only
  // (PUBLIC_SURFACE_PATTERNS), because it is common in internal working notes — that call predates this
  // pattern and is left standing rather than quietly reversed.
  { id: 'plan-bucket',  re: /\b(?:OBJ-\d+|Objective\s+[A-Z]\b|Track\s+[A-Z]\b)/g },
];

// EXTRA patterns enforced ONLY on the PUBLIC API surface (context 'api':
// docs/api/** + wave-1 package.json descriptions). These forms are planning
// codenames wherever they surface in the published reference, but are common
// enough in INTERNAL working-note comments (design-section citations, phase
// tags) that flagging them tree-wide would be noisy — so they are scoped to the
// generator's public projection, where a fresh reader actually meets them.
//   phase-word  — a spelled-out planning phase, "Phase 52.2.x", "Phase 50.1.A".
//   std-P       — "standardisation P1"-style standardisation-phase tag.
//   Q-letter    — an open-question ref, "Q-D.1" / "Q-F.2".
//   Q-hash      — an open-question ref, "Q#2".
//   followup    — a lettered follow-up label, "follow-up A".
//   section-ref — a plan/design SECTION ref, "§1b" / "§52.10".
//   V-milestone — a bare milestone label, "V0" / "V1" (the dotted V<n>.<n> form
//                 is already the base V-tag; this catches the bare milestone).
export const PUBLIC_SURFACE_PATTERNS = [
  { id: 'phase-word',  re: /\bPhase\s+\d+(?:\.(?:\d+|x))*[a-z]?\b/gi },
  { id: 'std-P',       re: /\bstandardisation\s+P\d+\b/gi },
  { id: 'Q-letter',    re: /\bQ-[A-Z]\.\d+\b/g },
  { id: 'Q-hash',      re: /\bQ#\d+\b/g },
  { id: 'followup',    re: /\bfollow-up\s+[A-Z]\b/g },
  { id: 'section-ref', re: /§\s?\d+(?:\.\d+)*[a-z]?\b/g },
  { id: 'V-milestone', re: /\bV[0-9]\b/g },
];

/**
 * All codename hits in a masked text; returns [{id, match, index}].
 * `context`:
 *   'code' (default) — source comments: the base patterns (incl. codeOnly).
 *   'doc'            — public doc prose: base patterns minus codeOnly.
 *   'api'            — the generated API reference + wave-1 descriptions:
 *                      base (minus codeOnly) PLUS PUBLIC_SURFACE_PATTERNS.
 */
export function findCodenames(maskedText, context = 'code') {
  const patterns = context === 'api'
    ? [...CODENAME_PATTERNS, ...PUBLIC_SURFACE_PATTERNS]
    : CODENAME_PATTERNS;
  const hits = [];
  for (const { id, re, codeOnly } of patterns) {
    if (codeOnly && context !== 'code') continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(maskedText))) {
      hits.push({ id, match: m[0], index: m.index });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return hits;
}
