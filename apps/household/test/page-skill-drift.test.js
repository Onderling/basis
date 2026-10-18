/**
 * Household page skill drift canary (2026-05-21).
 *
 * Sibling of `apps/tasks-v0/test/page-skill-drift.test.js` and
 * `apps/pinboard/test/page-skill-drift.test.js`.  Household has a tiny
 * web surface (one `main.js`) and a small skill registry, but the
 * canary closes the loop here too — any future page-side skill
 * reference must map to a real skill.
 *
 * Household's skill registration is split:
 *   - `HOUSEHOLD_SKILL_REGISTRY` (src/skillRegistry.js) — manifest-
 *     declared skills wired via the registry.
 *   - `agent.register('<id>', handler)` (bin/household-web.js) —
 *     the special-case `chat` endpoint that bridges the web form
 *     to the LLM-mediated HouseholdAgentFreeform.
 *
 * Both are scanned.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOUSEHOLD_SKILL_REGISTRY } from '../src/skillRegistry.js';

const HERE   = dirname(fileURLToPath(import.meta.url));
const APP    = join(HERE, '..');
const WEB_JS = join(APP, 'web', 'main.js');
const WEB_HTML = join(APP, 'web', 'index.html');
const WEB_BIN  = join(APP, 'bin', 'household-web.js');

// (Empty today — household has no known orphan skill refs.  Add
// per-page entries here with a comment if real architectural
// exceptions come up.)
const ALLOWLIST = new Set([]);

function stripJsComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

function collectIdsFromText(text, strip) {
  const stripped = strip(text);
  const ids = new Set();
  for (const m of stripped.matchAll(
    /callSkill\(['"]([A-Za-z_][\w-]*)['"]/g,
  )) {
    ids.add(m[1]);
  }
  return ids;
}

function collectPageSkillIds() {
  const ids = new Set();
  for (const id of collectIdsFromText(readFileSync(WEB_JS, 'utf8'), stripJsComments)) ids.add(id);
  for (const id of collectIdsFromText(readFileSync(WEB_HTML, 'utf8'), stripHtmlComments)) ids.add(id);
  return ids;
}

function collectRealSkillIds() {
  const ids = new Set(Object.keys(HOUSEHOLD_SKILL_REGISTRY));
  // Skills registered via agent.register('<id>', ...) — currently
  // `chat` lives only here, wired by bin/household-web.js.
  const binText = stripJsComments(readFileSync(WEB_BIN, 'utf8'));
  for (const m of binText.matchAll(
    /agent\.register\(['"]([A-Za-z_][\w-]*)['"]/g,
  )) {
    ids.add(m[1]);
  }
  return ids;
}

describe('household page skill drift canary', () => {
  it('every callSkill(<id>) in web/main.js + web/index.html maps to a real skill', () => {
    const pageIds = collectPageSkillIds();
    const real    = collectRealSkillIds();

    const orphans = [...pageIds].filter((id) => !real.has(id) && !ALLOWLIST.has(id)).sort();

    expect(
      orphans,
      `household pages call skill IDs that are not registered anywhere:\n` +
        `  ${orphans.join('\n  ')}\n\n` +
        `Fix by:\n` +
        `  (a) correcting the typo in the page, OR\n` +
        `  (b) adding the skill to HOUSEHOLD_SKILL_REGISTRY or\n` +
        `      registering it via agent.register() in household-web.js, OR\n` +
        `  (c) if the call is intentionally to a non-skill, add the\n` +
        `      id to ALLOWLIST in this test with a comment.\n`,
    ).toEqual([]);
  });

  it('reports the size of both sets (sanity check)', () => {
    const pageIds = collectPageSkillIds();
    const real    = collectRealSkillIds();
    // Household's web is tiny; just assert non-empty.
    expect(real.size, 'should find at least the registry skills').toBeGreaterThan(0);
    // pageIds may be 0 or small.
    expect(pageIds.size, 'should be a finite (possibly empty) number').toBeGreaterThanOrEqual(0);
  });
});
