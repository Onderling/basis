/**
 * mappings — the extension-mapping verify gate (P2b). A mapping is accepted
 * only when every composite op's steps resolve in the catalog
 * (sandbox-by-construction); otherwise it's refused with the missing opIds.
 */

import { describe, it, expect } from 'vitest';
import { verifyMapping, verifyMappings } from '../src/mappings.js';

// Minimal catalog: opsById keyed bare + app-qualified, like mergeManifests produces.
const catalog = {
  opsById: new Map([
    ['addItem', { op: {}, appOrigin: 'household' }],
    ['household/addItem', { op: {}, appOrigin: 'household' }],
    ['sendMessage', { op: {}, appOrigin: 'core' }],
  ]),
};

const composite = (id, steps) => ({ id, verb: 'run', steps });

describe('verifyMapping', () => {
  it('accepts a composite whose steps all resolve', () => {
    const m = { id: 'ok', ops: [composite('feedback', [
      { appOrigin: 'household', opId: 'addItem' },
      { appOrigin: 'core', opId: 'sendMessage' },
    ])] };
    expect(verifyMapping(m, catalog)).toEqual({ ok: true, missing: [] });
  });

  it('refuses a composite that references an unknown opId, listing it', () => {
    const m = { id: 'bad', ops: [composite('feedback', [
      { appOrigin: 'household', opId: 'addItem' },
      { appOrigin: 'ghost', opId: 'doesNotExist' },
    ])] };
    const res = verifyMapping(m, catalog);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(['ghost/doesNotExist']);
  });

  it('skips remote-skill bindings (the bot vouches, not the catalog)', () => {
    const m = { id: 'bot', ops: [
      { id: 'ask', binding: 'remote-skill@contact', bindRef: { contactId: 'c1', skillId: 'ask' } },
      { id: 'poll', bindRef: { skillId: 'poll' } },
    ] };
    expect(verifyMapping(m, catalog)).toEqual({ ok: true, missing: [] });
  });

  it('a non-composite, non-remote op has nothing to verify', () => {
    expect(verifyMapping({ id: 'x', ops: [{ id: 'plain', verb: 'noop' }] }, catalog))
      .toEqual({ ok: true, missing: [] });
  });
});

describe('verifyMappings', () => {
  it('partitions accepted vs rejected with their missing refs', () => {
    const good = { id: 'good', ops: [composite('a', [{ appOrigin: 'household', opId: 'addItem' }])] };
    const bad = { id: 'bad', ops: [composite('b', [{ appOrigin: 'x', opId: 'nope' }])] };
    const { accepted, rejected } = verifyMappings([good, bad], catalog);
    expect(accepted.map((m) => m.id)).toEqual(['good']);
    expect(rejected).toEqual([{ id: 'bad', missing: ['x/nope'] }]);
  });

  it('tolerates an empty / nullish list', () => {
    expect(verifyMappings(undefined, catalog)).toEqual({ accepted: [], rejected: [] });
  });
});
