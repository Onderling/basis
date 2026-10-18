/**
 * Recombination demo — shared scenario.
 *
 * One process hosts household + tasks-v0 (multi-circle) together via
 * `@canopy/manifest-host`.  A chat-agent drives a mocked LLM over the
 * composed tool catalogue.  Both apps' state mutates from one
 * conversation; the demo runner (`index.js`) logs the trace and the
 * test runner (`test/recombination.test.js`) asserts the state lands
 * in the right app's store.
 *
 * Module imported by both the demo + the test so they exercise the
 * exact same pipeline.
 */

import { LlmClient, mockProvider }            from '@canopy/llm-client';
import { ChatAgent, InMemoryBridge }          from '@canopy/chat-agent';
import { createManifestHost }                 from '@canopy/manifest-host';
import {
  treeOf, createCrossPodRefResolver,
  ItemStore, memoryDataSource,
}                                              from '@canopy/item-store';
import {
  makeSavedView, resolveSavedView, savedViewAudiences,
}                                              from '@canopy/circles';

import {
  InMemoryStore,
  householdManifest,
  createHouseholdMountable,
}                                              from '@canopy-app/household';
import {
  tasksManifest,
  buildMultiCircleRuntime,
  createTasksMountable,
}                                              from '@canopy-app/tasks-v0';

// SP-11b — pinboard as a 3rd mounted app.  Pinboard's manifest + LLM-chat
// skill-registry builder are NOT on its package `exports` map (the
// public surface is `src/index.js`), so we reach them by relative path
// into `apps/pinboard/` — exactly the file the task names, "mount
// apps/pinboard/manifest.js".  Relative imports resolve pinboard's own deps
// from `apps/pinboard/node_modules`, so the heavy substrate wires itself.
import pinboardManifest                          from '../../apps/pinboard/manifest.js';
import { createNeighbourhoodCluster }          from '../../apps/pinboard/src/index.js';
import { buildPinboardSkillRegistry }            from '../../apps/pinboard/src/chat/llmChat.js';

/* ─── pinboard mount constants ──────────────────────────────────────── */

const PINBOARD_GROUP = 'oosterpoort';
const PINBOARD_ACTOR = 'https://id.example/anne';

/* ─── scripted LLM responses ─────────────────────────────────────── */

/**
 * The chat-agent feeds the LLM the composed toolCatalogue
 * (`{id: "appId.opId", ...}`).  A real LLM would pick a tool from
 * that catalogue; here we script the choices so the demo + test run
 * deterministically.
 *
 * Pattern: each user turn → exactly one tool call → reply.
 */
export const DEMO_LLM_SCRIPT = [
  // Turn 1 — user: "add bread to shopping"
  {
    toolCall:       { id: 'household.addItem', args: { type: 'shopping', text: 'bread' } },
    classification: 'actionable',
  },
  // Turn 2 — user: "add a task: paint the hallway"
  {
    toolCall:       { id: 'tasks.addTask', args: { circleId: 'primary-circle', text: 'paint the hallway' } },
    classification: 'actionable',
  },
  // Turn 3 — user: "what's on my shopping list?"
  {
    toolCall:       { id: 'household.listOpen', args: { type: 'shopping' } },
    classification: 'actionable',
  },
];

/* ─── system-prompt composition policy ───────────────────────────── */

/**
 * "Generic preamble" policy for `perAppSystemPrompts` (per the
 * manifest-host README's "Potential conflicts" recommendation for ≥2
 * apps).  Lists which apps are mounted; lets the tool descriptions
 * (already in the composed catalogue) carry the rest.
 */
export function buildSystemPrompt(perAppSystemPrompts) {
  const apps = Object.keys(perAppSystemPrompts).sort();
  return [
    'You are a multi-app assistant.  You have access to tools from these apps:',
    ...apps.map((a) => `  - ${a}`),
    'Use the appropriate tool for each request.  For tools whose id starts with',
    '"tasks.", default to circleId: "primary-circle" if the user does not specify one.',
  ].join('\n');
}

/* ─── pinboard-as-3rd-app mountable (SP-11b) ────────────────────────── */

/**
 * Build a pinboard mountable for `host.mount('pinboard', pinboardManifest, …)`.
 *
 * Pinboard is a heavy closed-group substrate (identity, MemberMap,
 * SkillMatch, ItemStore).  `createNeighbourhoodCluster` boots one
 * in-memory bundle with a fresh identity + InternalBus — no pods, no
 * network — the same headless path pinboard's own `chat-llm` test uses.
 * `buildPinboardSkillRegistry` then walks `pinboardManifest.operations` and
 * binds each op to the live agent's SDK skill (via pinboard's own SDK→
 * renderChat adapter), so the mount is REAL skills, not a stub.
 *
 * Returns the mount `opts` (`{skillRegistry, toSkillCtx}`) plus the
 * live cluster + a `teardown` that stops its SkillMatch subscriptions.
 *
 * @returns {Promise<{
 *   mountable: {skillRegistry: object, toSkillCtx: Function},
 *   cluster: object, bundle: object, missing: string[],
 *   teardown: () => Promise<void>,
 * }>}
 */
export async function createPinboardMountable() {
  const cluster = await createNeighbourhoodCluster({
    groups: [{
      groupId:    PINBOARD_GROUP,
      localActor: PINBOARD_ACTOR,
      members:    [{ webid: PINBOARD_ACTOR }],
    }],
    label: 'recombination-demo-pinboard',
  });
  const bundle = cluster.groups.get(PINBOARD_GROUP);

  const { skillRegistry, missing } = buildPinboardSkillRegistry(bundle);

  const mountable = {
    skillRegistry,
    // pinboard skills key on `senderWebid` for the actor (mirrors pinboard's
    // own `createLlmChat` toSkillCtx).
    toSkillCtx: (toolCtx) => ({
      senderWebid: toolCtx?.actorWebid,
      chatId:      toolCtx?.chatId,
      bridgeId:    toolCtx?.bridgeId,
    }),
  };

  return {
    mountable, cluster, bundle, missing,
    async teardown() { await cluster.stop(); },
  };
}

/* ─── runtime setup ──────────────────────────────────────────────── */

/**
 * Build the demo runtime.  Returns the live pieces + a `teardown`.
 *
 * @param {object} [args]
 * @param {Array} [args.llmScript=DEMO_LLM_SCRIPT]
 * @param {boolean} [args.mountPinboard=false]  SP-11b — also mount
 *   `apps/pinboard/manifest.js` as a 3rd app.  Off by default so the
 *   original two-app scenario (index.js + the SP-11 assertions) is
 *   unchanged; the SP-11b cross-surface assertions pass `true`.
 */
export async function setupRecombinationDemo({
  llmScript  = DEMO_LLM_SCRIPT,
  mountPinboard = false,
} = {}) {
  // (1) household — InMemoryStore + the mountable that captures it in
  //     the toSkillCtx closure.
  const householdStore     = new InMemoryStore();
  const householdMountable = createHouseholdMountable({ store: householdStore });

  // (2) tasks-v0 multi-circle runtime — the same machinery
  //     `bin/tasks-ui.js --multi-circle` constructs, in-process.
  const tasksRuntime = await buildMultiCircleRuntime({
    label: 'recombination-demo',
  });
  const tasksMountable = createTasksMountable({
    meshAgent: tasksRuntime.meshAgent,
    circlesMap:  tasksRuntime.circlesMap,
  });

  // (3) host composition — mount the apps; everything namespaced.
  const host = createManifestHost();
  host.mount('household', householdManifest, householdMountable);
  host.mount('tasks',     tasksManifest,     tasksMountable);

  // (3b) SP-11b — pinboard as an optional 3rd mount.  Composition stays
  //      collision-free: tool ids are `appId.opId`-namespaced and the
  //      three apps' slash-command menus don't overlap.
  let pinboard = null;
  if (mountPinboard) {
    pinboard = await createPinboardMountable();
    host.mount('pinboard', pinboardManifest, pinboard.mountable);
  }

  const composed = host.compose();

  // (4) chat-agent over the composed view.  System-prompt composed
  //     per the generic-preamble policy (host README recommendation).
  const llm    = new LlmClient({ provider: mockProvider({ responses: llmScript }) });
  const bridge = new InMemoryBridge({ id: 'demo-bridge' });

  const chatAgent = new ChatAgent({
    bridges:        [bridge],
    llm,
    toolCatalogue:    composed.toolCatalogue,
    toolHandlers:   composed.toolHandlers,
    systemPrompt:   buildSystemPrompt(composed.perAppSystemPrompts),
    contextBuilder: async () => '',
  });

  await chatAgent.start();

  return {
    host, composed, chatAgent, bridge,
    householdStore, tasksRuntime,
    pinboard,                      // SP-11b — null unless mountPinboard:true
    async teardown() {
      await chatAgent.stop();
      if (pinboard) await pinboard.teardown();
    },
  };
}

/* ─── cross-app embed reference (SP-11b) ─────────────────────────── */

/**
 * Demonstrate a canonical cross-app `embeds` reference: a household
 * item that points at a tasks-v0 task by its `urn:dec:item:<id>` ref
 * — NOT an inlined pod URL.  Then walk it with the substrate's
 * `treeOf` walker + `createCrossPodRefResolver`, resolving the ref
 * ACROSS apps (household's store → tasks' store) so the embedded task
 * surfaces inline.
 *
 * This is the `docs/conventions/cross-pod-refs.md` `{type, ref}` shape
 * running end-to-end between two independently-mounted apps: household
 * never learns tasks' schema, only its ref; the walker fetches the
 * external item through the injected resolver.
 *
 * @param {Awaited<ReturnType<typeof setupRecombinationDemo>>} runtime
 * @param {object} [opts]
 * @param {string} [opts.taskText='paint the hallway']
 * @param {string} [opts.noteText='paint supplies']
 * @returns {Promise<{ task: object, householdItem: object, ref: string, tree: object }>}
 */
export async function demoCrossAppEmbed(runtime, {
  taskText = 'paint the hallway',
  noteText = 'paint supplies',
} = {}) {
  const tasksStore     = runtime.tasksRuntime.primaryBundle.itemStore;
  const householdStore = runtime.householdStore.substrate; // underlying ItemStore

  // (1) create the referenced task in tasks-v0.
  const [task] = await tasksStore.addItems(
    [{ type: 'task', text: taskText }],
    { actor: PINBOARD_ACTOR },
  );

  // (2) create a household item that EMBEDS it by canonical ref.
  const ref = `urn:dec:item:${task.id}`;
  const [householdItem] = await householdStore.addItems(
    [{ type: 'shopping', text: noteText, embeds: [{ type: 'task', ref }] }],
    { actor: PINBOARD_ACTOR },
  );

  // (3) walk the household item; resolve the external ref against the
  //     tasks store (cross-app fetch).
  const resolver = createCrossPodRefResolver({
    getItem: (id) => tasksStore.getById(id),
  });
  const tree = await treeOf({
    rootId:             householdItem.id,
    getItem:            (id) => householdStore.getById(id),
    resolveExternalRef: resolver,
  });

  return { task, householdItem, ref, tree };
}

/* ─── saved cross-circle view (SP-11b piece 3 · SP-8) ────────────── */

/**
 * The three circles the saved-view demo spans.  The saved view UNIONS
 * the first two; the third is deliberately UNLISTED so we can prove the
 * resolved list EXCLUDES it (a cross-circle view returns items visible
 * to ANY listed circle, and only those).
 */
export const SV_CIRCLE_GARDEN   = { kind: 'circle-ref', id: 'garden-committee' };  // listed
export const SV_CIRCLE_TOOLSHED = { kind: 'circle-ref', id: 'tool-library' };      // listed
export const SV_CIRCLE_PRIVATE  = { kind: 'circle-ref', id: 'private-notes' };     // UNLISTED
const SV_ACTOR                  = 'https://id.example/anne';

/**
 * Demonstrate a **saved cross-circle view** (SP-8, the piece SP-11b
 * originally skipped for want of `@canopy/circles`' saved-view helpers).
 *
 * `resolveSavedView` runs ONE cross-circle query
 * (`store.listOpen({type, audiences})`) against ONE `@canopy/item-store`
 * `ItemStore` whose items carry different `circle-ref` audiences.  The
 * mounted demo apps each keep a per-circle-ISOLATED store (tasks-v0 has
 * a separate `itemStore` per circle; household is a single-audience
 * store), so none of them can host a single store holding items across
 * several circles at once.  We therefore construct a dedicated
 * `ItemStore` for this piece rather than contorting a mounted app — it
 * is exactly the substrate surface `resolveSavedView` duck-types
 * (`listOpen(filter)` with `audiences` support, added by SP-8).
 *
 * The saved view itself is the canonical `@canopy/item-types` `view`
 * item `makeSavedView` builds: `audience = union(garden, tool-library)`.
 *
 * @returns {Promise<{
 *   store: ItemStore, view: object, seeded: object[], resolved: object[],
 *   listedIds: string[], excluded: object[],
 * }>}
 */
export async function demoSavedCrossCircleView() {
  const store = new ItemStore({
    dataSource:    memoryDataSource(),
    rootContainer: 'mem://saved-view/',
  });

  // Notes across THREE circles — two listed, one not.
  const seeded = await store.addItems([
    { type: 'note', text: 'order tomato seeds',   audience: SV_CIRCLE_GARDEN },
    { type: 'note', text: 'prune the roses',      audience: SV_CIRCLE_GARDEN },
    { type: 'note', text: 'borrow the drill',     audience: SV_CIRCLE_TOOLSHED },
    { type: 'note', text: 'diary — do not share', audience: SV_CIRCLE_PRIVATE }, // unlisted
  ], { actor: SV_ACTOR });

  // A different itemType in a LISTED circle — proves the view's
  // `itemType` narrows WITHIN the union (it must NOT be returned).
  await store.addItems(
    [{ type: 'event', text: 'garden open day', audience: SV_CIRCLE_GARDEN }],
    { actor: SV_ACTOR },
  );

  // Build the saved view: a UNION of the two listed circle-refs.
  const view = makeSavedView({
    title:     'Garden + tool-library notes',
    itemType:  'note',
    audiences: [SV_CIRCLE_GARDEN, SV_CIRCLE_TOOLSHED],
  });

  // Resolve → the UNIONED note list spanning both listed circles.
  const resolved = await resolveSavedView(view, store);

  // Bookkeeping for the demo/test: which seeded items SHOULD appear
  // (the two listed circles' notes) vs. which must be excluded (the
  // unlisted circle's note + the wrong-type event).
  const listedIds = seeded
    .filter((i) => i.audience.id !== SV_CIRCLE_PRIVATE.id)
    .map((i) => i.id);
  const excluded = seeded.filter((i) => i.audience.id === SV_CIRCLE_PRIVATE.id);

  return {
    store, view, seeded, resolved, listedIds, excluded,
    // the normalised audience SET the view spans (SP-8 helper) — the
    // exact set handed to `ListFilter.audiences`.
    viewAudiences: savedViewAudiences(view),
  };
}

/**
 * Run the scripted conversation: one user message per turn, return
 * the captured outbox + final per-app state.
 *
 * @param {Awaited<ReturnType<typeof setupRecombinationDemo>>} runtime
 * @param {string[]} userMessages
 */
export async function runScriptedConversation(runtime, userMessages) {
  const turns = [];
  for (const text of userMessages) {
    runtime.bridge.clearOutbox();
    await runtime.bridge.simulateIncoming({ text });
    // Capture this turn's outbox before the next clear.
    turns.push({
      userText: text,
      replies:  [...runtime.bridge.outbox],
    });
  }
  return turns;
}

/**
 * Convenience: the user-visible script that pairs 1-to-1 with
 * `DEMO_LLM_SCRIPT`.
 */
export const DEMO_USER_MESSAGES = [
  'add bread to my shopping list',
  'add a task: paint the hallway',
  "what's on my shopping list?",
];
