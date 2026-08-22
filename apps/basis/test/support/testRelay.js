/**
 * testRelay — the relay a `*.relay.test.js` journey runs over, chosen by ENV.
 *
 * By default it starts an IN-PROCESS relay on an ephemeral port, exactly as every relay journey
 * did before: fast, isolated, no ports to collide, torn down with the suite.
 *
 * Set `ONDERLING_RELAY_URL` and the same journeys run against an EXTERNAL relay instead — the
 * containerised image, or the deployed one:
 *
 *   ONDERLING_RELAY_URL=ws://127.0.0.1:8787            npx vitest run test/**\/*.relay.test.js
 *   ONDERLING_RELAY_URL=wss://relay.example.com        npx vitest run test/**\/*.relay.test.js
 *
 * WHY this exists: `deploy/smoke` proves a deployment speaks the wire protocol (register, deliver,
 * hold, fan out). It cannot prove that PEOPLE's journeys work over it — circles, membership folds,
 * sealed content, the enroll ceremony. Those walks already exist here; they were simply nailed to
 * an in-process relay. One indirection turns the whole set into the acceptance suite for a real
 * deployment, which is the honest way to answer "is the new relay actually good?" — the same
 * corridor a person walks, over the socket they will really use.
 *
 * Contract: the returned `close()` is a no-op for an external relay (a test must never shut down a
 * server it did not start), so `afterAll` blocks stay identical either way.
 */
import { startRelay } from '@onderling/relay';

/**
 * @param {object} [opts]  passed through to `startRelay` when starting an in-process one
 * @returns {Promise<{url: string, external: boolean, close: () => Promise<void>}>}
 */
export async function startJourneyRelay(opts = {}) {
  const external = (process.env.ONDERLING_RELAY_URL ?? '').trim();
  if (external) {
    return { url: external, external: true, close: async () => { /* not ours to stop */ } };
  }
  const relay = await startRelay({ port: 0, log: false, ...opts });
  return {
    url: `ws://127.0.0.1:${relay.port}`,
    external: false,
    close: async () => { try { await relay?.close?.(); } catch { /* teardown is best-effort */ } },
  };
}

export default startJourneyRelay;
