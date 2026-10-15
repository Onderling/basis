/**
 * FITNESS — the person's pages are edited through the screen ops only. A shell (web, mobile) reads the screen book and
 * paints it; every change goes through `callSkill('basis', 'screen-…')`, so it is kept as a version, logged and
 * undoable. A shell that imports a book function that changes the book, or writes the store itself, would be a second
 * door that skips all three.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASIS = path.resolve(HERE, '..', '..');
const MOBILE = path.resolve(BASIS, '..', 'basis-mobile', 'src');
const MUTATORS = ['addScreen', 'renameScreen', 'removeScreen', 'setActiveScreen', 'updateScreen', 'addCircleToScreen', 'removeCircleFromScreen', 'setAllCircles'];

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
  return /\.(m?js|jsx)$/.test(e.name) ? [p] : [];
});
const shellFiles = () => [...walk(path.join(BASIS, 'web')), ...walk(MOBILE)];

describe('the person\'s pages change only through the screen ops', () => {
  it('no shell file imports a book function that changes the book', () => {
    const offenders = [];
    for (const f of shellFiles()) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*(userScreens\.js|@onderling-app\/basis)['"]/g)) {
        const names = m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean);
        for (const n of names) if (MUTATORS.includes(n)) offenders.push(`${path.relative(BASIS, f)}: ${n}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no shell file writes the screen book store itself', () => {
    const offenders = [];
    for (const f of shellFiles()) {
      const src = fs.readFileSync(f, 'utf8');
      if (/userScreenStore\.(update|set|updateVersioned|restoreVersion)\s*\(/.test(src)) offenders.push(path.relative(BASIS, f));
    }
    expect(offenders).toEqual([]);
  });
});
