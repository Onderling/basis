#!/usr/bin/env node
// Surface coverage scan — PLAN-manifest-gate-surfaces.md Part B.
//
// Prints a matrix of op × { chat · slash · gate · web/mobile · inline } across the manifests
// canopy-chat composes, so we can scan at a glance WHAT IS WIRED WHERE — find gaps (an op with a
// chat surface but no deterministic gate verb) and plan the inline menus.
//
//   npm run coverage            (from apps/canopy-chat)
//
// Surfaces: chat = LLM tool (surfaces.chat) · slash = /command (surfaces.slash.command) · gate =
// deterministic NL verbs (surfaces.slash.match) · web/mobile = screen affordance (surfaces.ui or a
// creative verb; renderWeb ≡ renderMobile, V0-aliased) · inline = button (surfaces.ui.control).

import { renderCoverage, coverageGaps, formatCoverageMarkdown } from '../../../packages/app-manifest/src/index.js';

// Resilient: a manifest that fails to import is skipped, not fatal.
const SPECS = [
  { name: 'canopy-chat', path: '../manifest.js',                          pick: (m) => m.canopyChatManifest },
  { name: 'tasks',       path: '../src/core/manifests/mockManifests.js',  pick: (m) => m.mockTasksManifest },
  { name: 'stoop',       path: '../src/core/manifests/mockManifests.js',  pick: (m) => m.mockStoopManifest },
  { name: 'folio',       path: '../src/core/manifests/mockManifests.js',  pick: (m) => m.mockFolioManifest },
  { name: 'household',   path: '../../household/manifest.js',             pick: (m) => m.householdManifest },
];

const sources = [];
for (const spec of SPECS) {
  try {
    const mod = await import(spec.path);
    const m = spec.pick(mod);
    if (m && Array.isArray(m.operations)) sources.push({ ...m, appId: m.appId ?? spec.name });
    else console.error(`(skip ${spec.name}: no operations)`);
  } catch (e) {
    console.error(`(skip ${spec.name}: ${e.message})`);
  }
}

const cov = renderCoverage(sources);

console.log('# Surface coverage — op × chat / slash / gate / web·mobile / inline\n');
console.log('_chat = LLM tool · slash = /command · gate = deterministic NL verbs · ' +
  'web/mobile = screen (renderWeb ≡ renderMobile) · inline = button affordance_\n');
console.log(formatCoverageMarkdown(cov));

console.log('\n## Gaps for the gate/LLM + inline-menu work\n');
for (const surf of ['gate', 'inline', 'chat']) {
  const gaps = coverageGaps(cov, surf);
  const shown = gaps.slice(0, 40).map((g) => `${g.app}:${g.op}`).join(', ');
  console.log(`- **missing ${surf}** (${gaps.length}/${cov.totals.ops}): ${shown}${gaps.length > 40 ? ' …' : ''}`);
}
