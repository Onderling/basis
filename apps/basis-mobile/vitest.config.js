/**
 * Vitest config — runs the PORTABLE core tests only.  RN screens
 * + the Expo entry are NOT tested here (Vitest can't render RN
 * components; that's #224A Playwright/Expo-web's job).
 *
 * Excludes the RN files explicitly so a future stray `import 'react-
 * native'` from the core layer fails loud instead of being skipped.
 */
import { defineConfig } from 'vitest/config';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * `onderling-feedback` is an OPTIONAL sibling repo (`optionalDependencies`, a `link:` to a checkout
 * beside this one) — present on a machine that has both, absent on a clean clone and in CI. One suite
 * here imports it at module scope and so fails to LOAD without it, which is half of why this package was
 * never in CI. Excluded rather than skipped from inside, because a static import of a missing module
 * fails before any `describe.skip` could run — and announced rather than applied silently. The basis
 * config carries the same rule and the longer note.
 */
const FEEDBACK_SUITES = ['test/feedbackActivation.test.js'];
const hasFeedbackPackage = (() => {
  try { createRequire(import.meta.url).resolve('onderling-feedback/public'); return true; }
  catch { return false; }
})();
if (!hasFeedbackPackage) {
  console.warn('[basis-mobile/vitest] onderling-feedback is not installed — skipping '
    + `${FEEDBACK_SUITES.join(', ')}. Everything else runs.`);
}

export default defineConfig({
  resolve: {
    alias: {
      // RN-harness: the portable boot tests transitively reach async-storage
      // (pod-client dynamic-imports it); vite mis-resolves the real RN package in
      // node. Alias the specifier to an in-memory stub so the boot completes.
      '@react-native-async-storage/async-storage': path.resolve(__dirname, 'test/stubs/asyncStorage.js'),
      // `@onderling-app/basis` is a node_modules COPY here, a SEPARATE module tree from mobile's direct
      // `../../../basis/src/*` relative imports of the SAME shared code → two instances of every shared module
      // (breaks "same selector, no fork" identity + risks singleton divergence). Alias it to the real
      // workspace `apps/basis` so both import styles dedupe to ONE tree — and its `@onderling/*` deps resolve
      // from `apps/basis/node_modules` (complete) with vite transforming its src (JSON handled). (2026-08-07)
      // `expo-file-system` — same trap as async-storage above: the real entry is unparseable by vite in
      // node, so any module importing it fails to COLLECT even when the test injects its own fs.
      'expo-file-system': path.resolve(__dirname, 'test/stubs/expoFileSystem.js'),
      '@onderling-app/basis': path.resolve(__dirname, '../basis'),
    },
  },
  test: {
    include: ['test/**/*.test.js'],
    exclude: ['**/node_modules/**', 'src/rn/**', 'src/screens/**',
      ...(hasFeedbackPackage ? [] : FEEDBACK_SUITES)],
    environment: 'node',
  },
});
