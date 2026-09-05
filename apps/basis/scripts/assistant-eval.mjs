#!/usr/bin/env node
/**
 * assistant-eval — the eval loop for the assistant, so a walk is not the test.
 *
 * A fixed set of utterances (Dutch + English, many lifted from real walks) with what we accept as right:
 * the op the assistant should dispatch (and args it must carry), or a reply class ("asks a question",
 * "declines"), or "nothing". Every fixture runs through the SHARED assistant engine — the same gate,
 * memory, retrieval and interpreter the doors use — against the real model route (Privatemode, from
 * the key on this machine) or, with --mock, a deterministic stand-in, and the script prints a
 * scoreboard: which path answered (gate · llm · reply), how long, pass/fail, and why.
 *
 *   node scripts/assistant-eval.mjs                 # real route (needs ~/.privatemode-apikey)
 *   node scripts/assistant-eval.mjs --model gpt-oss-120b
 *   node scripts/assistant-eval.mjs --only add        # fixtures whose id contains "add"
 *   node scripts/assistant-eval.mjs --from-log ~/.basis-telegram/walk-log-*.jsonl   # print fixture stubs from a walk
 *
 * Exit code 1 when the pass rate is under --min (default 0.85). Fixtures: scripts/assistant-eval.fixtures.mjs.
 */
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { mergeManifests } from '../src/manifestMerge.js';
import { createAssistantEngine } from '../src/v2/assistantEngine.js';
import { interpretToCommand } from '../src/v2/interpretCommand.js';
import { householdManifest } from '../../household/manifest.js';
import { listsManifest } from '../../lists/manifest.js';
import { FIXTURES } from './assistant-eval.fixtures.mjs';

const { values } = parseArgs({ options: {
  model: { type: 'string' }, only: { type: 'string' }, min: { type: 'string', default: '0.85' },
  mock: { type: 'boolean', default: false }, 'from-log': { type: 'string' }, lang: { type: 'string', default: 'nl' },
} });

if (values['from-log']) {
  // A walk's turns as fixture stubs — annotate the `expect` and paste into the fixtures file.
  for (const line of readFileSync(values['from-log'], 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    if (e.kind === 'run' || !e.text || /^[A-Za-z][\w-]*:/.test(e.text)) continue;
    const got = e.opId ? `{ op: '${e.opId}', args: ${JSON.stringify(e.args ?? {})} }` : (e.via === 'llm-reply' ? `{ reply: 'asks' }` : `{ reply: 'declines' }`);
    console.log(`  { id: 'walk-${e.ts.slice(11, 19).replace(/:/g, '')}', text: ${JSON.stringify(e.text)}, expect: ${got} },   // was via=${e.via}`);
  }
  process.exit(0);
}

const catalogue = mergeManifests([{ manifest: householdManifest }, { manifest: listsManifest }]);
let llm = null;
if (!values.mock) {
  const { privatemodeProvider, readPrivatemodeKey } = await import('@onderling/llm-client/providers/privatemode');
  const { LlmClient } = await import('@onderling/llm-client');
  if (!readPrivatemodeKey()) { console.error('assistant-eval: no Privatemode key — pass --mock or add ~/.privatemode-apikey'); process.exit(2); }
  llm = new LlmClient({ provider: await privatemodeProvider({ model: values.model || undefined, timeoutMs: 60_000 }) });
} else {
  llm = { invoke: async () => ({ toolCall: null, replyText: 'Welke lijst bedoel je?' }) };
}

const fixtures = FIXTURES.filter((f) => !values.only || f.id.includes(values.only));
const results = [];
for (const f of fixtures) {
  const dispatched = [];
  const replies = [];
  const engine = createAssistantEngine({
    catalogue, lang: f.lang ?? values.lang, llm, interpret: interpretToCommand,
    loadItems: async () => (f.items ?? []).map((text, i) => ({ id: `i${i}`, type: 'shopping', text })),
    dispatch: (input) => { dispatched.push(input); },
    onUnhandled: async () => 'hint', onLlmUnavailable: () => replies.push('__unavailable'),
    onNoMatch: (_t, _c, extra) => replies.push(extra?.reply || '__unknown'),
  });
  for (const line of f.before ?? []) engine.remember('t', line.startsWith('assistant:') || line.startsWith('system:') ? line.split(':')[0] : 'you', line.replace(/^(you|assistant|system):\s*/, ''));
  const t0 = Date.now();
  let via = '?';
  try { const r = await engine.ask('t', f.text); via = r?.via ?? '?'; } catch (e) { via = `error:${e.message.slice(0, 40)}`; }
  const ms = Date.now() - t0;
  const got = dispatched[0] ? { op: dispatched[0].opId, args: dispatched[0].args ?? {} } : (replies[0] ? { reply: replies[0] } : null);
  const verdict = judge(f.expect, got, dispatched.length);
  results.push({ id: f.id, text: f.text, via, ms, got, ok: verdict.ok, why: verdict.why });
  console.log(`${verdict.ok ? '✓' : '✗'} ${f.id.padEnd(22)} ${String(ms).padStart(5)}ms ${via.padEnd(15)} ${f.text.slice(0, 48).padEnd(48)} → ${verdict.ok ? describe(got) : `${describe(got)}  (wanted ${describe(f.expect)}) ${verdict.why}`}`);
}
const pass = results.filter((r) => r.ok).length;
const rate = results.length ? pass / results.length : 0;
console.log(`\n${pass}/${results.length} passed (${Math.round(rate * 100)}%) · model ${values.mock ? 'mock' : (values.model || 'default')} · median ${median(results.map((r) => r.ms))} ms`);
process.exit(rate >= Number(values.min) ? 0 : 1);

function judge(expect, got, n) {
  if (!expect) return { ok: true, why: '' };
  if (Array.isArray(expect.anyOf)) {
    const verdicts = expect.anyOf.map((e) => judge(e, got, n));
    const hit = verdicts.find((v) => v.ok);
    return hit ?? { ok: false, why: verdicts.map((v) => v.why).join(' / ') };
  }
  if (expect.op) {
    if (!got?.op) return { ok: false, why: 'no tool call' };
    if (got.op !== expect.op) return { ok: false, why: 'wrong tool' };
    for (const [k, v] of Object.entries(expect.args ?? {})) {
      const g = got.args?.[k];
      const re = v instanceof RegExp ? new RegExp(v.source, v.flags.includes('i') ? v.flags : `${v.flags}i`) : null;   // args compare case-insensitively
      if (re ? !re.test(String(g ?? '')) : String(g ?? '').toLowerCase() !== String(v).toLowerCase()) return { ok: false, why: `arg ${k}=${JSON.stringify(g)}` };
    }
    if (expect.count && n < expect.count) return { ok: false, why: `${n} call(s), wanted ${expect.count}` };
    return { ok: true, why: '' };
  }
  if (expect.reply) {
    if (got?.op) return { ok: false, why: 'called a tool' };
    const text = got?.reply ?? '';
    if (expect.reply === 'asks') return /\?/.test(text) ? { ok: true, why: '' } : { ok: false, why: 'no question' };
    if (expect.reply === 'declines') return text && text !== '__unknown' ? { ok: true, why: '' } : { ok: false, why: 'silence' };
    return { ok: true, why: '' };
  }
  return { ok: !got, why: got ? 'acted' : '' };
}
function describe(x) {
  if (!x) return 'nothing';
  if (x.anyOf) return x.anyOf.map(describe).join(' | ');
  if (x.op) return `${x.op}(${Object.entries(x.args ?? {}).map(([k, v]) => `${k}=${v instanceof RegExp ? v : JSON.stringify(v)}`).join(', ')})`;
  return `reply:${String(x.reply).slice(0, 40)}`;
}
function median(xs) { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }
