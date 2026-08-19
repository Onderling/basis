/**
 * basis — manifest merge (thin shim over @onderling/manifest-host).
 *
 * The merge logic lives in `@onderling/manifest-host` (substrate).
 * This file is a basis-shaped projection over that substrate:
 *
 *   - `host.compose()` produces a generic composed view with
 *     `appId.opId` namespacing + structured `collisions` data.
 *   - basis's parser + router + dispatch consume a SHAPE with
 *     `commandMenu: [{command, opId, appOrigin}]`, `opsById:
 *     Map<opId, {op, appOrigin}>`, `replyShapeFor(opId)`, and
 *     `warnings`.  This shim translates the substrate's output into
 *     that shape so the existing consumers don't churn.
 *
 * Architectural choice (per substrate-reuse audit 2026-05-22, see
 * `Project Files/basis/coding-plan.md` § Substrate-reuse gate):
 *   - Use the substrate underneath (composition + collision detection
 *     are its job; we don't reinvent).
 *   - Keep the basis-shaped projection (`opsById`,
 *     `replyShapeFor`) because manifest-host's output is generic;
 *     basis's consumers expect richer per-op lookups.
 *
 * Phase v0.1 (original) → v0.3.4 substrate-reuse
 * refactor 2026-05-22.
 */

import { validateManifest }   from '@onderling/app-manifest';
import { createManifestHost, resolveSlash } from '@onderling/manifest-host';
import { synthesizeGenericOps } from './genericOpSynth.js';

/**
 * @typedef {object} MergedCatalogue
 * @property {Array<{ command: string, opId: string, appOrigin: string }>} commandMenu
 * @property {Map<string, { op: object, appOrigin: string }>}              opsById
 * @property {(opId: string) => string | undefined}                        replyShapeFor
 * @property {(opId: string) => Array<{opId: string, prefilledArgs?: object}> | undefined} followUpsFor
 * @property {string[]}                                                    appOrigins
 * @property {string[]}                                                    warnings
 */

/**
 * @typedef {object} MergeOptions
 * @property {'browser' | 'node' | 'both'} [runtime='both']
 *   Filters out ops whose `op.runtime` doesn't match this runtime.
 *   - 'browser' → keeps ops with runtime 'browser' or 'both'; drops 'node'
 *   - 'node'    → keeps 'node' or 'both'; drops 'browser'
 *   - 'both'    → no filtering (default)
 *   Per OQ-1.A: basis in the browser passes 'browser' so folio's
 *   sync/watch family (runtime: 'node') stays out of the catalogue.  A
 *   future sidecar deployment passes 'both' to re-include them.
 * @property {Object<string,string>} [slashOverrides]
 *   Objective D — per-host slash-collision WINNER pins (`command → appId`;
 *   keys bare `'done'` or slash-prefixed `'/done'`). For a command declared by
 *   ≥2 apps, the bare token resolves to the pinned app; the losers stay
 *   reachable via their app-qualified form (`/tasks:done`). Absent a pin, a
 *   colliding bare token is surfaced as AMBIGUOUS (offer the choices) rather
 *   than silently firing the first declarer.  Inert when no command collides.
 */

/**
 * Merge an array of `{manifest, callSkill?}` pairs into a basis
 * catalogue.  Composes `@onderling/manifest-host` underneath.
 *
 * Op-prefix-on-collision policy:
 *   - When op-ids are unique across all manifests, the catalogue uses
 *     bare opIds (`'markComplete'`).
 *   - When ≥2 manifests declare the SAME opId, the second-and-later
 *     declarations surface in `opsById` as `'<appOrigin>/<opId>'`
 *     (`'tasks-v0/markComplete'`).  The FIRST declaration keeps the
 *     bare form (no churn for solo apps).
 *   - Slash collisions (a command declared by ≥2 apps) follow the
 *     Objective-D policy: prefix-all + per-host override.  Every declarer
 *     gets an app-qualified command (`/tasks:done`, `/stoop:done`) in the
 *     commandMenu; the BARE token resolves to the `slashOverrides` winner if
 *     pinned, else the bare entry is marked `{ambiguous, choices}` (the parser
 *     surfaces the choices instead of firing one app).  Non-colliding commands
 *     keep the bare form unchanged — in practice apps coordinate slash names,
 *     so this whole pass is inert (no collisions → no qualified forms added).
 *     The resolution is exposed as `catalogue.slashPolicy` (from
 *     `@onderling/manifest-host`'s `resolveSlash`).
 *
 * @param {Array<{ manifest: object, callSkill?: Function }>} sources
 * @param {MergeOptions} [opts]
 * @returns {MergedCatalogue}
 */
export function mergeManifests(sources, opts = {}) {
  if (!Array.isArray(sources)) {
    throw new TypeError('mergeManifests: sources must be an array');
  }
  const wantRuntime = opts.runtime ?? 'both';

  const host        = createManifestHost();
  const warnings    = [];
  const opsById     = new Map();          // canonical key (bare or prefixed)
  const replyShape  = new Map();
  const followUps   = new Map();
  const embedSnapshot = new Map();
  const briefDecls    = new Map();        // v0.7 — canonicalKey → {summarySkill, order?, label?, appOrigin}
  const searchDecls   = new Map();        // v0.7.5 — canonicalKey → {searchSkill, appOrigin}
  const appOrigins  = [];
  /** @type {object[]} manifests that mounted OK — replayed in the §1b synthetic-op pass below. */
  const mountedManifests = [];
  /** @type {Map<string, string>} command → first-mounting appId */
  const commandOwner = new Map();
  const commandMenu = [];
  // Objective D — EVERY declarer of a slash command (not just the first-wins
  // winner), so the post-pass can detect collisions and project the qualified
  // forms. command → [{opId, appOrigin, body?}], in mount/declaration order.
  /** @type {Map<string, Array<{opId:string, appOrigin:string, body?:string}>>} */
  const commandDeclarers = new Map();
  const recordDeclarer = (command, opId, appOrigin, body) => {
    const arr = commandDeclarers.get(command) ?? [];
    arr.push(body ? { opId, appOrigin, body } : { opId, appOrigin });
    commandDeclarers.set(command, arr);
  };

  // Pre-pass 1: collect bare op-ids per app + identify collisions
  // across apps so we can apply prefix-on-collision in a second pass.
  /** @type {Map<string, Set<string>>} opId → set of appOrigins declaring it */
  const opIdAppearances = new Map();
  for (const source of sources) {
    const m = source?.manifest;
    if (!m || typeof m !== 'object') continue;
    for (const op of m.operations ?? []) {
      if (!opIdAppearances.has(op.id)) opIdAppearances.set(op.id, new Set());
      opIdAppearances.get(op.id).add(m.app);
    }
  }
  /** @type {Map<string, string>} opId → the app that "owns" the bare form (first declarer) */
  const bareOwner = new Map();

  for (const source of sources) {
    const m = source?.manifest;
    if (!m || typeof m !== 'object') {
      warnings.push('mergeManifests: skipping source with no manifest');
      continue;
    }

    const { ok, errors } = validateManifest(m);
    if (!ok) {
      throw new Error(
        `mergeManifests: invalid manifest from "${m.app}": ${JSON.stringify(errors)}`,
      );
    }

    const stub = {};
    for (const op of m.operations ?? []) {
      stub[op.id] = async () => ({ replies: [], stateUpdates: [] });
    }

    let mounted;
    try {
      mounted = host.mount(m.app, m, {
        skillRegistry: stub,
        toSkillCtx:    (c) => c,
      });
    } catch (err) {
      if (/already mounted/.test(String(err?.message))) {
        warnings.push(
          `app collision: "${m.app}" mounted twice; v0.1 keeps the first.`,
        );
        continue;
      }
      throw err;
    }

    appOrigins.push(m.app);
    mountedManifests.push(m);

    for (const op of m.operations ?? []) {
      // runtime filter — drop ops that don't run in our runtime.
      if (!matchesRuntime(op.runtime ?? 'both', wantRuntime)) continue;

      // commandMenu: first-wins by slash command (bare commands).
      // `standaloneOnly` slashes are deliberately NOT contributed to the unified
      // catalogue — they exist for the app's OWN standalone surface (bot / byte-
      // equivalence) but defer to the shell's equivalent in a merged circle
      // (e.g. household's /help → the basis shell's global /help, which
      // already introspects every app). Skipped here = no collision, no warning.
      if (op?.surfaces?.slash?.command && !op.surfaces.slash.standaloneOnly) {
        const command = op.surfaces.slash.command;
        // Objective D — record EVERY declarer (winner + losers) so the
        // post-pass can project qualified forms + apply the collision policy.
        recordDeclarer(command, op.id, m.app, op.surfaces.slash.body);
        const owner   = commandOwner.get(command);
        if (owner && owner !== m.app) {
          warnings.push(
            `slash collision: "${command}" declared by both "${owner}" and "${m.app}"; v0.1 keeps the first.`,
          );
        } else {
          commandOwner.set(command, m.app);
          // 2026-05-23 bug-fix: forward the `body` rule (match/flags/
          // reject) so the parser picks parseFlags for canonical
          // flag-body ops like /brief / /addtask / /find etc.
          const entry = { command, opId: op.id, appOrigin: m.app };
          if (op.surfaces.slash.body) entry.body = op.surfaces.slash.body;
          commandMenu.push(entry);
        }
      }

      // Op-id prefix-on-collision: when multiple apps declare the
      // same op id, only the FIRST app gets the bare key; the rest
      // get '<app>/<id>' keys so dispatch is unambiguous.
      const isColliding = (opIdAppearances.get(op.id)?.size ?? 0) > 1;
      let canonicalKey;
      if (!isColliding) {
        canonicalKey = op.id;
      } else if (!bareOwner.has(op.id)) {
        canonicalKey = op.id;
        bareOwner.set(op.id, m.app);
      } else {
        canonicalKey = `${m.app}/${op.id}`;
        // Surface the policy decision as a warning so consumers can
        // see which ops became prefixed.
        warnings.push(
          `op-id collision: "${op.id}" also declared by "${m.app}"; basis exposes it as "${canonicalKey}".`,
        );
      }
      opsById.set(canonicalKey, { op, appOrigin: m.app });

      // lookups from the substrate's renderChat output.
      const shape = mounted.rendered.replyShapeFor?.(op.id);
      if (shape) replyShape.set(canonicalKey, shape);

      const fu = mounted.rendered.followUpsFor?.(op.id);
      if (Array.isArray(fu) && fu.length > 0) followUps.set(canonicalKey, fu);

      // (v0.5) embed snapshot skill lookup.
      const skill = mounted.rendered.embedSnapshotFor?.(op.id);
      if (skill) embedSnapshot.set(canonicalKey, { snapshotSkill: skill, appOrigin: m.app });

      // (v0.7) brief summary skill lookup.
      const brief = mounted.rendered.briefFor?.(op.id);
      if (brief) briefDecls.set(canonicalKey, { ...brief, appOrigin: m.app });

      // (v0.7.5) search-skill lookup.
      const searchSkill = mounted.rendered.searchFor?.(op.id);
      if (searchSkill) searchDecls.set(canonicalKey, { searchSkill, appOrigin: m.app });
    }
  }

  // §1b — SYNTHETIC ops for GENERIC (op-less) capabilities.
  // "Declare a noun → get CRUD free": a manifest can declare a noun with CRUD atoms and NO implementing
  // op. `synthesizeGenericOps` turns each such op-less capability into a synthetic op (id encodes
  // `(app, atom, noun)` via `encodeGenericOpId`) so the EXISTING projectors (renderSlash /
  // buildToolDescriptors) and the op-keyed gate carry it unchanged. ADDITIVE, run AFTER all real ops so
  // real ops always win command-ownership — and it NEVER shadows a real op-id (the `__generic__:` prefix
  // can't collide, and `synthesizeGenericOps` already drops any capability a bespoke op implements).
  for (const m of mountedManifests) {
    for (const synthOp of synthesizeGenericOps(m)) {
      // Runtime filter for parity with real ops (synthetic ops are runtime-agnostic → always kept).
      if (!matchesRuntime(synthOp.runtime ?? 'both', wantRuntime)) continue;
      // Guard: never shadow a real op already in the catalogue (belt-and-braces — ids can't collide).
      if (opsById.has(synthOp.id)) continue;

      // commandMenu: first-wins by slash command (real ops already claimed theirs above).
      const command = synthOp.surfaces?.slash?.command;
      if (command && !synthOp.surfaces.slash.standaloneOnly) {
        recordDeclarer(command, synthOp.id, m.app, synthOp.surfaces.slash.body);
        const owner = commandOwner.get(command);
        if (owner && owner !== m.app) {
          warnings.push(
            `slash collision: "${command}" declared by both "${owner}" and "${m.app}"; v0.1 keeps the first.`,
          );
        } else {
          commandOwner.set(command, m.app);
          commandMenu.push({ command, opId: synthOp.id, appOrigin: m.app });
        }
      }

      opsById.set(synthOp.id, { op: synthOp, appOrigin: m.app });
    }
  }

  // Objective D — slash-collision policy (prefix-all + per-host override).
  // Build the collision list (a command declared by ≥2 DISTINCT apps) and run
  // the pure resolver.  Fully ADDITIVE + dormant when nothing collides: apps
  // coordinate slash names, so `collisions` is empty in production and the
  // commandMenu is byte-unchanged.
  const collisions = [];
  for (const [command, decls] of commandDeclarers) {
    const appIds = [...new Set(decls.map((d) => d.appOrigin))];
    if (appIds.length > 1) collisions.push({ command, appIds });
  }
  const slashPolicy = resolveSlash(collisions, opts.slashOverrides ?? {});
  for (const entry of slashPolicy.entries) {
    const decls = commandDeclarers.get(entry.command) ?? [];
    const declFor = (appId) => decls.find((d) => d.appOrigin === appId);
    // Qualified forms — one per declarer, ALWAYS available (prefix-all).
    for (const q of entry.qualified) {
      const d = declFor(q.appId);
      if (!d) continue;
      const qEntry = { command: q.command, opId: d.opId, appOrigin: d.appOrigin };
      if (d.body) qEntry.body = d.body;
      commandMenu.push(qEntry);
    }
    // Bare token — the winner (override) or ambiguous-with-choices.
    const idx = commandMenu.findIndex((e) => e.command === entry.command);
    if (idx < 0) continue;
    if (entry.bare.status === 'winner') {
      const d = declFor(entry.bare.appId);
      if (d) {
        const winEntry = { command: entry.command, opId: d.opId, appOrigin: d.appOrigin };
        if (d.body) winEntry.body = d.body;
        commandMenu[idx] = winEntry;
      }
    } else {
      // Ambiguous: strip the silently-fired opId; carry the qualified choices
      // so the parser returns kind:'ambiguous' and the shell offers them.
      // Keep an `appOrigin` (the first declarer) purely so the entry survives
      // catalogue scoping/filtering (which key on appOrigin) — it is NEVER used
      // to dispatch (the missing opId + `ambiguous` flag block that).
      commandMenu[idx] = {
        command: entry.command,
        ambiguous: true,
        appOrigin: entry.appIds[0],
        appIds: entry.appIds,
        choices: entry.qualified.map((q) => ({ command: q.command, appId: q.appId })),
      };
    }
  }

  return {
    commandMenu,
    slashPolicy,
    opsById,
    replyShapeFor:    (opId) => replyShape.get(opId),
    followUpsFor:     (opId) => followUps.get(opId),
    embedSnapshotFor: (opId) => embedSnapshot.get(opId),
    briefFor:         (opId) => briefDecls.get(opId),
    searchFor:        (opId) => searchDecls.get(opId),
    // v0.7 — flattened brief decls, order-sorted, for /brief fan-out.
    briefAggregations: () => [...briefDecls.entries()]
      .map(([opId, decl]) => ({ opId, ...decl }))
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
    // v0.7.5 — flattened search decls for /find fan-out.
    searchAggregations: () => [...searchDecls.entries()]
      .map(([opId, decl]) => ({ opId, ...decl })),
    appOrigins,
    warnings,
  };
}

/**
 * runtime filter — does an op's declared runtime match the
 * environment the chat shell is composing for?
 *
 * @param {'browser' | 'node' | 'both'} opRuntime
 * @param {'browser' | 'node' | 'both'} wantRuntime
 * @returns {boolean}
 */
function matchesRuntime(opRuntime, wantRuntime) {
  if (wantRuntime === 'both') return true;
  if (opRuntime === 'both')   return true;
  return opRuntime === wantRuntime;
}
