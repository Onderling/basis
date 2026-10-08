import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pathsForRole, relativeReach } from './box-role-paths.mjs';

describe('box-role-paths', () => {
  it('a package that imports another app\'s file by a relative path is rebuilt when that app changes', () => {
    const files = {
      'apps/node/src/index.js': "import { card } from './card.js';\nimport x from '@onderling/core';",
      'apps/node/src/card.js': "import { encode } from '../../other/src/lib/codec.js';",
      'apps/node/test/a.test.js': "import y from '../../testonly/src/y.js';",
      'apps/other/src/lib/codec.js': "export { z } from '../../../../packages/third/src/z.js';",
      'apps/other/src/unrelated.js': "import w from '../../../packages/never/src/w.js';",
      'packages/third/src/z.js': 'export const z = 1;',
    };
    const reach = relativeReach(['apps/node/'], {
      read: (f) => files[f],
      list: (dir) => Object.keys(files).filter((f) => f.startsWith(dir)),
    });
    // the file it reaches, and what THAT file reaches — never a whole app's other files, never a test's import
    expect(reach).toEqual(['apps/other/', 'packages/third/']);
  });

  it('the companion role names stoop (its card is stoop\'s codec)', () => {
    const yml = readFileSync(new URL('../deploy/roles/companion.yml', import.meta.url), 'utf8');
    expect(pathsForRole('companion', yml)).toContain('apps/stoop/');
    expect(readFileSync(new URL('../deploy/roles/companion.paths', import.meta.url), 'utf8').split('\n')).toContain('apps/stoop/');
  });
});
