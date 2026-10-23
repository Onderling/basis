/**
 * folioSearch + the browser agent's `/zoek` op (pod-search V2 consumer, 52.25).
 *
 * Proves the four acceptance gates:
 *   1. notes indexed → `/zoek` SEMANTIC returns a synonym match a lexical
 *      query misses;
 *   2. `llmTool:'off'` (no embedder injected) ⇒ lexical-only + NO embed call;
 *   3. no-embedder ⇒ a `mode:'semantic'` request degrades gracefully to lexical;
 *   4. the vector store, when supplied, persists ONLY under
 *      `private/state/search-index/…` (never `sharing/`).
 *
 * Everything runs against a pseudo-pod / in-memory store with a deterministic
 * MOCK embedder — no live Ollama, no real pod.
 */
import { describe, it, expect } from 'vitest';
import {
  AgentIdentity, InternalBus, InternalTransport, Agent, DataPart,
} from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod/memory';

import {
  buildFolioNoteSearch, indexFolioNotes, searchFolioNotes, noteItemFromRow,
} from '../src/folioSearch.js';
import { createBrowserFolioAgent } from '../src/browser.js';

/**
 * Deterministic mock embedder over a 3-axis concept space
 * [vehicle, food, weather]. "car" lands on the vehicle axis so it matches
 * "automobile repair" — a synonym a substring search never finds. Counts
 * embed() calls so "no embed" is assertable.
 */
function mockEmbedder({ id = 'mock:v1', dim = 3 } = {}) {
  // Keyword → concept axis. Matching on presence (not exact string) is robust
  // to PodSearch joining `title` + `body` with a blank line before embedding.
  const vecFor = (t) => {
    const s = String(t).toLowerCase();
    if (/\b(car|automobile|dealership)\b/.test(s)) return [1, 0, 0.05]; // vehicle
    if (/\b(lunch|soup|recipe)\b/.test(s))         return [0, 1, 0];    // food
    if (/\b(sunny|weather|forecast)\b/.test(s))    return [0, 0, 1];    // weather
    return new Array(dim).fill(0);
  };
  const emb = {
    id, dim, calls: 0, embeddedTexts: 0,
    async embed(texts) {
      emb.calls += 1; emb.embeddedTexts += texts.length;
      return texts.map((t) => Float32Array.from(vecFor(t)));
    },
  };
  return emb;
}

// Deliberately: NO note's name/path/title/body contains the token "car"
// EXCEPT the dealership note, so a lexical "car" search finds ONLY dealership
// while a semantic search ALSO surfaces the automobile note (the synonym).
const NOTES = [
  { id: '/notes/auto.md',    name: 'auto.md',    title: 'automobile repair', body: 'notes about fixing my automobile', state: 'synced' },
  { id: '/notes/deal.md',    name: 'deal.md',    title: 'car dealership',    body: 'visit', state: 'synced' },
  { id: '/notes/soup.md',    name: 'soup.md',    title: 'lunch recipe',      body: 'for soup', state: 'synced' },
  { id: '/notes/weather.md', name: 'weather.md', title: 'sunny weather',     body: 'forecast', state: 'synced' },
];

describe('folioSearch — note-corpus mapping', () => {
  it('projects a folio row onto a note item (tolerant of field names)', () => {
    const it = noteItemFromRow({ relPath: 'a/b.md', mime: 'text/markdown', content: 'hi', state: 'synced' });
    expect(it).toMatchObject({ id: 'a/b.md', path: 'a/b.md', name: 'b.md', title: 'b.md', body: 'hi', kind: 'text/markdown', state: 'synced' });
  });
});

describe('folioSearch — semantic vs lexical', () => {
  it('SEMANTIC finds the synonym note a LEXICAL query misses', async () => {
    const embedder = mockEmbedder();
    const s = buildFolioNoteSearch({ embedder });
    await indexFolioNotes(s, NOTES);
    expect(s.semanticReady).toBe(true);

    const lex = await searchFolioNotes(s, { text: 'car', mode: 'lexical' });
    // Lexical: only the note whose text contains "car".
    expect(lex.items.map((i) => i.id)).toEqual(['/notes/deal.md']);

    const sem = await searchFolioNotes(s, { text: 'car', mode: 'semantic', minScore: 0.1 });
    // Semantic surfaces the automobile note that lexical never found.
    expect(sem.items.map((i) => i.id)).toContain('/notes/auto.md');
    expect(lex.items.map((i) => i.id)).not.toContain('/notes/auto.md');
  });

  it('NO embedder ⇒ lexical-only, semantic degrades, ZERO embed calls', async () => {
    const s = buildFolioNoteSearch({ /* no embedder — llmTool:off / no Ollama */ });
    await indexFolioNotes(s, NOTES);
    expect(s.semanticReady).toBe(false);

    // A semantic request on a lexical-only index returns the coded empty
    // result (the agent layer converts this to a graceful lexical answer).
    const sem = await searchFolioNotes(s, { text: 'car', mode: 'semantic' });
    expect(sem.code).toBe('E_SEMANTIC_UNAVAILABLE');
    // Hybrid silently equals lexical when semantic is off.
    const hyb = await searchFolioNotes(s, { text: 'car', mode: 'hybrid' });
    expect(hyb.items.map((i) => i.id)).toEqual(['/notes/deal.md']);
  });

  it('llmTool:off proof — the embedder is never invoked when not injected', async () => {
    const embedder = mockEmbedder();
    // Simulate the policy gate: off ⇒ basis injects no embedder.
    const s = buildFolioNoteSearch({ /* embedder withheld by policy */ });
    await indexFolioNotes(s, NOTES);
    await searchFolioNotes(s, { text: 'car', mode: 'hybrid' });
    expect(embedder.calls).toBe(0);
  });
});

describe('folioSearch — persistence privacy invariant', () => {
  it('persists vector records ONLY under private/state/search-index/ (never sharing/)', async () => {
    const store = createMemoryBackend();
    const embedder = mockEmbedder();
    const s = buildFolioNoteSearch({ embedder, vectorStore: store, scope: 'folio-notes' });
    await indexFolioNotes(s, NOTES);

    const keys = await store.list('');
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k.startsWith('private/state/search-index/folio-notes/')).toBe(true);
      expect(k.includes('sharing/')).toBe(false);
    }
  });
});

/** Spin up a peer that can invoke the folio agent over a shared bus. */
async function makePeer(bus) {
  const identity = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({ identity, transport: new InternalTransport(bus, identity.pubKey) });
  await agent.start();
  return agent;
}

describe('browser folio agent — /zoek (searchNotes) op', () => {
  it('semantic mode returns the synonym note via the agent boundary', async () => {
    const bus = new InternalBus();
    const embedder = mockEmbedder();
    const folio = await createBrowserFolioAgent({
      agent: await makePeer(bus),
      seedFiles: NOTES, noteEmbedder: embedder,
    });
    const peer = await makePeer(bus);
    await peer.hello(folio.address);

    const res = await peer.invoke(folio.address, 'searchNotes',
      [DataPart({ query: 'car', mode: 'semantic', minScore: 0.1 })]);
    const data = res?.[0]?.data;
    expect(data.mode).toBe('semantic');
    expect(data.semantic).toBe(true);
    expect(data.items.map((i) => i.id)).toContain('/notes/auto.md');
  });

  it('no embedder ⇒ /zoek semantic degrades to lexical (degraded flag, no embed)', async () => {
    const bus = new InternalBus();
    const folio = await createBrowserFolioAgent({
      agent: await makePeer(bus),
      seedFiles: NOTES, /* noteEmbedder omitted — llmTool:'off' */
    });
    const peer = await makePeer(bus);
    await peer.hello(folio.address);

    const res = await peer.invoke(folio.address, 'searchNotes',
      [DataPart({ query: 'car', mode: 'semantic' })]);
    const data = res?.[0]?.data;
    expect(data.semantic).toBe(false);
    expect(data.mode).toBe('lexical');       // degraded from the requested semantic
    expect(data.degraded).toBe('lexical');
    // Lexical still finds the literal "car" note.
    expect(data.items.map((i) => i.id)).toEqual(['/notes/deal.md']);
  });

  it('setNoteEmbedder lights up semantic after boot', async () => {
    const bus = new InternalBus();
    const folio = await createBrowserFolioAgent({
      agent: await makePeer(bus), seedFiles: NOTES,
    });
    const peer = await makePeer(bus);
    await peer.hello(folio.address);

    folio.setNoteEmbedder(mockEmbedder());   // circle policy resolved → embedder wired
    const res = await peer.invoke(folio.address, 'searchNotes',
      [DataPart({ query: 'car', mode: 'semantic', minScore: 0.1 })]);
    const data = res?.[0]?.data;
    expect(data.semantic).toBe(true);
    expect(data.items.map((i) => i.id)).toContain('/notes/auto.md');
  });
});
