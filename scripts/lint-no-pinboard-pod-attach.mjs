#!/usr/bin/env node
/**
 * lint-no-pinboard-pod-attach — basis never attaches pinboard's own store to a person's pod while what it writes is
 * not sealed.
 *
 * ── What happened, measured 2026-11-14 ───────────────────────────────────────────────────────────────────────────────
 * Both shells attached pinboard's item store to the signed-in person's pod (`attachPinboardPod` → pinboard's
 * `attachPod` → `attachPodToBundle`). The write-through never reached the pod: basis gives the pinboard bundle no pod
 * routing, so every key reached the pod client as a `mem://` key, the first flush was refused, and the store's cache went
 * offline (later writes only queued, in memory, for the rest of the session). Had the routing been there, the store
 * would have written its records UNSEALED: a post's full text, member rows, governance and audit records. A test that
 * read back through the cache was green the whole time and never looked at the pod.
 *
 * So the attach is gone from every shell, and this guard keeps it gone. It comes back only as a design: pinboard's
 * records on the pod sealed (to self for own items, under the circle key for a circle's), what a pod host may see stated
 * per field. Lifting this guard is part of that change, not an exemption next to it.
 */
import { execSync } from 'node:child_process';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
// every place a basis shell (web, phone, box) or the shared basis source composes the pinboard agent
const PATHS = ['apps/basis/src', 'apps/basis/web', 'apps/basis/bin', 'apps/basis-mobile/src', 'apps/basis-mobile/App.js'];
// the pinboard-specific attach seams (a generic `attachInner`, e.g. the settings store's, is not one of them)
const PATTERN = 'attachPinboardPod|attachPodToBundle|attachSubstrateMirror|\\.attachPod\\(';

let hits = '';
try {
  hits = execSync(`git grep -nE "${PATTERN}" -- ${PATHS.join(' ')}`, { cwd: ROOT, encoding: 'utf8' }).trim();
} catch (err) {
  if (err.status !== 1) throw err;   // 1 = no match
}
if (hits) {
  console.error('lint-no-pinboard-pod-attach: pinboard\'s store is attached to a pod in basis, and what it writes is not sealed:');
  console.error(hits);
  console.error('It comes back only with the sealed design (see this file\'s header); remove the attach.');
  process.exit(1);
}
console.log('lint-no-pinboard-pod-attach: ok (no shell attaches pinboard\'s store to a pod)');
