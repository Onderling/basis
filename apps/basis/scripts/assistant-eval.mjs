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
 *   node scripts/assistant-eval.mjs --apps lists   # the bot's app list (default: the household template's — lists, tasks)
 *   node scripts/assistant-eval.mjs --from-log ~/.basis-telegram/walk-log-*.jsonl   # print fixture stubs from a walk
 *
 * Exit code 1 when the pass rate is under --min (default 0.85). Fixtures: scripts/assistant-eval.fixtures.mjs.
 */
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { createAssistantEngine } from '../src/v2/assistantEngine.js';
import { scopeCatalogueToRole, roleHintsFor } from '../src/v2/botOpMap.js';
import { listsGateRules } from '../src/v2/circleGate.js';
import { HOUSEHOLD_TEMPLATE, templateLists, botPromptLines, expandAdds } from '../src/v2/householdTemplate.js';
import { interpretToCommand } from '../src/v2/interpretCommand.js';
import { FIXTURES } from './assistant-eval.fixtures.mjs';
import { detectLang } from '../src/v2/assistantLanguage.js';

const { values } = parseArgs({ options: {
  model: { type: 'string' }, only: { type: 'string' }, min: { type: 'string', default: '0.85' },
  mock: { type: 'boolean', default: false }, 'from-log': { type: 'string' }, lang: { type: 'string', default: 'nl' }, 'door-lang': { type: 'string' },
  apps: { type: 'string' },
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

// What the household bot's door hands a MEMBER's model: the bot's slim map over its plugins (lists, tasks — the
// template's), the template's words about its lists, and the deterministic gate that speaks the lists. Composed the
// way the box composes a function profile (`bin/device-runner.mjs`).
// The template's list names as the box says them: read from the Dutch bundle, not a copy of its own.
const NL = JSON.parse(readFileSync(new URL('../src/locales/circle.nl.json', import.meta.url), 'utf8'));
const tNl = (key) => {
  const v = key.replace(/^circle\./, '').split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), NL);
  return typeof v === 'string' ? v : (v && typeof v.text === 'string' ? v.text : key);
};
const { catalogue: botCatalogue } = composeAssistantCatalogue({ apps: values.apps ? values.apps.split(',') : [...HOUSEHOLD_TEMPLATE.apps], slim: true });
const catalogue = scopeCatalogueToRole(botCatalogue, 'member');
const gateRulesFor = (lang) => listsGateRules(lang, templateLists(tNl));
let llm = null;
if (!values.mock) {
  const { privatemodeProvider, readPrivatemodeKey } = await import('@onderling/llm-client/providers/privatemode');
  const { LlmClient } = await import('@onderling/llm-client');
  if (!readPrivatemodeKey()) { console.error('assistant-eval: no Privatemode key — pass --mock or add ~/.privatemode-apikey'); process.exit(2); }
  llm = new LlmClient({ provider: await privatemodeProvider({ model: values.model || undefined, timeoutMs: 60_000 }) });
} else {
  // the same stand-in the browser specs use (llm-client's mockProvider), behind the real client
  const { LlmClient, mockProvider } = await import('@onderling/llm-client');
  llm = new LlmClient({ provider: mockProvider({ responses: [{ replyText: 'Welke lijst bedoel je?' }] }) });
}

const fixtures = FIXTURES.filter((f) => !values.only || f.id.includes(values.only));
const results = [];
for (const f of fixtures) {
  const dispatched = [];
  const replies = [];
  let modelCalls = 0;
  let peeked = null;   // a read the model picked first and the turn looked at (the box's read-then-act step)
  const counted = { invoke: (req) => { modelCalls += 1; return llm.invoke(req); } };
  const engine = createAssistantEngine({
    // --door-lang puts EVERY fixture on one door (an English line on a Dutch door must still be answered in English)
    catalogue, lang: values['door-lang'] ?? f.lang ?? values.lang, llm: counted, interpret: interpretToCommand,
    promptLines: botPromptLines(tNl), gateRules: gateRulesFor(values['door-lang'] ?? f.lang ?? values.lang),
    // A one-line fixture does not wait for the collect window (its time is the model's); lines sent at once do.
    ...(f.lines ? {} : { collectMs: 0 }),
    // the bot's retrieval shape (`loadListItems`): an entry, with its list
    // (an item that names its list — "lamp vervangen (Klusjes)" — keeps it; one that does not is a Boodschappen entry)
    loadItems: async () => (f.items ?? []).map((text, i) => ({ id: `i${i}`, type: 'list-item', text: /\([^)]+\)\s*$/.test(text) ? text : `${text} (Boodschappen)` })),
    dispatch: (input) => { dispatched.push(input); },
    // As the box: a read the model picks first is looked at (here: the fixture's entries, with their ids) and handed
    // back once; the member's thread names the admin's tools.
    peek: async (cmd) => { peeked = cmd.opId; return { payload: { items: (f.items ?? []).map((text, i) => ({ id: `i${i}`, label: text })) } }; },
    // with the door's translator, as the box hands it: the model is given the refusal sentence itself
    threadHints: () => roleHintsFor('member', tNl),
    expand: expandAdds({ t: tNl }),
    onUnhandled: async () => 'hint', onLlmUnavailable: () => replies.push('__unavailable'),
    onNoMatch: (_t, _c, extra) => replies.push(extra?.reply || '__unknown'),
  });
  for (const line of f.before ?? []) engine.remember('t', line.startsWith('assistant:') || line.startsWith('system:') ? line.split(':')[0] : 'you', line.replace(/^(you|assistant|system):\s*/, ''));
  const t0 = Date.now();
  let via = '?';
  const text = f.text ?? f.lines.join(' / ');
  try {
    const r = f.lines ? (await Promise.all(f.lines.map((l) => engine.ask('t', l))))[0] : await engine.ask('t', f.text);
    via = r?.via ?? '?';
  } catch (e) { via = `error:${e.message.slice(0, 40)}`; }
  const ms = Date.now() - t0;
  const got = dispatched[0] ? { op: dispatched[0].opId, args: dispatched[0].args ?? {} } : (replies[0] ? { reply: replies[0] } : null);
  let verdict = judge(f.expect, got, dispatched.length);
  if (verdict.ok && f.lines && modelCalls > 1) verdict = { ok: false, why: `${modelCalls} model calls, wanted one turn` };
  results.push({ id: f.id, text, via, ms, got, ok: verdict.ok, why: verdict.why, readFirst: Boolean(peeked) });
  console.log(`${verdict.ok ? '✓' : '✗'} ${f.id.padEnd(22)} ${String(ms).padStart(5)}ms ${(peeked ? `${via}·read` : via).padEnd(15)} ${text.slice(0, 48).padEnd(48)} → ${verdict.ok ? describe(got) : `${describe(got)}  (wanted ${describe(f.expect)}) ${verdict.why}`}`);
}
const pass = results.filter((r) => r.ok).length;
const rate = results.length ? pass / results.length : 0;
console.log(`\n${pass}/${results.length} passed (${Math.round(rate * 100)}%) · model ${values.mock ? 'mock' : (values.model || 'default')} · median ${median(results.map((r) => r.ms))} ms`);
// What the read-before-act step costs: the turns whose first pick was a read (one more model call each).
const readFirst = results.filter((r) => r.readFirst);
console.log(`read-first turns: ${readFirst.length}/${results.length}${readFirst.length ? ` (${readFirst.map((r) => r.id).join(', ')})` : ''}`);
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
    if (expect.exact && n !== (expect.count ?? 1)) return { ok: false, why: `${n} call(s), wanted exactly ${expect.count ?? 1}` };
    return { ok: true, why: '' };
  }
  if (expect.reply) {
    if (got?.op) return { ok: false, why: 'called a tool' };
    const text = got?.reply ?? '';
    if (expect.reply === 'asks') return /\?/.test(text) ? { ok: true, why: '' } : { ok: false, why: 'no question' };
    if (expect.reply === 'declines' && !(text && text !== '__unknown')) return { ok: false, why: 'silence' };
    // `says`: what the reply must SAY (a RegExp over its text) — "it answered" is not "it answered right"
    if (expect.says instanceof RegExp && !expect.says.test(text)) return { ok: false, why: `does not say ${expect.says}` };
    // `in`: the answer's language, read by the same counter the hint uses (undecided counts as a pass)
    if (expect.in && detectLang(text) && detectLang(text) !== expect.in) return { ok: false, why: `answered in ${detectLang(text)}` };
    if (expect.reply === 'declines') return { ok: true, why: '' };
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
