/**
 * The circle-rows view stands in for a circle store as the backing store of a task store, so it must offer every method the
 * task store calls on its backing store. A verb it lacks fails only when a person reaches it (a claim on a circle post
 * threw "putIfMatch is not a function" in the browser); this fails it here instead.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { circleRowsView } from '../src/lib/routedStore.js';

// the package's own sources, beside this app in the monorepo
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/item-store/src');
const TASK_STORE_SOURCES = ['createTaskStore.js', 'taskCrud.js', 'taskLifecycle.js', 'taskCtx.js'];

/** Every `store.x(` / `circleStore.x(` call in the task store's sources, comments left out. */
function backingStoreMethods() {
  const names = new Set();
  for (const f of TASK_STORE_SOURCES) {
    const code = readFileSync(join(srcDir, f), 'utf8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    for (const m of code.matchAll(/\b(?:store|circleStore)\.([a-zA-Z]+)\(/g)) names.add(m[1]);
  }
  return [...names].sort();
}

describe('circleRowsView — the whole backing-store surface', () => {
  it('implements every method the task store calls on its backing store', () => {
    const called = backingStoreMethods();
    // a floor, so a renamed receiver cannot make the list empty and the test vacuous
    expect(called).toEqual(expect.arrayContaining(['get', 'list', 'put', 'putIfMatch', 'delete']));
    const view = circleRowsView({ listByType: async () => [] });
    const missing = called.filter((m) => typeof view[m] !== 'function');
    expect(missing).toEqual([]);
  });
});
