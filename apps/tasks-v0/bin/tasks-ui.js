#!/usr/bin/env node
/**
 * H4 V0/V1 web UI launcher.
 *
 * Usage (V0 inline single-member, fastest to run):
 *   node bin/tasks-ui.js \
 *     --actor    https://id.example/anne \
 *     --role     admin \
 *     [--port    8080] \
 *     [--storage-root ./.tasks-data]
 *
 * Usage (V0 config file, multi-member household):
 *   node bin/tasks-ui.js \
 *     --actor    https://id.example/anne \
 *     --config   ./household.json \
 *     [--port    8080] \
 *     [--storage-root ./.tasks-data]
 *
 * Usage (V1 Circle mode):
 *   node bin/tasks-ui.js \
 *     --actor    https://id.example/anne \
 *     --circle     ./oss-tools.circle.json \
 *     [--storage-root ./.tasks-data] \
 *     [--telegram-token "$TG_BOT_TOKEN"]
 *
 * Usage (multi-circle smoke):
 *   node bin/tasks-ui.js \
 *     --actor      https://id.example/anne \
 *     --circle-list  ./two-circles.list.json
 *
 * `--circle-list <path>` boots ONE meshAgent + N CircleStates and runs an
 * in-process smoke probe (`addTask` against each circleId, asserting
 * cross-circle isolation), then exits. The list file shape is
 * `{"circles": ["./a.circle.json", "./b.circle.json"]}` — paths are resolved
 * relative to the list file. The HTTP UI is skipped in this mode; the
 * web UX for multi-circle (circle picker + per-tab circleId injection)
 * lives in tasks-mobile.
 *
 * `--telegram-token <token>` activates the chat-bot. Set the
 * token via env var to keep it out of shell history; map chatIds to
 * webids in the circle config's `bot.chatBindings`. Requires V1
 * (`--circle`) — the `bot.*` skills aren't registered in V0 mode.
 *
 * `--push` activates the Expo push side-channel. Notifications
 * dispatch to device tokens declared in `circleConfig.pushTokens`.
 * Conservative gating via `circleConfig.pushPolicy` (humanInTheLoop +
 * per-day cap + quiet hours).
 *
 * The V0 config file shape:
 *   {
 *     "roles":   { "<webid>": "admin"|"coordinator"|"member"|"observer", ... },
 *     "members": [...]
 *   }
 *
 * The V1 Circle config file shape (see `src/Circle.js` § CircleConfig):
 *   {
 *     "circleId": "oss-tools",
 *     "name":   "OSS Tools NL",
 *     "kind":   "project",
 *     "members": [...],
 *     "subtasksAdminApprovalDepth": 4
 *   }
 *
 * `--storage-root <path>` enables local-only-mode-with-restart-survival:
 *   - Wraps `core.FileSystemSource` rooted at the path in a
 *     `local-store.CachingDataSource`.
 *   - Tasks ledger + circle rosters + skill profile + inbox all
 *     persist across CLI restarts.
 *   - When omitted, the CLI uses an in-memory-only bundle
 *     (everything lost at exit; fine for one-off poking).
 */
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { AgentIdentity, InternalBus, InternalTransport, FileSystemSource } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { mountLocalUi, LocalUiAuth } from '@onderling/agent-ui';
import { CachingDataSource } from '@onderling/local-store';
import { renderWeb }         from '@onderling/app-manifest';

import { tasksManifest } from '../manifest.js';

const { values } = parseArgs({
  options: {
    actor:           { type: 'string' },
    role:            { type: 'string' },
    config:          { type: 'string' },
    circle:            { type: 'string' },
    'circle-list':     { type: 'string' },
    port:            { type: 'string' },
    'storage-root':  { type: 'string' },
    // chat bot. `--telegram-token <token>` activates the
    // bot bridge (TelegramBridge from @onderling/chat-agent). The
    // circle config's `bot.chatBindings` map decides which chatId
    // dispatches as which webid.
    'telegram-token': { type: 'string' },
    // Expo push side-channel. Without `--push`, push wiring
    // stays dormant. With it, the CLI imports `@onderling/relay`'s
    // `ExpoPushSender` lazily and Circle dispatches notifications to
    // the per-webid tokens declared in `circleConfig.pushTokens`.
    push: { type: 'boolean' },
    // V2 standardisation adoption (2026-05-14, multi-circle runtime).
    // `--multi-circle` opts the `--circle` path into the shared-agent
    // architecture: one meshAgent + N circle bundles routed via
    // `multiCircleResolver(circlesMap)`. Enables in-process spawning of
    // saved CircleConfigs (the `spawnMyCircle` skill's _spawnCircleInProcess
    // callback wires up). Default off — preserves V1 single-circle
    // boot semantics. Limitation: onboarding skills (issueInvite /
    // redeemInvite) are NOT registered in multi-circle mode yet; they
    // currently register last-write-wins per createCircleAgent. Use the
    // single-circle CLI for invite operations until a multi-circle
    // dispatch lands.
    'multi-circle': { type: 'boolean' },
  },
});

if (!values.actor) {
  console.error('--actor <webid> is required');
  process.exit(2);
}
if (!values.role && !values.config && !values.circle && !values['circle-list']) {
  console.error('one of --role <role> | --config <path> | --circle <path> | --circle-list <path> is required');
  process.exit(2);
}

// ── multi-circle smoke (early exit; no HTTP UI) ─────────────────────────
if (values['circle-list']) {
  const listPath = resolvePath(values['circle-list']);
  const listDir  = dirname(listPath);
  let listFile;
  try {
    listFile = JSON.parse(await readFile(listPath, 'utf8'));
  } catch (err) {
    console.error(`--circle-list: failed to read ${listPath}: ${err?.message ?? err}`);
    process.exit(2);
  }
  if (!Array.isArray(listFile?.circles) || listFile.circles.length === 0) {
    console.error('--circle-list: file must contain {"circles": ["./a.json", ...]} with at least one path');
    process.exit(2);
  }

  const { CircleItemStore, createTaskStore } = await import('@onderling/item-store');
  const { MemberMap } = await import('@onderling/identity-resolver');
  const { DataPart }  = await import('@onderling/core');
  const { buildMeshAgent }  = await import('../src/MeshAgent.js');
  const { wireSkills }      = await import('../src/wireSkills.js');
  const { multiCircleResolver } = await import('../src/bundleResolver.js');
  const { buildStandardRolePolicy } = await import('../src/rolePolicy.js');

  // Load every circle config first so we can fail fast on bad input.
  const circleConfigs = [];
  for (const rel of listFile.circles) {
    const circlePath = resolvePath(listDir, rel);
    try {
      circleConfigs.push(JSON.parse(await readFile(circlePath, 'utf8')));
    } catch (err) {
      console.error(`--circle-list: failed to load ${circlePath}: ${err?.message ?? err}`);
      process.exit(2);
    }
  }

  // ONE meshAgent for the whole process.
  // `circleStates` is the agent's revocation truth (one resolver, taken at construction). These
  // smoke-path CircleStates carry no grant manager or bot registry, so nothing is ever revoked —
  // stated by passing the map rather than left to look like an oversight.
  const { meshAgent } = await buildMeshAgent({ label: 'TasksMeshAgent(multi)', circleStates: () => circles.values() });

  // Build a minimal CircleState per circleConfig — same shape as
  // test/v2_8-single-agent.test.js fixture (no per-circle V1+ wiring;
  // the smoke only needs the substrate's dispatch path).
  const circles = new Map();
  const allMembers = [];
  for (const cfg of circleConfigs) {
    const roles = Object.fromEntries(
      (cfg.members ?? []).map((m) => [m.webid, m.role ?? 'member']),
    );
    const dataSource = new (await import('@onderling/core')).MemorySource();
    const circleStore = new CircleItemStore({
      dataSource,
      rootContainer: `mem://tasks/circles/${cfg.circleId}/`,
    });
    const itemStore = createTaskStore(circleStore, {
      rolePolicy:          buildStandardRolePolicy(roles),
      enforceDependencies: true,
    });
    let liveCircle = Object.freeze({
      circleId:     cfg.circleId,
      name:       cfg.name ?? cfg.circleId,
      kind:       cfg.kind ?? 'household',
      members:    cfg.members ?? [],
      customRoles: cfg.customRoles ?? [],
    });
    circles.set(cfg.circleId, {
      get circleId()   { return liveCircle.circleId; },
      get liveCircle() { return liveCircle; },
      circleMutator(patch) { liveCircle = Object.freeze({ ...liveCircle, ...patch }); },
      roles,
      itemStore,
      dataSource,
      members: new MemberMap({ initial: cfg.members ?? [] }),
      chatController: null,
      botAgentRegistry: null,
      metricsTracker: null,
      notifierChannels: null,
      onCalendarEmissionChange: null,
      onCompensationChange: null,
    });
    for (const m of cfg.members ?? []) allMembers.push({ webid: m.webid });
  }

  wireSkills({
    meshAgent,
    bundleResolver: multiCircleResolver(circles),
    circlesProvider:  () => circles.values(),
    members:        new MemberMap({ initial: allMembers }),
  });
  await meshAgent.start();

  console.log(`V2.8 multi-circle smoke: 1 meshAgent, ${circles.size} CircleStates`);
  console.log(`  pubKey: ${meshAgent.identity?.pubKey ?? '(unknown)'}`);
  for (const [circleId, st] of circles) {
    console.log(`  • ${circleId}: ${st.liveCircle.members.length} member(s)`);
  }

  // Probe: addTask per circle via the registered handler, assert isolation.
  const addDef = meshAgent.skills.get('addTask');
  if (!addDef) {
    console.error('FAIL: addTask not registered');
    process.exit(1);
  }
  for (const [circleId, st] of circles) {
    const adminWebid = Object.entries(st.roles).find(([, r]) => r === 'admin')?.[0]
                    ?? Object.keys(st.roles)[0];
    if (!adminWebid) {
      console.error(`FAIL: ${circleId} has no member to act as`);
      process.exit(1);
    }
    const r = await addDef.handler({
      parts:    [DataPart({ circleId, text: `smoke-task-${circleId}` })],
      from:     adminWebid,
      agent:    meshAgent,
      envelope: null,
    });
    if (r?.error || !r?.task) {
      console.error(`FAIL: ${circleId} addTask returned ${JSON.stringify(r)}`);
      process.exit(1);
    }
  }
  // Isolation check: each ItemStore holds exactly its own probe item.
  for (const [circleId, st] of circles) {
    const open = await st.itemStore.listOpen();
    if (open.length !== 1 || open[0].text !== `smoke-task-${circleId}`) {
      console.error(`FAIL: ${circleId} isolation broken — listOpen()=${JSON.stringify(open)}`);
      process.exit(1);
    }
  }
  console.log(`OK: addTask routed to the right circle for all ${circles.size} circle(s); ItemStores isolated.`);
  process.exit(0);
}


const port = Number(values.port ?? 0);

// Storage bundle. Three modes:
//   - --storage-root <path>   → FileSystemSource-backed bundle (restart-survival)
//   - --circle (no --storage-root) → in-memory CachingDataSource bundle
//                                  (V1 skills register against it; nothing persists)
//   - V0 mode (--role / --config without --circle) → no bundle; createTasksAgent
//                                  defaults to a bare MemorySource for the ItemStore
//                                  and the V1 helper skills are not registered.
let localStoreBundle = null;
if (values['storage-root']) {
  const root = resolvePath(values['storage-root']);
  const fs = new FileSystemSource({ root });
  const cache = new CachingDataSource({ inner: fs });
  localStoreBundle = {
    cache,
    cadence: null,
    async attachInner(ds) { await cache.attachInner(ds); },
    async detachInner()   { await cache.attachInner(null); },
    async close()         {},
  };
  console.log(`Local-only storage root: ${root}`);
} else if (values.circle) {
  // V1 Circle mode without --storage-root: build an ephemeral in-memory
  // bundle so all the V1 helper skills (inbox / workspace / observability /
  // circle-controls / appeal) get registered against a real CachingDataSource.
  // Nothing persists across CLI restarts — add --storage-root for that.
  const cache = new CachingDataSource({});
  localStoreBundle = {
    cache,
    cadence: null,
    async attachInner(ds) { await cache.attachInner(ds); },
    async detachInner()   { await cache.attachInner(null); },
    async close()         {},
  };
  console.log('In-memory local store (V1 mode); add --storage-root <path> for restart-survival.');
}

const id  = await AgentIdentity.generate(new VaultMemory());
const bus = new InternalBus();
const transport = new InternalTransport(bus, id.pubKey);

const { createTasksAgent } = await import('../src/index.js');
const { createCircleAgent }  = await import('../src/Circle.js');

let bundle;
let roles, members;

if (values.circle) {
  // V1 Circle mode.
  const circleConfig = JSON.parse(await readFile(values.circle, 'utf8'));

  // optional push sender (Expo). Lazy-import so users who
  // don't pass --push don't pay for the relay dep at startup.
  let pushSender;
  if (values.push) {
    try {
      const { ExpoPushSender } = await import('@onderling/relay');
      pushSender = new ExpoPushSender();
      console.log('  push:   Expo push sender wired');
    } catch (err) {
      console.error(`  ⚠ --push: failed to load @onderling/relay (${err?.message ?? err})`);
    }
  }

  // V2 standardisation adoption (2026-05-14) — multi-circle runtime
  // (`--multi-circle`) builds the meshAgent first and threads it
  // through createCircleAgent. The primary circle gets `registerSkills:
  // false + wireOnboardingSkills: false` so the CLI owns the single
  // wireSkills call. `_spawnCircleInProcess` lives on the CircleState
  // and the `spawnMyCircle` skill invokes it to add more bundles to
  // `circlesMap`.
  if (values['multi-circle']) {
    const { buildMeshAgent } = await import('../src/MeshAgent.js');
    const { wireSkills }     = await import('../src/wireSkills.js');
    const { multiCircleResolver } = await import('../src/bundleResolver.js');
    const { buildMultiCircleOnboardingSkills } = await import('../src/skills/multiCircleOnboarding.js');

    const { meshAgent } = await buildMeshAgent({
      identity:        id,
      transport,
      localStoreBundle,
      label:           `Tasks-MultiCircle-${values.actor}`,
      // The agent's revocation truth: every circle in the map, asked at verify time. The engine
      // takes ONE resolver at construction, so a circle spawned later must be REACHABLE from it
      // rather than pushing itself in — the map is that reach.
      circleStates:    () => circlesMap.values(),
    });

    bundle = await createCircleAgent({
      circleConfig,
      localStoreBundle,
      identity:             id,
      transport,
      agent:                meshAgent,
      registerSkills:       false,
      wireOnboardingSkills: false,
      label:                `Circle(${circleConfig.circleId ?? 'unknown'})-${values.actor}`,
      ...(pushSender ? { pushSender } : {}),
    });

    const primaryCircleState = bundle._circleState;
    const circlesMap = new Map([[primaryCircleState.circleId, primaryCircleState]]);

    /**
     * Closure-captured spawn callback the `spawnMyCircle` skill invokes
     * to bring up a saved CircleConfig in-process. Adds the fresh
     * CircleState to `circlesMap` so the multiCircleResolver routes future
     * skill calls to it. Onboarding skills aren't wired per-circle;
     * `issueInvite`/`redeemInvite` are not registered in multi-circle
     * mode (multi-circle dispatch for them is a follow-up).
     */
    async function spawnCircleInProcess(circleId) {
      if (typeof circleId !== 'string' || !circleId) {
        throw new Error('spawnCircleInProcess: circleId required');
      }
      if (circlesMap.has(circleId)) return circlesMap.get(circleId);
      const path = `mem://tasks/circles/${circleId}/config.json`;
      const raw = await localStoreBundle.cache.read(path);
      if (!raw) throw new Error(`spawnCircleInProcess: no saved config at ${path}`);
      const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const spawned = await createCircleAgent({
        circleConfig:           cfg,
        localStoreBundle,
        identity:             id,
        transport,
        agent:                meshAgent,
        registerSkills:       false,
        wireOnboardingSkills: false,
        label:                `Circle(${cfg.circleId})-${values.actor}`,
        ...(pushSender ? { pushSender } : {}),
      });
      const cs = spawned._circleState;
      // Make the spawn callback visible on the new CircleState too, so
      // subsequent spawnMyCircle calls routed to it can spawn further.
      cs._spawnCircleInProcess = spawnCircleInProcess;
      circlesMap.set(cfg.circleId, cs);
      return cs;
    }
    primaryCircleState._spawnCircleInProcess = spawnCircleInProcess;

    wireSkills({
      meshAgent,
      bundleResolver: multiCircleResolver(circlesMap),
      circlesProvider:  () => circlesMap.values(),
      members:        bundle.members,
    });

    // Multi-circle onboarding dispatch — registers `issueInvite` +
    // `redeemInvite` ONCE with per-call CircleState resolution. Closes
    // the gap that V2 sixth slice flagged as "known limitation in
    // --multi-circle mode" (per-circle onboarding skills last-write-wins).
    for (const def of buildMultiCircleOnboardingSkills({
      bundleResolver: multiCircleResolver(circlesMap),
    })) {
      meshAgent.skills.register(def);
    }

    await meshAgent.start();
  } else {
    // Default V1 Circle mode — single-circle, skills register inside
    // createCircleAgent's createTasksAgent path.
    bundle = await createCircleAgent({
      circleConfig,
      localStoreBundle,
      identity: id,
      transport,
      label:    `Circle(${circleConfig.circleId ?? 'unknown'})-${values.actor}`,
      ...(pushSender ? { pushSender } : {}),
    });
  }
  roles   = Object.fromEntries((circleConfig.members ?? []).map((m) => [m.webid, m.role]));
  members = circleConfig.members ?? [];
  if (!roles[values.actor]) {
    console.error(`--circle: ${values.circle} doesn't list a role for ${values.actor}`);
    process.exit(2);
  }
} else {
  // V0 (legacy) single-household mode.
  if (values.config) {
    const cfg = JSON.parse(await readFile(values.config, 'utf8'));
    roles   = cfg.roles   ?? {};
    members = cfg.members ?? [];
    if (!roles[values.actor]) {
      console.error(`--config: ${values.config} doesn't list a role for ${values.actor}`);
      process.exit(2);
    }
  } else {
    roles   = { [values.actor]: values.role };
    members = [{
      webid:       values.actor,
      displayName: values.actor.split('/').pop() || values.actor,
      role:        values.role,
    }];
  }
  bundle = await createTasksAgent({
    identity:  id,
    transport,
    label:     `H4-${values.actor}`,
    roles,
    members,
    localStoreBundle,
  });
}

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

// Surface the actor's role to the UI via an extraStaticFiles overlay so
// the frontend knows which buttons to render. The skill handlers still
// enforce role policy server-side; the UI hint is purely cosmetic.
const tasksConfig = JSON.stringify({
  actor: values.actor,
  roles,
  ...(bundle.circle ? { circle: { circleId: bundle.circle.circleId, name: bundle.circle.name, kind: bundle.circle.kind } } : {}),
});

// surface the NavModel for the renderWeb
// driven `dag.html` (and future pages).  Static for the life of the
// process; the manifest is module-scope const.  Mirror of household-
// web.js (`apps/household/bin/household-web.js`).
const navModel = renderWeb(tasksManifest);

// overlay `src/ui/dagFlatten.js` at `/lib/dagFlatten.js`
// so dag.html can `import` it from the browser.  `staticDir` is
// path-traversal-hardened so a relative `../src/...` import resolves
// to 404; this overlay re-routes one shared helper through
// `extraStaticFiles` (the same mechanism the navmodel/config use).
// Source-of-truth stays under `src/ui/` (consumed by tasks-mobile too,
// per `docs/web-mobile-parity-workarounds.md` §A.4).
const dagFlattenJs = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui', 'dagFlatten.js'),
  'utf8',
);

// Slice (2026-05-27) — overlay the chat-thread helpers at
// `/lib/chatThread.js` so the web chat page (`chat.html`) can import
// the same pure-JS glue tasks-mobile's `ChatThreadScreen.jsx`
// consumes. Source-of-truth: `src/ui/chatThread.js`.
const chatThreadJs = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui', 'chatThread.js'),
  'utf8',
);

// task.html (2026-05-27) — overlay the per-task detail helpers at
// `/lib/taskDetail.js` so the web per-task page can import the
// shared pure-JS glue. Mirrors `src/ui/chatThread.js`. The page also
// pulls `describeTaskStatus` from `taskStatus.js`; that lives at
// `/lib/taskStatus.js` (overlayed alongside) so the import path is
// stable rather than relative-into-parent (which the static handler
// blocks via path-traversal hardening). Source-of-truth:
// `src/ui/{taskDetail,taskStatus}.js`.
const taskDetailJs = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui', 'taskDetail.js'),
  'utf8',
);
const taskStatusJs = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui', 'taskStatus.js'),
  'utf8',
);

// Post-V0 follow-up (2026-05-27) — runtime locale loader.
// Pages declare `data-i18n` attributes; until this loader landed,
// no JS swapped them so every visible string rendered as the
// hardcoded English fallback.  Overlay the browser-side bootstrap
// + serve the en/nl JSON files via extraStaticFiles so pages can
// `fetch('/locales/<lng>.json')`.  Source-of-truth: same locale
// JSONs `src/lib/localisation.js` (Node) consumes.
const i18nBootstrapJs = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui', 'i18nBootstrap.js'),
  'utf8',
);
const i18nAutoBootJs = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ui', 'i18nAutoBoot.js'),
  'utf8',
);
const enLocaleJson = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'locales', 'en.json'),
  'utf8',
);
const nlLocaleJson = await readFile(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'locales', 'nl.json'),
  'utf8',
);

// .0 (2026-05-20) — overlay the shared @onderling/web-adapter
// helpers at `/lib/web-adapter/<basename>.js`. Same mechanism as
// `/lib/dagFlatten.js`. Source-of-truth: `packages/web-adapter/src/`.
const webAdapterFiles = await loadWebAdapterFiles();

const ui = await mountLocalUi(bundle.agent, {
  port,
  staticDir:        webDir,
  a2aTLSLayer:      new LocalUiAuth({ localActor: values.actor }),
  extraStaticFiles: {
    '/tasks-config.json':     tasksConfig,
    '/navmodel.json':         JSON.stringify(navModel),
    '/lib/dagFlatten.js':     dagFlattenJs,
    '/lib/chatThread.js':     chatThreadJs,
    '/lib/taskDetail.js':     taskDetailJs,
    '/lib/taskStatus.js':     taskStatusJs,
    '/lib/i18nBootstrap.js':  i18nBootstrapJs,
    '/lib/i18nAutoBoot.js':   i18nAutoBootJs,
    '/locales/en.json':       enLocaleJson,
    '/locales/nl.json':       nlLocaleJson,
    ...webAdapterFiles,
  },
});

async function loadWebAdapterFiles() {
  const root = join(
    dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..',
    'packages', 'web-adapter', 'src',
  );
  // fetchSectionItems + schemaToFormFields join the
  // shared web-adapter overlay. `fetchSectionItems` honours the
  // manifest's `view.dataSource` so per-page section→skill dispatch
  // collapses; `schemaToFormFields` turns an affordance's paramsSchema
  // into a platform-neutral form-field descriptor list.
  const names = [
    'callSkill.js',
    'deriveItemState.js',
    'itemMatchesAppliesTo.js',
    'applyPrefilledParams.js',
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

console.log(`H4 UI ready at ${ui.url}`);
console.log(`  actor:  ${values.actor}`);
console.log(`  role:   ${roles[values.actor]}`);
console.log(`  pubKey: ${id.pubKey}`);
console.log(`  members: ${members.length}`);

// telegraf launch errors can surface as unhandled rejections
// (long-polling launch is fire-and-forget inside TelegramBridge).
// Catch them here so the rest of the UI keeps serving.
process.on('unhandledRejection', (err) => {
  const msg = err?.message ?? String(err);
  if (/telegram|telegraf|TelegramError/i.test(msg)) {
    console.error(`  ⚠ Telegram bot async error: ${msg}`);
    return;
  }
  // Surface non-telegram rejections — those are real bugs.
  console.error('Unhandled rejection:', err);
});

// wire the Telegram bot if `--telegram-token` was supplied.
// Requires V1 Circle mode (the `bot.*` skills are only registered when
// `localStoreBundle` is present, which `--circle` always provides).
let botCleanup = null;
if (values['telegram-token']) {
  if (!values.circle) {
    console.error('  ⚠ --telegram-token ignored: needs --circle (V1 mode)');
  } else {
    try {
      // Pre-flight the token via Telegram's /getMe so a bad token
      // produces a clean error instead of an unhandled rejection
      // when telegraf's fire-and-forget bot.launch() 404s.
      const meRes = await fetch(`https://api.telegram.org/bot${values['telegram-token']}/getMe`);
      if (!meRes.ok) {
        const body = await meRes.text().catch(() => '');
        throw new Error(`token rejected by Telegram (HTTP ${meRes.status}): ${body.slice(0, 200)}`);
      }
      const me = await meRes.json();
      if (!me?.ok || !me?.result?.username) {
        throw new Error(`token rejected by Telegram: ${JSON.stringify(me).slice(0, 200)}`);
      }
      console.log(`  bot:    Telegram token OK (@${me.result.username})`);

      const { TelegramBridge } = await import('@onderling/chat-agent/bridges/telegram');
      const { wireBotChannel } = await import('../src/bot/wireBotChannel.js');
      // Pass a live provider so bindings added via the
      // setBotChatBinding skill propagate without restart.
      const liveBindings = () => bundle.getCircle?.()?.bot?.chatBindings ?? bundle.circle?.bot?.chatBindings ?? {};
      const bindingCount = Object.keys(liveBindings()).length;

      const tg = new TelegramBridge({
        botToken: values['telegram-token'],
        mode:     'long-polling',
      });
      const r = await wireBotChannel({
        agent:            bundle.agent,
        bridges:          [{ bridge: tg, name: 'telegram' }],
        chatBindings:     liveBindings,
        botAgentRegistry: bundle.botAgentRegistry,
      });
      botCleanup = r.detach;
      console.log(`  bot:    Telegram bridge active (${bindingCount} chatBinding${bindingCount === 1 ? '' : 's'})`);
      if (bindingCount === 0) {
        console.log('          (no chatBindings yet — add some under circle.bot.chatBindings)');
      }
    } catch (err) {
      const msg = err?.message ?? String(err);
      if (/Cannot find package 'telegraf'|Cannot find module 'telegraf'/.test(msg)) {
        console.error('  ⚠ Telegram bot needs `telegraf` — run `npm i telegraf` in this app to enable.');
      } else {
        console.error(`  ⚠ Telegram bot failed to start: ${msg}`);
      }
    }
  }
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
async function shutdown() {
  console.log('\nShutting down…');
  try { await botCleanup?.(); } catch { /* noop */ }
  await ui.stop();
  process.exit(0);
}
