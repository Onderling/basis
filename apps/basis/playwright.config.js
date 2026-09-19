/**
 * Playwright config for basis browser-driven tests.
 *
 * Boots `pnpm dev` on a known port, then drives two browser
 * contexts so we can headlessly verify the things that Vitest
 * can't reach: real DOM rendering, IndexedDB persistence under
 * a Chromium runtime, multi-tab cross-peer flows (sender Tab A,
 * receiver Tab B).
 *
 * Note: this config + the example test (test-browser/) are scaffold
 * only.  To USE them you must first install Playwright from the
 * repo root:
 *
 *   cd /home/frits/expotest/onderling-mono
 *   pnpm add -Dw @playwright/test playwright
 *   pnpm exec playwright install chromium
 *
 * Then run from this app:
 *
 *   pnpm --filter basis exec playwright test
 *
 * The browser-driven tests live in `test-browser/` (separate from
 * `test/` so Vitest doesn't pick them up — Playwright + Vitest have
 * incompatible runners).
 */
import { defineConfig, devices } from '@playwright/test';

/* The connectivity SETUP/MODE MATRIX (test-browser/setups.js + matrix.spec.js) adds a small set of
 * transport-dimension PROJECTS so a reviewer can run one setup:
 *   --project=no-relay  the single-context specs, against a server with NO relay configured.
 *   --project=relay     the multi-client specs, against a server WITH the relay. Bring up a local
 *                       @onderling/relay by ARMING the
 *                       fixture with PEER_TEST_RELAY (a ws:// URL); globalSetup starts it, the harness
 *                       seeds it per-client (localStorage cc.relayUrl + ?relay=), globalTeardown kills it:
 *                         PEER_TEST_RELAY=ws://127.0.0.1:8787 npx playwright test --project=relay
 * The per-client seed is the robust knob; VITE_CIRCLE_RELAY_URL below is the belt (only applied when
 * Playwright itself STARTS the dev server — a reused pre-existing :5173 keeps its own env). */
const RELAY_URL = process.env.PEER_TEST_RELAY || null;
/* Dedicated-port isolation: other jobs on this machine restart Vite on :5173, which kills shared runs.
 * Set PEER_TEST_PORT to boot the matrix on its own port (strictPort → fails loudly if taken):
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8788 npx playwright test --project=relay  */
const PORT = process.env.PEER_TEST_PORT || '5173';
const BASE_URL = `http://localhost:${PORT}`;
/* The NO-RELAY configuration gets its OWN dev server on the next port. It has to: `VITE_CIRCLE_RELAY_URL`
 * is baked into the bundle at boot, so one server cannot serve both "a relay is configured" and "no relay
 * is configured", and `circle-settings-controls.spec.js` asserts a real product rule about the second
 * (§7 route × capability: no relay ⇒ private DM and the relay transport options are disabled). Before
 * 2026-09-11 the suite had these two configurations and one server, so one `playwright test` run could
 * never be fully green — whichever way the env was set, the other half was wrong by construction. */
const NO_RELAY_PORT = String(Number(PORT) + 1);
const NO_RELAY_BASE_URL = `http://localhost:${NO_RELAY_PORT}`;

/* Which specs boot SEVERAL clients over the relay fixture (`peerHarness.js`, or their own contexts): they
 * run under `relay`. Everything else is a single-context spec through `helpers.js` and runs under
 * `no-relay`. Matched by file so a spec belongs to exactly one project and nothing has to declare it. */
const RELAY_SPECS = /(journeys|matrix|twopeer|two-relays|feedback-path-box|walk-[a-z0-9-]+)\.spec\.js$/;

export default defineConfig({
  testDir: './test-browser',
  /* Run tests in parallel where safe; the dev server is shared. */
  fullyParallel: false,
  /* Fail the build on accidental `test.only` left in source */
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  /* Single worker keeps two-tab orchestration deterministic. */
  workers: 1,
  /* Bound an `expect(...)` poll too. Same reasoning as `actionTimeout`: the default 5s is fine, but
   * several specs pass an explicit longer one, and without a floor here a bare `toBeVisible()` on a
   * never-appearing element is another silent budget-eater. */
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'list' : 'html',
  /* Relay fixture: only spawns a relay when PEER_TEST_RELAY is set (default/nkn runs are untouched,
   * and nothing leaks). Teardown stops whatever globalSetup started. */
  globalSetup: './test-browser/relayFixture.js',
  globalTeardown: './test-browser/relayTeardown.js',
  use: {
    baseURL: BASE_URL,
    /* Bound a SINGLE action, so a missing element fails in seconds NAMING ITSELF, instead of eating the
     * whole test budget and reporting only "timeout exceeded".
     *
     * Playwright's default here is 0 — unbounded — and this config never set it, so every hang consumed
     * the test's entire allowance: 30s in a default spec, 70s in the circle specs, and a full SEVEN
     * MINUTES in the journeys/matrix/twopeer trio that set `setTimeout(420_000)`. Three of those in one
     * run is 21 minutes spent learning nothing, which is most of why this suite was too slow to run and
     * too vague to act on when it did fail.
     *
     * 20s is deliberately generous — this app boots a real agent and a transport before it can render —
     * but it is finite, and finite is the whole point. */
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    /* Headless by default — flip to false locally with
     * `pnpm exec playwright test --headed` to watch the flows. */
    headless: true,
  },
  projects: [
    /* Two projects, two configurations, two dev servers (2026-09-11). Until now there were three projects
     * — `chromium`, `nkn`, `relay` — all identical Desktop Chrome, with nothing anywhere reading the
     * project name: `--project=relay` was a no-op, and the real switch was the PEER_TEST_RELAY env var
     * read by the harness and the server alike. That is what the project mechanism is FOR, so it now does
     * the job: each project points at the server built for its configuration, and `testMatch` decides
     * membership by file. One command runs both; every spec runs under exactly one. */
    {
      name: 'relay',
      testMatch: RELAY_SPECS,
      use: { ...devices['Desktop Chrome'], baseURL: BASE_URL },
    },
    {
      name: 'no-relay',
      testIgnore: RELAY_SPECS,
      use: { ...devices['Desktop Chrome'], baseURL: NO_RELAY_BASE_URL },
    },
  ],
  /* Boot the dev server automatically.  The reuseExistingServer flag
   * lets a manually-started `pnpm dev` survive across test runs. */
  webServer: [{
    // `pnpm dev -- --port X` does NOT reach vite as a port: the `--` is passed straight through, vite
    // treats everything after it as positional, and serves on its own default instead. Playwright then
    // waits on the port it asked for until the 240s timeout and reports "Timed out waiting from
    // config.webServer" — so PEER_TEST_PORT has never actually worked, and every green matrix run to
    // date quietly reused a warm :5173 (which the note above half-admits). `pnpm exec vite` takes its
    // flags directly.
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    /* Cold-boot of this large app on a fresh dedicated port (PEER_TEST_PORT) needs well over 60s —
     * the old default only worked because it reused another job's warm :5173 server. */
    timeout: 240_000,
    /* Circle-bot smokes (circle-view-bot.spec.js) need a circle LLM provider to EXIST so the bot
     * "engages" — the deterministic gate path (`@assistant add/done X`) never CALLS it, so a dummy
     * loopback URL is enough. Without this the server boots with no provider, the bot stays inert,
     * `@assistant …` just fans out, and the gate smokes fail. Injected here so the harness is
     * self-contained (no manually-prepped `VITE_CIRCLE_LLM_BASEURL=… pnpm dev` required).
     * NB: only applied when Playwright STARTS the server; a reused pre-existing server keeps its env. */
    env: {
      VITE_CIRCLE_LLM_BASEURL: 'http://127.0.0.1:9999',
      /* Belt to the per-client seed: when the relay setup is armed, boot the dev server with the relay
       * as its build-time default too (ignored by a reused server — the per-client cc.relayUrl wins). */
      ...(RELAY_URL ? { VITE_CIRCLE_RELAY_URL: RELAY_URL } : {}),
    },
  }, {
    /* The no-relay server: same app, same LLM stub, NO relay baked in. This is the configuration the
     * single-context specs were written against and the one `circle-settings-controls` asserts. */
    command: `pnpm exec vite --port ${NO_RELAY_PORT} --strictPort`,
    url: NO_RELAY_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: { VITE_CIRCLE_LLM_BASEURL: 'http://127.0.0.1:9999' },
  }],
});
