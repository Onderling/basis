/**
 * companion-node — the R1 pod source.
 *
 * Per PLAN-companion-node-remote-hosting.md §R1, R1 uses "the simplest real
 * path that proves the mesh": folio's existing dev pseudo-pod backend, NOT a
 * token-honouring bundled pod.  The `CapabilityAuth` / `PodCapabilityToken`
 * `pod-direct` delegation (Option A) is explicitly R1.5/R2's concern.
 *
 * We reuse folio's own `FsBackedMockPodClient` (the in-memory pod client its
 * Node tests use — `apps/folio/src/cli/_podFactory.js`), seed it with a file
 * that lives ONLY in the pod backend (never in the in-process seed index), and
 * hand back `{ podClient, containerUri }` — the exact shape `store.getPodSource`
 * returns and `listPodFolio` consumes.  So `listFiles({ source:'pod' })` walks
 * a genuine pod container end-to-end: device → relay → host → folio core →
 * podClient.list → back.  This is the REAL pod leg (distinct from the seed
 * index), proving the mesh — while staying honest that pod *auth* is deferred.
 *
 * DELEGATION STATUS (R1): none. The host holds a dev pod client directly. R2
 * lands the scoped/short-TTL/revocable `PodCapabilityToken`; R3 (BYO real-Solid
 * pods) lands `agent-proxy` (pod HTTP proxied back through the device's OIDC
 * session — no pod secret on the host).
 */
import { FsBackedMockPodClient } from '../../folio/src/cli/_podFactory.js';

const DEFAULT_POD_ROOT  = 'https://companion.pod.invalid/';
const DEFAULT_CONTAINER = 'folio/';

/**
 * Build a dev pod source seeded with one pod-only note.
 *
 * @param {object} [opts]
 * @param {string} [opts.podRoot]
 * @param {string} [opts.container]  container path under podRoot (trailing '/')
 * @param {Array<{ name: string, content: string, contentType?: string }>} [opts.files]
 *   files to seed into the pod backend (default: one markdown note).
 * @returns {Promise<{ podClient: object, containerUri: string }>}
 */
export async function buildDevPodSource({
  podRoot   = DEFAULT_POD_ROOT,
  container = DEFAULT_CONTAINER,
  files     = [{ name: 'pod-only-note.md', content: '# Pod-only note\n\nThis note lives only in the pod backend, not the in-process index.\n', contentType: 'text/markdown' }],
} = {}) {
  const root         = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
  const containerUri = `${root}${container.replace(/^\/+/, '')}`;
  const podClient    = new FsBackedMockPodClient(root);

  for (const f of files) {
    await podClient.write(`${containerUri}${f.name}`, f.content, {
      contentType: f.contentType ?? 'application/octet-stream',
    });
  }

  return { podClient, containerUri };
}
