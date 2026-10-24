#!/usr/bin/env node
/**
 * lint-agent-count — the basis agent constructs exactly the listed in-process agents, and the list only SHRINKS.
 *
 * Beside its one wire-facing agent, the basis agent runs in-process agents on one bus (host, household, tasks,
 * pinboard, folio). "One agent per service-context" says they should become one; until they are folded, no new one
 * may appear. Every in-process agent is reachable only once it is adopted (`adoptInProcess(...)`), so the adoptions
 * are the list; the constructions (`new Agent({`, a `createBrowser…Agent(` factory, `new InternalTransport(bus`) are
 * counted beside it so an agent built but not adopted is caught too.
 *
 * Red when an adoption or a construction appears that the baseline does not name, and when the baseline names one
 * that is gone (shrink the baseline in the same change, so it stays exact).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'apps/basis/src/core/agent/realAgent.js';

/** The in-process agents adopted today. Only ever remove from this list. */
export const ADOPTED_BASELINE = ['hostAgent', 'tasksCircle.agent', 'pinboardAgent.bundle.agent'];
/** How many constructions of each kind build them today. Only ever lower these. */
export const CONSTRUCTION_BASELINE = { 'new Agent({': 1, 'createBrowser…Agent(': 3, 'new InternalTransport(bus': 1 };

/** The arguments of every `adoptInProcess(...)` call in one file's text (the helper's own definition excluded). */
export function adoptions(text) {
  return [...String(text).matchAll(/(?<!const\s)\badoptInProcess\(\s*([\w.]+)\s*\)/g)].map((m) => m[1]);
}

/** The constructions of in-process agents in one file's text, counted per kind. */
export function constructions(text) {
  const t = String(text);
  return {
    'new Agent({': (t.match(/\bnew Agent\(\{/g) ?? []).length,
    'createBrowser…Agent(': (t.match(/\bcreateBrowser\w*Agent\(\{/g) ?? []).length,
    'new InternalTransport(bus': (t.match(/\bnew InternalTransport\(bus\b/g) ?? []).length,
  };
}

/** Every difference from the baselines, as messages. */
export function agentCountProblems(text, adoptedBaseline = ADOPTED_BASELINE, constructionBaseline = CONSTRUCTION_BASELINE) {
  const out = [];
  const adopted = adoptions(text);
  for (const a of adopted) if (!adoptedBaseline.includes(a)) out.push(`a NEW in-process agent is adopted: ${a} — fold it into an existing one instead`);
  for (const a of adoptedBaseline) if (!adopted.includes(a)) out.push(`${a} is no longer adopted — remove it from ADOPTED_BASELINE (the list only shrinks)`);
  const counts = constructions(text);
  for (const [kind, n] of Object.entries(counts)) {
    const allowed = constructionBaseline[kind] ?? 0;
    if (n > allowed) out.push(`${n} × ${kind} (baseline ${allowed}) — a new in-process agent is built`);
    if (n < allowed) out.push(`${n} × ${kind} (baseline ${allowed}) — lower CONSTRUCTION_BASELINE (it only shrinks)`);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const problems = agentCountProblems(readFileSync(path.join(ROOT, FILE), 'utf8'));
  if (problems.length) {
    console.error(`lint-agent-count (${FILE}):`);
    for (const p of problems) console.error(`  • ${p}`);
    process.exit(1);
  }
  console.log(`lint-agent-count: ${ADOPTED_BASELINE.length} in-process agents, none new`);
}
