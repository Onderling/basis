/**
 * basis — vitest config.  Per-test-file environment selection:
 * DOM-adapter + smoke tests use happy-dom; pure-logic suites stay in
 * the default node environment (faster).
 */
import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // The web-smoke boot transitively reaches the RN-only async-storage leaf
      // (pod-client dynamic-imports it); vite can't resolve the RN package in
      // node. Alias it to an in-memory stub so the smoke test loads.
      '@react-native-async-storage/async-storage': path.resolve(__dirname, 'test/stubs/asyncStorage.js'),
      // @onderling/core's barrel eagerly re-exports MqttTransport (an optional runtime transport) whose
      // `import('mqtt')` vite can't pre-resolve when mqtt isn't installed → any suite reaching the barrel
      // (web-smoke, circleFolio.dom, …) fails to LOAD. Stub it; no test uses a live MQTT connection.
      mqtt: path.resolve(__dirname, 'test/stubs/mqtt.js'),
    },
  },
  test: {
    // Per-file env via @vitest/environment directive at the top of each test file that needs DOM.
    environment: 'node',
    // ── The flakiness fix: a regression must be distinguishable from noise ────────────────────────────────────────
    // One test failed per full run, a DIFFERENT one each time, every one passing in isolation — so a
    // red run carried no information. The relay package went fully serial at 283 tests; this suite is
    // ~4,900, so the cure is scoped: the files that boot REAL agents/relays/sockets run in one SERIAL
    // project; everything else keeps full parallelism.
    //
    // NB the root deliberately declares NO `include`: with `extends: true` vitest CONCATENATES array
    // fields, so a root include would leak into both projects and every file would run twice — which is
    // exactly what happened on this config's first run (9,848 tests ≈ 2× the suite). Each project owns
    // its globs COMPLETELY. The Playwright exclusion (`test-browser/**`) therefore lives in both.
    projects: [
      {
        extends: true,
        test: {
          name: 'boot-serial',
          include: [
            'test/app*.test.js',
            'test/**/*.relay.*(repro.)test.js',
            'test/**/*RealReceive*.test.js',
            'test/**/*ThreeDevice*.test.js',
            'test/v2/circleAddressAnnounce.relay.test.js',
            'test/v2/circleChatReliableSend.integration.test.js',
            'test/reachabilityOracleAdoption.test.js',
          ],
          exclude: ['test-browser/**', 'node_modules/**'],
          fileParallelism: false,
          // Booting a real agent (vaults, identities, a transport) takes seconds, and these files run
          // while the parallel project loads the machine. vitest's 5s default then fails a test AT ITS
          // BOOT LINE — a red that carries no information and passes when run alone (four seen in the
          // week of 2026-08-22). Nothing loses the ability to fail: every walk bounds its own waits with
          // `until(..., {timeout})`, and each `it` still carries its own explicit budget where it needs one.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'parallel',
          include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
          // 62 files in THIS project boot a real agent or relay too (measured 2026-09-03), and under load
          // vitest's 5s default fails them at their boot line — a red that carries no information and passes
          // alone (one different file per full run; eleven false reds in one loaded run on 09-03). Same
          // reasoning as boot-serial below: nothing loses the ability to fail, because every wait is bounded
          // by its own `until(..., {timeout})` budget. What this buys is that a red run MEANS something.
          testTimeout: 30_000,
          hookTimeout: 30_000,
          exclude: [
            'test-browser/**', 'node_modules/**',
            'test/app*.test.js',
            'test/**/*.relay.*(repro.)test.js',
            'test/**/*RealReceive*.test.js',
            'test/**/*ThreeDevice*.test.js',
            'test/v2/circleAddressAnnounce.relay.test.js',
            'test/v2/circleChatReliableSend.integration.test.js',
            'test/reachabilityOracleAdoption.test.js',
          ],
        },
      },
    ],
  },
});
