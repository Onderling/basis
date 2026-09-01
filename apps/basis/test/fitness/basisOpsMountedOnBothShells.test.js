/**
 * basis's own ops are on the waist, on every shell — the check that a shell cannot forget to mount.
 *
 * Both Advanced drawers dispatch a tapped row with `callSkill(row.app, row.op, args)`, which is the
 * AGENT's waist. basis's ops are not agent skills — they end in a file picker, a camera, a panel, a pod
 * login — so they live in a `createLocalBuiltins` table a shell mounts with `mountAppOps`. The v2 web
 * shell never built one, so every basis row there dispatched into `unknown appOrigin "basis"` while the
 * form said "✓ Submitted": twenty-three buttons that did nothing, for months, on the shell we ship.
 *
 * That is a mistake of OMISSION, which no test of behaviour catches — the ops all worked when called
 * directly, and the shells have no runtime coverage — so this reads the sources and asks the one
 * question the omission answers wrongly. The agent's own default table keeps a composition that mounts
 * nothing honest rather than broken; this is about the shells, which have seams the default cannot.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(HERE, rel), 'utf8');
const WEB    = read('../../web/v2/circleApp.js');
const MOBILE = read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js');
const AGENT  = read('../../src/core/agent/realAgent.js');

describe("basis's ops are mounted on the waist by every shell", () => {
  it('the agent serves the `basis` origin at all, and refuses an undeclared op without throwing', () => {
    expect(AGENT).toMatch(/if \(appOrigin === 'basis'\)/);
    expect(AGENT, 'an undeclared op is a structured refusal, never a throw at the boundary')
      .toMatch(/error: 'unknown-op', app: 'basis'/);
    expect(AGENT, 'a shell can upgrade the default table with its own seams').toMatch(/mountAppOps:/);
  });

  it('the web shell builds the table and mounts it', () => {
    expect(WEB).toMatch(/import \{ createLocalBuiltins \} from '\.\.\/\.\.\/src\/core\/localBuiltins\.js'/);
    expect(WEB).toMatch(/mountAppOps\('basis',/);
    expect(WEB, 'and calls the mount, not merely defines it').toMatch(/mountBasisOpsOnAgent\(agent\)/);
  });

  it('the mobile shell mounts the table it has always assembled', () => {
    expect(MOBILE).toMatch(/import \{ buildMobileLocalBuiltins \}/);
    expect(MOBILE).toMatch(/mountAppOps\('basis',/);
  });

  it('both shells pass a file picker, and neither invents a second handler table', () => {
    expect(WEB).toMatch(/openFilePicker: webFilePicker/);
    expect(MOBILE).toMatch(/openFilePicker: openMobileFilePicker/);
    // The point of the waist is ONE implementation of each op. A shell that builds its own handlers
    // instead of injecting seams into the shared table is the drift this whole route exists to end.
    expect(WEB.match(/createLocalBuiltins\(/g) ?? [], 'web builds the shared table once').toHaveLength(1);
    expect(MOBILE.match(/buildMobileLocalBuiltins\(/g) ?? [], 'mobile builds the shared table once').toHaveLength(1);
  });
});
