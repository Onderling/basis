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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

// 1 · no shell keeps its own list of view modes — the pill comes from alphaViewModes()
for (const f of ['apps/basis/web/v2/circleView.js', 'apps/basis-mobile/src/screens/v2/CircleLauncherScreen.js']) {
  const src = readFileSync(path.join(ROOT, f), 'utf8');
  if (/\[\s*'chat'\s*,\s*'screen'\s*\]/.test(src)) problems.push(`${f}: paints the chat/scherm pill from a literal list — use alphaViewModes()`);
}

// 2 · the projection both shells consume hands out no hidden tab
const { circleTabs, circleTabsMobile } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/v2/tabProjection.js')).href);
const { HIDDEN_TABS, HIDDEN_CIRCLE_ACTIONS } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/v2/alphaSurface.js')).href);
const { circleActions, circleActionsMobile } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/v2/actionProjection.js')).href);
const { DEFAULT_CIRCLE_POLICY } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/v2/circlePolicy.js')).href);
const { basisManifest } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/index.js')).href);
for (const [name, fn] of [['web', circleTabs], ['mobile', circleTabsMobile]]) {
  const ids = fn(basisManifest).map((t) => t.id);
  for (const h of HIDDEN_TABS) if (ids.includes(h)) problems.push(`${name} tab projection still paints the hidden "${h}" tab`);
}

// 3 · the ⋯ menu projection hands out no hidden action
for (const [name, ids] of [
  ['web', circleActions(basisManifest, { policy: DEFAULT_CIRCLE_POLICY, platform: 'web' }).map((a) => a.id)],
  ['mobile', circleActionsMobile(basisManifest, { policy: DEFAULT_CIRCLE_POLICY }).map((a) => a.id)],
]) for (const h of HIDDEN_CIRCLE_ACTIONS) if (ids.includes(h)) problems.push(`${name} ⋯ menu projection still paints the hidden "${h}" action`);

if (problems.length) { console.error(`✖ lint-alpha-surface:\n  • ${problems.join('\n  • ')}`); process.exit(1); }
console.log(`✓ lint-alpha-surface: hidden tabs (${HIDDEN_TABS.join(', ')}) and ${HIDDEN_CIRCLE_ACTIONS.length} hidden ⋯ actions stay hidden on both shells; no literal pill list`);
