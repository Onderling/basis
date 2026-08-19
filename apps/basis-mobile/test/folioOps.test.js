/**
 * folio operations smoke — verifies the 5 folio skills (listFiles,
 * getFileSnapshot, shareFolder, saveToMyPod, downloadFile) round-trip
 * through `bundle.callSkill('folio', X, args)` on the basis-mobile
 * portable-core boot.  Skills live in apps/folio/src/browser.js +
 * compose into the real agent via realAgent.js:579 (createBrowserFolio
 * Agent).  This test confirms the mobile bundle composes the same
 * surface — no Hermes/RN gap on the substrate level.
 *
 * The test does NOT cover UI wiring (slash-command parser, button
 * intercepts, list rendering) — those live in their own targeted tests
 * (filePickerSendFile, buttonSpecials, chatRender).  The job here is
 * purely "does callSkill('folio', …) work end-to-end on mobile's boot
 * path".
 */
import { describe, it, expect } from 'vitest';

import { bootAgentBundle }   from '../src/core/agentBundle.js';
import { composeManifests }  from '../src/core/composeManifests.js';

describe('#237 folio surface — manifest exposure', () => {
  it('folio exposes the manifest-surfaced ops in the mobile catalogue', () => {
    const c = composeManifests();
    const folioOps = [...c.opsById.values()].filter((e) => e.appOrigin === 'folio');
    const ids = folioOps.map((e) => e.op.id).sort();
    // The 4 manifest-surfaced ops (UI/slash entries):
    //  getFileSnapshot is the cardSnapshotSkill for /embed-file
    //  - shareFolder backs /share
    //  - saveToMyPod / downloadFile are file-card buttons (appliesTo:file)
    //  - folioStatus backs /folio-status
    // NOTE: listFiles is now IN the merged folioManifest (folded in via the
    // Part-G dissolve) with a /files slash + list surface, and is invokable
    // via callSkill as always.
    for (const need of [
      'getFileSnapshot', 'shareFolder', 'saveToMyPod', 'downloadFile', 'folioStatus',
    ]) {
      expect(ids).toContain(need);
    }
  });

  it('folio slash commands (/share, /folio-status) reach the catalogue commandMenu', () => {
    const c = composeManifests();
    const folioCmds = (c.commandMenu ?? []).filter((e) =>
      ['shareFolder', 'folioStatus', 'readNote'].includes(e.opId),
    );
    const map = Object.fromEntries(folioCmds.map((e) => [e.opId, e.command]));
    expect(map.shareFolder).toBe('/share');
    expect(map.folioStatus).toBe('/folio-status');
    expect(map.readNote).toBe('/readnote');
  });

  it('downloadFile + saveToMyPod surface as ui:button (appliesTo file)', () => {
    const c = composeManifests();
    const ops = [...c.opsById.values()];
    const download = ops.find((e) => e.op.id === 'downloadFile')?.op;
    const save     = ops.find((e) => e.op.id === 'saveToMyPod')?.op;
    expect(download?.surfaces?.ui?.control).toBe('button');
    expect(save?.surfaces?.ui?.control).toBe('button');
    expect(download?.appliesTo?.type).toBe('file');
    expect(save?.appliesTo?.type).toBe('file');
  });
});

describe('#237 folio operations via mobile bundle.callSkill', () => {
  async function bootFolioBundle() {
    const { VaultMemory } = await import('@onderling/vault');
    return bootAgentBundle({
      chatVault: new VaultMemory(),
      hostVault: new VaultMemory(),
    });
  }

  // Real-agent boot lifts createRealHouseholdAgent + composes folio,
  // tasks-v0, stoop, household — first boot can clear 5s on a cold
  // module cache.  Bump per-test timeout the same way bootSmoke
  // implicitly relies on (its tests run 2-3s).
  const BOOT_TIMEOUT = 15000;

  it('listFiles returns the seeded folio file index', { timeout: BOOT_TIMEOUT }, async () => {
    const bundle = await bootFolioBundle();
    try {
      const r = await bundle.callSkill('folio', 'listFiles', {});
      expect(r).toBeTruthy();
      expect(Array.isArray(r.items)).toBe(true);
      // Browser folio seeds 3 demo files (anne.md / recipes.md / lease.pdf).
      expect(r.items.length).toBeGreaterThan(0);
      const names = r.items.map((it) => it.name).sort();
      expect(names).toContain('recipes.md');
    } finally {
      await bundle.dispose();
    }
  });

  it('getFileSnapshot returns metadata for a seeded file', async () => {
    const bundle = await bootFolioBundle();
    try {
      const r = await bundle.callSkill('folio', 'getFileSnapshot', {
        path: '/notes/recipes.md',
      });
      expect(r).toBeTruthy();
      expect(r.ok).not.toBe(false);
      expect(r.id).toBe('/notes/recipes.md');
      expect(r.type).toBe('file');
      expect(r.name).toBe('recipes.md');
      expect(r.mime).toMatch(/markdown/);
      expect(typeof r.bytes).toBe('number');
    } finally {
      await bundle.dispose();
    }
  });

  it('shareFolder mints a real PodCapabilityToken (autoShare)', async () => {
    const bundle = await bootFolioBundle();
    try {
      const r = await bundle.callSkill('folio', 'shareFolder', {
        folder: '/notes/shared',
        with:   'https://anne.example.org/profile#me',
      });
      expect(r).toBeTruthy();
      expect(r.ok).toBe(true);
      expect(r.share).toBeTruthy();
      expect(r.share.webid).toBe('https://anne.example.org/profile#me');
      expect(r.share.sharePath).toBe('/notes/shared');
      // Real PodCapabilityToken JSON object — receivers verify against
      // their pod's authorization layer.
      expect(r.share.token).toBeTruthy();
      expect(typeof r.share.issuer).toBe('string');
      // autoShare.mintShareToken returns issuedAt/expiresAt as numeric
      // epoch-ms (PodCapabilityToken convention) — both number and ISO
      // string are acceptable downstream; we just confirm presence.
      expect(r.share.issuedAt).toBeTruthy();
    } finally {
      await bundle.dispose();
    }
  });

  it('saveToMyPod returns the cross-pod copy ack', async () => {
    const bundle = await bootFolioBundle();
    try {
      const r = await bundle.callSkill('folio', 'saveToMyPod', {
        name: 'gift-from-anne.md',
      });
      expect(r).toBeTruthy();
      expect(r.ok).toBe(true);
      expect(r.message).toMatch(/gift-from-anne\.md/);
    } finally {
      await bundle.dispose();
    }
  });

  it('downloadFile returns the receiver-side ack', async () => {
    const bundle = await bootFolioBundle();
    try {
      const r = await bundle.callSkill('folio', 'downloadFile', {
        path: '/notes/recipes.md',
      });
      expect(r).toBeTruthy();
      expect(r.ok).toBe(true);
      expect(r.message).toMatch(/recipes\.md/);
    } finally {
      await bundle.dispose();
    }
  });

  it('folioStatus returns the sync-status record', async () => {
    const bundle = await bootFolioBundle();
    try {
      const r = await bundle.callSkill('folio', 'folioStatus', {});
      expect(r).toBeTruthy();
      expect(r.title).toBe('Folio sync status');
      expect(typeof r.fileCount).toBe('number');
      expect(r.fileCount).toBeGreaterThan(0);
      expect(typeof r.syncedCount).toBe('number');
    } finally {
      await bundle.dispose();
    }
  });
});
