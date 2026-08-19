/**
 * companion-node — the Node-side `store` the RELOCATED folio cores read.
 *
 * This is the Node mirror of the `store` object `createBrowserFolioAgent`
 * builds in `apps/folio/src/browser.js` (§"the injected folio backend the
 * cores read").  It satisfies the EXACT contract documented in
 * `apps/folio/src/agentCores.js` so the pure cores (`readNote`, `listFiles`,
 * `searchNotes`, `shareFolder`, …) run UNCHANGED on the host — the whole point
 * of R1 is that folio's cores are already relocatable, so we only re-thread
 * their collaborators on the Node side rather than reimplement any of them.
 *
 * The collaborators are imported VERBATIM from folio by relative path (folio's
 * isolated `node_modules` resolves their own bare `@onderling/*` deps; we never
 * copy folio logic — see the coupling note in the app README).  Only two
 * things are host-local: the seed file index and the `simulateSync` envelope
 * stub — both are byte-identical to `browser.js`, kept here so the store is
 * self-contained.
 *
 * WHAT'S REAL vs STUBBED in R1 (see README phase table):
 *   - `files`            REAL in-process index (this IS folio's relocatable
 *                        browser pod-file surface — the same seeds browser.js
 *                        serves).
 *   - `getPodSource()`   REAL round-trip to a pod source (`podSource.js` wires
 *                        folio's dev pseudo-pod backend). `listFiles({source:
 *                        'pod'})` walks it via `listPodFolio` — a genuine pod
 *                        leg, not the seed index.
 *   - `mintShareToken`   REAL `PodCapabilityToken` issuance (folio's autoShare).
 *   - note search        REAL lexical `@onderling/pod-search` index (no embedder
 *                        injected ⇒ lexical-only, exactly like browser default).
 *
 * NOT wired in R1 (deferred): the `CapabilityAuth` `pod-direct` delegation that
 * turns the pod source into a token-honouring bundled pod — that is R1.5/R2's
 * concern per PLAN-companion-node-remote-hosting.md.
 */

// Folio collaborators, reused verbatim (relative import into apps/folio/src —
// folio's node_modules resolves their transitive @onderling/* deps).
import { mintShareToken }        from '../../folio/src/autoShare.js';
import { listPodFolio }          from '../../folio/src/folioPodList.js';
import {
  buildFolioNoteSearch,
  indexFolioNotes,
  searchFolioNotes,
}                                from '../../folio/src/folioSearch.js';

/**
 * Pre-seeded demo files — byte-identical to `browser.js` SEED_FILES so the
 * host serves the same known content the browser folio agent does (tests +
 * demo UX rely on these ids).  Opt out with `seedFiles: []`.
 */
const SEED_FILES = [
  {
    id: '/notes/shared/anne.md', name: 'anne.md', type: 'file',
    mime: 'text/markdown', bytes: 1234, state: 'synced',
    frontmatter: {
      embeds: [
        { type: 'task',           ref: 't-anne-onboarding', label: 'Anne onboarding' },
        { type: 'calendar-event', ref: 'evt-anne-welcome',  label: 'Welcome dinner' },
      ],
    },
  },
  { id: '/notes/recipes.md', name: 'recipes.md', type: 'file', mime: 'text/markdown',   bytes: 5678,   state: 'synced' },
  { id: '/docs/lease.pdf',   name: 'lease.pdf',  type: 'file', mime: 'application/pdf', bytes: 102400, state: 'synced' },
];

/** Sync-envelope shape the chat-shell renderer reads (mirrors browser.js). */
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
 * Build the Node `store` the relocated folio cores read.
 *
 * @param {object} args
 * @param {import('@onderling/core').AgentIdentity} args.identity  host identity (shareFolder signer)
 * @param {Array}  [args.seedFiles]     override the demo seeds ([] for a clean index)
 * @param {string} [args.podRoot]       token's `pod` field (shareFolder)
 * @param {{ podClient: object, containerUri: string }|null} [args.podSource]
 *        real pod source for `listFiles({source:'pod'})` (see podSource.js)
 * @param {object} [args.noteEmbedder]  optional /zoek embedder (absent ⇒ lexical)
 * @param {object} [args.noteVectorStore]
 * @param {(e:object)=>void} [args.noteAudit]
 * @returns {object} the store consumed by buildFolioSkills({ store })
 */
export function buildCompanionStore({
  identity,
  seedFiles,
  podRoot,
  podSource = null,
  noteEmbedder,
  noteVectorStore,
  noteAudit,
} = {}) {
  const files = Array.isArray(seedFiles)
    ? seedFiles.map((f) => ({ ...f }))
    : SEED_FILES.map((f) => ({ ...f }));

  // Mutable pod source (the browser attaches it post-sign-in; the host attaches
  // it at boot). Reached via an accessor so a future `setPodSource` still works.
  let _podSource = podSource;

  // /zoek stateful, embedder-swappable note index — mirrors browser.js.
  let noteSearch = null;
  let builtWithEmbedder;
  async function ensureNoteSearch() {
    if (!noteSearch || builtWithEmbedder !== noteEmbedder) {
      noteSearch = buildFolioNoteSearch({
        embedder: noteEmbedder, vectorStore: noteVectorStore, audit: noteAudit,
      });
      builtWithEmbedder = noteEmbedder;
    }
    await indexFolioNotes(noteSearch, files);
    return noteSearch;
  }

  return {
    files,
    identity,
    podRoot,
    mintShareToken,
    simulateSync,
    listPodFolio,
    getPodSource:  () => _podSource,
    setPodSource:  (src) => {
      _podSource = src?.podClient && src?.containerUri
        ? { podClient: src.podClient, containerUri: src.containerUri }
        : null;
      return _podSource;
    },
    ensureNoteSearch,
    searchFolioNotes,
  };
}
