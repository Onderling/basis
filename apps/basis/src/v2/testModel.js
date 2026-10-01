/**
 * testModel — a stand-in model for the browser specs, behind the real model interface.
 *
 * A spec puts a script on the page before it boots (`window.__onderlingTestModel = { script: [...] }`); a DEVELOPMENT
 * build (never a released one — the shell only reads it under `import.meta.env.DEV`) then answers its circle bot with
 * `mockProvider`'s script mode instead of a real model. Everything else is the real route: the prompt the engine
 * builds, the tools it hands over, how the answer is read, the gate, the dispatch. Every request is kept on the same
 * object (`requests`), so a spec can check what the model was asked.
 *
 * Script entries are JSON (a spec passes them through the page): `when` is a string the newest member message
 * contains, or `{ re: '<pattern>', flags }` for a pattern; the rest is the answer (`toolCall: {id, args}` or
 * `replyText`).
 */
import { LlmClient, mockProvider } from '@onderling/llm-client';

/** The page's test model, or null. Read once, by a development build only. */
export function readTestModel(g = globalThis) {
  const m = g?.__onderlingTestModel;
  return m && Array.isArray(m.script) ? m : null;
}

/** The provider map a circle picks from, answered by the script (`local`: the mode a circle resolves to). */
export function testModelProviders(model) {
  const script = model.script.map((e) => ({ ...e, when: e?.when?.re ? new RegExp(e.when.re, e.when.flags ?? 'i') : e?.when }));
  if (!Array.isArray(model.requests)) model.requests = [];
  const provider = mockProvider({
    id: 'test-model', script,
    onRequest: (req) => { model.requests.push({ system: req?.system ?? null, messages: req?.messages ?? [], tools: (req?.tools ?? []).map((t) => t?.name ?? t?.id ?? null) }); },
  });
  return { local: new LlmClient({ provider }) };
}
