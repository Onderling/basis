#!/usr/bin/env node
/**
 * lint-function-matrix — alpha one's sixteen functions × web · mobile · box, green where a story proves the cell.
 *
 * Reads `function-matrix.mjs` (the cells Fable names) and checks each named story exists in the tree: the file, and the
 * test title when one is pinned. Red: a cell that names nothing, or names a story that is not there. A cell that does
 * not apply says why and is neither.
 *
 *   node scripts/lint-function-matrix.mjs           the matrix + the red cells (REPORTING: always exit 0)
 *   node scripts/lint-function-matrix.mjs --gate    the same, exit 1 on any red cell (once Fable names them all)
 *
 * Static on purpose: whether the story PASSES is CI's job (the suites run it); this answers "is there a story at all".
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FUNCTIONS, SHELLS } from './function-matrix.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** One cell's verdict: { state: 'green'|'red'|'na', why, proposed } */
export function judgeCell(cell, { root = ROOT } = {}) {
  if (cell == null) return { state: 'red', why: 'no story named' };
  if (typeof cell.na === 'string') return { state: 'na', why: cell.na };
  if (typeof cell.file !== 'string' || !cell.file) return { state: 'red', why: 'a story without a file' };
  const abs = path.join(root, cell.file);
  if (!existsSync(abs)) return { state: 'red', why: `named story is gone: ${cell.file}` };
  const src = readFileSync(abs, 'utf8');
  if (typeof cell.test === 'string' && cell.test && !src.includes(cell.test)) {
    return { state: 'red', why: `no test "${cell.test}" in ${cell.file}` };
  }
  // A walk that only LOGS what it found (PASS / FINDING) passes whatever happened — a probe that cannot fail proves
  // nothing (walk-pod passed for months while logging that no circle could be pointed at a pod).
  if (!/\bexpect\s*[.(]|\bassert\s*[.(]|\bthrow\s+new\s+\w*Error\b/.test(src)) return { state: 'red', why: `the story asserts nothing (it cannot fail): ${cell.file}` };
  return { state: 'green', why: cell.file, proposed: cell.proposed === true };
}

/** The matrix as rows of verdicts. */
export function judgeMatrix(functions = FUNCTIONS, opts = {}) {
  return functions.map((f) => ({ id: f.id, name: f.name, cells: Object.fromEntries(SHELLS.map((s) => [s, judgeCell(f.cells?.[s] ?? null, opts)])) }));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const gate = process.argv.includes('--gate');
  const rows = judgeMatrix();
  const mark = (v) => (v.state === 'green' ? (v.proposed ? '◐' : '●') : v.state === 'na' ? '—' : '✗');
  const w = Math.max(...rows.map((r) => r.id.length));
  console.log(`function matrix — ${rows.length} functions × ${SHELLS.join(' · ')}   (● named · ◐ proposed, to confirm · ✗ red · — not applicable)`);
  console.log(`${''.padEnd(w)}  ${SHELLS.map((s) => s.padEnd(6)).join(' ')}`);
  for (const r of rows) console.log(`${r.id.padEnd(w)}  ${SHELLS.map((s) => mark(r.cells[s]).padEnd(6)).join(' ')}`);
  const reds = rows.flatMap((r) => SHELLS.filter((s) => r.cells[s].state === 'red').map((s) => `${r.id} × ${s}: ${r.cells[s].why}`));
  const proposed = rows.reduce((n, r) => n + SHELLS.filter((s) => r.cells[s].proposed).length, 0);
  const named = rows.reduce((n, r) => n + SHELLS.filter((s) => r.cells[s].state === 'green' && !r.cells[s].proposed).length, 0);
  console.log(`\n${named} named · ${proposed} proposed · ${reds.length} red`);
  for (const line of reds) console.log(`  ✗ ${line}`);
  if (gate && reds.length) process.exit(1);
  console.log(gate ? '✓ lint:function-matrix — every cell has a story' : '✓ lint:function-matrix (reporting) — not a gate until the cells are named');
}
