#!/usr/bin/env node
/**
 * lint-agent-count — the basis agent constructs exactly the listed in-process agents, and the list only SHRINKS.
 *
 * THE TARGET (docs/decisions.md 2026-10-23, "One agent per person"): TWO agents in the bundle — the peer façade on the
 * wire and the host — with one gate truth and the host key as the one token issuer. The baseline below is TODAY, not
 * the design: every name in it beyond the host is a standalone-app leftover still to fold onto the host. The split
 * between façade and host is not a security wall (one process, bundle code trusted as a whole); the boundary is the
 * façade's gate — see docs/architecture.md, the Agent home, "Where the security boundary is".
 *
 * It also pins the AGREEMENT with the doc: the marked sentence in docs/architecture.md
 * (`<!-- lint-agent-count: in-process = a, b -->`) must name exactly ADOPTED_BASELINE, so folding an agent changes the
 * doc in the same PR.
 *
 * Beside its one wire-facing agent, the basis agent runs in-process agents on one bus (host, household, tasks,
 * pinboard, folio). "One agent per service-context" says they should become one; until they are folded, no new one
 * may appear. Every in-process agent is reachable only once it is adopted (`adoptInProcess(...)`), so the adoptions
 * are the list; the constructions (`new Agent({`, a `createBrowser…Agent(` factory, `new InternalTransport(bus`) are
 * counted beside it so an agent built but not adopted is caught too.
 *
 * Red when an adoption or a construction appears that the baseline does not name, and when the baseline names one
 * that is gone (shrink the baseline in the same change, so it stays exact).
 *
 * What it does not see: a factory that composes skills onto an agent it is handed (the tasks factory, given the host,
 * builds none — its name still counts here) and the agents a bot registry spins up per bound chat (`new Agent` in
 * BotAgentRegistry, outside this file): those are a bot's own key, `public` on the host's registry.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'apps/basis/src/core/agent/realAgent.js';

/** The in-process agents adopted today. Only ever remove from this list. */
export const ADOPTED_BASELINE = ['hostAgent', 'pinboardAgent.bundle.agent'];
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

const DOC = 'docs/architecture.md';

/** The agents the doc's marked sentence names, or null when the marker is missing. */
export function docNamedAgents(docText) {
  const m = String(docText).match(/<!--\s*lint-agent-count:\s*in-process\s*=\s*([^>]*?)\s*-->/);
  return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : null;
}

/** Differences between the doc's marked sentence and the baseline, as messages. */
export function docAgreementProblems(docText, adoptedBaseline = ADOPTED_BASELINE) {
  const named = docNamedAgents(docText);
  if (!named) return [`${DOC} has no "<!-- lint-agent-count: in-process = … -->" marker — the Agent home must name the in-process agents`];
  const out = [];
  for (const a of adoptedBaseline) if (!named.includes(a)) out.push(`${DOC} does not name ${a} — the Agent home's agents paragraph is stale`);
  for (const a of named) if (!adoptedBaseline.includes(a)) out.push(`${DOC} names ${a}, which is no longer adopted — update the Agent home's agents paragraph`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const problems = agentCountProblems(readFileSync(path.join(ROOT, FILE), 'utf8'))
    .concat(docAgreementProblems(readFileSync(path.join(ROOT, DOC), 'utf8')));
  if (problems.length) {
    console.error(`lint-agent-count (${FILE}, ${DOC}):`);
    for (const p of problems) console.error(`  • ${p}`);
    process.exit(1);
  }
  console.log(`lint-agent-count: ${ADOPTED_BASELINE.length} in-process agents, none new`);
}
