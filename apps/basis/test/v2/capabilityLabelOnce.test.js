// @reads-source: this test reads source as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
/**
 * ONE lookup for a capability's label (`src/v2/capabilityLabel.js`): no shell builds it from `circle.settings.verb.<atom>`
 * itself. Seven screens did (three copies of a `verbLabel` on the phone, four inline on web), each painting the noun's
 * id; the next copy is red here, not a quiet eighth.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APPS = path.resolve(HERE, '../../..');
const ROOTS = ['basis/src', 'basis/web', 'basis-mobile/src'].map((r) => path.join(APPS, r));
const OWNER = path.join(APPS, 'basis/src/v2/capabilityLabel.js');

const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : files(p)) : (/\.(m?js|jsx)$/.test(n) ? [p] : []);
});

describe('a capability\'s label has one home', () => {
  it('no shell or shared file but capabilityLabel.js reads circle.settings.verb.<atom>', () => {
    const offenders = ROOTS.flatMap(files).filter((f) => f !== OWNER && /circle\.settings\.verb\./.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(APPS, f));
    expect(offenders).toEqual([]);
  });
});
