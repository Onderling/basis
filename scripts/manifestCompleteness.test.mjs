/**
 * G-S1 — MANIFEST COMPLETENESS: the ops a manifest declares exist, and (where the app's shape lets
 * us say it strictly) the ops that exist are declared.
 *
 * The manifest is the source of truth for surfaces (invariant #4); an op declared with no
 * implementation reads as capability in every plan that cites it and fails at first dispatch —
 * `PLAN-agent-management-surface` sat "blocked on missing substrate" over exactly this class.
 *
 * Three apps, three shapes, three appropriate strictnesses (the first measurement, 2026-08-04,
 * decided these — see the ledger):
 *
 *   • **basis** — `createLocalBuiltins` returns a map KEYED BY OP ID. Both directions are checked
 *     STRICTLY (set equality), because they can be: today the sets match exactly (34 ≡ 34).
 *   • **stoop** — skills register three ways (defineSkill literals, a cores map, realAgent
 *     adapters) and the shell wizard registry implements the wizard ops, so "implemented" is a
 *     TEXT-level scan over the named implementation sources, biased to under-report (a mention
 *     counts). Declared-but-NOWHERE fails. The reverse direction is NOT hard-checked here: stoop's
 *     113 undeclared skills are protocol-internal ops (broadcast…, ingest…, record…) — the manifest
 *     deliberately declares the curated surface, and 113 allow-notes would be noise, not a guard.
 *   • **folio** — skills are built FROM the manifest (`buildSkillsFromManifest`), so declared ⇒
 *     implemented by construction; the known deliberate exception (the `listFiles` VIEW) is
 *     annotated in the manifest itself, and this test pins that the annotation stays.
 *
 * Allow-note mechanism: ALLOW below — op id → reason. An entry with no reason would not survive
 * review, which is the point.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

/** op id → reason. Empty today — basis measures exact, stoop's declared set all resolves. */
const ALLOW = {
  basisDeclaredUnimplemented: {},
  basisImplementedUndeclared: {},
  stoopDeclaredUnimplemented: {},
};

describe('G-S1 — manifest completeness', () => {
  it('basis: declared ops ≡ implemented builtins (both directions, strict)', async () => {
    const m = await load('apps/basis/manifest.js');
    const manifest = m.default ?? m.basisManifest;
    const { createLocalBuiltins } = await load('apps/basis/src/core/localBuiltins.js');
    // Deps are closed over, consulted only at CALL time — stubs suffice to enumerate the surface.
    const impl = new Set(Object.keys(createLocalBuiltins({ catalog: { apps: [] }, t: (k) => k })));
    const decl = new Set((manifest.operations ?? []).map((o) => o.id));

    const declaredUnimplemented = [...decl]
      .filter((id) => !impl.has(id) && !ALLOW.basisDeclaredUnimplemented[id]);
    const implementedUndeclared = [...impl]
      .filter((id) => !decl.has(id) && !ALLOW.basisImplementedUndeclared[id]);

    expect(declaredUnimplemented, 'basis declares op(s) nothing implements').toEqual([]);
    expect(implementedUndeclared,
      'basis implements op(s) the manifest does not declare — the manifest is the surface truth').toEqual([]);
  });

  it('stoop: every declared op resolves to SOME implementation source', async () => {
    const m = await load('apps/stoop/manifest.js');
    const manifest = m.default ?? m.stoopManifest;
    // The places a stoop op is implemented: its own skills + service, the realAgent adapters that
    // synthesize ops (getCurrentGroup etc.), the chat layer (startDm), the circle-scope dispatch
    // adapters, and the shell wizard registry (the *Wizard ops are shell-implemented flows).
    const sources = [
      'apps/stoop/src/skills/index.js',
      'apps/stoop/src/Service.js',
      'apps/stoop/src/chat/llmChat.js',
      'apps/basis/src/core/agent/realAgent.js',
      'apps/basis/src/v2/circleStoopScope.js',
      'apps/basis-mobile/src/core/wizardRegistry.js',
    ].map((rel) => readFileSync(path.join(ROOT, rel), 'utf8')).join('\n');

    const missing = (manifest.operations ?? []).map((o) => o.id)
      .filter((id) => !new RegExp(`\\b${id}\\b`).test(sources))
      .filter((id) => !ALLOW.stoopDeclaredUnimplemented[id]);
    expect(missing,
      'stoop declares op(s) that appear in NO implementation source — declared-without-implementation')
      .toEqual([]);
  });

  it('folio: skills build FROM the manifest; the listFiles-VIEW exception stays annotated', async () => {
    const src = readFileSync(path.join(ROOT, 'apps/folio/manifest.js'), 'utf8');
    // The annotation is the allow-note: the VIEW is deliberate, the OP is real. If it vanishes,
    // either the exception was fixed (delete this assertion with it) or the note was lost (restore it).
    expect(src).toMatch(/listFiles/);
    expect(src, 'the deliberate-exception annotation must stay beside the declaration')
      .toMatch(/strict.*flag|deliberate|historical note/i);
  });
});
