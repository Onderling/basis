#!/usr/bin/env node
// docs/architecture.md describes what RUNS. It carries no plans, no considerations, no history of who
// proposed what — a newcomer must be able to read it as a description of the system as it is. Planning
// prose belongs in plans/ (private) and decisions in decisions.md.
//
// HARD FAILS (exit 1): a line in docs/architecture.md (outside code fences) that carries planning or
// deliberation language, or names a person or model as an actor.
//
// Usage: node scripts/lint-architecture-reality.mjs
import { readFileSync } from 'node:fs';

export const PATTERNS = [
  [/not yet built|not built yet|yet to be built/i, 'plan language ("not yet built")'],
  [/\bdirection(, not| —|:)/i, 'plan language ("direction")'],
  [/\b(was|were) (tried|proposed|withdrawn|demoted)\b/i, 'history of a decision'],
  [/\blater work\b|\bnext step is\b|\bworth scoping\b|\bto be decided\b/i, 'plan language'],
  [/\b(Frits|Opus|Fable|Claude)\b/, 'a person or model named as an actor'],
  [/\[ledger\b/i, 'ledger coordinate'],
  [/\bwe (should|could|might|first said)\b|\bI (first|was|had)\b/i, 'deliberation voice'],
];

export function findViolations(text) {
  const out = [];
  let fenced = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    for (const [re, why] of PATTERNS) if (re.test(line)) out.push({ line: i + 1, why, text: line.trim() });
  });
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const v = findViolations(readFileSync('docs/architecture.md', 'utf8'));
  for (const x of v) console.log(`docs/architecture.md:${x.line}: ${x.why}\n    ${x.text.slice(0, 120)}`);
  if (v.length) { console.log(`\n${v.length} line(s) of planning prose in the architecture — move them to plans/ or decisions.md`); process.exit(1); }
  console.log('architecture-reality: docs/architecture.md describes only what runs');
}
