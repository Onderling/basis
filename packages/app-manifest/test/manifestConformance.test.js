/**
 * FITNESS FUNCTION — every app manifest is CONFORMANT.
 *
 * The §6 standardisation backbone (CLAUDE.md invariant #4: "the manifest is the
 * source of truth for surfaces"). `manifestConformance` encodes the standard
 * every real app manifest holds to — structural validity, atom discipline, §1a
 * noun-declaration discipline, and projector totality. This test discovers
 * EVERY `apps/<app>/manifest.js` and asserts each is conformant, with a per-app
 * per-issue breakdown on failure. A manifest that drifts — a rogue verb, a
 * noun-op with no `nouns` block, a shape a projector chokes on — fails CI here.
 *
 * Discovery is dynamic (filesystem scan), so a NEW app with a manifest is held
 * to the standard automatically — you can't add a non-conformant app silently.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { manifestConformance } from '../src/index.js';

const appsDir = fileURLToPath(new URL('../../../apps/', import.meta.url));

/** Discover every apps/<app>/manifest.js on disk. */
function discoverManifestApps() {
  return readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(new URL(`../../../apps/${name}/manifest.js`, import.meta.url)))
    .sort();
}

/** Format a conformance result as a scannable per-issue breakdown. */
function breakdown(app, result) {
  const lines = result.issues.map(
    (i) => `    [${i.code}] ${i.path ?? ''}${i.surface ? ` (${i.surface})` : ''} — ${i.message}`,
  );
  return `${app} is NOT manifest-conformant:\n${lines.join('\n')}`;
}

const APPS = discoverManifestApps();

describe('FITNESS: manifest conformance (§6 standardisation)', () => {
  it('discovers the known app manifests', () => {
    // Sanity: the scan actually found the fleet of app manifests (guards against
    // a broken glob silently checking nothing).
    expect(APPS.length).toBeGreaterThanOrEqual(6);
    for (const expected of ['tasks-v0', 'stoop', 'household', 'calendar', 'folio', 'basis']) {
      expect(APPS, `expected ${expected} among discovered app manifests`).toContain(expected);
    }
  });

  for (const app of APPS) {
    it(`${app}: manifest.js is conformant`, async () => {
      const href = new URL(`../../../apps/${app}/manifest.js`, import.meta.url).href;
      const mod = await import(/* @vite-ignore */ href);
      const manifest = mod.default;
      expect(manifest, `${app}/manifest.js has no default export`).toBeTruthy();
      const result = manifestConformance(manifest);
      expect(result.ok, breakdown(app, result)).toBe(true);
    });
  }
});

describe('manifestConformance: the guard bites (negative cases)', () => {
  // A minimal conformant baseline to mutate — shell-shaped (no noun ops, no nouns).
  const baseline = () => ({
    app: 'probe',
    itemTypes: ['thing'],
    operations: [{ id: 'help', verb: 'help' }],
    domainVerbs: { help: 'read' },
  });

  it('accepts a minimal conformant manifest', () => {
    expect(manifestConformance(baseline()).ok).toBe(true);
  });

  it('rejects a non-object manifest with invalid-structure', () => {
    const r = manifestConformance(null);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'invalid-structure')).toBe(true);
  });

  it('rejects a structurally-broken manifest (missing app)', () => {
    const m = baseline();
    delete m.app;
    const r = manifestConformance(m);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'invalid-structure' && i.path === '/app')).toBe(true);
  });

  it('rejects an undeclared non-atom verb with verb-not-atom', () => {
    const m = baseline();
    m.operations = [{ id: 'frobnicateThing', verb: 'frobnicate' }];
    const r = manifestConformance(m);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'verb-not-atom')).toBe(true);
  });

  it('rejects a noun-bearing atom op with no `nouns` block (nouns-required, §1a)', () => {
    const m = {
      app: 'probe',
      itemTypes: ['thing'],
      operations: [{ id: 'addThing', verb: 'add', appliesTo: { type: 'thing' } }],
    };
    const r = manifestConformance(m);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'nouns-required')).toBe(true);
  });

  it('rejects a vacuous `nouns` block on a shell manifest (nouns-vacuous, §1a / #81)', () => {
    const m = baseline();
    m.nouns = { thing: { atoms: ['add'] } }; // declared, but no noun-bearing op uses it
    const r = manifestConformance(m);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'nouns-vacuous')).toBe(true);
  });

  it('accepts a noun-bearing atom op WHEN `nouns` is declared', () => {
    const m = {
      app: 'probe',
      itemTypes: ['thing'],
      nouns: { thing: { atoms: ['add'] } },
      operations: [{ id: 'addThing', verb: 'add', appliesTo: { type: 'thing' } }],
    };
    expect(manifestConformance(m).ok).toBe(true);
  });

  it('surfaces registry-noncanonical nouns as NON-blocking warnings (F-SP1-a)', () => {
    // `thing` is not in the @onderling/item-types registry, but app-local nouns are
    // permitted — a warning, never a conformance failure.
    const r = manifestConformance(baseline());
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.code === 'noncanonical-itemtype')).toBe(true);
  });
});
