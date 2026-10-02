/**
 * FITNESS: the box and the eval tell the bot's model the SAME lines — both through `botPromptLines`, neither adding
 * lines of its own beside it. The eval had quietly stopped composing the bot as it ships (the box's reminder lines were
 * missing from it, 2026-10-02); one function both read keeps it true by construction.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('FITNESS: one composition of the bot\'s prompt lines', () => {
  for (const [name, rel] of [['the box', '../../bin/device-runner.mjs'], ['the eval', '../../scripts/assistant-eval.mjs']]) {
    it(`${name} reads botPromptLines, and composes no lines of its own`, () => {
      const src = read(rel);
      expect(src).toMatch(/promptLines:\s*botPromptLines\(/);
      expect(src).not.toMatch(/reminderPromptLines|promptLinesFor\(/);
    });
  }
});
