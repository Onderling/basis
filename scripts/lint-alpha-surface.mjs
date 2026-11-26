#!/usr/bin/env node
/**
 * lint-alpha-surface — a hidden surface cannot creep back into a shell by accident.
 *
 * The alpha paints what apps/basis/src/v2/alphaSurface.js lists (plans/PLAN-alpha-surface-cut.md: hide,
 * never delete). Two things would silently undo that: a shell painting the chat/scherm pill from its own
 * literal list again, or the shared tab projection handing a hidden tab to the shells. This checks both.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { linesMatching } from './guard-where.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PILL = /\[\s*'chat'\s*,\s*'screen'\s*\]/;

/** A shell that paints the chat/scherm pill from its own literal list: one message per line, as file:line. */
export function pillProblems(f, src) {
  return linesMatching(src, PILL).map((l) => `${f}:${l}: paints the chat/scherm pill from a literal list.\n    Fix: take the modes from alphaViewModes() (apps/basis/src/v2/alphaSurface.js) instead.`);
}

/** A hidden tab or ⋯ action that a projection still hands to a shell. The projection is named; its output has no line. */
export function hiddenProblems({ kind, shell, ids, hidden, projection }) {
  const what = kind === 'tab' ? 'tab projection still paints the hidden' : '⋯ menu projection still paints the hidden';
  const list = kind === 'tab' ? 'HIDDEN_TABS' : 'HIDDEN_CIRCLE_ACTIONS';
  return hidden.filter((h) => ids.includes(h)).map((h) => `${projection}: the ${shell} ${what} "${h}" ${kind === 'tab' ? 'tab' : 'action'}.\n    Fix: filter it out in ${projection} through ${list} (apps/basis/src/v2/alphaSurface.js): hide, never delete.`);
}

async function main() {
  const problems = [];

  // 1 · no shell keeps its own list of view modes — the pill comes from alphaViewModes()
  for (const f of ['apps/basis/web/v2/circleView.js', 'apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js']) {
    problems.push(...pillProblems(f, readFileSync(path.join(ROOT, f), 'utf8')));
  }

  // 2 · the projection both shells consume hands out no hidden tab
  const { circleTabs, circleTabsMobile } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/v2/tabProjection.js')).href);
  const { HIDDEN_TABS, HIDDEN_CIRCLE_ACTIONS } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/v2/alphaSurface.js')).href);
  const { circleActions, circleActionsMobile } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/v2/actionProjection.js')).href);
  const { DEFAULT_CIRCLE_POLICY } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/v2/circlePolicy.js')).href);
  const { basisManifest } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/index.js')).href);
  for (const [shell, fn] of [['web', circleTabs], ['mobile', circleTabsMobile]]) {
    problems.push(...hiddenProblems({ kind: 'tab', shell, ids: fn(basisManifest).map((t) => t.id), hidden: HIDDEN_TABS, projection: 'apps/basis/src/v2/tabProjection.js' }));
  }

  // 3 · the ⋯ menu projection hands out no hidden action
  for (const [shell, ids] of [
    ['web', circleActions(basisManifest, { policy: DEFAULT_CIRCLE_POLICY, platform: 'web' }).map((a) => a.id)],
    ['mobile', circleActionsMobile(basisManifest, { policy: DEFAULT_CIRCLE_POLICY }).map((a) => a.id)],
  ]) problems.push(...hiddenProblems({ kind: 'action', shell, ids, hidden: HIDDEN_CIRCLE_ACTIONS, projection: 'apps/basis/src/v2/actionProjection.js' }));

  if (problems.length) { console.error(`✖ lint-alpha-surface:\n  ${problems.join('\n  ')}`); process.exit(1); }
  console.log(`✓ lint-alpha-surface: hidden tabs (${HIDDEN_TABS.join(', ')}) and ${HIDDEN_CIRCLE_ACTIONS.length} hidden ⋯ actions stay hidden on both shells; no literal pill list`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
