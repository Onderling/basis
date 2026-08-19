/**
 * basis — local built-ins tests.  /help today.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { basisManifest }              from '../manifest.js';
import { mergeManifests }                  from '../src/manifestMerge.js';
import { createLocalBuiltins }             from '../src/core/localBuiltins.js';
import { initLocalisation, t, setLang }    from '../src/localisation.js';
import { ThreadStore }                     from '../src/threadStore.js';

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

describe('/newthread', () => {
  let store, setActiveCalls;
  beforeAll(async () => { await initLocalisation({ lng: 'en' }); });
  beforeEach(() => {
    store = new ThreadStore();
    store.createThread({ id: 'main', name: 'Main' });
    setActiveCalls = [];
  });

  it("creates a new thread + switches active", async () => {
    const catalogue  = mergeManifests([{ manifest: basisManifest }]);
    const builtins = createLocalBuiltins({
      catalogue, t, threadStore: store,
      setActive: (id) => setActiveCalls.push(id),
    });
    const r = await builtins.newthread({ name: 'Project Alpha' });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Created thread "Project Alpha"/);
    expect(r.threadId).toBeTruthy();
    expect(store.size).toBe(2);
    expect(store.getThread(r.threadId).name).toBe('Project Alpha');
    expect(setActiveCalls).toEqual([r.threadId]);
  });

  it("rejects empty name", async () => {
    const builtins = createLocalBuiltins({
      catalogue: mergeManifests([{ manifest: basisManifest }]),
      t, threadStore: store, setActive: () => {},
    });
    const r1 = await builtins.newthread({});
    const r2 = await builtins.newthread({ name: '   ' });
    expect(r1.ok).toBe(false);
    expect(r1.error).toMatch(/Please provide a name/);
    expect(r2.ok).toBe(false);
    expect(store.size).toBe(1);
  });

  it("fails gracefully when no threadStore wired", async () => {
    const builtins = createLocalBuiltins({
      catalogue: mergeManifests([{ manifest: basisManifest }]),
      t,
    });
    const r = await builtins.newthread({ name: 'X' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not available/);
  });
});

describe('/threads', () => {
  let store;
  beforeEach(() => {
    store = new ThreadStore();
    store.createThread({ id: 'main',  name: 'Main' });
    store.createThread({ id: 'inbox', name: 'Inbox',
                         filter: { eventTypes: ['notification'] } });
  });

  it('lists every thread with active marker', async () => {
    const builtins = createLocalBuiltins({
      catalogue:     mergeManifests([{ manifest: basisManifest }]),
      t,
      threadStore: store,
    });
    const r = await builtins.threads();
    expect(r.message).toMatch(/Threads:/);
    expect(r.message).toMatch(/Main ●/);   // active (created first)
    expect(r.message).toMatch(/Inbox/);
    expect(r.message).toMatch(/type:notification/);
  });

  it('shows "no threads" when store empty', async () => {
    const empty = new ThreadStore();
    const builtins = createLocalBuiltins({
      catalogue: mergeManifests([{ manifest: basisManifest }]),
      t, threadStore: empty,
    });
    const r = await builtins.threads();
    expect(r.message).toMatch(/No threads yet/);
  });
});

describe('basisManifest now also carries /newthread + /threads', () => {
  it('declares both ops', () => {
    const ids = basisManifest.operations.map((o) => o.id);
    expect(ids).toContain('newthread');
    expect(ids).toContain('threads');
  });

  it('newthread has a required name param', () => {
    const op = basisManifest.operations.find((o) => o.id === 'newthread');
    expect(op.params).toEqual([{ name: 'name', kind: 'string', required: true }]);
    expect(op.surfaces.slash.command).toBe('/newthread');
  });

  it('threads has no params + /threads slash', () => {
    const op = basisManifest.operations.find((o) => o.id === 'threads');
    expect(op.params).toEqual([]);
    expect(op.surfaces.slash.command).toBe('/threads');
  });
});
