/**
 * capabilities — the (verb × noun) set B's gate authorises (B · Layer 1).
 * Covers: derivation from ops (appliesTo.type AND type-enum params), declared `nouns`,
 * the declared∪derived union, opId resolution, and the `nouns` shape validation.
 */
import { describe, it, expect } from 'vitest';
import { capabilitiesOf, resolveAtom, atomsForNoun } from '../src/capabilities.js';
import { validateManifest } from '../src/validate.js';

// A manifest exercising BOTH ways an op names its noun:
//  - addItem carries the noun in a type-enum PARAM (of: LIST_TYPES);
//  - markComplete / claim carry it in appliesTo.type.
const M = {
  app: 'demo',
  itemTypes: ['shopping', 'task'],
  domainVerbs: { help: 'read' },
  nouns: {
    shopping: { atoms: ['add', 'list', 'complete', 'remove'] },
    task:     { atoms: ['add', 'complete', 'claim', 'update'] },   // `update` declared but no op implements it
  },
  operations: [
    { id: 'addItem',      verb: 'add',      params: [{ name: 'type', kind: 'enum', of: ['shopping'] }] },
    { id: 'listOpen',     verb: 'list',     params: [{ name: 'type', kind: 'enum', of: ['shopping'] }] },
    { id: 'markComplete', verb: 'complete', appliesTo: { type: ['shopping', 'task'] } },
    { id: 'removeItem',   verb: 'remove',   appliesTo: { type: ['shopping'] } },
    { id: 'addTask',      verb: 'add',      appliesTo: { type: 'task' } },
    { id: 'claim',        verb: 'claim',    appliesTo: { type: 'task', state: ['open'] } },
    { id: 'help',         verb: 'help' },   // domain verb → NOT a capability
  ],
};

describe('resolveAtom', () => {
  it('resolves an atom×noun to the implementing opId (both param-enum and appliesTo forms)', () => {
    expect(resolveAtom(M, 'add', 'shopping')).toBe('addItem');       // via param enum
    expect(resolveAtom(M, 'add', 'task')).toBe('addTask');           // via appliesTo.type
    expect(resolveAtom(M, 'complete', 'task')).toBe('markComplete'); // appliesTo array
    expect(resolveAtom(M, 'claim', 'task')).toBe('claim');
  });
  it('canonicalises an alias before resolving', () => {
    expect(resolveAtom(M, 'create', 'task')).toBe('addTask');   // create → add
    expect(resolveAtom(M, 'grab', 'task')).toBe('claim');       // grab → claim
  });
  it('returns null for an unimplemented or non-atom pair', () => {
    expect(resolveAtom(M, 'list', 'task')).toBe(null);       // declared but no listTask op
    expect(resolveAtom(M, 'archive', 'task')).toBe(null);
    expect(resolveAtom(M, 'frobnicate', 'task')).toBe(null);
  });
});

describe('capabilitiesOf', () => {
  it('unions declared nouns with ops-derived pairs, resolving opIds', () => {
    const caps = capabilitiesOf(M);
    const find = (noun, atom) => caps.find((c) => c.noun === noun && c.atom === atom);

    // declared + implemented → source 'declared', opId filled from the op
    expect(find('shopping', 'add')).toEqual({ noun: 'shopping', atom: 'add', opId: 'addItem', source: 'declared' });
    // declared but NOT implemented (no op does `update` on task) → opId null
    expect(find('task', 'update')).toEqual({ noun: 'task', atom: 'update', opId: null, source: 'declared' });
    // domain verb `help` never becomes a capability
    expect(caps.some((c) => c.atom === 'help')).toBe(false);
  });

  it('derives capabilities even with NO nouns declaration (un-migrated manifest)', () => {
    const bare = { ...M, nouns: undefined };
    const caps = capabilitiesOf(bare);
    expect(caps.every((c) => c.source === 'derived')).toBe(true);
    expect(caps.find((c) => c.noun === 'task' && c.atom === 'add')?.opId).toBe('addTask');
    // no phantom list-on-task (it was only in the declaration, which is gone)
    expect(caps.some((c) => c.noun === 'task' && c.atom === 'list')).toBe(false);
  });

  it('atomsForNoun lists the available atoms for a noun', () => {
    expect(atomsForNoun(M, 'task')).toEqual(['add', 'claim', 'complete', 'update']);
  });

  // DECLARED-AUTHORITATIVE (decision 2026-07-02): a manifest that declares `nouns` curates its own
  // capability surface — an op-derived pair the author didn't declare is DROPPED. This is how a broad
  // `appliesTo` (e.g. stoop cancelRequest `type:'*'`) stops minting capabilities on internal itemTypes.
  it('drops a derived pair the declared nouns omit (declared is authoritative)', () => {
    const curated = {
      app: 'curated',
      itemTypes: ['post', 'internal'],
      nouns: { post: { atoms: ['add', 'remove'] } },   // author declares ONLY post — `internal` omitted
      operations: [
        { id: 'addPost',   verb: 'add',    appliesTo: { type: 'post' } },
        { id: 'wipeAll',   verb: 'remove', appliesTo: { type: '*' } },   // would derive remove×internal
      ],
    };
    const caps = capabilitiesOf(curated);
    const nouns = new Set(caps.map((c) => c.noun));
    expect(nouns.has('internal')).toBe(false);                    // dropped — not declared
    expect(caps.find((c) => c.noun === 'post' && c.atom === 'add')?.opId).toBe('addPost');
    expect(caps.find((c) => c.noun === 'post' && c.atom === 'remove')?.opId).toBe('wipeAll'); // opId still filled
  });

  it('without a nouns declaration, ops remain the surface (derived fallback)', () => {
    const bare = {
      app: 'bare', itemTypes: ['post', 'internal'],
      operations: [{ id: 'wipeAll', verb: 'remove', appliesTo: { type: '*' } }],
    };
    const nouns = new Set(capabilitiesOf(bare).map((c) => c.noun));
    expect(nouns.has('post')).toBe(true);
    expect(nouns.has('internal')).toBe(true);   // derived — no nouns decl to curate it
  });

  // Regression (device-verify 2026-07-02): a VALUE-enum param (mode/action/lang/…) lists option
  // values, not item types — it must NOT become a noun. Before the fix, basis's mode:[nkn,both]
  // / lang:[en,nl] / action:[on,off] params produced junk freedom-matrix rows (submit·nkn, List·en).
  it('ignores non-`type` enum params (value-enums are not nouns)', () => {
    const withValueEnums = {
      app: 'chatty',
      itemTypes: ['message'],
      operations: [
        { id: 'setTransport', verb: 'update', params: [{ name: 'mode',   kind: 'enum', of: ['nkn', 'both'] }] },
        { id: 'listByLang',   verb: 'list',   params: [{ name: 'lang',   kind: 'enum', of: ['en', 'nl'] }] },
        { id: 'toggle',       verb: 'update', params: [{ name: 'action', kind: 'enum', of: ['on', 'off'] }] },
      ],
    };
    const caps = capabilitiesOf(withValueEnums);
    for (const junk of ['nkn', 'both', 'en', 'nl', 'on', 'off']) {
      expect(caps.some((c) => c.noun === junk), `phantom noun "${junk}"`).toBe(false);
    }
    // A `type`-named enum on the same shape still yields real nouns.
    const withTypeEnum = {
      app: 'listy', itemTypes: ['shopping'],
      operations: [{ id: 'addItem', verb: 'add', params: [{ name: 'type', kind: 'enum', of: ['shopping'] }] }],
    };
    expect(capabilitiesOf(withTypeEnum).find((c) => c.noun === 'shopping' && c.atom === 'add')?.opId).toBe('addItem');
  });
});

describe('nouns shape validation', () => {
  it('accepts a well-formed nouns map', () => {
    expect(validateManifest(M).ok).toBe(true);
  });
  it('rejects a noun not in itemTypes', () => {
    const bad = { ...M, nouns: { ...M.nouns, widget: { atoms: ['add'] } } };
    const { ok, errors } = validateManifest(bad);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.code === 'unknown-noun')).toBe(true);
  });
  it('rejects a non-atom in atoms[]', () => {
    const bad = { ...M, nouns: { shopping: { atoms: ['frobnicate'] } } };
    expect(validateManifest(bad).errors.some((e) => e.code === 'unknown-atom')).toBe(true);
  });
  it('rejects an ALIAS in atoms[] (declarations must be canonical)', () => {
    const bad = { ...M, nouns: { shopping: { atoms: ['create'] } } };
    const { errors } = validateManifest(bad);
    expect(errors.some((e) => e.code === 'alias-in-nouns')).toBe(true);
  });
  it('rejects a nouns value that is not an object', () => {
    const { ok, errors } = validateManifest({ ...M, nouns: ['shopping'] });
    expect(ok).toBe(false);
    expect(errors.some((e) => e.path === '/nouns')).toBe(true);
  });
  it('rejects a noun declaration that is not an object', () => {
    const { errors } = validateManifest({ ...M, nouns: { shopping: ['add'] } });
    expect(errors.some((e) => e.path === '/nouns/shopping')).toBe(true);
  });
  it('rejects a non-array atoms field', () => {
    const { errors } = validateManifest({ ...M, nouns: { shopping: { atoms: 'add' } } });
    expect(errors.some((e) => e.path === '/nouns/shopping/atoms')).toBe(true);
  });
  it('rejects an empty / non-string atoms entry', () => {
    expect(validateManifest({ ...M, nouns: { shopping: { atoms: [''] } } })
      .errors.some((e) => e.path === '/nouns/shopping/atoms/0')).toBe(true);
    expect(validateManifest({ ...M, nouns: { shopping: { atoms: [7] } } })
      .errors.some((e) => e.path === '/nouns/shopping/atoms/0')).toBe(true);
  });
});
