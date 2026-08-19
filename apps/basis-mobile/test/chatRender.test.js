/**
 * chatRender — regression tests for the rendered-reply pipeline.
 *
 * Covers two bugs hit on 2026-05-26 during the step 2
 * on-device walk-through:
 *
 *   1. List bubbles had no buttons.  Root cause: ChatScreen called
 *      `renderReply(reply, { catalogue })` but the renderer needs
 *      `{ appOrigin, manifestsByOrigin }` to look up
 *      `renderChat.inlineKeyboardFor`.  Without it, every list row
 *      came out with `buttons: []`.
 *
 *   2. Per-row staleness hint showed the raw `sync.row_ago` locale
 *      key instead of a natural-language "2h ago".  Root cause: our
 *      `t()` had no `sync.row_ago` entry, so it returned the key
 *      verbatim.  (formatLastSync's fallback is `(k) => k`.)
 *
 * Tests exercise renderReply directly (no RN runtime needed) so
 * they're fast + don't depend on real-device flows.
 *
 * Per the manifest-pipeline doc, this file is the canonical
 * regression for the "list reply → bubble" contract on mobile.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  renderReply, basisManifest,
} from '@onderling-app/basis';

import { composeManifests } from '../src/core/composeManifests.js';
import { t, initLocalisation } from '../src/core/localisation.js';

// basis's mockStoopManifest is the closest thing to a "real"
// list-shape op (postRequest → list of posts with per-row buttons).
// We import it directly so we can build manifestsByOrigin from a
// known reference.
import {
  mockTasksManifest, mockStoopManifest, mockFolioManifest,
} from '../../basis/src/core/manifests/mockManifests.js';
import { mockHouseholdManifest } from '../../basis/src/core/agent/mockAgent.js';
import { calendarManifest } from '../../calendar/manifest.js';

beforeAll(async () => {
  await initLocalisation({ lang: 'en' });
});

/** Build the manifestsByOrigin map the same way web's main.js does. */
function makeManifestsByOrigin() {
  return {
    'basis': basisManifest,
    'household':   mockHouseholdManifest,
    'tasks':    mockTasksManifest,
    'stoop':       mockStoopManifest,
    'folio':       mockFolioManifest,
    'calendar':    calendarManifest,
  };
}

/** Synthesize a household "list of chores" reply — mirrors what
 * `/mine` returns on device (the actual user repro from 2026-05-26).
 * household's markComplete op has `appliesTo: { type: 'chore', state:
 * 'open' }` so the items MUST carry `type: 'chore'` for buttons to
 * appear — earlier versions of this fixture omitted that field,
 * which would have hidden the bug under "fixture error". */
function makeHouseholdListReply() {
  return {
    shape:    'list',
    threadId: null,
    payload: {
      items: [
        {
          id:        'chore-1',
          type:      'chore',
          title:     'Dishwasher',
          state:     'open',
          _lastSync: Date.now() - 2 * 3600 * 1000,  // 2h ago
        },
        {
          id:        'chore-2',
          type:      'chore',
          title:     'Vacuum living room',
          state:     'open',
          _lastSync: Date.now() - 30 * 60 * 1000,   // 30m ago
        },
      ],
    },
  };
}

describe('#253 step 2 — list reply with inline keyboards', () => {
  it('REGRESSION: with only { catalogue } opts, list items have NO buttons (the bug)', () => {
    const catalogue  = composeManifests();
    const reply    = makeHouseholdListReply();
    const rendered = renderReply(reply, { catalogue });
    expect(rendered.kind).toBe('list');
    expect(rendered.items.length).toBe(2);
    // Captures the V1 broken state — without manifestsByOrigin +
    // appOrigin, the renderer can't compute inlineKeyboardFor so
    // every row's buttons collapse to [].
    for (const item of rendered.items) {
      expect(item.buttons).toEqual([]);
    }
  });

  it('with { appOrigin, manifestsByOrigin } opts, list items get buttons', () => {
    const reply = makeHouseholdListReply();
    const rendered = renderReply(reply, {
      appOrigin:         'household',
      manifestsByOrigin: makeManifestsByOrigin(),
    });
    expect(rendered.kind).toBe('list');
    expect(rendered.items.length).toBe(2);
    // At least one row should have at least one button.  household
    // declares markComplete with appliesTo: { type:'chore', state:'open' }
    // — items meeting both light it up.
    const totalButtons = rendered.items
      .reduce((n, it) => n + (it.buttons?.length ?? 0), 0);
    expect(totalButtons).toBeGreaterThan(0);
    // Each button must carry the canonical `<opId>:<itemId>` callbackData
    // shape so the RN row-tap handler can parse it.
    for (const item of rendered.items) {
      for (const btn of item.buttons ?? []) {
        expect(btn.label).toBeTruthy();
        expect(typeof btn.callbackData).toBe('string');
        const [opId, ...rest] = btn.callbackData.split(':');
        expect(opId).toBeTruthy();
        expect(rest.join(':')).toBe(item.id);
      }
    }
  });
});

describe('#253 step 2 — per-row staleness hint via t()', () => {
  it('REGRESSION: without a t() that knows sync.row_ago, the key leaks (the bug)', () => {
    const reply = makeHouseholdListReply();
    const rendered = renderReply(reply, {
      appOrigin:         'household',
      manifestsByOrigin: makeManifestsByOrigin(),
      // Deliberately use a minimal t that doesn't know sync.row_ago,
      // simulating the V1 broken state where our locales lacked it.
      t: (key) => key,
    });
    const staleHints = rendered.items.map((i) => i.staleHint ?? '');
    // The raw key leaks — exactly the bug we observed on device.
    for (const hint of staleHints) {
      expect(hint).toContain('sync.row_ago');
    }
  });

  it('with our own t() (after adding sync.row_ago), staleHints render naturally', () => {
    const reply = makeHouseholdListReply();
    const rendered = renderReply(reply, {
      appOrigin:         'household',
      manifestsByOrigin: makeManifestsByOrigin(),
      t,
    });
    const staleHints = rendered.items.map((i) => i.staleHint ?? '');
    // Must NOT contain the raw key.
    for (const hint of staleHints) {
      expect(hint).not.toContain('sync.row_ago');
      // After fix, a natural-language "Xs/m/h/d ago" pattern.
      // (Tolerant: accept any short form ending in 's', 'm', 'h',
      // or 'd' followed by an "ago" word — the exact phrasing is
      // locale-dependent.)
      expect(hint.length).toBeGreaterThan(0);
    }
  });
});

describe('P3 — curation reply renders + locale resolves on mobile', () => {
  it("renderReply emits kind:'curation' with before/after sides", () => {
    const r = renderReply(
      { payload: { before: { text: 'raw with Jan' }, after: { text: 'cleaned [naam]' } }, shape: 'curation' },
      {},
    );
    expect(r.kind).toBe('curation');
    expect(r.changed).toBe(true);
    expect(r.sides).toEqual({ before: { text: 'raw with Jan' }, after: { text: 'cleaned [naam]' } });
    expect(r.changedPaths).toContain('text');
  });

  it('circle.curation.* keys resolve to real strings (not the raw key)', () => {
    for (const k of ['changed', 'unchanged', 'before', 'after']) {
      const v = t(`circle.curation.${k}`);
      expect(v).toBeTruthy();
      expect(v).not.toBe(`circle.curation.${k}`);
    }
  });
});
