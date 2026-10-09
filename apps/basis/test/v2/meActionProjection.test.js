/**
 * Me's two actions are DECLARED in the basis manifest and projected for both shells (2026-10-09).
 */
import { describe, it, expect } from 'vitest';
import { basisManifest } from '../../src/index.js';
import { validateManifest } from '@onderling/app-manifest';
import { meActionsFor, meActionsMobile } from '../../src/v2/meActionProjection.js';

describe("Me's actions come from the manifest", () => {
  it('the basis manifest declares share-card and scan, and stays valid', () => {
    expect((validateManifest(basisManifest).errors ?? []).filter((e) => String(e.path).startsWith('/meActions'))).toEqual([]);
    expect(meActionsFor(basisManifest).map((a) => a.id)).toEqual(['share-card', 'scan']);
    expect(meActionsMobile(basisManifest)).toEqual(meActionsFor(basisManifest));
  });
  it('share-card goes to the existing share view; scan has its own entry', () => {
    const [share, scan] = meActionsFor(basisManifest);
    expect(share.target).toEqual({ kind: 'nav', to: 'shareContact' });
    expect(scan.target).toEqual({ kind: 'nav', to: 'scan' });
  });
});
