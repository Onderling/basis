#!/usr/bin/env node
// Surface coverage scan — PLAN-manifest-gate-surfaces.md Part B.
//
// Prints a matrix of op × { chat · slash · gate · web/mobile · inline } across the manifests
// basis composes, so we can scan at a glance WHAT IS WIRED WHERE — find gaps (an op with a
// chat surface but no deterministic gate verb) and plan the inline menus.
//
//   npm run coverage            (from apps/basis)
//
// Surfaces: chat = LLM tool (surfaces.chat) · slash = /command (surfaces.slash.command) · gate =
// deterministic NL verbs (surfaces.slash.match) · web/mobile = screen affordance (surfaces.ui or a
// creative verb; renderWeb ≡ renderMobile, V0-aliased) · inline = button (surfaces.ui.control).

import { renderCoverage, coverageGaps, formatCoverageMarkdown } from '@onderling/app-manifest';

// The circle catalogue set — read from the ONE list both shells compose (`src/v2/manifestSources.js`), plus
// params (the register's meta-ops + the restore-settings flow; flows ride the snapshot too), plus the door's own ops. The device-log
// lane manifests declare appends, not surfaces, so they have no row here.
import { catalogueManifests, DOOR_MANIFESTS } from '../src/v2/manifestSources.js';
import { paramsManifest } from '../src/v2/paramsManifest.js';

const sources = [...catalogueManifests(), paramsManifest, ...DOOR_MANIFESTS].map((m) => ({ ...m, appId: m.appId ?? m.app }));

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
