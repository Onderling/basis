/**
 * basis — local built-ins tests.  /help today.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { basisManifest }              from '../manifest.js';
import { mergeManifests }                  from '../src/manifestMerge.js';
import { createLocalBuiltins }             from '../src/core/localBuiltins.js';
import { initLocalisation, t, setLang }    from '../src/localisation.js';

const householdLite = {
  app:       'household', itemTypes: ['chore'],
  operations: [
    { id: 'listOpen', verb: 'list', params: [],
      surfaces: { slash: { command: '/mine' },
                  chat:  { reply: 'list', hint: 'list open chores' } } },
    { id: 'markComplete', verb: 'complete', params: [{ name: 'choreId', kind: 'string', required: true }],
      surfaces: { slash: { command: '/done' },
                  chat:  { reply: 'text', hint: 'mark a chore complete' } } },
  ],
  views: [{ id: 'chores', title: 'C', type: 'chore' }],
};

beforeAll(async () => {
  await initLocalisation({ lng: 'en' });
});

describe('/help', () => {
  it('lists every command from the merged catalogue, grouped by app', async () => {
    const catalogue  = mergeManifests([
      { manifest: basisManifest },
      { manifest: householdLite },
    ]);
    const builtins = createLocalBuiltins({ catalogue, t });
    const r = await builtins.help();
    expect(typeof r.message).toBe('string');
    expect(r.message).toMatch(/Available commands/);
    expect(r.message).toMatch(/Chat/);             // basis section first
    expect(r.message).toMatch(/\/help/);
    expect(r.message).toMatch(/household/);        // app section header
    expect(r.message).toMatch(/\/mine/);
    expect(r.message).toMatch(/\/done/);
    expect(r.message).toMatch(/list open chores/);
    expect(r.message).toMatch(/mark a chore complete/);
  });

  it("puts basis (built-ins) section first", async () => {
    const catalogue = mergeManifests([
      { manifest: householdLite },
      { manifest: basisManifest },
    ]);
    const r = await createLocalBuiltins({ catalogue, t }).help();
    const chatIdx = r.message.indexOf('Chat');
    const appIdx  = r.message.indexOf('household');
    expect(chatIdx).toBeGreaterThan(-1);
    expect(appIdx).toBeGreaterThan(-1);
    expect(chatIdx).toBeLessThan(appIdx);
  });

  it("respects locale (Dutch heading)", async () => {
    const catalogue = mergeManifests([{ manifest: basisManifest }]);
    await setLang('nl');
    const r = await createLocalBuiltins({ catalogue, t }).help();
    expect(r.message).toMatch(/Beschikbare commando's/);
    await setLang('en');
  });

  it("renders 'empty' message when catalogue has no commands", async () => {
    const catalogue = mergeManifests([]);
    const r = await createLocalBuiltins({ catalogue, t }).help();
    expect(r.message).toBe('No commands available yet.');
  });

  it("sorts commands alphabetically within an app section", async () => {
    const catalogue = mergeManifests([{ manifest: householdLite }]);
    const r = await createLocalBuiltins({ catalogue, t }).help();
    const doneIdx = r.message.indexOf('/done');
    const mineIdx = r.message.indexOf('/mine');
    expect(doneIdx).toBeLessThan(mineIdx);   // /done before /mine alphabetically
  });
});

describe('basisManifest now carries /help', () => {
  it("declares help op with /help slash + 'text' reply", () => {
    const help = basisManifest.operations.find((o) => o.id === 'help');
    expect(help).toBeTruthy();
    expect(help.surfaces.slash.command).toBe('/help');
    expect(help.surfaces.chat.reply).toBe('text');
  });

  it("manifest still validates", async () => {
    const { validateManifest } = await import('@onderling/app-manifest');
    const result = validateManifest(basisManifest);
    expect(result.ok).toBe(true);
  });

  it("/help appears in the merged catalogue's commandMenu", () => {
    const catalogue = mergeManifests([{ manifest: basisManifest }]);
    const helpEntry = catalogue.commandMenu.find((e) => e.command === '/help');
    expect(helpEntry).toBeTruthy();
    expect(helpEntry.appOrigin).toBe('basis');
    expect(helpEntry.opId).toBe('help');
  });
});

describe('the chat-era thread ops are RETRACTED from the manifest (2026-08-31)', () => {
  // They declared a door — `/newthread`, `/threads`, `/dm`, `/reset-thread`, `/send-to` — onto a
  // surface that no longer exists: the chat shell was folded into the circle view in July, and the
  // circle model has no threads of its own (a conversation with one person is a contact thread).
  // The manifest is the contract, so it should not offer what nothing can serve. The HANDLERS stay
  // for now — `lint-typed-commands-reachable` tracks them — because deleting them is a separate,
  // larger piece of work than withdrawing the claim.
  it('the manifest no longer declares them', () => {
    const ids = new Set((basisManifest.operations ?? []).map((o) => o.id));
    for (const gone of ['newthread', 'threads', 'startDm', 'reset-thread', 'sendto']) {
      expect(ids.has(gone), `${gone} is declared again — it has no surface to be reached on`).toBe(false);
    }
  });

  it('…but `help-with` stays: two journeys still exercise its story', () => {
    // "Ask privately about a post" is a live user story (CC-ST.2, JM-1). It needs a circle-era home
    // rather than a retraction — recorded on the work list.
    expect(new Set((basisManifest.operations ?? []).map((o) => o.id)).has('help-with')).toBe(true);
  });
});
