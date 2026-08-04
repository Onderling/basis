/**
 * G-DICT — the dictionary stays a superset of the runtime (the homes plan, Part III).
 *
 * The task type's schema drifted BEHIND the code: the lifecycle verbs read/write fields the canonical
 * schema never learned (`requiredSkills` among them — the field the hybrid-dispatch product idea depends
 * on). A dictionary that under-describes its own type makes every schema-validating consumer reject real
 * items, and makes "declare a noun → get CRUD" quietly partial.
 *
 * Baselined GREEN over the known gap: `KNOWN_MISSING` holds the fields the wave-2 catch-up will add to
 * the schema. Shrink it as they land; a NEW runtime field that skips the schema fails immediately.
 * When it reaches empty, delete the constant and this header's excuse with it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_TYPES } from '../src/canonical.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STORE_SRC = path.resolve(here, '../../item-store/src');

/** The task fields the RUNTIME actually reads/writes — measured from the lifecycle sources. */
function runtimeTaskFields() {
  const fields = new Set();
  for (const f of ['taskLifecycle.js', 'createTaskStore.js', 'taskCrud.js', 'dag.js']) {
    let src; try { src = readFileSync(path.join(STORE_SRC, f), 'utf8'); } catch { continue; }
    // item-field access/writes: `task.<field>` / `t.<field>` / `{ <field>:` in put payloads is too noisy;
    // measure the conservative core: dotted reads off task-shaped identifiers.
    for (const m of src.matchAll(/\b(?:task|item|current|merged|local|t)\.([a-zA-Z][a-zA-Z0-9]+)\b/g)) {
      fields.add(m[1]);
    }
  }
  // Not item fields: methods/utilities that ride the same identifiers.
  const NOT_FIELDS = new Set(['id', 'length', 'push', 'map', 'filter', 'find', 'some', 'every', 'slice',
    'includes', 'join', 'sort', 'forEach', 'concat', 'indexOf', 'split', 'trim', 'toLowerCase', 'keys',
    'values', 'entries', 'source', 'etag']);
  return [...fields].filter((f) => !NOT_FIELDS.has(f)).sort();
}

/** The wave-2 catch-up list — the KNOWN gap, baselined green. Shrink, never grow. */
const KNOWN_MISSING = [
  // the nine the verification passes catalogued…
  'claimedAt', 'completedAt', 'dueAt', 'note', 'notes', 'parentTaskId',
  'requiredSkills', 'reviewLog', 'submittedAt',
  // …and four more this guard's own first measurement found that no pass had (the derived list beating
  // the remembered one, on its first run):
  'addedAt', 'addedBy', 'addedByDisplayName', 'deliverable',
];

describe('G-DICT — the task schema is a superset of the runtime', () => {
  const schema = CANONICAL_TYPES.task;
  const declared = new Set(Object.keys(schema?.properties ?? {}));

  it('the schema exists and declares its core', () => {
    expect(declared.size).toBeGreaterThan(5);
    expect(declared.has('text')).toBe(true);
  });

  it('every runtime field is declared OR in the known wave-2 gap — a NEW undeclared field fails', () => {
    const runtime = runtimeTaskFields();
    const missing = runtime.filter((f) => !declared.has(f) && !KNOWN_MISSING.includes(f));
    expect(missing, `runtime task fields the schema never learned (add to the schema, not to KNOWN_MISSING): ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('KNOWN_MISSING only shrinks — a field added to the schema must leave the list', () => {
    const stale = KNOWN_MISSING.filter((f) => declared.has(f));
    expect(stale, `these are IN the schema now — remove from KNOWN_MISSING: ${stale.join(', ')}`).toEqual([]);
  });
});
