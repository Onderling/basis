#!/usr/bin/env node
/**
 * integration-index.mjs — THE index of the monorepo's real-infrastructure INTEGRATION tests.
 *
 * These are the `*.css.test.js` suites: each needs a live external service — a Community Solid Server, i.e.
 * a REAL pod — and SELF-SKIPS when it is absent (gated on `CSS_URL` + client-credentials). So they never run
 * in the ordinary hermetic suites or in `npm run guards`, which is precisely why they need an index: a gated
 * test that nothing triggers is a test that silently rots (the exact failure mode this repo keeps hitting).
 *
 * This file is the single place that lists them. The runner (`run-integration.mjs` / `npm run
 * test:integration`) triggers them FROM HERE; the guard (`lint-integration-index.mjs`, auto-run by
 * `npm run guards`) FAILS if this list and the on-disk `*.css.test.js` set ever drift.
 *
 * Adding a `*.css.test.js`? Add a row here (the guard reminds you). You write only `file` + `proves`; the
 * workspace to run it in (`pkg`) is DERIVED from the path.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The canonical list. `file` is repo-relative; `proves` is one honest line of what the live pod confirms. */
export const INTEGRATION_TESTS = [
  { file: 'packages/pod-client/test/PodClient.css.test.js',            proves: 'PodClient read/write/list against a real CSS pod over Solid-OIDC auth.' },
  { file: 'packages/pod-client/test/SolidPodSource.css.test.js',       proves: 'SolidPodSource (a core.DataSource) read/write/list on a real pod.' },
  { file: 'packages/pod-client/test/sealedPodDataSource.css.test.js',  proves: 'The sealed DataSource: write seals (pod holds ciphertext), read opens plaintext; list + delete. The exact shape the circle cache medium rides.' },
  { file: 'packages/pod-client/test/sharing/sharing.css.test.js',      proves: 'ACP sharing round-trip on a real pod — a grant makes a resource readable to the grantee, and no more.' },
  { file: 'packages/pod-client/test/sharing/acpWriter.css.test.js',    proves: 'Writing ACP access-control resources against a real pod.' },
  { file: 'packages/pod-client/test/sharing/setResourceAccess.css.test.js', proves: 'Setting per-resource access (grant/revoke) on a real pod.' },
  { file: 'packages/oidc-session/test/SolidVault.css.test.js',         proves: 'SolidVault Solid-OIDC (DPoP) client-credentials login + authenticated fetch against a real IdP.' },
  { file: 'packages/pod-onboarding/test/resourceUri.css.test.js',      proves: 'The canonical pod storage-layout URIs resolve against a real pod.' },
  { file: 'apps/basis/test/circlePodProducer.css.test.js',            proves: 'Per-circle producer on a real pod: sealed round-trip + roster growth + survives-restart re-hydration (p2/p3).' },
  { file: 'apps/basis/test/circleSealing.css.test.js',                proves: 'Circle group key persists on the pod + sealed content round-trips; leave rotates the key (forward secrecy).' },
  { file: 'apps/basis/test/circlePod2Pod.css.test.js',                proves: 'Cross-pod sealed circle delivery between two separate CSS accounts/pods.' },
  { file: 'apps/basis-mobile/test/circleSealE2E.css.test.js',         proves: 'Mobile circle seal end-to-end against a real pod (the RN-side parity of the basis producer path).' },
  { file: 'apps/companion-node/test/companionAgentProxy.css.test.js', proves: 'The companion proxies a device\'s pod fetches to a real pod (holds no secret); out-of-scope is denied; revoke kills the grant.' },
  { file: 'apps/stoop/test/realPodAttach.css.test.js',                proves: 'Attaching a real Solid pod to stoop and reading/writing through the attachment.' },
];

/** The workspace a test runs in — the `apps/<x>` or `packages/<x>` prefix of its path. */
export function pkgOf(file) {
  return file.split('/').slice(0, 2).join('/');
}

/** Every `*.css.test.js` on disk (repo-relative, sorted) — the truth the index must match. */
export function discoverCssTests(root = ROOT) {
  const out = [];
  const skip = new Set(['node_modules', '.git', '_archive']);
  (function walk(dir) {
    let names;
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      if (skip.has(name)) continue;
      const full = path.join(dir, name);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (name.endsWith('.css.test.js')) out.push(path.relative(root, full));
    }
  })(root);
  return out.sort();
}
