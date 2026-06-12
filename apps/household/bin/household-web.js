#!/usr/bin/env node
/**
 * household-web — Slice A.3 + A.4 bootstrap (PLAN-gui-chat-uplift.md).
 *
 * Boots a localhost-only household web UI driven by the manifest's
 * NavModel (rendered via `@canopy/app-manifest`'s `renderWeb`).  The
 * server is the same `@canopy/agent-ui`'s `mountLocalUi` substrate that
 * tasks-v0 uses; the client (apps/household/web/main.js) consumes
 * `/navmodel.json` and `/household-config.json` to render tabs +
 * affordances + per-item buttons.
 *
 * Slice A.3 scope (manifest-driven UI):
 *   - list/add/markComplete/remove for the 4 list-type sections (+
 *     tasks/members surfaced for completeness).
 *
 * Slice A.4 scope (LLM passthrough — NEW):
 *   - When started with `{ llm }`, the bootstrap also wires a real
 *     HouseholdAgent over the SAME store.  A `chat` skill is registered
 *     that hands free text to `agent.onMessage` — the HouseholdAgent's
 *     existing regex-then-LLM router does the rest (slash fast-path
 *     hits skills directly; free text routes to the embedded
 *     `@canopy/chat-agent` ChatAgent built from the manifest).
 *   - No new LLM stack: this re-exposes the path HouseholdAgent already
 *     constructs when an LLM is configured (see HouseholdAgent.js
 *     lines 111–144).
 *   - Without `{ llm }`, the `chat` skill replies with the regex
 *     help-hint — the V0 behaviour pre-A.4.
 *
 * Usage:
 *   node bin/household-web.js [--port 8080] [--actor https://id.example/anne]
 *
 * Returns (when used as a module via `startHouseholdWeb()`):
 *   { url, port, stop, agent, store, householdAgent }
 *
 * The CLI entry-point uses `startHouseholdWeb` with defaults and logs
 * the URL; the smoke test (`test/web.test.js`) imports `startHouseholdWeb`
 * directly so it can await + stop without shell-driven lifecycle.
 */
import { parseArgs }                              from 'node:util';
import { readFile }                               from 'node:fs/promises';
import { fileURLToPath }                          from 'node:url';
import { dirname, join }                          from 'node:path';
import {
  Agent,
  AgentIdentity,
  VaultMemory,
  InternalBus,
  InternalTransport,
  Parts,
}                                                 from '@canopy/core';
import { mountLocalUi, LocalUiAuth }              from '@canopy/agent-ui';
import { renderWeb }                              from '@canopy/app-manifest';

import { householdManifest }                       from '../manifest.js';
import { HouseholdAgent }                          from '../src/HouseholdAgent.js';
import { MockBridge }                              from '../src/bridges/MockBridge.js';
import { InMemoryStore }                           from '../src/storage/InMemoryStore.js';
import { LlmClient }                               from '../src/llm/LlmClient.js';
import { ollamaProvider }                          from '../src/llm/providers/ollama.js';
import { openaiProvider }                          from '../src/llm/providers/openai.js';
import { anthropicProvider }                       from '../src/llm/providers/anthropic.js';
import {
  addItem,
  listOpen,
  markComplete,
  removeItem,
  addTask,
  listTasks,
  claim,
  registerName,
} from '../src/skills/index.js';

const DEFAULT_ACTOR = 'https://id.example/anne';

/**
 * Build a `(args, skillCtx) → {replies, stateUpdates}` shape from `ctx`
 * (the core.Agent skill ctx).  Mirrors `mountable.js`'s shape, but
 * called inline since we own the dispatch here.
 *
 * @param {object} ctx                 core.Agent skill ctx
 * @param {InMemoryStore} store
 * @param {object} agent
 */
function buildSkillCtx(ctx, store, agent) {
  return {
    store,
    chatId:      'web-ui',
    senderWebid: ctx.from ?? ctx.originFrom ?? DEFAULT_ACTOR,
    bridgeId:    'local-ui',
    agent,
  };
}

/**
 * Adapt a renderChat-shape skill `(args, skillCtx) → {replies, stateUpdates}`
 * into a core.Agent handler `(ctx) → parts`.  The web client reads the
 * skill's text reply via `replies[0].text` (or the structured `items`
 * we add post-hoc for the data-returning skills).
 *
 * @param {function} skill   household-shape skill handler
 * @param {InMemoryStore} store
 * @param {function} getAgent  closure returning the live agent (avoids
 *                             a circular ref before Agent is constructed)
 * @param {function} [postProcess]  optional `(reply, args, skillCtx) → data`
 *                                  to add structured data to the response
 */
function adaptHouseholdSkill(skill, store, getAgent, postProcess) {
  return async (ctx) => {
    const args = ctx.parts?.[0]?.data ?? {};
    const skillCtx = buildSkillCtx(ctx, store, getAgent());
    const reply = await skill(args, skillCtx);
    const data = {
      replies:      reply?.replies ?? [],
      stateUpdates: reply?.stateUpdates ?? [],
    };
    if (typeof postProcess === 'function') {
      Object.assign(data, await postProcess(reply, args, skillCtx) ?? {});
    }
    return Parts.wrap(data);
  };
}

/**
 * Start the household-web server.  Returns a handle the caller can use
 * to stop it cleanly (the smoke test does this).
 *
 * @param {object} [opts]
 * @param {number} [opts.port=0]      0 → OS picks a free port
 * @param {string} [opts.actor]       webid the LocalUiAuth claims
 * @param {InMemoryStore} [opts.store]  pre-built store (else fresh)
 * @param {object} [opts.llm]
 *   Optional LlmClient — when provided, free-text chat messages route
 *   through the HouseholdAgent's manifest-built ChatAgent (Slice A.4).
 *   When omitted, the `chat` skill replies with the regex help-hint.
 */
export async function startHouseholdWeb(opts = {}) {
  const port  = opts.port ?? 0;
  const actor = opts.actor ?? DEFAULT_ACTOR;
  const store = opts.store ?? new InMemoryStore();
  const llm   = opts.llm ?? null;

  const id        = await AgentIdentity.generate(new VaultMemory());
  const bus       = new InternalBus();
  const transport = new InternalTransport(bus, id.pubKey);
  const agent     = new Agent({ identity: id, transport, label: 'household-web' });

  // ── Slice A.4: real HouseholdAgent on the SAME store ─────────────
  // HouseholdAgent.constructor wires the regex fast path + (when an
  // LLM is configured) the `@canopy/chat-agent` ChatAgent built from
  // the manifest's renderChat projection (toolCatalog/toolHandlers/
  // systemPrompt).  We use a MockBridge as a placeholder — the chat
  // skill below calls `householdAgent.onMessage(msg)` directly and
  // reads the returned Reply, so no outbound bridge dispatch is
  // needed for the web surface.
  const webBridge      = new MockBridge();
  const householdAgent = new HouseholdAgent({ store, bridges: [webBridge], llm });
  await householdAgent.start();

  // Closure-captured ref so adaptHouseholdSkill can pass the live agent
  // into the skill ctx (skills inspect ctx.agent for the LLM hook,
  // which is the HouseholdAgent when an LLM is configured).
  const getAgent = () => householdAgent;

  // Web-shaped skill registrations.  Each maps the manifest op id 1:1
  // to a core.Agent skill that adapts the household skill's reply
  // shape into a DataPart the web client can read.  Where the
  // household skill returns text-only (e.g. listOpen), we add the
  // structured `items` array post-hoc by re-reading the store.
  //
  // The handlers preserve the manifest's contract: same op ids, same
  // arg names, same param shapes.  This is what makes the NavModel
  // drive the UI — every button on the page traces to an op the
  // server knows how to dispatch.

  agent.register('listOpen', adaptHouseholdSkill(
    listOpen, store, getAgent,
    async (_reply, args) => ({
      items: await store.listOpen({ type: args?.type }),
    }),
  ));

  agent.register('listTasks', adaptHouseholdSkill(
    listTasks, store, getAgent,
    async () => ({
      items: await store.listOpen({ type: 'task' }),
    }),
  ));

  agent.register('addItem', adaptHouseholdSkill(
    addItem, store, getAgent,
    // After addItem, surface the freshly-added item (last one in the
    // type's listOpen) so the client can render it without a refetch.
    async (_reply, args) => {
      const open = await store.listOpen({ type: args?.type });
      return { items: open, added: open[open.length - 1] ?? null };
    },
  ));

  agent.register('addTask', adaptHouseholdSkill(
    addTask, store, getAgent,
    async () => {
      const items = await store.listOpen({ type: 'task' });
      return { items, added: items[items.length - 1] ?? null };
    },
  ));

  agent.register('markComplete', adaptHouseholdSkill(markComplete, store, getAgent));
  agent.register('removeItem',   adaptHouseholdSkill(removeItem,   store, getAgent));
  agent.register('claim',        adaptHouseholdSkill(claim,        store, getAgent));
  agent.register('registerName', adaptHouseholdSkill(registerName, store, getAgent));

  // ── Slice A.4: `chat` skill — free-text passthrough ──────────────
  // The web client POSTs to `/tasks/send` with skillId='chat' and
  // `{ text }` in the DataPart.  We synthesise an IncomingMessage and
  // hand it to `householdAgent.onMessage` — which routes through the
  // manifest's slash grammar (regex fast path) first and falls
  // through to the ChatAgent's LLM pipeline when no command matches.
  //
  // Reply shape: `{ replies: [{text, buttons?}, ...], stateUpdates }`
  // mirroring the bridge-facing contract.  The browser reads
  // `replies[0].text` (or concatenates all) for display.
  let chatMessageCounter = 0;
  agent.register('chat', async (ctx) => {
    const args  = ctx.parts?.[0]?.data ?? {};
    const text  = typeof args.text === 'string' ? args.text : '';
    const sender = {
      displayName: args.displayName ?? 'web-user',
      bridgeUid:   args.bridgeUid   ?? 'web-ui',
      webid:       ctx.from ?? ctx.originFrom ?? DEFAULT_ACTOR,
    };
    const msg = {
      bridgeId:    webBridge.bridgeId,
      chatId:      args.chatId ?? 'web-ui',
      messageId:   `web-${++chatMessageCounter}`,
      sender,
      text,
      replyTo:     null,
      isAddressed: true,
    };
    let reply;
    try {
      reply = await householdAgent.onMessage(msg);
    } catch (err) {
      return Parts.wrap({
        replies:      [{ text: `chat failed: ${err?.message ?? String(err)}` }],
        stateUpdates: [],
      });
    }
    return Parts.wrap({
      replies:      reply?.replies ?? [],
      stateUpdates: reply?.stateUpdates ?? [],
    });
  });

  // (no need to register `listOpen` for type=contact specifically — the
  // members section's adapter calls listOpen({type: 'contact'}) and
  // the household skill's KNOWN_TYPES guard rejects it.  V0 surfaces
  // the members tab as empty until a follow-on adds a contact-list
  // path.  Owner ack'd this in `test/navmodel.test.js`.)

  // Pre-compute the NavModel from the manifest.  Static for the life
  // of the server (manifest is module-scope const).
  const navModel = renderWeb(householdManifest);

  const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

  // Slice B.2.0 (2026-05-20) — overlay the shared @canopy/web-adapter
  // helpers at `/lib/web-adapter/<file>.js` so apps/household/web/main.js
  // can ESM-import them from the browser. Same mechanism tasks-ui.js
  // uses for `/lib/dagFlatten.js`. Source-of-truth stays under
  // `packages/web-adapter/src/`; this overlay is the runtime hook.
  const webAdapterFiles = await loadWebAdapterFiles();

  const ui = await mountLocalUi(agent, {
    port,
    staticDir:        webDir,
    a2aTLSLayer:      new LocalUiAuth({ localActor: actor }),
    extraStaticFiles: {
      '/navmodel.json':         JSON.stringify(navModel),
      '/household-config.json': JSON.stringify({ actor, app: navModel.app }),
      ...webAdapterFiles,
    },
  });

  return {
    url:   ui.url,
    port:  ui.port,
    agent,
    householdAgent,
    store,
    navModel,
    async stop() {
      try { await householdAgent.stop(); } catch { /* swallow */ }
      await ui.stop();
    },
  };
}

/**
 * Read @canopy/web-adapter's per-helper source files into an
 * extraStaticFiles map keyed by `/lib/web-adapter/<basename>`. Pure
 * passthrough — no rewriting; the package's source IS the runtime
 * artefact (ESM, no bundling). One overlay per file so the browser
 * can `import { callSkill } from '/lib/web-adapter/callSkill.js'`
 * just like it imports `/lib/dagFlatten.js` today.
 *
 * Resolved relative to `node_modules/@canopy/web-adapter/src/` via
 * the workspace symlink. If the package ever ships a `dist/` build
 * step, switch this to point at that.
 */
async function loadWebAdapterFiles() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..', '..', 'packages', 'web-adapter', 'src');
  const names = [
    'callSkill.js',
    'deriveItemState.js',
    'itemMatchesAppliesTo.js',
    'applyPrefilledParams.js',
    // V0.2 (2026-05-21) — new helpers consumed by web/main.js:
    //   fetchSectionItems   honours view.dataSource (Q7) with Q6 fallback
    //   schemaToFormFields  drives multi-field add-form rendering from
    //                       the affordance's paramsSchema
    'fetchSectionItems.js',
    'schemaToFormFields.js',
    'index.js',
  ];
  const out = {};
  for (const n of names) {
    out[`/lib/web-adapter/${n}`] = await readFile(join(root, n), 'utf8');
  }
  return out;
}

// ── CLI entry ─────────────────────────────────────────────────────────
// Build an LlmClient from the HOUSEHOLD_LLM_* env (the SAME contract as the CLI/smoke scripts —
// cli-freetext.js, tg-smoke.js), so `npm run web` can drive free-text chat through a real model.
// For a local Privatemode proxy: HOUSEHOLD_LLM_PROVIDER=openai, HOUSEHOLD_LLM_BASE_URL=http://localhost:8080/v1,
// OPENAI_API_KEY=<any non-empty — the proxy holds the project key>. Null when HOUSEHOLD_DISABLE_LLM=1
// (or provider build fails upstream) → the chat skill stays on the regex fast-path (the pre-A.4 V0).
function buildLlmFromEnv() {
  if (process.env.HOUSEHOLD_DISABLE_LLM === '1') return null;
  const id = (process.env.HOUSEHOLD_LLM_PROVIDER ?? 'ollama').toLowerCase();
  let provider;
  if (id === 'ollama') {
    provider = ollamaProvider({ baseUrl: process.env.HOUSEHOLD_LLM_BASE_URL, model: process.env.HOUSEHOLD_LLM_MODEL });
  } else if (id === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY required when HOUSEHOLD_LLM_PROVIDER=openai (for a local Privatemode proxy any non-empty value works — the proxy holds the project key).');
    provider = openaiProvider({ apiKey, baseUrl: process.env.HOUSEHOLD_LLM_BASE_URL, model: process.env.HOUSEHOLD_LLM_MODEL });
  } else if (id === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY required when HOUSEHOLD_LLM_PROVIDER=anthropic');
    provider = anthropicProvider({ apiKey, baseUrl: process.env.HOUSEHOLD_LLM_BASE_URL, model: process.env.HOUSEHOLD_LLM_MODEL });
  } else {
    throw new Error(`Unknown HOUSEHOLD_LLM_PROVIDER: ${id} (ollama | openai | anthropic)`);
  }
  return new LlmClient({
    provider,
    audit: (e) => console.error(`[llm.audit ${e.kind === 'llm.invoke.error' ? 'ERR' : 'OK '}] ${e.providerId} ${e.kind}`),
  });
}

const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { values } = parseArgs({
    options: {
      port:  { type: 'string' },
      actor: { type: 'string' },
    },
  });

  const port  = values.port ? Number(values.port) : 0;
  const actor = values.actor ?? DEFAULT_ACTOR;

  const llm = buildLlmFromEnv();
  const handle = await startHouseholdWeb({ port, actor, llm });
  console.log(`Household web UI ready at ${handle.url}`);
  console.log(`  actor:    ${actor}`);
  console.log(`  app:      ${handle.navModel.app}`);
  console.log(`  llm:      ${llm ? `${process.env.HOUSEHOLD_LLM_PROVIDER ?? 'ollama'} / ${process.env.HOUSEHOLD_LLM_MODEL ?? '(provider default)'}${process.env.HOUSEHOLD_LLM_BASE_URL ? ` @ ${process.env.HOUSEHOLD_LLM_BASE_URL}` : ''}` : 'OFF (regex fast-path only — set HOUSEHOLD_LLM_PROVIDER)'}`);
  console.log(`  sections: ${handle.navModel.sections.map((s) => s.id).join(', ')}`);

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
  async function shutdown() {
    console.log('\nShutting down…');
    await handle.stop();
    process.exit(0);
  }
}
