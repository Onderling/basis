// renderCoverage — scan a manifest (or several) into a SURFACE-COVERAGE matrix: for each op, which
// surfaces it has a counterpart on. The point is to see at a glance what's wired where — to find gaps
// (an op with chat but no gate verb) and to plan the inline menus.
//
// Declaration-based + pure: it reads the same `surfaces.*` declarations the projectors consume, so an
// op marked ✅ for a surface is one that surface's projector will render (given a skill, where needed).
// Surfaces:
//   chat   — surfaces.chat            (the LLM tool / chat affordance; renderChat)
//   slash  — surfaces.slash.command   (the explicit /command; renderSlash command form)
//   gate   — surfaces.slash.match     (the deterministic NL verbs; renderGate / renderSlash)
//   screen — surfaces.ui OR a CREATIVE_VERB (add/register)  (web/mobile page/affordance; renderWeb ≡
//            renderMobile, V0-aliased — one column)
//   inline — surfaces.ui.control === 'button'  (the inline button/menu affordance)

import { CREATIVE_VERBS } from './renderWeb.js';

const SURFACES = [
  { key: 'chat',   label: 'chat',       detect: (s)     => !!s.chat },
  { key: 'slash',  label: 'slash',      detect: (s)     => !!(s.slash && s.slash.command) },
  { key: 'gate',   label: 'gate',       detect: (s)     => !!(s.slash && s.slash.match) },
  { key: 'screen', label: 'web/mobile', detect: (s, op) => !!s.ui || CREATIVE_VERBS.has(op.verb) },
  { key: 'inline', label: 'inline',     detect: (s)     => !!(s.ui && s.ui.control === 'button') },
];

/**
 * @param {import('./schema.js').Manifest | import('./schema.js').Manifest[]} manifestOrList
 * @returns {{ surfaces: Array<{key:string,label:string}>,
 *            rows: Array<{app:string,op:string,verb:string,chat:boolean,slash:boolean,gate:boolean,screen:boolean,inline:boolean,gateVerbs:string[]}>,
 *            totals: Record<string,number> }}
 */
export function renderCoverage(manifestOrList) {
  const manifests = Array.isArray(manifestOrList) ? manifestOrList : [manifestOrList];
  const rows = [];
  for (const m of manifests.filter(Boolean)) {
    const app = m.appId ?? m.id ?? '';
    for (const op of (Array.isArray(m.operations) ? m.operations : [])) {
      const s = op.surfaces ?? {};
      const row = { app, op: op.id, verb: op.verb ?? '' };
      for (const surf of SURFACES) row[surf.key] = !!surf.detect(s, op);
      const verbs = s.slash && s.slash.match && Array.isArray(s.slash.match.verbs) ? s.slash.match.verbs : [];
      row.gateVerbs = verbs.map((v) => (Array.isArray(v) ? v.join(' ') : String(v)));
      rows.push(row);
    }
  }
  const totals = { ops: rows.length };
  for (const surf of SURFACES) totals[surf.key] = rows.filter((r) => r[surf.key]).length;
  return { surfaces: SURFACES.map(({ key, label }) => ({ key, label })), rows, totals };
}

/** Ops missing a given surface — the work list for that surface (e.g. coverageGaps(cov, 'gate')). */
export function coverageGaps(coverage, surfaceKey) {
  return coverage.rows.filter((r) => !r[surfaceKey]).map((r) => ({ app: r.app, op: r.op, verb: r.verb }));
}

/** Render the matrix as a scannable markdown table (grouped by app). */
export function formatCoverageMarkdown(coverage, { mark = '✅', blank = '·' } = {}) {
  const { rows, surfaces, totals } = coverage;
  const cell = (b) => (b ? mark : blank);
  const cols = surfaces.map((s) => s.label);
  const out = [
    `| app | op | verb | ${cols.join(' | ')} | gate verbs |`,
    `|${'---|'.repeat(cols.length + 4)}`,
  ];
  let lastApp = null;
  for (const r of rows) {
    const app = r.app !== lastApp ? `**${r.app || '—'}**` : '';
    lastApp = r.app;
    const cells = surfaces.map((s) => cell(r[s.key])).join(' | ');
    out.push(`| ${app} | \`${r.op}\` | ${r.verb} | ${cells} | ${r.gateVerbs.join(', ')} |`);
  }
  out.push(`|${'---|'.repeat(cols.length + 4)}`);
  out.push(`| **totals** | ${totals.ops} ops | | ${surfaces.map((s) => totals[s.key]).join(' | ')} | |`);
  return out.join('\n');
}
