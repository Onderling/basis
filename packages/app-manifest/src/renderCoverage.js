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
//   attach — surfaces.attach          (the attach "+" menu entry; renderAttachments)
//   screen — surfaces.ui OR surfaces.page OR a CREATIVE_VERB (add/register)  (web/mobile
//            page/affordance; renderWeb ≡ renderMobile, V0-aliased — one column). D /:
//            `surfaces.page` (side-panel / modal / screen) now counts — it projects to
//            NavModel.pages[] via renderWeb, so a declared page IS a web/mobile surface.
//   inline — surfaces.ui.control === 'button'  (the inline button/menu affordance)

import { CREATIVE_VERBS } from './renderWeb.js';

const SURFACES = [
  { key: 'chat',   label: 'chat',       detect: (s)     => !!s.chat },
  { key: 'slash',  label: 'slash',      detect: (s)     => !!(s.slash && s.slash.command) },
  { key: 'gate',   label: 'gate',       detect: (s)     => !!(s.slash && s.slash.match) },
  { key: 'attach', label: 'attach',     detect: (s)     => !!s.attach },
  { key: 'screen', label: 'web/mobile', detect: (s, op) => !!s.ui || !!s.page || CREATIVE_VERBS.has(op.verb) },
  { key: 'inline', label: 'inline',     detect: (s)     => !!(s.ui && s.ui.control === 'button') },
];

/**
 * Scan a manifest (or several) into the surface-coverage matrix: one row per op with a boolean per
 * surface (chat / slash / gate / web-mobile screen / inline), read from the same `surfaces.*`
 * declarations the projectors consume — plus per-surface totals. Pure and declaration-ordered.
 *
 * @param {import('./schema.js').Manifest | import('./schema.js').Manifest[]} manifestOrList
 * @returns {{ surfaces: Array<{key:string,label:string}>,
 *   rows: Array<{app:string, op:string, verb:string, chat:boolean, slash:boolean, gate:boolean,
 *     screen:boolean, inline:boolean, gateVerbs:string[]}>,
 *   totals: Record<string,number> }}
 */
export function renderCoverage(manifestOrList) {
  const manifests = Array.isArray(manifestOrList) ? manifestOrList : [manifestOrList];
  const rows = [];
  for (const m of manifests.filter(Boolean)) {
    const app = m.appId ?? m.app ?? m.id ?? '';
    for (const op of (Array.isArray(m.operations) ? m.operations : [])) {
      const s = op.surfaces ?? {};
      // `surfaces.internal` — substrate ops (the card machinery's snapshot calls): no person invokes
      // them, so they belong on no surface and in no coverage row. Skipping them HERE is what also
      // removes them from the Advanced drawer, whose row source is this matrix's complement — internal
      // is a declaration, precise on purpose: internal ≠ unused (the machinery calls these daily).
      if (s.internal === true) continue;
      const row = { app, op: op.id, verb: op.verb ?? '' };
      for (const surf of SURFACES) row[surf.key] = !!surf.detect(s, op);
      const verbs = s.slash && s.slash.match && Array.isArray(s.slash.match.verbs) ? s.slash.match.verbs : [];
      row.gateVerbs = verbs.map((v) => (Array.isArray(v) ? v.join(' ') : String(v)));
      rows.push(row);
    }
  }
  // Flows are part of the declared surface too — one row per flow so the snapshot
  // records which processes exist, their scope, and their declared effects.
  const flows = [];
  for (const m of manifests.filter(Boolean)) {
    const app = m.appId ?? m.app ?? m.id ?? '';
    for (const f of (Array.isArray(m.flows) ? m.flows : [])) {
      flows.push({
        app,
        flow:    f.id,
        kind:    f.kind ?? '',
        scope:   f.scope ?? 'device',
        steps:   Array.isArray(f.steps) ? f.steps.length : 0,
        effects: (Array.isArray(f.effects) ? f.effects : [])
          .map((e) => `${e.kind}:${e.target ?? ''}`),
      });
    }
  }
  const totals = { ops: rows.length, flows: flows.length };
  for (const surf of SURFACES) totals[surf.key] = rows.filter((r) => r[surf.key]).length;
  return { surfaces: SURFACES.map(({ key, label }) => ({ key, label })), rows, flows, totals };
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
  const flows = coverage.flows ?? [];
  if (flows.length) {
    out.push('', '### Flows', '', '| app | flow | kind | scope | steps | declared effects |', `|${'---|'.repeat(6)}`);
    let last = null;
    for (const f of flows) {
      const app = f.app !== last ? `**${f.app || '—'}**` : '';
      last = f.app;
      out.push(`| ${app} | \`${f.flow}\` | ${f.kind} | ${f.scope} | ${f.steps} | ${f.effects.join(', ')} |`);
    }
  }
  return out.join('\n');
}
