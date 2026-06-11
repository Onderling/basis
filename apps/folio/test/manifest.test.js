/**
 * Slice F.1 — folio first manifest (V0.8, 2026-05-21).
 *
 * Validates the manifest's structure + Q27 confirm hints on the three
 * destructive ops the Tier C audit (Project Files/Substrates/tier-c-proposals.md) flagged for
 * lift.  The manifest is declaration-only today (no adapter consumes
 * it yet); these tests pin the shape so future adopters know what to
 * read.
 */

import { describe, it, expect } from 'vitest';

import { renderWeb, validateManifest } from '@canopy/app-manifest';

import { folioManifest } from '../manifest.js';

describe('Slice F.1 — folio manifest validation', () => {
  it('validates via @canopy/app-manifest validateManifest (non-strict)', () => {
    const { ok, errors } = validateManifest(folioManifest);
    expect(ok, JSON.stringify(errors, null, 2)).toBe(true);
  });

  it('declares the "note" + "file" itemTypes (Part G dissolve)', () => {
    expect(folioManifest.itemTypes).toEqual(['note', 'file']);
  });

  it('carries the merged op set (7 app ops + 7 chat-shell ops = 14)', () => {
    const ids = folioManifest.operations.map((o) => o.id);
    expect(ids).toEqual([
      // folio's own app ops
      'deleteFromPod', 'deleteLocally', 'forceRepush',
      'syncOnce', 'watchStart', 'watchStop', 'verifyPodState',
      // chat-shell ops folded in from the former mockFolioManifest
      'readNote', 'shareFolder', 'getFileSnapshot',
      'downloadFile', 'saveToMyPod', 'folioStatus', 'listFiles',
    ]);
    expect(folioManifest.operations).toHaveLength(14);
  });

  it('declares a "files" view with shape: list + listFiles dataSource', () => {
    const view = folioManifest.views.find((v) => v.id === 'files');
    expect(view).toBeTruthy();
    expect(view.title).toBe('Files');
    expect(view.type).toBe('file');
    expect(view.dataSource).toEqual({ skillId: 'listFiles' });
  });
});

describe('Slice F.1 — folio Q27 confirm declarations', () => {
  it('deleteFromPod declares Q27 confirm with severity:danger', () => {
    const op = folioManifest.operations.find((o) => o.id === 'deleteFromPod');
    expect(op).toBeTruthy();
    expect(op.appliesTo).toEqual({ type: 'file' });
    expect(op.surfaces.ui.confirm).toEqual({
      severity: 'danger',
      message:  'Permanently delete this file from your Solid pod?  This cannot be undone.',
    });
    // Part G curation — destructive ops are withheld from the circle LLM.
    expect(op.surfaces).not.toHaveProperty('chat');
  });

  it('deleteLocally declares Q27 confirm with severity:info', () => {
    const op = folioManifest.operations.find((o) => o.id === 'deleteLocally');
    expect(op).toBeTruthy();
    expect(op.appliesTo).toEqual({ type: 'file' });
    expect(op.surfaces.ui.confirm).toEqual({
      severity: 'info',
      message:  'Remove local copy?  Pod copy survives.',
    });
    // Part G curation — destructive ops are withheld from the circle LLM.
    expect(op.surfaces).not.toHaveProperty('chat');
  });

  it('forceRepush declares Q27 confirm with severity:warn + section-header placement', () => {
    const op = folioManifest.operations.find((o) => o.id === 'forceRepush');
    expect(op).toBeTruthy();
    // Q8 wildcard — folder-wide op surfaces on every view's header.
    expect(op.appliesTo).toEqual({ type: '*' });
    expect(op.surfaces.ui.placement).toBe('section-header');
    expect(op.surfaces.ui.confirm).toEqual({
      severity: 'warn',
      message:  'Force-push the local folder to the pod?  This overwrites any concurrent edits on the pod side.',
    });
    // Part G curation — destructive ops are withheld from the circle LLM.
    expect(op.surfaces).not.toHaveProperty('chat');
  });

  it('non-destructive ops carry NO confirm (syncOnce, watchStart, watchStop, verifyPodState)', () => {
    for (const id of ['syncOnce', 'watchStart', 'watchStop', 'verifyPodState']) {
      const op = folioManifest.operations.find((o) => o.id === id);
      expect(op, `op ${id} should exist`).toBeTruthy();
      expect(op.surfaces.ui, `op ${id} ui surface`).toBeTruthy();
      expect(op.surfaces.ui, `op ${id} should not declare confirm`).not.toHaveProperty('confirm');
    }
  });
});

describe('Slice F.1 — folio renderWeb projection', () => {
  it('projects the files section with Q27 confirms on itemActions + sectionActions', () => {
    const nav = renderWeb(folioManifest);
    const filesSec = nav.sections.find((s) => s.id === 'files');
    expect(filesSec).toBeTruthy();
    expect(filesSec.itemType).toBe('file');

    // Per-file itemActions — deleteFromPod (danger) + deleteLocally
    // (info) + verifyPodState (no confirm).
    const itemActionIds = filesSec.itemActions.map((a) => a.opId);
    expect(itemActionIds).toContain('deleteFromPod');
    expect(itemActionIds).toContain('deleteLocally');
    expect(itemActionIds).toContain('verifyPodState');

    const delPod = filesSec.itemActions.find((a) => a.opId === 'deleteFromPod');
    expect(delPod.confirm.severity).toBe('danger');
    const delLocal = filesSec.itemActions.find((a) => a.opId === 'deleteLocally');
    expect(delLocal.confirm.severity).toBe('info');
    const verify = filesSec.itemActions.find((a) => a.opId === 'verifyPodState');
    expect(verify).not.toHaveProperty('confirm');

    // Section-header CTAs — forceRepush (warn), syncOnce, watchStart,
    // watchStop (no confirm).
    const sectionActionIds = (filesSec.sectionActions ?? []).map((a) => a.opId);
    expect(sectionActionIds).toContain('forceRepush');
    expect(sectionActionIds).toContain('syncOnce');

    const force = filesSec.sectionActions.find((a) => a.opId === 'forceRepush');
    expect(force.confirm.severity).toBe('warn');
    const sync = filesSec.sectionActions.find((a) => a.opId === 'syncOnce');
    expect(sync).not.toHaveProperty('confirm');
  });
});
