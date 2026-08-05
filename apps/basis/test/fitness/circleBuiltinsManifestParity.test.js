/**
 * FITNESS — the shared circle-composer built-in classifier stays in agreement with the manifest.
 *
 * `CIRCLE_BUILTIN_COMMANDS` (circleComposerBuiltins.js) is the ONE shared list both shells use to intercept
 * `/settings`, `/set-relay`, `/transport-mode`, `/transports`, `/security-status` as built-ins instead of
 * routing them to the bot. Its own contract (that file's header) is: *"Names match the
 * `surfaces.slash.command` (sans leading `/`) on the basis manifest ops."* That agreement was UNPINNED —
 * nothing failed if the classifier recognised a command the manifest never declared (a slash surface only
 * the shells know), or if a manifest slash op was renamed out from under the classifier. Both are exactly
 * invariant #4 ("the manifest is the source of truth for surfaces") drift. This pins the agreement: change
 * one, this fails until you change the other.
 *
 * Note this is deliberately the WEAK direction (`builtins ⊆ manifest slash ops`) — the manifest has many
 * slash ops that are NOT circle/transport built-ins, so the reverse is not an equality.
 */
import { describe, it, expect } from 'vitest';

import { basisManifest } from '../../manifest.js';
import { CIRCLE_BUILTIN_COMMANDS, parseCircleBuiltin } from '../../src/v2/circleComposerBuiltins.js';

/** The slash commands the basis manifest declares, sans leading '/'. */
const manifestSlashCommands = new Set(
  (basisManifest.operations ?? [])
    .map((op) => op?.surfaces?.slash?.command)
    .filter((c) => typeof c === 'string' && c.startsWith('/'))
    .map((c) => c.slice(1)),
);

describe('FITNESS: circle-composer built-ins ↔ manifest slash surfaces (invariant #4)', () => {
  it('every CIRCLE_BUILTIN_COMMANDS command is a real basis manifest slash op', () => {
    const orphans = CIRCLE_BUILTIN_COMMANDS.filter((cmd) => !manifestSlashCommands.has(cmd));
    expect(
      orphans,
      `built-in commands the classifier recognises but the manifest does not declare as a slash op `
      + `(add the op to manifest.js, or drop it from CIRCLE_BUILTIN_COMMANDS): ${orphans.join(', ')}`,
    ).toEqual([]);
  });

  it('the classifier round-trips each command to the matching op id', () => {
    for (const cmd of CIRCLE_BUILTIN_COMMANDS) {
      const parsed = parseCircleBuiltin(`/${cmd}`);
      expect(parsed, `/${cmd} must classify as a built-in`).toBeTruthy();
      // The classifier's opId is the command name; by the file's contract that IS the manifest op whose
      // slash surface is `/${cmd}` — assert such an op exists and its id agrees.
      const op = (basisManifest.operations ?? []).find((o) => o?.surfaces?.slash?.command === `/${cmd}`);
      expect(op, `/${cmd} has a manifest slash op`).toBeTruthy();
      expect(parsed.opId, `/${cmd} classifier opId agrees with the manifest op id`).toBe(op.id);
    }
  });
});
