import { describe, it, expect } from 'vitest';
import { canopyChatManifest } from '../manifest.js';
import { mergeManifests } from '../src/manifestMerge.js';

// M11 — /feedback + /feedback-stop are declared on canopy-chat's manifest so they surface in /help
// (catalog.commandMenu) and the slash autosuggest (catalog.opsById). Execution is still intercepted in
// main.js handleUserText; the manifest entries are for discoverability only.
describe('M11 — /feedback in the command menu', () => {
  const cat = mergeManifests([{ manifest: canopyChatManifest }], { runtime: 'browser' });

  it('the manifest declares /feedback + /feedback-stop slash ops', () => {
    const cmds = canopyChatManifest.operations
      .map((op) => op?.surfaces?.slash?.command)
      .filter(Boolean);
    expect(cmds).toContain('/feedback');
    expect(cmds).toContain('/feedback-stop');
  });

  it('they appear in catalog.commandMenu (drives /help)', () => {
    const menuCmds = cat.commandMenu.map((e) => e.command);
    expect(menuCmds).toContain('/feedback');
    expect(menuCmds).toContain('/feedback-stop');
  });

  it('they appear in catalog.opsById with a hint (drives autosuggest)', () => {
    const feedback = [...cat.opsById.values()].map((e) => e.op).find((op) => op?.id === 'feedback');
    expect(feedback?.surfaces?.slash?.command).toBe('/feedback');
    expect(feedback?.surfaces?.chat?.hint).toMatch(/feedback/i);
    // optional code arg (so `/feedback <code>` is understood), not required
    expect(feedback?.params?.find((p) => p.name === 'code')?.required).toBeFalsy();
  });
});
