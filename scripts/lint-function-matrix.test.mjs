import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { judgeCell, judgeMatrix } from './lint-function-matrix.mjs';
import { FUNCTIONS, SHELLS } from './function-matrix.mjs';

describe('the function matrix', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fm-'));
  mkdirSync(path.join(root, 't'), { recursive: true });
  writeFileSync(path.join(root, 't/a.spec.js'), "test('a person sends a message', () => {})");

  it('a cell is red when it names nothing, or a story that is gone, or a test title the file lacks', () => {
    expect(judgeCell(null, { root }).state).toBe('red');
    expect(judgeCell({ file: 't/gone.spec.js' }, { root }).state).toBe('red');
    expect(judgeCell({ file: 't/a.spec.js', test: 'a person reads' }, { root }).state).toBe('red');
  });
  it('green when the named story is there; proposed stays visible; not-applicable is neither', () => {
    expect(judgeCell({ file: 't/a.spec.js', test: 'sends a message' }, { root })).toMatchObject({ state: 'green', proposed: false });
    expect(judgeCell({ file: 't/a.spec.js', proposed: true }, { root })).toMatchObject({ state: 'green', proposed: true });
    expect(judgeCell({ na: 'no screen' }, { root }).state).toBe('na');
  });
  it('the declaration: sixteen functions, every shell has a cell entry (named, proposed, na or null)', () => {
    expect(FUNCTIONS).toHaveLength(16);
    for (const f of FUNCTIONS) for (const s of SHELLS) expect(Object.prototype.hasOwnProperty.call(f.cells, s), `${f.id} × ${s}`).toBe(true);
    expect(judgeMatrix()).toHaveLength(16);
  });
});
