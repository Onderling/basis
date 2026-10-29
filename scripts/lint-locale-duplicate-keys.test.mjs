import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { duplicateKeys } from './lint-locale-duplicate-keys.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((f) => /(^|\/)locales\/.*\.json$/.test(f));

describe('lint-locale-duplicate-keys', () => {
  it('finds a key repeated in one object, with its path and line, and nothing across objects', () => {
    expect(duplicateKeys('{"a":{"x":1,"y":2},"b":{"x":3}}')).toEqual([]);
    expect(duplicateKeys('{"a":{\n"x":1,\n"x":2}}')).toEqual([{ path: 'a', key: 'x', line: 3 }]);
    expect(duplicateKeys('{"k":"a \\" , \\"k\\": b","k":2}')).toEqual([{ path: '', key: 'k', line: 1 }]);
  });

  it('is red on a planted repeat in every locale file, and green on each as it is', () => {
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const text = readFileSync(path.join(ROOT, f), 'utf8');
      expect(duplicateKeys(text), `${f} as it stands`).toEqual([]);
      const first = Object.keys(JSON.parse(text))[0];
      const planted = text.replace('{', `{\n  ${JSON.stringify(first)}: "planted",`);
      expect(duplicateKeys(planted).map((d) => d.key), `${f} with "${first}" planted twice`).toContain(first);
    }
  });
});
