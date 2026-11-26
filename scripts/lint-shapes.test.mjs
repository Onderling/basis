/**
 * Self-test for lint-shapes (the wire half): a row whose declared fields changed while its `v` stayed is red; a raised `v` is green
 * only with a raised WIRE_VERSION or with `additive` and its reason; a row missing from the committed file (or one the
 * register dropped) is red until `--update`. And the repo itself is clean.
 */
import { describe, it, expect } from 'vitest';
import { shapeProblems, committedShapeOf, storedShapeProblems, committedStoredShapeOf, check } from './lint-shapes.mjs';

const reg = (rows) => Object.fromEntries(Object.entries(rows).map(([n, r]) => [n, { home: 'direct', v: 1, ...r }]));
const committed = (rows, wire = 1) => ({ wire, rows: Object.fromEntries(Object.entries(rows).map(([n, r]) => [n, committedShapeOf({ home: 'direct', v: 1, ...r })])) });

describe('lint-shapes: wire', () => {
  const was = committed({ a: { fields: { subtype: 'string', x: 'string' } } });
  it('unchanged is green', () => {
    expect(shapeProblems(reg({ a: { fields: { subtype: 'string', x: 'string' } } }), was, 1)).toEqual([]);
  });
  it('a field changed with the same v is red', () => {
    expect(shapeProblems(reg({ a: { fields: { subtype: 'string', x: 'number' } } }), was, 1).join('\n')).toMatch(/'a'.*v stayed 1/);
    expect(shapeProblems(reg({ a: { fields: { subtype: 'string', x: 'string', y: 'string?' } } }), was, 1)).toHaveLength(1);
  });
  it('a raised v alone is red: no reader sees it', () => {
    expect(shapeProblems(reg({ a: { v: 2, fields: { subtype: 'string', x: 'number' } } }), was, 1).join('\n')).toMatch(/WIRE_VERSION|additive/);
  });
  it('a raised v with a raised WIRE_VERSION is green', () => {
    expect(shapeProblems(reg({ a: { v: 2, fields: { subtype: 'string', x: 'number' } } }), was, 2)).toEqual([]);
  });
  it('a raised v marked additive, with its reason, is green; additive without a reason is red', () => {
    const fields = { subtype: 'string', x: 'string', y: 'string?' };
    expect(shapeProblems(reg({ a: { v: 2, fields, additive: 'an older build ignores y' } }), was, 1)).toEqual([]);
    expect(shapeProblems(reg({ a: { v: 2, fields, additive: true } }), was, 1)).toHaveLength(1);
  });
  it('the additive reason is committed with the row, and a second rise needs a new reason', () => {
    const y = { subtype: 'string', x: 'string', y: 'string?' };
    const z = { ...y, z: 'string?' };
    const after = committed({ a: { v: 2, fields: y, additive: 'an older build ignores y' } });
    expect(after.rows.a.additive).toBe('an older build ignores y');
    expect(shapeProblems(reg({ a: { v: 3, fields: z, additive: 'an older build ignores y' } }), after, 1).join('\n')).toMatch(/'a'.*same additive reason/);
    expect(shapeProblems(reg({ a: { v: 3, fields: z, additive: 'an older build ignores z too' } }), after, 1)).toEqual([]);
  });
  it('a changed home or block-list mark is red until --update records it (it moves a kind on or off the block list)', () => {
    expect(shapeProblems(reg({ a: { home: 'circle', fields: { subtype: 'string', x: 'string' } } }), was, 1).join('\n')).toMatch(/'a'.*home.*--update/);
    expect(shapeProblems(reg({ a: { blockList: false, fields: { subtype: 'string', x: 'string' } } }), was, 1).join('\n')).toMatch(/'a'.*block list.*--update/);
  });
  it('a row the committed file lacks, or one the register dropped, is red until --update', () => {
    expect(shapeProblems(reg({ a: { fields: { subtype: 'string', x: 'string' } }, b: { fields: { subtype: 'string' } } }), was, 1).join('\n')).toMatch(/'b'.*--update/);
    expect(shapeProblems(reg({}), was, 1).join('\n')).toMatch(/'a'.*no longer/);
  });
});

describe('lint-shapes: stored', () => {
  const at = (rows) => ({ rows: Object.fromEntries(Object.entries(rows).map(([id, shape]) => [id, committedStoredShapeOf({ shape })])) });
  const reg = (rows) => Object.fromEntries(Object.entries(rows).map(([id, shape]) => [id, { shape }]));
  const was = at({ flag: { v: 'none', value: 'flag' }, store: { v: 1, carrier: 'snapshot' }, vault: 'opaque' });
  it('unchanged is green', () => {
    expect(storedShapeProblems(reg({ flag: { v: 'none', value: 'flag' }, store: { v: 1, carrier: 'snapshot' }, vault: 'opaque' }), was)).toEqual([]);
  });
  it("a key's value kind changed in place is red, and --update does not settle it: a new kind goes under a new key", () => {
    const p = storedShapeProblems(reg({ flag: { v: 'none', value: 'json' }, store: { v: 1, carrier: 'snapshot' }, vault: 'opaque' }), was);
    expect(p.join('\n')).toMatch(/'flag'.*in place.*NEW key/);
    expect(p.join('\n')).not.toMatch(/--update/);
  });
  it("a stamped store's v going down is red; a rise is red until --update records it", () => {
    expect(storedShapeProblems(reg({ flag: { v: 'none', value: 'flag' }, store: { v: 0, carrier: 'snapshot' }, vault: 'opaque' }), was).join('\n')).toMatch(/'store'.*went down/);
    expect(storedShapeProblems(reg({ flag: { v: 'none', value: 'flag' }, store: { v: 2, carrier: 'snapshot' }, vault: 'opaque' }), was).join('\n')).toMatch(/'store'.*--update/);
  });
  it('a row with no shape is red; a new or dropped row is red until --update', () => {
    expect(storedShapeProblems(reg({ flag: { v: 'none', value: 'flag' }, store: { v: 1, carrier: 'snapshot' }, vault: 'opaque', bare: undefined }), was).join('\n')).toMatch(/'bare': no shape/);
    expect(storedShapeProblems(reg({ flag: { v: 'none', value: 'flag' }, store: { v: 1, carrier: 'snapshot' }, vault: 'opaque', fresh: 'opaque' }), was).join('\n')).toMatch(/'fresh'.*--update/);
    expect(storedShapeProblems(reg({ flag: { v: 'none', value: 'flag' }, store: { v: 1, carrier: 'snapshot' } }), was).join('\n')).toMatch(/'vault'.*no longer/);
  });
});

describe('lint-shapes: the repo', () => {
  it('the repo is clean', async () => {
    expect(await check()).toEqual([]);
  });
});
