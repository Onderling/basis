// Tests for the codename naming-hygiene guard (scripts/lint-codenames.mjs +
// scripts/codenames-scope.mjs).
//   npm run test:codenames   (root)  →  vitest run scripts/lint-codenames.test.mjs
//
// Covers: the curated patterns FLAG real codenames; the low-false-positive
// commitments (lookalikes NOT flagged); comments/prose are scanned but code/
// strings/fenced-code are NOT; and the forward-protection invariant — the real
// tree is CLEAN today, so any new codename in a scoped comment/doc fails here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  tracked, isScopedCode, isScopedDoc, isPublicApiDoc, isWave1PkgJson,
  commentMask, docProseMask, pkgDescriptionMask, findCodenames,
} from './codenames-scope.mjs';

const ids = (s, mask = commentMask) => findCodenames(mask(s)).map((h) => h.id);
// Public-API surface (docs/api + wave-1 package.json descriptions): base + extras.
const apiIds = (s, mask = docProseMask) => findCodenames(mask(s), 'api').map((h) => h.id);

/** Mirror the guard's per-file scope selection (scripts/lint-codenames.mjs scopeOf). */
function scopeOf(f) {
  if (isWave1PkgJson(f)) return { mask: pkgDescriptionMask, context: 'api' };
  if (isPublicApiDoc(f)) return { mask: docProseMask, context: 'api' };
  if (isScopedCode(f)) return { mask: commentMask, context: 'code' };
  if (isScopedDoc(f)) return { mask: docProseMask, context: 'doc' };
  return null;
}

describe('curated patterns FLAG real internal codenames', () => {
  const cases = [
    ['// cluster K · K2 — composable lists', 'cluster-K'],
    ['// the K2 containment substrate', 'K-spike'],
    ['// SP-13.2 — kring stream', 'SP-n'],
    ['// SP-3b consumer-switch', 'SP-n'],
    ['// board 5B shows action buttons', 'board-n'],
    ['// Q27 confirm gate', 'Q-n'],
    ['// same Q15 pattern', 'Q-n'],
    ['// P2 CONTROL ops', 'P-phase'],
    ['// P6.M7 folio notes-list', 'P-phase'],
    ['// P6.9 first-run mnemonic', 'P-phase'],
    ['// closes issue #347 in the tracker', 'issue-ref'],
    ['// B · Slice 4 — the capability gate', 'slice-n'],
    ['// read slice 2026-07-09', 'slice-n'],
    ['// V2.8 phase tag', 'V-tag'],
    ['// V0.2 adoption', 'V-tag'],
  ];
  for (const [line, id] of cases) {
    it(`flags ${JSON.stringify(line)} as ${id}`, () => {
      expect(ids(line)).toContain(id);
    });
  }
});

describe('LOW FALSE-POSITIVE: lookalikes are NOT flagged', () => {
  const clean = [
    '// the keyboard 3 rows below',       // "board 3" must need a word boundary
    '// a P2P transport hop',              // P2P is not a P2 phase label
    '// bumped to #12 in the list',        // 1–2 digit #refs are ordinals, not issue refs
    '// see item #7 above',
    '// the v2 design tier directory',     // lowercase v2 is a real dir, not a V-tag
    '// V2 without a dotted minor',        // needs V<n>.<n>
    '// the capability id tasks-v0 uses',  // load-bearing identifier, not a codename
    '// dispatchReady is the waist',       // no codename at all
    '// HTTP 404 / 500 handling',          // status codes, not issue refs
  ];
  for (const line of clean) {
    it(`does not flag ${JSON.stringify(line)}`, () => {
      expect(ids(line)).toEqual([]);
    });
  }
});

describe('scope: only COMMENTS / PROSE are scanned', () => {
  it('a codename inside a JS string literal is NOT flagged', () => {
    expect(ids(`const label = 'board 5B';`)).toEqual([]);
    expect(ids('const x = `cluster K`;')).toEqual([]);
  });
  it('a codename inside a JS comment IS flagged', () => {
    expect(ids(`const x = 1; // board 5B`)).toContain('board-n');
  });
  it('a codename inside a markdown fenced code block is NOT flagged', () => {
    const md = 'prose is clean here\n```\n// board 5B in a sample\n```\n';
    expect(ids(md, docProseMask)).toEqual([]);
  });
  it('a codename in markdown prose IS flagged', () => {
    expect(ids('This lands in board 5B of the design.', docProseMask)).toContain('board-n');
  });
  it('a bare #issue ref is flagged in CODE but NOT in doc prose (legit citation)', () => {
    const codeHits = findCodenames(commentMask('// see #347 for the fix'), 'code').map((h) => h.id);
    const docHits = findCodenames(docProseMask('Tracked as #347 in the matrix.'), 'doc').map((h) => h.id);
    expect(codeHits).toContain('issue-ref');
    expect(docHits).not.toContain('issue-ref');
  });
});

describe('PUBLIC API surface: the fuller pattern set (base + extras)', () => {
  // The extras are enforced on docs/api/** + wave-1 package.json descriptions —
  // the projection of wave-1 exported-symbol JSDoc that a fresh reader meets.
  const flagged = [
    ['A spelled-out planning phase — Phase 52.2.x.', 'phase-word'],
    ['Extracted 2026-05-11 (Phase 50.1.A).', 'phase-word'],
    ['as part of the standardisation P1 work.', 'std-P'],
    ['Locked Q-D.1: five standard roles.', 'Q-letter'],
    ['peer-fetch gate (Q#2 2026-05-14).', 'Q-hash'],
    ['follow-up B — snapshot support.', 'followup'],
    ['the §1b capability-routing seam.', 'section-ref'],
    ['see plan §52.10 for the layout.', 'section-ref'],
    ['V0 ships the first two modes.', 'V-milestone'],
  ];
  for (const [line, id] of flagged) {
    it(`flags ${JSON.stringify(line)} as ${id} on the public surface`, () => {
      expect(apiIds(line)).toContain(id);
    });
  }
  it('the EXTRA pattern ids never fire in ordinary source comments (extras are api-scope only)', () => {
    for (const [line, id] of flagged) {
      // Base patterns may still legitimately fire (e.g. "P1" as P-phase); the
      // POINT is that the api-only extra id is not produced outside api scope.
      expect(findCodenames(commentMask(`// ${line}`), 'code').map((h) => h.id)).not.toContain(id);
    }
  });
  it('reads a package.json description via pkgDescriptionMask, not its other fields', () => {
    const pj = '{\n  "name": "@onderling/pseudo-pod",\n  "description": "Standardisation Phase 52.2 companion.",\n  "version": "0.1.0"\n}\n';
    expect(apiIds(pj, pkgDescriptionMask)).toContain('phase-word');
    // the version 0.1.0 and package name must not be mistaken for codenames
    const clean = '{\n  "name": "@onderling/x",\n  "description": "A plain, honest description.",\n  "version": "1.2.0"\n}\n';
    expect(apiIds(clean, pkgDescriptionMask)).toEqual([]);
  });
});

describe('FORWARD PROTECTION: nothing leaks in beyond the recorded debt', () => {
  // This asserted an ABSOLUTELY clean tree until 2026-08-03, when the `plan-label` pattern started
  // catching checklist ids (`B4 — `, `M1-S3: `) that had been unguardable before. That pattern found
  // ~500 pre-existing sites, so an absolute assertion would have meant either deleting the guard or
  // rewriting every one of them in a single change.
  //
  // So it now mirrors the LINT SCRIPT's ceiling semantics instead: known sites are carried in
  // `codenames-baseline.json` as debt, and anything NOT in that file fails. The guard's real job is
  // unchanged — a codename you add today still fails here — and the debt can only be paid down,
  // because `--update` is the only way to rewrite the baseline and it is reviewed like any other diff.
  const siteKey = (f, h) => `${f}:${h.id}:${h.match}`;
  const known = new Set(
    JSON.parse(readFileSync(new URL('codenames-baseline.json', import.meta.url), 'utf8')).sites ?? [],
  );

  it('no NEW internal codename in any scoped source comment, doc, api-ref, or wave-1 description', () => {
    const hits = [];
    for (const f of tracked()) {
      const scope = scopeOf(f);
      if (!scope) continue;
      let src;
      try { src = readFileSync(f, 'utf8'); } catch { continue; }
      for (const h of findCodenames(scope.mask(src), scope.context)) {
        if (!known.has(siteKey(f, h))) hits.push(`${f} [${h.id}: ${h.match}]`);
      }
    }
    expect(hits, `codenames leaked back into a scoped surface:\n${hits.join('\n')}`).toEqual([]);
  });

  it('the baseline is DEBT, not a licence — every entry still exists in the tree', () => {
    // A baseline that outlives the code it describes silently grants permission for names nobody
    // has written yet. Entries that no longer match anything are stale and must be pruned.
    const live = new Set();
    for (const f of tracked()) {
      const scope = scopeOf(f);
      if (!scope) continue;
      let src;
      try { src = readFileSync(f, 'utf8'); } catch { continue; }
      for (const h of findCodenames(scope.mask(src), scope.context)) live.add(siteKey(f, h));
    }
    const stale = [...known].filter((k) => !live.has(k));
    expect(stale, `baseline entries that no longer exist — run --update:\n${stale.join('\n')}`).toEqual([]);
  });
});
