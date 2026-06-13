/**
 * N5 (mobile) — CircleFolioScreen's folder tree is pure substrate:
 * the screen feeds its circle-scoped rows through `folioLevel` (re-
 * exported from @canopy-app/canopy-chat) and labels folders/breadcrumbs
 * from the mobile locale bundle.  No RN render infra here — we cover the
 * substrate the screen leans on + the locale keys it resolves, matching
 * the project's portable-vitest testing cadence.
 */
import { describe, it, expect } from 'vitest';

import { folioLevel, glyphForFile, formatFileSize } from '@canopy-app/canopy-chat';
import enRaw from '../locales/en.json';
import nlRaw from '../locales/nl.json';
import { sharedCircleLocale } from '@canopy-app/canopy-chat';
// `circle.*` now lives in the shared canopy-chat source; merge it back to check the effective bundle.
const en = { ...enRaw, circle: sharedCircleLocale.en };
const nl = { ...nlRaw, circle: sharedCircleLocale.nl };

// Mirrors the browser folio seed shape (id carries the pod path).
const ROWS = [
  { id: '/notes/recipes.md', name: 'recipes.md', bytes: 5678 },
  { id: '/notes/shared/anne.md', name: 'anne.md', bytes: 1234 },
  { id: '/docs/lease.pdf', name: 'lease.pdf', bytes: 102400 },
  { id: '/readme.txt', name: 'readme.txt', bytes: 12 },
];

describe('mobile folio Drive tree (folioLevel re-export)', () => {
  it('is re-exported from the canopy-chat package the screen imports', () => {
    expect(typeof folioLevel).toBe('function');
    expect(typeof glyphForFile).toBe('function');
    expect(typeof formatFileSize).toBe('function');
  });

  it('splits root into folders (with counts) + root files', () => {
    const lvl = folioLevel(ROWS, '');
    expect(lvl.folders.map((f) => f.name)).toEqual(['docs', 'notes']);
    expect(lvl.folders.find((f) => f.name === 'notes').count).toBe(2);
    expect(lvl.files.map((f) => f.name)).toEqual(['readme.txt']);
  });

  it('descends into a subfolder + builds breadcrumbs', () => {
    const lvl = folioLevel(ROWS, 'notes/shared');
    expect(lvl.folders).toEqual([]);
    expect(lvl.files.map((f) => f.name)).toEqual(['anne.md']);
    expect(lvl.crumbs.map((c) => c.path)).toEqual(['', 'notes', 'notes/shared']);
  });

  it('rich-row helpers drive the glyph + size shown per file', () => {
    expect(glyphForFile('lease.pdf')).toBe('📕');
    expect(formatFileSize(102400)).toBe('100 KB');
  });
});

describe('mobile folio Drive locale keys', () => {
  it('root / folder_count / empty_folder exist in en + nl', () => {
    for (const bundle of [en, nl]) {
      expect(bundle.circle?.folio?.root?.text).toBeTruthy();
      expect(bundle.circle?.folio?.folder_count?.text).toContain('{{count}}');
      expect(bundle.circle?.folio?.empty_folder?.text).toBeTruthy();
    }
  });
});
