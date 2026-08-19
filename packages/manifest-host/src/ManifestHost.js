/**
 * `@onderling/manifest-host` — runtime composition of N app-manifests.
 *
 * V0 substrate (locked 2026-05-20). Owns the *runtime* side of the
 * manifest model: accept manifests via `mount()`, hand back a composed
 * view that merges across all mounted apps with `appId.opId` namespacing.
 *
 *   createManifestHost() → Host
 *     host.mount(appId, manifest, { skillRegistry, toSkillCtx,
 *                                   onStateUpdates? }) → MountedApp
 *     host.unmount(appId)                              → void
 *     host.list()                                       → string[]
 *     host.compose()                                    → ComposedView
 *
 * Composed view (everything namespaced; collisions detected, not resolved):
 *   {
 *     toolCatalogue:        [{id:"appId.opId", description, schema}],
 *     toolHandlers:       {"appId.opId": handler},
 *     commandMenu:        [{command, description, appId}],
 *     collisions:         [{command, appIds: string[]}],
 *     inlineKeyboardFor:  (item) → buttons (callbackData re-prefixed),
 *     perAppSystemPrompts:{appId: systemPrompt},
 *   }
 *
 * Discipline:
 *   - Pure substrate.  No app imports.  No state outside the host instance.
 *   - `mount()` validates the manifest before accepting it; an invalid
 *     manifest throws (caller bug, fail loud).
 *   - `appId` must not contain `.` or `:` (would alias namespacing or
 *     `callbackData` split).
 *   - `compose()` rebuilds from current mounts every call (runtime
 *     mount/unmount works without cache invalidation chores).
 *   - The host does NOT pick a winner for command collisions; surfacing
 *     them as data lets the consumer decide policy (prefix-all,
 *     first-mounted-wins, per-host config, LLM-disambiguate).
 *   - The host does NOT concatenate systemPrompts; consumer picks
 *     composition strategy (concat / pick primary / generic preamble).
 *
 * What this V0 does NOT do (deferred to):
 *   Generalising tasks-v0's multi-circle machinery (`bundleResolver`,
 *     `wireSkills`, `CircleState`) through the host.  That touches 542
 *     production tests and needs its own characterization gate.
 *   - Per-scope enabled-set persistence ("which apps are on for this
 *     circle").  Mount is API-driven for V0; persistence wires later.
 */

import { renderChat, validateManifest } from '@onderling/app-manifest';

/** @returns {Host} */
export function createManifestHost() {
  /** @type {Map<string, MountedApp>} */
  const mounts = new Map();

  /** @type {Host} */
  const host = {
    mount(appId, manifest, opts) {
      assertAppId(appId);
      if (mounts.has(appId)) {
        throw new Error(`mount: appId "${appId}" already mounted`);
      }
      const { ok, errors } = validateManifest(manifest);
      if (!ok) {
        throw new Error(
          `mount: invalid manifest for "${appId}": ${JSON.stringify(errors)}`,
        );
      }
      if (!opts || typeof opts !== 'object') {
        throw new Error('mount: opts required ({skillRegistry, toSkillCtx})');
      }
      // renderChat enforces skillRegistry+toSkillCtx; let it throw on its
      // own contract.
      const rendered = renderChat(manifest, opts);
      /** @type {MountedApp} */
      const mounted = { appId, manifest, rendered };
      mounts.set(appId, mounted);
      return mounted;
    },

    unmount(appId) {
      assertAppId(appId);
      mounts.delete(appId);
    },

    list() {
      return Array.from(mounts.keys());
    },

    // The mounted manifests in mount-insertion order — the composed set the
    // host is running.  Used by `createGate` to project the deterministic
    // token-gate from the host's manifests (renderGate needs the raw manifests,
    // not the rendered/namespaced compose() view).
    manifests() {
      return Array.from(mounts.values()).map((m) => m.manifest);
    },

    compose() {
      return composeMounts(mounts);
    },
  };

  return host;
}

/* ─── internals ──────────────────────────────────────────────────────── */

function assertAppId(appId) {
  if (typeof appId !== 'string' || appId.length === 0) {
    throw new Error('appId must be a non-empty string');
  }
  if (appId.includes('.') || appId.includes(':')) {
    throw new Error(
      `appId "${appId}" must not contain "." or ":" (collides with ` +
      `tool-id and callbackData namespacing)`,
    );
  }
}

/**
 * Rebuild the composed view from current mounts (no cache).  Deterministic:
 * mount-insertion order drives output order (Map preserves insertion).
 */
function composeMounts(mounts) {
  const toolCatalogue  = [];
  const toolHandlers = {};
  const commandMenu  = [];
  const perAppSystemPrompts = {};

  // Track command → [appIds] for collision detection.
  /** @type {Map<string, string[]>} */
  const commandIndex = new Map();

  for (const [appId, m] of mounts) {
    const { rendered } = m;

    for (const t of rendered.toolCatalogue) {
      toolCatalogue.push({
        id:          `${appId}.${t.id}`,
        description: t.description,
        schema:      t.schema,
      });
    }

    for (const opId of Object.keys(rendered.toolHandlers)) {
      toolHandlers[`${appId}.${opId}`] = rendered.toolHandlers[opId];
    }

    for (const entry of rendered.commandMenu) {
      commandMenu.push({
        command:     entry.command,
        description: entry.description,
        appId,
      });
      const arr = commandIndex.get(entry.command) ?? [];
      arr.push(appId);
      commandIndex.set(entry.command, arr);
    }

    perAppSystemPrompts[appId] = rendered.systemPrompt;
  }

  /** @type {Array<{command: string, appIds: string[]}>} */
  const collisions = [];
  for (const [command, appIds] of commandIndex) {
    if (appIds.length > 1) collisions.push({ command, appIds });
  }

  /**
   * Aggregate inlineKeyboardFor across all mounts; re-prefix `callbackData`
   * with `<appId>.` so the leading segment up to `:` is `appId.opId`.
   * Iteration order = mount-insertion order, so a household task in one
   * app and a tasks-v0 task in another both surface their buttons in
   * deterministic order.
   */
  const inlineKeyboardFor = (item) => {
    const out = [];
    for (const [appId, m] of mounts) {
      const perApp = m.rendered.inlineKeyboardFor(item);
      for (const b of perApp) {
        // Per-app callbackData is `<opId>:<itemId>`; prefix the opId half.
        const sepIdx = b.callbackData.indexOf(':');
        const prefixed = sepIdx >= 0
          ? `${appId}.${b.callbackData.slice(0, sepIdx)}:${b.callbackData.slice(sepIdx + 1)}`
          : `${appId}.${b.callbackData}`;
        out.push({ label: b.label, callbackData: prefixed });
      }
    }
    return out;
  };

  return {
    toolCatalogue,
    toolHandlers,
    commandMenu,
    collisions,
    inlineKeyboardFor,
    perAppSystemPrompts,
  };
}

/* ─── typedefs ───────────────────────────────────────────────────────── */

/**
 * @typedef {object} MountedApp
 * @property {string} appId
 * @property {object} manifest
 * @property {object} rendered  // renderChat() output
 */

/**
 * @typedef {object} Host
 * @property {(appId: string, manifest: object, opts: object) => MountedApp} mount
 * @property {(appId: string) => void} unmount
 * @property {() => string[]} list
 * @property {() => object[]} manifests
 * @property {() => object} compose
 */
