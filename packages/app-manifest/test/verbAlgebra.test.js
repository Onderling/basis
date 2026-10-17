/**
 * FITNESS FUNCTION — the verb × noun ALGEBRA is enforced.
 *
 * The uniforme-representatie convention (CLAUDE.md + PLAN-capabilities-tasks-
 * roles.md Phase 0 "CONVENTION FINDING"): an app's member-facing capability
 * surface is a set of `(verb × noun)` pairs, where the VERB is a CANONICAL SDK
 * ATOM (`CANONICAL_ATOMS`) and the NOUN is a declared item-type. The manifest
 * declares this as `nouns[noun].atoms` — but the convention was DOCUMENTED, not
 * GUARDED: nothing scanned every app's declarations and failed a ROGUE VERB (an
 * atom that isn't in the canonical set, or an alias smuggled in as a
 * declaration). This test is that guard.
 *
 * It discovers EVERY `apps/<app>/manifest.js` on disk (dynamic fs scan, like
 * `manifestConformance.test.js`), reads each `nouns[noun].atoms` declaration,
 * and FAILS if any declared atom is not a CANONICAL_ATOM in its canonical
 * spelling. A new app that declares a rogue verb fails CI here automatically.
 *
 * (Op-level atom discipline — every `op.verb` is an atom OR a declared
 * domainVerb — is enforced separately by the `verb-not-atom` conformance rule;
 * this test is the DECLARATION-side guard on `nouns[].atoms`, the explicit
 * capability surface.)
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CANONICAL_ATOMS, canonicalAtom, validateManifest } from '../src/index.js';

const appsDir = fileURLToPath(new URL('../../../apps/', import.meta.url));
const CANONICAL = new Set(CANONICAL_ATOMS);

/** Discover every apps/<app>/manifest.js on disk. */
function discoverManifestApps() {
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(new URL(`../../../apps/${name}/manifest.js`, import.meta.url)))
    .sort();
}

/** Every (noun, atom, path) triple declared in a manifest's `nouns` block. */
function declaredAtoms(manifest) {
  const out = [];
  const nouns = (manifest?.nouns && typeof manifest.nouns === 'object' && !Array.isArray(manifest.nouns))
    ? manifest.nouns : {};
  for (const [noun, decl] of Object.entries(nouns)) {
    for (const atom of (Array.isArray(decl?.atoms) ? decl.atoms : [])) {
      out.push({ noun, atom, path: `/nouns/${noun}` });
    }
  }
  return out;
}

const APPS = discoverManifestApps();

describe('FITNESS: verb × noun algebra — nouns[].atoms are canonical SDK atoms', () => {
  it('discovers the app manifests (guards against a broken scan)', () => {
    expect(APPS.length).toBeGreaterThanOrEqual(6);
    for (const expected of ['tasks-v0', 'pinboard', 'household', 'calendar', 'folio']) {
      expect(APPS, `expected ${expected} among discovered app manifests`).toContain(expected);
    }
  });

  for (const app of APPS) {
    it(`${app}: every declared nouns[].atoms entry is a CANONICAL_ATOM`, async () => {
      const href = new URL(`../../../apps/${app}/manifest.js`, import.meta.url).href;
      const mod = await import(/* @vite-ignore */ href);
      const manifest = mod.default;
      expect(manifest, `${app}/manifest.js has no default export`).toBeTruthy();

      const rogue = [];
      for (const { noun, atom, path } of declaredAtoms(manifest)) {
        if (typeof atom !== 'string' || atom === '') {
          rogue.push(`${path}: non-string atom ${JSON.stringify(atom)}`);
        } else if (!CANONICAL.has(atom)) {
          // Either a total unknown, or an ALIAS declared where the canonical
          // spelling is required — both are rogue for the surface.
          const canon = canonicalAtom(atom);
          rogue.push(
            canon
              ? `${path}: "${atom}" is an alias — declare the canonical atom "${canon}"`
              : `${path}: "${atom}" is not a canonical SDK atom (not in CANONICAL_ATOMS)`,
          );
        }
      }
      expect(rogue, `${app} declares rogue verb(s):\n    ${rogue.join('\n    ')}`).toEqual([]);
    });
  }

  it('CANONICAL_ATOMS covers every atom the app manifests actually declare (constant stays derived-from-reality)', async () => {
    const used = new Set();
    for (const app of APPS) {
      const href = new URL(`../../../apps/${app}/manifest.js`, import.meta.url).href;
      const mod = await import(/* @vite-ignore */ href);
      for (const { atom } of declaredAtoms(mod.default)) {
        if (typeof atom === 'string') used.add(atom);
      }
    }
    const uncovered = [...used].filter((a) => !CANONICAL.has(a));
    expect(uncovered, `atoms declared by manifests but absent from CANONICAL_ATOMS: ${uncovered.join(', ')}`).toEqual([]);
  });
});

describe('the verb-algebra guard bites (negative cases)', () => {
  // A shell-shaped conformant baseline that declares a noun surface.
  const baseline = () => ({
    app: 'probe',
    itemTypes: ['thing'],
    nouns: { thing: { atoms: ['add', 'list'] } },
    operations: [{ id: 'addThing', verb: 'add', appliesTo: { type: 'thing' } }],
  });

  const rogueInNouns = (m) => {
    const atoms = declaredAtoms(m);
    return atoms.some(({ atom }) => !CANONICAL.has(atom));
  };

  it('a canonical declaration has no rogue verbs', () => {
    expect(rogueInNouns(baseline())).toBe(false);
  });

  it('catches an unknown verb in a nouns[].atoms declaration', () => {
    const m = baseline();
    m.nouns.thing.atoms = ['add', 'frobnicate'];
    expect(rogueInNouns(m)).toBe(true);
  });

  it('catches an ALIAS declared instead of its canonical atom', () => {
    const m = baseline();
    m.nouns.thing.atoms = ['add', 'create']; // 'create' is an alias of 'add'
    expect(rogueInNouns(m)).toBe(true);
  });

  it('validateManifest also rejects the same rogue declarations (defence in depth)', () => {
    const m = baseline();
    m.nouns.thing.atoms = ['add', 'frobnicate'];
    const r = validateManifest(m);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'unknown-atom')).toBe(true);
  });
});
