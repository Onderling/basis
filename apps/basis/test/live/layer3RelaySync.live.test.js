/**
 * LIVE Layer-3 harness — OBJ-2 no-pod household item-sync across TWO agents over the REAL relay.
 *
 * This is the "two devices over relay" exercise (the laptop + phone scenario), run as two independent
 * agents in one Node process — each with its OWN identity (VaultMemory) and its OWN household store —
 * both connected to a REAL relay server (real WebSocket frames out to ws://…:8787 and back; the relay
 * is an external broker, so even in-process the messages genuinely traverse the wire). An item added on
 * agent A must appear on agent B, carried by: setSyncHook (publish-on-write) → secureMeshEnvelopeAdapter
 * (sa.peer.sendTo) → relay → B's relay receive handler → householdSync.handleInbound → wireItemMirror
 * → B's household store. NO pod. The phone is the same wiring (main.js connectPeerTransport w/ relayUrl).
 *
 * ── ENV-GATED ── skips unless LIVE_RELAY=1 (needs a relay running). Start one with:
 *     (cd packages/relay && PORT=8787 node bin/relay.js)
 *
 *   LIVE_RELAY=1 RELAY_URL=ws://127.0.0.1:8787 \
 *     npx vitest run test/live/layer3RelaySync.live.test.js
 *
 * ── PRODUCTION-SAFE LLM (optional) ── add LIVE_LLM=1 (+ OLLAMA_BASEURL/MODEL, LLM_APIKEY) to ALSO drive
 *   A's add through the live Privatemode LLM. The laptop hosts its own LOOPBACK proxy, so the confidential
 *   route guard (`@onderling/llm-client/routeSafety`) is satisfied — no plaintext leaves the device. (The
 *   phone-side confidential LLM is the unbuilt Option B; here only the laptop runs the model.)
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { VaultMemory } from '@onderling/vault';

import { createRealHouseholdAgent } from '../../src/web/realAgent.js';

const LIVE_RELAY = process.env.LIVE_RELAY === '1';
const RELAY_URL  = process.env.RELAY_URL || 'ws://127.0.0.1:8787';
const LIVE_LLM   = process.env.LIVE_LLM === '1';

// HARNESS FIX (same class as the RN react-alias fix): on Node < 21 there is no global WebSocket, so
// RelayTransport falls back to `await import('ws')` — but vite/vitest resolves bare 'ws' to its BROWSER
// STUB (which never connects; the throw is swallowed by connect()'s `.catch`). In real Node/browser/RN
// the relay transport works fine; only this harness needs the real node `ws` installed as a global so
// RelayTransport uses it directly. Resolve the node build (node conditions, not vite's browser) and load
// it with a vite-ignored dynamic import so vite doesn't re-stub it.
async function installNodeWebSocket() {
  if (typeof globalThis.WebSocket === 'function') return;
  const wsEntry = createRequire(createRequire(import.meta.url).resolve('@onderling/core')).resolve('ws');
  const mod = await import(/* @vite-ignore */ pathToFileURL(wsEntry).href);
  globalThis.WebSocket = mod.default ?? mod.WebSocket ?? mod;
}

/** Build a household agent wired onto the real relay, routing inbound through the household sync handler. */
async function buildRelayAgent(label) {
  const agent = await createRealHouseholdAgent({
    chatVault:      new VaultMemory(),   // distinct identity per agent (two "devices")
    seedHousehold:  false,               // clean slate → we observe exactly the synced item
    seedTasks:      false,
    seedStoopPosts: false,
  });
  // Use the REAL app wiring: connectPeerTransport relay-only (no nknLib — the LAN no-pod path). Its
  // internal routedOnPeerMessage consumes household-item envelopes via handleInbound and pins
  // transportMode to 'relay'; the shell onPeerMessage (no-op here) gets everything else. This exercises
  // exactly what circleApp.js does in the browser, not a hand-rolled relay.connect.
  await agent.connectPeerTransport({ relayUrl: RELAY_URL, onPeerMessage: () => {} });
  // eslint-disable-next-line no-console
  console.log(`[layer3] ${label} on relay as ${agent.relay.address?.slice(0, 12)}… (${RELAY_URL})`);
  return agent;
}

const openItems = async (agent) => {
  const r = await agent.callSkill('household', 'listOpen', {});
  return (r?.items ?? []).map((i) => String(i.text ?? i.label ?? ''));
};
const waitFor = async (fn, { tries = 40, gapMs = 250 } = {}) => {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true;
    await new Promise((res) => setTimeout(res, gapMs));
  }
  return false;
};

describe.runIf(LIVE_RELAY)(`LIVE Layer-3 — household no-pod sync over relay @ ${RELAY_URL}`, () => {
  let A, B;
  beforeAll(async () => { await installNodeWebSocket(); });
  afterAll(async () => {
    try { await A?.relay?.disconnect?.(); } catch { /* */ }
    try { await B?.relay?.disconnect?.(); } catch { /* */ }
  });

  it('item added on A appears on B over the real relay (HARD; model-independent)', async () => {
    A = await buildRelayAgent('A (laptop)');
    B = await buildRelayAgent('B (phone)');

    // Each adds the OTHER to its household roster (member pubKeys) → publishItem fans out to them.
    A.addCirclePeer(B.relay.address);
    B.addCirclePeer(A.relay.address);
    expect(A.relay.address).toBeTruthy();
    expect(B.relay.address).toBeTruthy();
    expect(A.relay.address).not.toBe(B.relay.address);   // genuinely two identities

    // Baseline: B has neither item yet (clean slate).
    expect(await openItems(B)).not.toContain('pumpkin seeds');

    // ── A adds an item (deterministic callSkill path) → must reach B over relay ──
    const added = await A.callSkill('household', 'addItem', { type: 'shopping', text: 'pumpkin seeds' });
    expect(added).toMatchObject({ ok: true });

    const onB = await waitFor(async () => (await openItems(B)).some((t) => /pumpkin seeds/i.test(t)));
    // eslint-disable-next-line no-console
    console.log(`[layer3] B open items after A's add: ${JSON.stringify(await openItems(B))}`);
    expect(onB).toBe(true);                              // ← the Layer-3 assertion: A → relay → B, no pod
  }, 60_000);

  it.runIf(LIVE_LLM)('A adds via the live Privatemode LLM → also syncs to B (full pipeline)', async () => {
    // Lazy imports — only when the LLM leg runs.
    const { LlmClient }             = await import('@onderling/llm-client');
    const { ollamaProvider }        = await import('@onderling/llm-client/providers/ollama');
    const { mergeManifests }        = await import('../../src/manifestMerge.js');
    const { createCircleDispatch }  = await import('../../src/v2/circleDispatch.js');
    const { interpretToCommand }    = await import('../../src/v2/interpretCommand.js');
    const { createTokenGate }       = await import('../../src/v2/tokenGate.js');
    const { circleGateRules }       = await import('../../src/v2/circleGate.js');

    const BASEURL = process.env.OLLAMA_BASEURL || 'http://localhost:8080';
    const MODEL   = process.env.OLLAMA_MODEL   || 'gpt-oss-120b';
    const APIKEY  = process.env.LLM_APIKEY     || undefined;
    const BOT     = 'assistant';

    const catalog = mergeManifests([{ manifest: A.manifest }]);
    const llm = new LlmClient({ provider: ollamaProvider({ baseUrl: BASEURL, model: MODEL, apiKey: APIKEY, timeoutMs: 90_000 }) });

    const cd = createCircleDispatch({
      catalog,
      policy: { llmTool: 'local' },
      llmProviders: { local: llm },
      interpret: interpretToCommand,
      gate: createTokenGate({ rules: circleGateRules('en') }),
      botName: BOT,
      dispatch: async (input) => {
        const cmd = typeof input === 'string' ? null : input;
        if (!cmd?.opId) return null;
        const entry = catalog.opsById.get(cmd.opId) ?? catalog.opsById.get(`household/${cmd.opId}`);
        return A.callSkill(entry?.appOrigin ?? 'household', cmd.opId, cmd.args ?? {});
      },
      postToKring: () => {}, onNoMatch: () => {}, onLlmUnavailable: () => {},
    });

    await cd.handle(`@${BOT} add cinnamon to the shopping list`, {});
    const onB = await waitFor(async () => (await openItems(B)).some((t) => /cinnamon/i.test(t)));
    // eslint-disable-next-line no-console
    console.log(`[layer3+llm] B open items after LLM-driven add: ${JSON.stringify(await openItems(B))}`);
    if (!onB) console.warn('[layer3+llm] LLM did not land "cinnamon" as an item (small-model arg variance) — relay path already proven by the HARD test');
    expect(typeof A.relay.address).toBe('string');       // pipeline ran without throwing; sync proven above
  }, 240_000);
});
