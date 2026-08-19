/**
 * LIVE household pipeline harness — drives the REAL circle bot end-to-end against a
 * LIVE LLM (Ollama / Qwen2.5) + the real apps/household agent (the Option-B rewire).
 *
 * It exercises the genuine path: tokenGate → interpretToCommand (the live model) →
 * callSkill → real household skills → adaptHouseholdReply → structured reply. Plus
 * F-retrieve grounding (lexical by default; SEMANTIC when EMBED_BASEURL is set), and
 * the "basic mode" reply (point the LLM at a dead endpoint to see it).
 *
 * ── ENV-GATED ── skips entirely unless LIVE_LLM=1, so CI / `npm test` never need a model.
 *
 *   LIVE_LLM=1 \
 *   OLLAMA_BASEURL=http://127.0.0.1:11434 \
 *   OLLAMA_MODEL=qwen2.5:7b-instruct \
 *     npx vitest run test/live/householdPipeline.live.test.js
 *
 *   # also exercise F-retrieve tier-2 (semantic) — point at the enclave / an embed route:
 *   EMBED_BASEURL=… EMBED_MODEL=qwen3-embedding-4b  (add to the above)
 *
 * HARD assertions are model-INDEPENDENT (the wiring + adaptHouseholdReply structured
 * shapes must hold). The live model's free-text tool-picks are LOGGED in a transcript
 * for you to judge — small-model variance is reported, not failed.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { LlmClient } from '@onderling/llm-client';
import { ollamaProvider } from '@onderling/llm-client/providers/ollama';

import { createRealHouseholdAgent } from '../../src/web/realAgent.js';
import { mergeManifests }            from '../../src/manifestMerge.js';
import { createCircleDispatch }      from '../../src/v2/circleDispatch.js';
import { interpretToCommand }        from '../../src/v2/interpretCommand.js';
import { createTokenGate }           from '../../src/v2/tokenGate.js';
import { circleGateRules }           from '../../src/v2/circleGate.js';
import { makeCircleRetriever }       from '../../src/v2/circleRetriever.js';
import { buildCircleEmbedProviders } from '../../src/v2/circleEmbedProviders.js';
import { resolveCircleEmbedder }     from '../../src/v2/embedPicker.js';

const LIVE           = process.env.LIVE_LLM === '1';
const OLLAMA_BASEURL = process.env.OLLAMA_BASEURL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL   = process.env.OLLAMA_MODEL   || 'qwen2.5:7b-instruct';
const EMBED_BASEURL  = process.env.EMBED_BASEURL  || null;
const EMBED_MODEL    = process.env.EMBED_MODEL    || undefined;
// Bearer keys for an OpenAI-compatible gateway (e.g. the Privatemode loopback
// proxy). Unset → local Ollama (no auth). For Privatemode: point *_BASEURL at the
// proxy root (e.g. http://localhost:8080) + set the project key here.
const LLM_APIKEY     = process.env.LLM_APIKEY     || undefined;
const EMBED_APIKEY   = process.env.EMBED_APIKEY   || LLM_APIKEY;   // same proxy by default
const BOT            = 'assistant';

/** Fail loudly (not vacuously) when LIVE_LLM=1 but the endpoint isn't up. */
async function assertReachable() {
  // Probe the OpenAI-compatible model list (`/v1/models`) — works for BOTH local
  // Ollama AND the Privatemode loopback proxy. (Ollama's own `/api/tags` 404s on
  // the OpenAI-shaped Privatemode proxy, which has no such route.) Normalise the
  // base (strip a trailing `/v1`) and send the Bearer key if one is set.
  const url = `${OLLAMA_BASEURL.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/models`;
  try {
    const res = await fetch(url, {
      method:  'GET',
      headers: LLM_APIKEY ? { Authorization: `Bearer ${LLM_APIKEY}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    throw new Error(
      `[live] LLM endpoint not reachable at ${url} (${err?.message ?? err}). ` +
      `Local Ollama: \`ollama serve\` + \`ollama pull ${OLLAMA_MODEL}\`. ` +
      `Privatemode: start the privatemode-proxy (OpenAI /v1 on :8080).`,
    );
  }
}

function fmt(transcript) {
  return transcript.map((t) => {
    if (t.kind === 'user')       return `\n🧑 ${t.text}`;
    if (t.kind === 'via')        return `   ↳ via=${t.via}${t.cmd ? ` cmd=${t.cmd.opId}(${JSON.stringify(t.cmd.args ?? {})})` : ''}`;
    if (t.kind === 'dispatch')   return `   ⚙️  ${t.opId}(${JSON.stringify(t.args ?? {})}) → ${JSON.stringify(t.reply)?.slice(0, 160)}`;
    if (t.kind === 'post')       return `   💬 (posted to circle) ${t.text}`;
    if (t.kind === 'no-match')   return `   🤷 (llm-nomatch) "${t.text}"`;
    if (t.kind === 'basic-mode') return `   🔌 (basic-mode reply, reason=${t.reason})`;
    return `   ? ${JSON.stringify(t)}`;
  }).join('\n');
}

async function buildBot() {
  const agent   = await createRealHouseholdAgent();
  const catalog = mergeManifests([{ manifest: agent.manifest }]);

  // Live LLM — generous timeout (a cold 7B on CPU can exceed the app's 12s default).
  const llm = new LlmClient({ provider: ollamaProvider({ baseUrl: OLLAMA_BASEURL, model: OLLAMA_MODEL, apiKey: LLM_APIKEY, timeoutMs: 90_000 }) });
  const llmProviders = { local: llm };

  // F-retrieve grounds on the REAL household items (listOpen), semantic if EMBED_BASEURL set.
  const loadItems = async () => {
    const r = await agent.callSkill('household', 'listOpen', {});
    return (r?.items ?? []).map((it) => ({ id: it.id, label: it.text ?? it.label, kind: it.type ?? 'item' }));
  };
  let embed;
  if (EMBED_BASEURL) {
    const providers = buildCircleEmbedProviders({ localBaseUrl: EMBED_BASEURL, model: EMBED_MODEL, apiKey: EMBED_APIKEY });
    embed = async (texts) => {
      const e = resolveCircleEmbedder({ circlePolicy: { embedTool: 'local' }, providers });
      if (!e) throw new Error('no-embedder');
      return e.embed(texts);
    };
  }
  const retrieve = makeCircleRetriever({ embed, loadItems });

  const transcript = [];
  const cd = createCircleDispatch({
    catalog,
    policy: { llmTool: 'local' },
    llmProviders,
    interpret: interpretToCommand,
    gate: createTokenGate({ rules: circleGateRules('en'), retrieve }),
    botName: BOT,
    dispatch: async (input) => {
      const cmd = typeof input === 'string' ? null : input;
      if (!cmd?.opId) return null;
      const entry = catalog.opsById.get(cmd.opId) ?? catalog.opsById.get(`household/${cmd.opId}`);
      const appOrigin = entry?.appOrigin ?? 'household';
      const reply = await agent.callSkill(appOrigin, cmd.opId, cmd.args ?? {});
      transcript.push({ kind: 'dispatch', opId: cmd.opId, args: cmd.args, reply });
      return reply;
    },
    postToCircle:      (text) => { transcript.push({ kind: 'post', text }); },
    onNoMatch:        (text) => { transcript.push({ kind: 'no-match', text }); },
    onLlmUnavailable: (text, _ctx, info) => { transcript.push({ kind: 'basic-mode', text, reason: info?.reason }); },
  });

  const turn = async (text) => {
    transcript.push({ kind: 'user', text });
    const r = await cd.handle(`@${BOT} ${text}`, {});
    transcript.push({ kind: 'via', via: r.via, cmd: r.cmd });
    return r;
  };
  const hasItem = async (re) => {
    const r = await agent.callSkill('household', 'listOpen', {});
    return (r?.items ?? []).some((i) => re.test(String(i.text ?? i.label ?? '')));
  };
  return { agent, cd, transcript, turn, hasItem };
}

describe.runIf(LIVE)(`LIVE household pipeline — ${OLLAMA_MODEL} @ ${OLLAMA_BASEURL}`, () => {
  it('drives a real household NL journey end-to-end (wiring HARD-asserted; model behaviour logged)', async () => {
    await assertReachable();
    const { agent, transcript, turn, hasItem } = await buildBot();

    // ── HARD (model-independent): adaptHouseholdReply structured shapes ──
    const added = await agent.callSkill('household', 'addItem', { type: 'shopping', text: 'fresh bread' });
    expect(added).toMatchObject({ ok: true });                 // ACTION shape {ok,message,itemId}
    expect(typeof added.itemId === 'string' || added.itemId == null).toBe(true);

    const list = await agent.callSkill('household', 'listOpen', {});
    expect(Array.isArray(list.items)).toBe(true);              // LIST shape {items:[…]}
    expect(list.items.some((i) => /fresh bread/i.test(i.text ?? ''))).toBe(true);
    expect(list.items[0]).toHaveProperty('id');               // structured per-row → inline buttons render

    // ── LIVE journey: drive NL through the real model ──
    await turn('what do I still need to get?');                // free-text → LLM (no gate verb) → list
    await turn('I got the fresh bread');                       // LLM → markComplete{match}
    const breadGone = !(await hasItem(/fresh bread/i));
    await turn('I will do the vacuuming');                     // LLM → claim/grab a task
    await turn('add olive oil to the shopping list');          // gate OR llm → add
    const oilAdded = await hasItem(/olive oil/i);

    // eslint-disable-next-line no-console
    console.log(`\n=== LIVE TRANSCRIPT (embeddings: ${EMBED_BASEURL ? 'semantic' : 'lexical'}) ===\n${fmt(transcript)}\n`);

    // ── HARD: the pipeline ran end-to-end against the live model (≥1 turn reached the LLM, no throw) ──
    expect(transcript.some((t) => t.kind === 'via' && (t.via === 'llm' || t.via === 'rule'))).toBe(true);
    expect(transcript.some((t) => t.kind === 'dispatch')).toBe(true);

    // ── SOFT (live-model behaviour): report, don't fail on small-model variance ──
    if (!breadGone) console.warn('[live] model did NOT complete "fresh bread" from "I got the fresh bread"');
    if (!oilAdded)  console.warn('[live] "add olive oil" did NOT land an item (gate/LLM args?)');
    console.log(`[live] NL outcomes — complete-by-phrase: ${breadGone ? '✓' : '✗'} · add-by-phrase: ${oilAdded ? '✓' : '✗'}`);
  }, 240_000);
});
