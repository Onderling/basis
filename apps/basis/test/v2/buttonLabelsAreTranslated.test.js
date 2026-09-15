import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mockTasksManifest, mockStoopManifest, mockFolioManifest } from '../../src/core/manifests/mockManifests.js';
import { basisManifest } from '../../manifest.js';
import { householdManifest } from '../../../household/manifest.js';
import { calendarManifest } from '../../../calendar/manifest.js';
import { listsManifest } from '../../../lists/manifest.js';
import { agentsManifest } from '../../../agents/manifest.js';

// Every button an op declares is painted at people, in whichever language they chose. A literal `label`
// is untranslatable by construction, and an op that declares a `labelKey` nobody defined paints its key.
// Walked 2026-09-14 through three real shells: "Claim", "Edit", "Add sub-task" and the bare key
// "circle.item.share" on the assistant's task answer. This test reads the SAME manifest set both shells
// compose and the SAME shared bundles both shells merge — so a new button op cannot ship untranslated.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const bundle = (lang) => JSON.parse(readFileSync(path.join(HERE, `../../src/locales/circle.${lang}.json`), 'utf8'));
const resolve = (b, key) => key.replace(/^circle\./, '').split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), b);

const MANIFESTS = { basis: basisManifest, tasks: mockTasksManifest, household: householdManifest, stoop: mockStoopManifest, folio: mockFolioManifest, calendar: calendarManifest, lists: listsManifest, agents: agentsManifest };

describe('every row-action button an op declares has a translated label in both languages', () => {
  const nl = bundle('nl'); const en = bundle('en');
  const buttons = [];
  for (const [app, m] of Object.entries(MANIFESTS)) {
    for (const op of m?.operations ?? []) {
      // Row actions: what `itemRowButtons` emits and a reply or an item card paints. A button op without
      // `appliesTo` is a standing affordance painted by a dedicated screen with strings of its own.
      if (op?.surfaces?.ui?.control === 'button' && op.appliesTo) buttons.push({ app, opId: op.id, ui: op.surfaces.ui });
    }
  }

  it('finds the button ops (the set is not empty, so a broken import cannot pass silently)', () => {
    expect(buttons.length).toBeGreaterThan(40);
  });

  it('each declares a labelKey under circle.', () => {
    const missing = buttons.filter((b) => typeof b.ui.labelKey !== 'string' || !b.ui.labelKey.startsWith('circle.')).map((b) => `${b.app}:${b.opId} (${b.ui.label ?? '?'})`);
    expect(missing, 'button ops without a labelKey').toEqual([]);
  });

  it('each labelKey resolves to a text in nl AND en', () => {
    const unresolved = [];
    for (const b of buttons) {
      if (typeof b.ui.labelKey !== 'string') continue;
      for (const [lang, bd] of [['nl', nl], ['en', en]]) {
        const v = resolve(bd, b.ui.labelKey);
        if (typeof v?.text !== 'string' || !v.text) unresolved.push(`${lang}: ${b.ui.labelKey} (${b.app}:${b.opId})`);
      }
    }
    expect(unresolved, 'labelKeys with no text in a bundle').toEqual([]);
  });
});
