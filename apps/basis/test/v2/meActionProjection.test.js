/**
 * Me's two actions are DECLARED in the basis manifest and projected for both shells (2026-10-09).
 */
import { describe, it, expect } from 'vitest';
import { basisManifest } from '../../src/index.js';
import { validateManifest } from '@onderling/app-manifest';
import { meActionsFor, meActionsMobile } from '../../src/v2/meActionProjection.js';

describe("Me's actions come from the manifest", () => {
  it('the basis manifest declares share-contact (Scan is in the "+" only), and stays valid', () => {
    expect((validateManifest(basisManifest).errors ?? []).filter((e) => String(e.path).startsWith('/meActions'))).toEqual([]);
    expect(meActionsFor(basisManifest).map((a) => a.id)).toEqual(['share-contact']);
    expect(meActionsMobile(basisManifest)).toEqual(meActionsFor(basisManifest));
  });
  it('share-contact goes to the existing share view; Scan IS the scanQr op, in the "+" (one door with /scan-qr)', () => {
    const [share] = meActionsFor(basisManifest);
    expect(share.target).toEqual({ kind: 'nav', to: 'shareContact' });
    expect(basisManifest.plus.dial.find((b) => b.id === 'scan').target).toEqual({ kind: 'op', opId: 'scanQr' });
  });
  it('the "+" is not a Me action: its button is the one way into the conversation (Frits 2026-11-16)', () => {
    expect(meActionsFor(basisManifest).some((a) => a.id === 'assistant' || a.target?.to === 'assistant')).toBe(false);
  });
});
