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
    // Per-file env via @vitest/environment directive at the top of
    // each test file that needs DOM (see test/domAdapter.test.js).
    environment: 'node',
    // Vitest's default include picks up `**/*.spec.{js,...}` which
    // collides with Playwright (test-browser/*.spec.js).  Restrict
    // to the canonical `test/**` location so Playwright owns
    // `test-browser/**` cleanly.
    include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['test-browser/**', 'node_modules/**'],
    // ── B9: a regression must be distinguishable from noise ────────────────────────────────────────
    // One test failed per full run, a DIFFERENT one each time, every one passing in isolation — so a
    // red run carried no information, which is worse for the guards' credibility than being slow.
    // The relay package hit the same wall at 283 tests and went fully serial; this suite is ~4,900,
    // so the blunt fix costs real wall-clock. Instead: the files that boot REAL agents, relays or
    // sockets — the load-sensitive minority — run in one sequential group; the other ~450 files keep
    // full parallelism. Same cure as the relay's, scoped to where the disease is.
    sequence: { groupOrder: 0 },
    poolOptions: { forks: { singleFork: false } },
    projects: [
      {
        extends: true,
        test: {
          name: 'boot-serial',
          include: [
            'test/app*.test.js',
            'test/**/*.relay.*.?(c|m)js',
            'test/**/*RealReceive*.test.js',
            'test/**/*ThreeDevice*.test.js',
            'test/v2/circleAddressAnnounce.relay.test.js',
            'test/v2/kringChatReliableSend.integration.test.js',
            'test/reachabilityOracleAdoption.test.js',
          ],
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'parallel',
          include: ['test/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
          exclude: [
            'test-browser/**', 'node_modules/**',
            'test/app*.test.js',
            'test/**/*.relay.*.?(c|m)js',
            'test/**/*RealReceive*.test.js',
            'test/**/*ThreeDevice*.test.js',
            'test/v2/circleAddressAnnounce.relay.test.js',
            'test/v2/kringChatReliableSend.integration.test.js',
            'test/reachabilityOracleAdoption.test.js',
          ],
        },
      },
    ],
  },
});
