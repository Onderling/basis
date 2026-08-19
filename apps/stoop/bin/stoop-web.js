#!/usr/bin/env node
/**
 * stoop-web — bootstrap (PLAN-gui-chat-uplift.md).
 *
 * Boots a localhost-only stoop web UI driven by the manifest's NavModel
 * (rendered via `@onderling/app-manifest`'s `renderWeb`).  Mirrors
 * `apps/household/bin/household-web.js`: same `@onderling/agent-ui`'s
 * `mountLocalUi` substrate, same `extraStaticFiles` carrying
 * `/navmodel.json` + `/stoop-config.json`.
 *
 * ──── + E.2 + E.3 scope (the three smallest stoop pages) ──
 *
 * Stoop has 16 web pages today (per `Project Files/projects/audit-stoop-folio-surfaces.md`).
 * E.1 surfaced ONE — `mine.html` (my active posts + completions); E.2
 * (2026-05-20) added a second — `privacy.html` (closed-beta
 * disclosure + data-location); E.3 (2026-05-20) added a third —
 * `settings.html` (per-device + per-actor preferences).  All three
 * pages prove the substrate-shape, mirroring B.1's discipline for
 * tasks-v0 (just `dag.html`).  13 pages remain hand-built and will
 * land in follow-on E.x slices.
 *
 * Why `mine.html` (E.1)?
 *   - Single-list page (one `listMyRequests` skill, one `<ul>` of items)
 *   - The skill it calls (`listMyRequests`) IS in the manifest
 *     (`listMyRequests` op declared D.1, line 158)
 *   - Smaller than `index.html` (noticeboard has filters + multi-intent
 *     tabs) — strictly less risky to migrate as the first proof
 *
 * Why `privacy.html` (E.2)?
 *   - Smallest read-only page (66 lines pre-migration) — a clean
 *     `view.readOnly: true` proof-point
 *   - Two skill calls (`getPrivacyNotice`, `getDataLocation`), one of
 *     which (`getDataLocation`) fits the `dataSource` contract
 *     (param-free); the lang-aware `getPrivacyNotice` exposes a
 *     gap (static `dataSource.args`) logged inline for
 *   - Neither skill is a manifest op (they're read-only info-skills,
 *     not chat/slash-callable per D.1 primary-flows discipline) —
 *     `dataSource.skillId` is a free string in validate.js so this
 *     is permitted and worth flagging
 *
 * Why `settings.html` (E.3)?
 *   Next-smallest-after-privacy + a clean fit: `getSettings({})`
 *     is param-free (perfect `dataSource` declaration) and the
 *     per-field mutations live outside the D.1 manifest as profile/
 *     plumbing skills (same gap #4 territory as privacy)
 *   Surfaces NEW signals: NavModel sections assume list-of
 *     items but settings is a SINGLETON record (one merged object);
 *     and the per-field "patch a setting" mutation model doesn't
 *     fit 's creative-verb add/register vocabulary. Both
 *     deferred to — see manifest views[] inline notes
 *   - Profile (591 lines — avatar resize / mnemonic / geocoding /
 *     backup, many runtime-arg skills) defers to a later slice
 *   - Contacts (417 lines, heavy mutations) defers to a later slice
 *
 * Other pages (chat / contacts / group / create-group / profile /
 * onboard / sign-in / auth-callback / push / restore / welcome /
 * metrics / index) DEFER to follow-on E.x slices.
 *
 * ──── This bootstrap vs `stoop-ui.js` / `stoop-testbed.js` ──────────
 *
 * `stoop-ui.js` and `stoop-testbed.js` are the production launchers —
 * they wire full skill-match + substrate-mirror + relay + multi-group.
 * THIS bootstrap is the **manifest-driven web smoke**: a minimal
 * single-actor stoop bundle that serves `/mine.html` via the NavModel.
 * Production launchers stay unchanged; this is the E.1 substrate proof
 * that doesn't disturb them.
 *
 * Returns (when used as a module via `startStoopWeb()`):
 *   { url, port, agent, bundle, stop, navModel }
 *
 * The CLI entry-point uses `startStoopWeb` with defaults and logs the
 * URL; the smoke test (`test/stoop-web.test.js`) imports
 * `startStoopWeb` directly so it can await + stop without shell-driven
 * lifecycle.
 *
 * Usage:
 *   node bin/stoop-web.js [--port 8080] [--actor https://id.example/anne]
 *                         [--group block-42]
 */
import { parseArgs }                              from 'node:util';
import { readFile }                               from 'node:fs/promises';
import { fileURLToPath }                          from 'node:url';
import { dirname, join }                          from 'node:path';
import { AgentIdentity, InternalBus, InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { mountLocalUi, LocalUiAuth }              from '@onderling/agent-ui';
import { renderWeb }                              from '@onderling/app-manifest';

import { stoopManifest }                           from '../manifest.js';
import { createNeighbourhoodAgent }                 from '../src/index.js';

const DEFAULT_ACTOR = 'https://id.example/anne';
const DEFAULT_GROUP = 'block-42';

/**
 * Start the stoop-web server.  Returns a handle the caller can use
 * to stop it cleanly (the smoke test does this).
 *
 * @param {object} [opts]
 * @param {number} [opts.port=0]      0 → OS picks a free port
 * @param {string} [opts.actor]       webid the LocalUiAuth claims
 * @param {string} [opts.group]       group id (single-group; testbed
 *                                    + multi-group are out of E.1 scope)
 */
export async function startStoopWeb(opts = {}) {
  const port  = opts.port  ?? 0;
  const actor = opts.actor ?? DEFAULT_ACTOR;
  const group = opts.group ?? DEFAULT_GROUP;

  const id        = await AgentIdentity.generate(new VaultMemory());
  const bus       = new InternalBus();
  const transport = new InternalTransport(bus, id.pubKey);

  // Minimal single-actor stoop bundle.  No skill-match peers, no
  // substrate mirror, no relay — this is the manifest-driven web smoke.
  // Production launchers (`stoop-ui.js`, `stoop-testbed.js`) wire the
  // full plumbing and are out of E.1 scope.
  const bundle = await createNeighbourhoodAgent({
    identity:  id,
    transport,
    label:     `stoop-web-${actor}`,
    members:   [{ webid: actor, displayName: actor.split('/').pop() || actor }],
    offeringMatch: {
      group,
      localActor: actor,
      peers:      [],
    },
  });
  await bundle.offeringMatch.start();

  // Pre-compute the NavModel from the manifest.  Static for the life
  // of the server (manifest is module-scope const).  E.1 + E.2 + E.3
  // ship THREE sections (`mine`, `privacy`, `settings`); follow-on
  // E.x will grow this.
  const navModel = renderWeb(stoopManifest);

  const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

  // adopt (2026-05-21) — overlay the shared `@onderling/web-adapter`
  // helpers at `/lib/web-adapter/<basename>.js`.  Same mechanism that
  // tasks-v0's `bin/tasks-ui.js` uses. Source-of-truth
  // lives in `packages/web-adapter/src/`; this overlay re-routes the
  // helpers through `extraStaticFiles` so `mine.html`'s `<script
  // type="module">` can `import` them at runtime without bundling.
  const webAdapterFiles = await loadWebAdapterFiles();

  const ui = await mountLocalUi(bundle.agent, {
    port,
    staticDir:        webDir,
    a2aTLSLayer:      new LocalUiAuth({ localActor: actor }),
    extraStaticFiles: {
      '/navmodel.json':      JSON.stringify(navModel),
      // expose the raw manifest for T2 pages that
      // need ops the NavModel projection doesn't carry (e.g. session-
      // scoped ops with no view surface like signOutOfPod).
      // Pre- only /navmodel.json was served; T2 pages had to
      // hardcode confirm messages. With /stoop-manifest.json,
      // createOpBinding({manifest}) can resolve any declared op.
      '/stoop-manifest.json': JSON.stringify(stoopManifest),
      '/stoop-config.json':  JSON.stringify({ actor, group, app: navModel.app }),
      // One entry: the switcher dropdown still hides (mountGroupSwitcher
      // hides at length<=1) but the client now KNOWS the active group —
      // mirrors stoop-ui.js's single-group `groups.json` shape so the
      // existing app.js helpers stay happy.
      '/groups.json':        JSON.stringify([{ groupId: group }]),
      ...webAdapterFiles,
    },
  });

  return {
    url:   ui.url,
    port:  ui.port,
    agent: bundle.agent,
    bundle,
    navModel,
    async stop() {
      try { await bundle.offeringMatch.stop(); } catch { /* swallow */ }
      await ui.stop();
    },
  };
}

/**
 * Read `packages/web-adapter/src/*.js` from disk and return them keyed
 * by their `/lib/web-adapter/<basename>` overlay path.  Mirrors the
 * helper in `apps/tasks-v0/bin/tasks-ui.js`; kept inline
 * here rather than refactored into a shared utility to keep stoop's
 * bootstrap self-contained.
 */
async function loadWebAdapterFiles() {
  const root = join(
    dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..',
    'packages', 'web-adapter', 'src',
  );
  const names = [
    'callSkill.js',
    'deriveItemState.js',
    'itemMatchesAppliesTo.js',
    'applyPrefilledParams.js',
    'fetchSectionItems.js',
    'schemaToFormFields.js',
    // T2-tier helper. Pages that read the
    // manifest for confirm + labelKey resolution import via
    // /lib/web-adapter/createOpBinding.js.
    'createOpBinding.js',
    'index.js',
  ];
  const out = {};
  for (const n of names) {
    out[`/lib/web-adapter/${n}`] = await readFile(join(root, n), 'utf8');
  }
  return out;
}

// ── CLI entry ─────────────────────────────────────────────────────────
const isMain = fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { values } = parseArgs({
    options: {
      port:  { type: 'string' },
      actor: { type: 'string' },
      group: { type: 'string' },
    },
  });

  const port  = values.port ? Number(values.port) : 0;
  const actor = values.actor ?? DEFAULT_ACTOR;
  const group = values.group ?? DEFAULT_GROUP;

  const handle = await startStoopWeb({ port, actor, group });
  console.log(`Stoop web UI (Slice E.1 + E.2 + E.3) ready at ${handle.url}`);
  console.log(`  actor:    ${actor}`);
  console.log(`  group:    ${group}`);
  console.log(`  app:      ${handle.navModel.app}`);
  console.log(`  sections: ${handle.navModel.sections.map((s) => s.id).join(', ')}`);
  console.log(`  ⚠  E.1+E.2+E.3 surface /mine.html + /privacy.html + /settings.html via the NavModel.`);
  console.log(`     Other pages still load (legacy hand-built); their migration`);
  console.log(`     is follow-on E.x scope (13 pages remaining).`);

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);
  async function shutdown() {
    console.log('\nShutting down…');
    await handle.stop();
    process.exit(0);
  }
}
