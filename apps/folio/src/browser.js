/**
 * folio — browser entry for basis composition (of the
 * basis integration plan, 2026-05-23).
 *
 * Composes folio's web-only surface into basis's browser
 * bundle.  Out of scope: the SyncEngine, the chokidar watcher, the
 * desktop tray, the CLI, the HTTP server — those stay app-side and
 * never enter the browser bundle (they all carry node-only deps).
 *
 * In scope (the chat-web subset):
 *   - readNote            — read a file by relPath or filename
 *   - shareFolder         — issue a real PodCapabilityToken via
 *                           autoShare.mintShareToken (the same
 *                           primitive the desktop sync uses)
 *   - listFiles           — return the in-process file index
 *   - searchFiles         — name/path substring search
 *   getFileSnapshot — cardSnapshotSkill (for /embed-file)
 *   - verifyPodState      — pod-side check (browser-doable; the
 *                           manifest declares runtime:'browser')
 *   - deleteFromPod       — pod-side delete (browser-doable)
 *   - downloadFile        — receiver-side action; placeholder reply
 *   - saveToMyPod         — receiver-side cross-pod copy; placeholder
 *   folio_briefSummary — briefSummary
 *   - folioStatus         — record reply: count / synced / shared
 *
 * Mobile-extended (DEFERRED): basis mobile composes the same
 * browser-shape factory PLUS @onderling/sync-engine-rn for real file-
 * system mirroring; the in-memory file store collapses to a thin
 * proxy over the RN sync engine. Tracked by -.
 *
 * Boundary: imports ONLY platform-neutral parts of folio — autoShare
 * (which uses an injected FsAdapter; no `fs` import at module load)
 * and PodCapabilityToken (pure crypto, no node deps).  Verified by
 * the audit in integration-plan-2026-05-23.md §Audit.
 */

import {
  Agent, AgentIdentity, InternalTransport,
} from '@onderling/core';

import { mintShareToken } from './autoShare.js';
import { listPodFolio } from './folioPodList.js';
import { buildFolioNoteSearch, indexFolioNotes, searchFolioNotes } from './folioSearch.js';

// folio's pod-file ops are now MANIFEST-DERIVED wireSkill
// capabilities (buildFolioSkills), not hand-rolled agent.register handlers.
import { buildFolioSkills } from './wireSkills.js';
import { searchFiles as searchFilesCore, folioBriefSummary } from './agentCores.js';

// N5 — Drive tree (folder navigation + rich rows).  Pure JS, node-free,
// RN-free; safe to pull into the browser bundle (unlike the `.` barrel,
// which drags in scanLocal's `fs`/chokidar).  basis web/mobile
// import the Drive view from here.
export {
  folioLevel, breadcrumbs, parentPath, rowPath, rowName,
  formatFileSize, fileKind, glyphForFile, FILE_KIND_GLYPH,
} from './folioTree.js';
export { listPodFolio } from './folioPodList.js';

/**
 * Pre-seeded demo files.  Mirrors the slice-1/2b convention — the
 * chat-shell expects /files + /folio-status to show content out of
 * the box; tests + the demo UX rely on these IDs ('/notes/recipes.md'
 * etc).  Opt out with `seedFiles:false`.
 */
const SEED_FILES = [
  {
    id: '/notes/shared/anne.md', name: 'anne.md', type: 'file',
    mime: 'text/markdown', bytes: 1234, state: 'synced',
    // (B9, 2026-05-23) — frontmatter `embeds` per
    // v1-web-functional-design § 4f.  Notes can declare references to
    // tasks / pinboard posts / events; the chat-shell renders them as
    // clickable "See also" chips at the head of /readnote replies.
    frontmatter: {
      embeds: [
        { type: 'task',          ref: 't-anne-onboarding', label: 'Anne onboarding' },
        { type: 'calendar-event', ref: 'evt-anne-welcome', label: 'Welcome dinner' },
      ],
    },
  },
  { id: '/notes/recipes.md', name: 'recipes.md', type: 'file', mime: 'text/markdown',   bytes: 5678,   state: 'synced' },
  { id: '/docs/lease.pdf',   name: 'lease.pdf',  type: 'file', mime: 'application/pdf', bytes: 102400, state: 'synced' },
];

/**
 * Sync-envelope shape consumed by the chat-shell renderer (mirrors
 * basis's `simulateSync` so the chat-shell's _sync UI keeps
 * working without a real pod-write round-trip).
 */
function simulateSync() {
  return {
    plannedPaths: [],
    durationMs:   0,
    bytesPushed:  0,
    bytesPulled:  0,
    conflictCount: 0,
    queueDepth:   0,
  };
}

/**
 * Build a folio web-surface agent on the shared bus.
 *
 * @param {object} args
 * @param {InternalBus}    args.bus              shared bus (basis owns it)
 * @param {object}         args.identityVault    Vault for the folio agent's identity
 *                                               (browser convention: VaultLocalStorage
 *                                               prefixed `cc-folio-id:`)
 * @param {string}         [args.label='FolioAgent']
 * @param {object}         [args.podClient]      reserved for future pod-backed reads
 * @param {string}         [args.podRoot]        reserved; used as the token's `pod` field
 *                                               in shareFolder when set
 * @param {Array}          [args.seedFiles]      override demo seeds; pass [] for clean
 * @param {object}         [args.noteEmbedder]   duck-typed embedder for `/zoek` semantic
 *                                               mode (a mock provider or an
 *                                               `@onderling/llm-client` EmbeddingClient).
 *                                               Absent ⇒ lexical-only (llmTool:'off' /
 *                                               no-Ollama path). Wired by basis
 *                                               from the circle's embed policy; may also
 *                                               be attached post-boot via `setNoteEmbedder`.
 * @param {object}         [args.noteVectorStore] optional StorageBackend-shaped store ⇒
 *                                               vectors persist under private/state/search-index/
 * @param {(e:object)=>void} [args.noteAudit]    optional pod-search audit hook
 * @returns {Promise<{
 *   agent:    Agent,
 *   identity: AgentIdentity,
 *   address:  string,
 *   files:    Array,            mutable in-process index
 *   close:    () => Promise<void>,
 * }>}
 */
export async function createBrowserFolioAgent({
  bus,
  identityVault,
  label = 'FolioAgent',
  podClient,
  podRoot,
  seedFiles,
  noteEmbedder,
  noteVectorStore,
  noteAudit,
}) {
  if (!bus)           throw new TypeError('createBrowserFolioAgent: bus required');
  if (!identityVault) throw new TypeError('createBrowserFolioAgent: identityVault required');

  const identity = await (async () => {
    if (await identityVault.has('agent-privkey')) {
      return AgentIdentity.restore(identityVault);
    }
    return AgentIdentity.generate(identityVault);
  })();

  const transport = new InternalTransport(bus, identity.pubKey);
  const agent = new Agent({ identity, transport, label });

  const files = Array.isArray(seedFiles)
    ? seedFiles.map((f) => ({ ...f }))
    : SEED_FILES.map((f) => ({ ...f }));

  // N5 — lazy real-pod source for the Drive browser.  The folio agent
  // boots before the user signs in, so the pod source is attached later
  // (main.js, after OIDC) via the returned `setPodSource`.  When set and
  // a caller asks `listFiles({ source: 'pod' })`, files come from the live
  // pod container (a lightweight `.list` walk — no file reads); otherwise
  // the in-process index is returned as before.
  let podSource = null;   // { podClient, containerUri } | null

  /* ─── /zoek note-search index — stateful, embedder-swappable ──────────
   *
   * The SEMANTIC sibling of `searchFiles`. Where `searchFiles` is a
   * name/path substring match, `/zoek` (searchNotes) ranks notes by MEANING
   * via `@onderling/pod-search` — so "car" finds a note about "automobile
   * repair". Degrades per (option a) + the llmTool policy: with no
   * `noteEmbedder` injected (llmTool:'off' / no Ollama) the index is
   * lexical-only, and a `mode:'semantic'` request gracefully returns the
   * LEXICAL ranking rather than an empty E_SEMANTIC_UNAVAILABLE. No embed
   * call is ever made without an embedder. Kept in the closure (not the
   * core) because the index is mutable state — `setNoteEmbedder` rebuilds
   * it and `getNoteSearch` exposes it. */
  let noteSearch = null;
  let builtWithEmbedder;             // embedder identity the current index was built with
  async function ensureNoteSearch() {
    if (!noteSearch || builtWithEmbedder !== noteEmbedder) {
      noteSearch = buildFolioNoteSearch({
        embedder: noteEmbedder, vectorStore: noteVectorStore, audit: noteAudit,
      });
      builtWithEmbedder = noteEmbedder;
    }
    // Upsert the current corpus. The content-hash cache makes an unchanged
    // note free (no re-embed); absent an embedder this is a pure lexical index.
    await indexFolioNotes(noteSearch, files);
    return noteSearch;
  }

  /* ─── the injected folio backend the cores read (agentCores.js) ─────────
   * Threads the file index + share/pod/search collaborators the old
   * hand-rolled handlers closed over.  Mutable state (podSource,
   * noteEmbedder) is reached via accessors so the returned setters keep
   * working. */
  const store = {
    files,
    identity,
    podRoot,
    mintShareToken,
    simulateSync,
    listPodFolio,
    getPodSource:     () => podSource,
    ensureNoteSearch,
    searchFolioNotes,
  };

  /* ─── register the pod-file ops — MANIFEST-DERIVED via buildFolioSkills ──
   * The folioManifest `runtime:'browser'` ops (readNote / shareFolder /
   * listFiles / searchNotes / getFileSnapshot / verifyPodState /
   * deleteFromPod / downloadFile / saveToMyPod / folioStatus) are now
   * wireSkill-wrapped pure cores, not hand-rolled handlers.  Same ids, same
   * replies (the cores return the exact payloads `DataPart(...)` wrapped
   * before). */
  for (const skill of buildFolioSkills({ store })) {
    agent.register(skill.id, skill.handler);
  }

  /* ─── ops with NO manifest op (registered directly) ─────────────────────
   * `searchFiles` (lexical substring — the semantic sibling searchNotes is
   * the declared op) and `folio_briefSummary` (basis's generic
   * /brief maps to this named skill).  Decode the first DataPart and call
   * the shared core so their logic still lives once in agentCores.js. */
  agent.register('searchFiles', async ({ parts }) => searchFilesCore(store, parts?.[0]?.data ?? {}));
  agent.register('folio_briefSummary', async () => folioBriefSummary(store));

  await agent.start();

  return {
    agent,
    identity,
    address: identity.pubKey,
    files,
    // N5 — attach / detach the live pod source after sign-in.  Pass
    // `{ podClient, containerUri }` to light up `listFiles({ source:'pod' })`;
    // pass null (or nothing) to fall back to the in-process index.
    setPodSource: (src) => {
      podSource = src?.podClient && src?.containerUri
        ? { podClient: src.podClient, containerUri: src.containerUri }
        : null;
      return podSource;
    },
    getPodSource: () => podSource,
    // 52.25 — attach / swap the `/zoek` semantic embedder after boot. The
    // folio agent is global while the embed policy is per-circle, so
    // basis resolves the embedder from the active circle's
    // llmTool/embedTool policy and wires it here (null ⇒ back to lexical).
    // A changed embedder identity rebuilds the index on the next `/zoek`.
    setNoteEmbedder: (e) => { noteEmbedder = e ?? undefined; return noteEmbedder ?? null; },
    getNoteSearch:   () => noteSearch,
    close:   () => agent.close?.(),
  };
}
