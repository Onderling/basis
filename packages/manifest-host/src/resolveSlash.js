/**
 * `resolveSlash` — the slash-collision POLICY resolver (Objective D).
 *
 * `ManifestHost.compose()` DETECTS command collisions (`collisions:
 * [{command, appIds}]`) but deliberately does NOT pick a winner — it surfaces
 * them as data so the consumer decides policy. This is that policy, made pure
 * and reusable: **prefix-all + per-host override.**
 *
 *   - **prefix-all (default):** a colliding command is ambiguous as a bare
 *     token, so the canonical way to invoke it is the APP-QUALIFIED form
 *     (`/tasks:done`, `/pinboard:done`) — always available for EVERY declarer.
 *     The bare token (`/done`) resolves to the per-host override winner if one
 *     is pinned, else it is surfaced as AMBIGUOUS (offer the qualified choices)
 *     rather than silently firing one app.
 *   - **per-host override:** a host/circle pins a winner for a specific
 *     command via `overrides` (e.g. `{ done: 'tasks' }`); the bare token then
 *     resolves to that app, and the others stay reachable via their qualified
 *     form.
 *
 * Non-colliding commands are NOT the resolver's concern — it only ever returns
 * data for the commands present in `collisions`. A caller leaves every
 * non-colliding command exactly as it was.
 *
 * Pure: no I/O, no state, deterministic. Qualified forms preserve the mount
 * order of `appIds` (which `compose()` already fixes).
 *
 *   resolveSlash(collisions, overrides) → {
 *     entries:   [{ command, appIds, qualified:[{command,appId,base}], bare }],
 *     qualified: [{ command, appId, base }],   // flattened, all commands
 *     winners:   { '<command>': '<appId>' },   // only pinned + valid overrides
 *     ambiguous: { '<command>': [appId,…] },   // only where no valid winner
 *     isCollision:(command)=>boolean,
 *     bareFor:    (command)=>bareResolution|null,
 *   }
 *
 * `bare` per entry is one of:
 *   { status: 'winner',    appId }              // an override pinned a winner
 *   { status: 'ambiguous', choices:[appId,…] }  // prefix-all fallthrough
 *
 * The qualified command form is `/<appId>:<bareToken>` — the `:` is safe
 * because `ManifestHost` forbids `:` (and `.`) in an appId, so a split on the
 * first `:` recovers `(appId, bareToken)` unambiguously.
 *
 * @param {Array<{command:string, appIds:string[]}>} collisions
 *   the `collisions` array from `ManifestHost.compose()` (or any equivalent).
 * @param {Object<string,string>} [overrides]
 *   per-host winner pins, `command → appId`. Keys may be given bare (`done`)
 *   or slash-prefixed (`/done`); both match a `/done` collision.
 * @returns {object} the resolution (shape above).
 */
export function resolveSlash(collisions, overrides = {}) {
  const list = Array.isArray(collisions) ? collisions : [];
  const overrideMap = normalizeOverrides(overrides);

  const entries   = [];
  const qualified = [];
  const winners   = {};
  const ambiguous = {};

  for (const c of list) {
    if (!c || typeof c.command !== 'string' || !Array.isArray(c.appIds)) continue;
    if (c.appIds.length < 2) continue;   // not actually a collision

    const command = c.command;
    const base    = bareToken(command);
    const appIds  = c.appIds.slice();

    // Qualified forms: one per declarer, always available (prefix-all).
    const q = appIds.map((appId) => ({
      command: qualify(appId, base),
      appId,
      base,
    }));
    qualified.push(...q);

    // Bare-token resolution: an override winner (if pinned AND a real declarer),
    // else ambiguous with the qualified choices.
    const pinned = overrideMap.get(base);
    let bare;
    if (pinned && appIds.includes(pinned)) {
      bare = { status: 'winner', appId: pinned };
      winners[command] = pinned;
    } else {
      bare = { status: 'ambiguous', choices: appIds };
      ambiguous[command] = appIds;
    }

    entries.push({ command, appIds, qualified: q, bare });
  }

  const byCommand = new Map(entries.map((e) => [e.command, e]));

  return {
    entries,
    qualified,
    winners,
    ambiguous,
    /** Is `command` (bare or slash-prefixed) a detected collision? */
    isCollision: (command) => byCommand.has(normalizeCommand(command)),
    /** The bare-token resolution for `command`, or null if it isn't a collision. */
    bareFor: (command) => byCommand.get(normalizeCommand(command))?.bare ?? null,
  };
}

/* ─── internals ──────────────────────────────────────────────────────── */

/** Strip a single leading '/' — '/done' → 'done', 'done' → 'done'. */
function bareToken(command) {
  return command.startsWith('/') ? command.slice(1) : command;
}

/** '/done' ↔ 'done' → the slash-prefixed canonical command '/done'. */
function normalizeCommand(command) {
  const s = String(command ?? '');
  return s.startsWith('/') ? s : `/${s}`;
}

/** Build the app-qualified command: (appId 'tasks', base 'done') → '/tasks:done'. */
function qualify(appId, base) {
  return `/${appId}:${base}`;
}

/** Normalize the overrides map to a `bareToken → appId` lookup (accepts '/done' keys). */
function normalizeOverrides(overrides) {
  const map = new Map();
  if (overrides && typeof overrides === 'object') {
    for (const [key, appId] of Object.entries(overrides)) {
      if (typeof appId !== 'string' || !appId) continue;
      map.set(bareToken(String(key)), appId);
    }
  }
  return map;
}
