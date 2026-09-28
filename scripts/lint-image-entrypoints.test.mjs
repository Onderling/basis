import { describe, it, expect } from 'vitest';
import { bareImports, entrypoints } from './lint-image-entrypoints.mjs';

describe('lint-image-entrypoints', () => {
  it('names the bare packages, static and dynamic, and lets builtins and relative paths through', () => {
    const src = `
      import { readFileSync } from 'node:fs';
      import { startRelay } from '../../packages/relay/index.js';
      import thing from 'some-package';
      const { default: Database } = await import('better-sqlite3');
      const { a } = await import(
        '../../packages/blob-gateway/src/adapters/s3Bucket.js'
      );
      // import { x } from 'in-a-comment';
    `;
    expect(bareImports(src)).toEqual(['better-sqlite3', 'some-package']);
  });

  it('finds the relay image entrypoint', () => {
    expect(entrypoints()).toContain('deploy/relay/entrypoint.mjs');
  });
});
