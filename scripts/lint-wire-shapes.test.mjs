/**
 * Self-test for lint-wire-shapes: a row whose declared fields changed while its `v` stayed is red; a raised `v` is green
 * only with a raised WIRE_VERSION or with `additive` and its reason; a row missing from the committed file (or one the
 * register dropped) is red until `--update`. And the repo itself is clean.
 */
import { describe, it, expect } from 'vitest';
import { shapeProblems, committedShapeOf, check } from './lint-wire-shapes.mjs';

const reg = (rows) => Object.fromEntries(Object.entries(rows).map(([n, r]) => [n, { home: 'direct', v: 1, ...r }]));
const committed = (rows, wire = 1) => ({ wire, rows: Object.fromEntries(Object.entries(rows).map(([n, r]) => [n, committedShapeOf({ home: 'direct', v: 1, ...r })])) });

describe('lint-wire-shapes', () => {
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
  it('a changed home or block-list mark is red until --update records it (it moves a kind on or off the block list)', () => {
    expect(shapeProblems(reg({ a: { home: 'circle', fields: { subtype: 'string', x: 'string' } } }), was, 1).join('\n')).toMatch(/'a'.*home.*--update/);
    expect(shapeProblems(reg({ a: { blockList: false, fields: { subtype: 'string', x: 'string' } } }), was, 1).join('\n')).toMatch(/'a'.*block list.*--update/);
  });
  it('a row the committed file lacks, or one the register dropped, is red until --update', () => {
    expect(shapeProblems(reg({ a: { fields: { subtype: 'string', x: 'string' } }, b: { fields: { subtype: 'string' } } }), was, 1).join('\n')).toMatch(/'b'.*--update/);
    expect(shapeProblems(reg({}), was, 1).join('\n')).toMatch(/'a'.*no longer/);
  });
  it('the repo is clean', async () => {
    expect(await check()).toEqual([]);
  });
});
