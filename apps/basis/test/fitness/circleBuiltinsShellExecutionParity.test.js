/**
 * FITNESS — every circle-composer built-in the classifier recognises is actually EXECUTED in BOTH shells.
 *
 * `CIRCLE_BUILTIN_COMMANDS` (circleComposerBuiltins.js) is the one shared list both composers use to intercept
 * a slash command as a built-in instead of routing it to the bot. The sibling test
 * (`circleBuiltinsManifestParity`) pins the classifier to the MANIFEST. What was UNPINNED — and what let a real
 * bug through — is the classifier ↔ per-shell EXECUTION agreement: a command can be classified and yet have no
 * handler branch in one shell, so it silently falls through to the bot/feedback path on that platform only.
 *
 * That is exactly what happened: mobile classified `/security-status` (it is in the shared list) but its circle
 * composer had no branch, so on mobile `/security-status` misrouted to the bot while web answered it — a
 * web≢mobile drift (invariant #2). The manifest-parity guard missed it because it checks classifier↔manifest,
 * not whether each shell actually runs the command.
 *
 * This pins it structurally: every command in `CIRCLE_BUILTIN_COMMANDS` must have an `opId === '<cmd>'`
 * execution branch in BOTH composer sources. Add a command to the shared list and forget to wire one shell →
 * this fails naming the shell. (Deliberately a source-text check: the composers live in screen/shell files that
 * have no unit-test harness, which is why the drift was invisible. If a shell is refactored to dispatch these
 * through a table instead of explicit branches, update this guard to match that shape.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { CIRCLE_BUILTIN_COMMANDS, parseCircleBuiltin } from '../../src/v2/circleComposerBuiltins.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The two composer shells that must both intercept + run every built-in (invariants #1/#2). */
const SHELLS = [
  { name: 'web (circleApp.js)', path: 'apps/basis/web/v2/circleApp.js' },
  { name: 'mobile (CircleLauncherScreen.js)', path: 'apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js' },
];

describe('FITNESS: circle-composer built-ins are EXECUTED in both shells (invariant #2)', () => {
  for (const shell of SHELLS) {
    it(`${shell.name} has an execution branch for every built-in command`, () => {
      const src = readFileSync(resolve(repoRoot, shell.path), 'utf8');
      const missing = CIRCLE_BUILTIN_COMMANDS.filter((cmd) => {
        // The classifier maps the command to its opId; the shell dispatches on `opId === '<opId>'`.
        const opId = parseCircleBuiltin(`/${cmd}`)?.opId ?? cmd;
        return !src.includes(`=== '${opId}'`);
      });
      expect(
        missing,
        `classified but NOT handled in ${shell.name} — these fall through to the bot on this platform `
        + `(add the "opId === '<cmd>'" branch in that composer, or drop the command from `
        + `CIRCLE_BUILTIN_COMMANDS): ${missing.join(', ')}`,
      ).toEqual([]);
    });
  }
});
