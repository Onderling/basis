import { describe, it, expect } from 'vitest';
import { telegramImportsIn } from './lint-telegram-imports.mjs';

describe('lint-telegram-imports', () => {
  it('names a shared file that imports from the Telegram folder', () => {
    expect(telegramImportsIn('apps/basis/src/v2/x.js', "import { a } from '../telegram/runner.js';")).toEqual(['apps/basis/src/v2/x.js:1: ../telegram/runner.js']);
    expect(telegramImportsIn('apps/basis/web/v2/y.js', "const m = await import('../../src/telegram/z.js');")).toHaveLength(1);
  });
  it('leaves the folder itself and the box shell alone', () => {
    expect(telegramImportsIn('apps/basis/src/telegram/runner.js', "import b from '../telegram/y.js';")).toEqual([]);
    expect(telegramImportsIn('apps/basis/bin/device-runner.mjs', "import { a } from '../src/telegram/runner.js';")).toEqual([]);
  });
});
