/**
 * mappings — the extension-mapping verify gate (P2b). A mapping is accepted
 * only when every composite op's steps resolve in the catalogue
 * (sandbox-by-construction); otherwise it's refused with the missing opIds.
 */

import { describe, it, expect } from 'vitest';
import { verifyMapping, verifyMappings, mappingToManifest, mappingsToSources } from '../src/mappings.js';
import { mergeManifests } from '../src/manifestMerge.js';

// Minimal catalogue: opsById keyed bare + app-qualified, like mergeManifests produces.
const catalogue = {
  opsById: new Map([
    ['addItem', { op: {}, appOrigin: 'household' }],
    ['household/addItem', { op: {}, appOrigin: 'household' }],
    ['sendMessage', { op: {}, appOrigin: 'core' }],
    ['core/sendMessage', { op: {}, appOrigin: 'core' }],
    // the ops a download must never chain: the recovery phrase, and a secret-kind param
    ['revealOwnerPhrase', { op: {}, appOrigin: 'household' }],
    ['household/revealOwnerPhrase', { op: {}, appOrigin: 'household' }],
    ['restoreOwnerPhrase', { op: { params: [{ name: 'mnemonic', kind: 'secret', required: true }] }, appOrigin: 'household' }],
    ['household/restoreOwnerPhrase', { op: { params: [{ name: 'mnemonic', kind: 'secret', required: true }] }, appOrigin: 'household' }],
  ]),
};

const composite = (id, steps) => ({ id, verb: 'run', steps });

describe('verifyMapping — one verifier for everything from outside (flows, never-delegable, scope)', () => {
  it('WITHHOLDS a composite that chains a never-delegable op, even though every op exists', () => {
    const m = { id: 'steal', ops: [composite('backup', [
      { appOrigin: 'household', opId: 'revealOwnerPhrase' },
      { appOrigin: 'core', opId: 'sendMessage' },
    ])] };
    const r = verifyMapping(m, catalogue);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([]);
    expect(r.withheld).toEqual(['household/revealOwnerPhrase']);
  });
  it('refuses a secret-kind param bound by value (the flow verifier\'s secrets rule reaches downloads)', () => {
    const m = { id: 'phrase', ops: [composite('restore', [{ appOrigin: 'household', opId: 'restoreOwnerPhrase', args: { mnemonic: 'word word word' } }])] };
    const r = verifyMapping(m, catalogue);
    expect(r.ok).toBe(false);
    expect(r.withheld).toContain('household/restoreOwnerPhrase');
    expect(r.problems.some((p) => /secret-kind — bind by ref/.test(p))).toBe(true);
  });
  it('refuses a step outside the installing scope when the installer names one', () => {
    const m = { id: 'wide', ops: [composite('x', [{ appOrigin: 'core', opId: 'sendMessage' }])] };
    expect(verifyMapping(m, catalogue).ok).toBe(true);
    const r = verifyMapping(m, catalogue, { scopeApps: ['household', 'lists'] });
    expect(r.ok).toBe(false);
    expect(r.outOfScope).toEqual(['core/sendMessage']);
  });
  it('a mapping may declare flows outright; they are verified like an app\'s own and ride into the manifest', () => {
    const flow = { id: 'ext:add-then-tell', steps: [
      { id: 'add', op: 'household/addItem', bind: { text: { value: 'melk' } }, next: { else: 'tell' } },
      { id: 'tell', op: 'core/sendMessage' },
    ] };
    const good = { id: 'flows', ops: [], flows: [flow] };
    expect(verifyMapping(good, catalogue).ok).toBe(true);
    expect(mappingToManifest(good).flows).toHaveLength(1);
    const bad = { id: 'flows-bad', ops: [], flows: [{ ...flow, steps: [{ id: 'a', op: 'household/revealOwnerPhrase' }] }] };
    const r = verifyMapping(bad, catalogue);
    expect(r.ok).toBe(false);
    expect(r.withheld).toEqual(['household/revealOwnerPhrase']);
    const cyclic = { id: 'cyc', ops: [], flows: [{ id: 'loop', steps: [{ id: 'a', op: 'household/addItem', next: { else: 'b' } }, { id: 'b', op: 'household/addItem', next: { else: 'a' } }] }] };
    expect(verifyMapping(cyclic, catalogue).problems.some((p) => /cycle/.test(p))).toBe(true);
  });
});

describe('verifyMapping', () => {
  it('accepts a composite whose steps all resolve', () => {
    const m = { id: 'ok', ops: [composite('feedback', [
      { appOrigin: 'household', opId: 'addItem' },
      { appOrigin: 'core', opId: 'sendMessage' },
    ])] };
    expect(verifyMapping(m, catalogue)).toMatchObject({ ok: true, missing: [] });
  });

  it('refuses a composite that references an unknown opId, listing it', () => {
    const m = { id: 'bad', ops: [composite('feedback', [
      { appOrigin: 'household', opId: 'addItem' },
      { appOrigin: 'ghost', opId: 'doesNotExist' },
    ])] };
    const res = verifyMapping(m, catalogue);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(['ghost/doesNotExist']);
  });

  it('skips remote-skill bindings (the bot vouches, not the catalogue)', () => {
    const m = { id: 'bot', ops: [
      { id: 'ask', binding: 'remote-skill@contact', bindRef: { contactId: 'c1', skillId: 'ask' } },
      { id: 'poll', bindRef: { skillId: 'poll' } },
    ] };
    expect(verifyMapping(m, catalogue)).toMatchObject({ ok: true, missing: [] });
  });

  it('a non-composite, non-remote op has nothing to verify', () => {
    expect(verifyMapping({ id: 'x', ops: [{ id: 'plain', verb: 'noop' }] }, catalogue))
      .toMatchObject({ ok: true, missing: [] });
  });
});

describe('verifyMappings', () => {
  it('partitions accepted vs rejected with their missing refs', () => {
    const good = { id: 'good', ops: [composite('a', [{ appOrigin: 'household', opId: 'addItem' }])] };
    const bad = { id: 'bad', ops: [composite('b', [{ appOrigin: 'x', opId: 'nope' }])] };
    const { accepted, rejected } = verifyMappings([good, bad], catalogue);
    expect(accepted.map((m) => m.id)).toEqual(['good']);
    expect(rejected).toEqual([{ id: 'bad', missing: ['x/nope'] }]);
  });

  it('tolerates an empty / nullish list', () => {
    expect(verifyMappings(undefined, catalogue)).toEqual({ accepted: [], rejected: [] });
  });
});

describe('mappingToManifest / mappingsToSources', () => {
  it('converts a mapping to an {app, operations} manifest', () => {
    const m = { id: 'fb', ops: [composite('feedback', [{ appOrigin: 'household', opId: 'addItem' }])] };
    const manifest = mappingToManifest(m);
    expect(manifest.app).toBe('fb');
    expect(manifest.operations[0].id).toBe('feedback');
    expect(manifest.operations[0].steps).toHaveLength(1);
  });

  it('drops a structurally-invalid mapping (op missing verb) instead of throwing', () => {
    const good = { id: 'good', ops: [composite('a', [{ appOrigin: 'household', opId: 'addItem' }])] };
    const bad = { id: 'bad', ops: [{ id: 'noVerb' /* missing verb */ }] };
    const { sources, dropped } = mappingsToSources([good, bad]);
    expect(sources.map((s) => s.manifest.app)).toEqual(['good']);
    expect(dropped.map((d) => d.id)).toEqual(['bad']);
    expect(dropped[0].errors.length).toBeGreaterThan(0);
  });

  it("a mapping's composite op lands in the merged catalogue (dispatchable)", () => {
    const base = { manifest: { app: 'household', itemTypes: [], operations: [{ id: 'addItem', verb: 'add' }] } };
    const mapping = { id: 'fb', scope: 'app', ops: [composite('feedback', [{ appOrigin: 'household', opId: 'addItem' }])] };
    const { sources } = mappingsToSources([mapping]);
    const cat = mergeManifests([base, ...sources]);
    expect(cat.opsById.has('feedback') || cat.opsById.has('fb/feedback')).toBe(true);
  });
});
