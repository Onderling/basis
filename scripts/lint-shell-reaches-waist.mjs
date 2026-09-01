#!/usr/bin/env node
/**
 * lint-shell-reaches-waist — a shell may COMPOSE the substrate, never CALL it.
 *
 * The claim: every act a person takes travels `{opId, args} → callSkill`. Principle 8 states it, the
 * architecture calls it the waist, and nothing checked it. `lint-callskill-literals` verifies that a
 * `callSkill` names a real op; nothing verified that a shell USES `callSkill` rather than importing the
 * substrate and doing the thing itself.
 *
 * ── What it cost, measured 2026-09-01 ────────────────────────────────────────────────────────────────
 * The Me → My data panel signed you in and out by calling `podAuth.startSignIn` / `signOut` directly, on
 * both shells, while `basis.signin` / `signout` / `whoami` existed as ops doing the same thing through
 * the same substrate. Two implementations of one capability (invariant 1), and a manifest that described
 * neither of the buttons people actually pressed (invariant 4). The ops looked unreachable, which is how
 * they nearly got retracted — the panel was their door all along, just not through the waist.
 *
 * ── COMPOSING vs CALLING, and why the distinction is the whole guard ─────────────────────────────────
 * A first draft of this guard banned substrate IMPORTS under `apps/basis/web/v2`. That would have failed
 * on `circleApp.js`, which imports `podAuth` AND `createRealHouseholdAgent` because it IS the web
 * composition root — wiring the substrate together is its job, and something must do it. A guard whose
 * only fix is an exemption is a guard that teaches people to write exemptions.
 *
 * So the rule follows the seam that actually exists:
 *   · a composition root may IMPORT the substrate and wire it at boot (`podAuth.handleRedirect()` on the
 *     redirect path, handing the session to the agent) — that is not an act a person took;
 *   · nowhere may a shell CALL a substrate ACTION — signing in, signing out, muting a peer. Those are
 *     ops, and an op is reached through the waist.
 *   · screens and RN wizards compose nothing, so for them the import itself is the defect.
 *
 * Baseline is 0 and must stay 0: the four call sites this was written for were rewired in the same
 * change. Per `lint-hardcoded-strings`' doctrine — a guard that lands with a debt list teaches people to
 * grow the debt list.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

/** Comments describe; they do not dispatch. */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => (/^\s*\/\//.test(l) ? '' : l)).join('\n');

/**
 * Substrate ACTIONS a shell must not perform itself. Each is an op today, which is why it is here: the
 * test for adding a row is "is there an op for this?", not "does this look low-level?".
 */
const ACTIONS = [
  { re: /\bpodAuth[?.]*\.\s*startSignIn\s*\(/, op: 'basis.signin' },
  { re: /\bpodAuth[?.]*\.\s*signOut\s*\(/,     op: 'basis.signout' },
  { re: /\.\s*sa\s*\.\s*mute\s*\.\s*(add|remove|clear)\s*\(/, op: 'basis.mute / basis.unmute' },
];

/**
 * Where composition legitimately happens. Everything else in scope may not even IMPORT the substrate.
 * Kept as a short, named list rather than a pattern: a composition root is a decision, and a repo that
 * grows a fifth one silently has stopped having a waist.
 */
const COMPOSITION_ROOTS = new Set([
  'apps/basis/web/v2/circleApp.js',        // the web shell's boot: podAuth → the agent's pod routing
  'apps/basis-mobile/src/core/agentBundle.js',
  // ⚠ Mobile's podAuth is BUILT here — `buildMobilePodAuth` over the RN OIDC session — and handed up to
  // App.js so the visible launcher can use it. That is composition, so it belongs on this list; that it
  // happens inside the HIDDEN chat shell is a piece of debt, not a design. The screen stays mounted only
  // because the peer wiring routes through it, and the day that moves, this construction should move to
  // `agentBundle` and this line should go.
  'apps/basis-mobile/src/screens/ChatScreen.js',
]);

const SCOPE = ['apps/basis/web/v2/', 'apps/basis-mobile/src/screens/', 'apps/basis/src/rn/'];
const SUBSTRATE_IMPORT = /import[^;]*from\s+['"][^'"]*(podAuth|@onderling\/secure-agent)[^'"]*['"]/;

const files = sh(`git ls-files ${SCOPE.map((s) => `'${s}'`).join(' ')}`)
  .split('\n').filter(Boolean)
  .filter((f) => f.endsWith('.js'))
  .filter((f) => !/\.test\.|\/test\//.test(f));

const problems = [];
for (const f of files) {
  const src = strip(readFileSync(path.join(ROOT, f), 'utf8'));
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    for (const { re, op } of ACTIONS) {
      if (re.test(line)) {
        problems.push(`${f}:${i + 1}\n    calls the substrate directly — dispatch \`${op}\` through the waist instead`);
      }
    }
  });

  if (!COMPOSITION_ROOTS.has(f) && SUBSTRATE_IMPORT.test(src)) {
    const i = lines.findIndex((l) => SUBSTRATE_IMPORT.test(l));
    problems.push(`${f}:${i + 1}\n    imports the substrate, and composes nothing — a screen reaches the waist, never past it`);
  }
}

if (problems.length === 0) {
  console.log(`✓ lint-shell-reaches-waist: ${files.length} shell files — every act goes through callSkill`);
  process.exit(0);
}
console.error(`✖ lint-shell-reaches-waist: ${problems.length} shell(s) reaching past the waist:\n`);
for (const p of problems) console.error(`  ${p}`);
console.error(`
An op is the one door. A shell that calls the substrate is a second implementation of the same
capability, and the manifest stops describing what the buttons do — which is how basis ended up with
signin/signout/whoami declared, tested, and apparently reachable by nobody while the panel used them.`);
process.exit(1);
