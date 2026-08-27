/**
 * .4 — pod-settings.html -adopt.
 *
 * Mirrors stoop's -adopt settings test (commit 9e7003b /
 * `apps/stoop/test/stoop-web.test.js`).  Asserts:
 *
 *   1. The manifest validates with the new view added.
 *   2. The `pod-settings` view declares `shape: 'record'`.
 *   3. The view declares a `dataSource` with `getCircleStoragePolicy` +
 *      `argsFromContext.circleId` (runtime-derived arg).
 *   4. The view declares `fields[]` with both editable fields
 *      of the storage policy (policy + groupPodUri), each with a
 *      `patch` declaration pointing at `setCircleStoragePolicy`.
 *   5. Renderweb projects the section verbatim (shape + dataSource +
 *      fields[]), so the page can drive its hand-coded UI from the
 *      manifest as the source-of-truth.
 *
 * The page itself (`pod-settings.html`) keeps its rich custom UI —
 * the pod-sign-in flow + conditional groupPodUri row + localisation labels
 * would all regress under auto-rendering.  The manifest models the
 * data; the page draws the chrome.
 *
 * Pure-JSON assertions only — no live server.  The page is exercised
 * in the existing characterization corpus / web.test.js as it stands
 * today (no UI changes in this slice).
 */

import { describe, it, expect } from 'vitest';

import { renderWeb, validateManifest } from '@onderling/app-manifest';

import { tasksManifest } from '../manifest.js';

describe('Slice B.2.4: pod-settings V0.4-adopt manifest declaration', () => {
  it('manifest still validates with the new view + itemType', () => {
    const { ok, errors } = validateManifest(tasksManifest);
    expect(ok, JSON.stringify(errors, null, 2)).toBe(true);
  });

  it("'circle-storage-policy' is registered as an app-local itemType", () => {
    expect(tasksManifest.itemTypes).toContain('circle-storage-policy');
  });

  it("the `pod-settings` view declares shape: 'record' + dataSource + fields", () => {
    const view = tasksManifest.views.find((v) => v.id === 'pod-settings');
    expect(view).toBeTruthy();
    expect(view.title).toBe('Pod settings');
    expect(view.type).toBe('circle-storage-policy');
    // singleton record (getCircleStoragePolicy returns
    // {policy, groupPodUri?}, not an array).
    expect(view.shape).toBe('record');
    // `circleId` is RUNTIME-derived (browser URL `?circle=...`);
    // the page passes it via the fetch-section context substitution.
    expect(view.dataSource).toEqual({
      skillId:         'getCircleStoragePolicy',
      argsFromContext: { circleId: '$circleId' },
    });
    // fields[] declares the editable subset.
    expect(Array.isArray(view.fields)).toBe(true);
    expect(view.fields.length).toBeGreaterThanOrEqual(2);
  });

  it('fields[] declares policy + groupPodUri with setCircleStoragePolicy patch ops', () => {
    const view = tasksManifest.views.find((v) => v.id === 'pod-settings');
    const byName = Object.fromEntries(view.fields.map((f) => [f.name, f]));

    // policy — enum {shared, personal, hybrid} (none
    // intentionally omitted — the skill rejects downgrade).
    expect(byName.policy).toBeTruthy();
    expect(byName.policy.type).toBe('enum');
    expect(byName.policy.choices).toEqual(['shared', 'personal', 'hybrid']);
    expect(byName.policy.patch).toEqual({
      opId: 'setCircleStoragePolicy', argName: 'storagePolicy',
    });

    // groupPodUri — free-form URL string; flat-arg patch (no
    // argWrapper — the skill takes flat args, not `{patch: {...}}`).
    expect(byName.groupPodUri).toBeTruthy();
    expect(byName.groupPodUri.type).toBe('string');
    expect(byName.groupPodUri.patch).toEqual({
      opId: 'setCircleStoragePolicy', argName: 'groupPodUri',
    });
    // No argWrapper on either field — assert absence so a future
    // accidental wrap doesn't slip in silently.
    expect(byName.policy.patch.argWrapper).toBeUndefined();
    expect(byName.groupPodUri.patch.argWrapper).toBeUndefined();

    // adoption (2026-05-20) — groupPodUri declares a
    // conditional-display gate: only meaningful when policy is
    // 'shared' or 'hybrid'.  Auto-rendered consumers hide the
    // field otherwise; hand-coded pages enforce the same rule.
    expect(byName.groupPodUri.requiresField).toEqual({
      policy: ['shared', 'hybrid'],
    });
    // policy itself has no gate.
    expect(byName.policy).not.toHaveProperty('requiresField');
  });

  it('renderWeb projects the section with shape + dataSource + fields verbatim', () => {
    const nav = renderWeb(tasksManifest);
    const section = nav.sections.find((s) => s.id === 'pod-settings');
    expect(section).toBeTruthy();
    expect(section.title).toBe('Pod settings');
    expect(section.itemType).toBe('circle-storage-policy');
    expect(section.shape).toBe('record');
    expect(section.dataSource).toEqual({
      skillId:         'getCircleStoragePolicy',
      argsFromContext: { circleId: '$circleId' },
    });
    expect(Array.isArray(section.fields)).toBe(true);
    expect(section.fields.length).toBe(2);
    const byName = Object.fromEntries(section.fields.map((f) => [f.name, f]));
    expect(byName.policy.patch.opId).toBe('setCircleStoragePolicy');
    expect(byName.policy.patch.argName).toBe('storagePolicy');
    expect(byName.groupPodUri.patch.opId).toBe('setCircleStoragePolicy');
    expect(byName.groupPodUri.patch.argName).toBe('groupPodUri');
    // requiresField gate survives projection (defensive
    // copy of the value array).
    expect(byName.groupPodUri.requiresField).toEqual({
      policy: ['shared', 'hybrid'],
    });
    // No creative-verb affordances surface here — getCircleStoragePolicy
    // and setCircleStoragePolicy are NOT in manifest.operations[] (they're
    // pod-plumbing skills, mirroring stoop's getSettings/updateSettings
    // choice). Same #6 territory as stoop's settings view.
    expect(section.affordances).toEqual([]);
    // The view is not flagged readOnly (it mutates via the patch ops);
    // but because the per-field skills aren't manifest ops, no
    // creative-verb affordances surface.
    expect(section.readOnly).toBeUndefined();
  });
});
