/**
 * "List the X" resolves to an op that LISTS: for every app manifest the person's app and the bot compose, the `list`
 * atom of each declared noun resolves to an op that takes no item id (a list), never to a one-item read. tasks-v0
 * declared its `getTaskSnapshot` (one task, by id) with the verb `list`, and the first op wins — so a cross-circle
 * "my chores" asked for a list and would have got a snapshot (found 2026-10-05).
 */
import { describe, it, expect } from 'vitest';
import { resolveCapability } from '@onderling/app-manifest';
import { tasksManifest } from '../../../tasks-v0/manifest.js';
import { calendarManifest } from '../../../calendar/manifest.js';
import { householdManifest } from '../../../household/manifest.js';
import { listsManifest } from '../../../lists/manifest.js';

describe('the list atom lists', () => {
  for (const [name, m] of [['tasks', tasksManifest], ['calendar', calendarManifest], ['household', householdManifest], ['lists', listsManifest]]) {
    it(name, () => {
      const wrong = [];
      for (const noun of Object.keys(m.nouns ?? {})) {
        const r = resolveCapability(m, 'list', noun);
        if (r.kind !== 'op') continue;
        const op = m.operations.find((o) => o.id === r.opId);
        if ((op?.params ?? []).some((p) => p.required && p.name === 'id')) wrong.push(`${noun} → ${r.opId}`);
      }
      expect(wrong).toEqual([]);
    });
  }
});
