/**
 * The assistant's memory reaches the model as a CONVERSATION, and a turn with many acts is not silently cut short.
 *
 * History: the remembered turns used to be woven into the system prompt as lines ("you: …", "assistant: …"), so the
 * model read its own earlier words as instructions rather than as what it had said. The member's and the assistant's
 * turns now go as real messages, and an op's result stays in the conversation at its place, as the app's note on the
 * member's side: moved out into the prompt, the request it answered read as unanswered and the model did it again
 * (measured: 21/27 against 27/27); in the assistant's voice, the model would imitate it instead of calling a tool.
 *
 * Many acts: a member naming many items gets one tool call each, capped per turn; a call the model's output cut off
 * (its arguments did not parse) is not dispatched as an empty act, and the member is asked for the rest.
 */
import { describe, it, expect } from 'vitest';
import { mergeManifests } from '../src/manifestMerge.js';
import { householdManifest } from '../../household/manifest.js';
import { listsManifest } from '../../lists/manifest.js';
import { createAssistantEngine, assistantReplyText } from '../src/v2/assistantEngine.js';
import { interpretToCommand } from '../src/v2/interpretCommand.js';
import { parseOpenAIChatResponse } from '@onderling/llm-client/providers/ollama';
import { sharedCircleLocale } from '../src/locales/index.js';

const catalogue = mergeManifests([{ manifest: householdManifest }, { manifest: listsManifest }]);
const nl = (key) => key.split('.').slice(1).reduce((o, k) => o?.[k], sharedCircleLocale.nl)?.text ?? key;

function engineWith(llm, extra = {}) {
  const dispatched = [];
  const noMatch = [];
  const engine = createAssistantEngine({
    catalogue, lang: 'nl', llm, interpret: interpretToCommand,
    dispatch: (input) => { dispatched.push(input); },
    onUnhandled: async () => 'hint', onLlmUnavailable: () => {},
    onNoMatch: (_t, _c, opts) => { noMatch.push(opts ?? {}); },
    ...extra,
  });
  return { engine, dispatched, noMatch };
}

describe('the remembered turns go to the model as a conversation', () => {
  it('the member and the assistant as messages; an op result as the app\'s note at its place; no transcript in the system prompt', async () => {
    let req = null;
    const { engine } = engineWith({ invoke: async (r) => { req = r; return { toolCall: null, replyText: 'Welke lijst?' }; } });
    engine.remember('t', 'you', 'zet kaas op de lijst');
    engine.remember('t', 'assistant', 'Welke lijst bedoel je?');
    engine.remember('t', 'system', 'toegevoegd aan boodschappen: kaas');
    engine.remember('t', 'you', 'en broccoli ook');
    await engine.ask('t', 'wat staat er nu op');

    expect(req.messages).toEqual([
      { role: 'user', content: 'zet kaas op de lijst' },
      { role: 'assistant', content: 'Welke lijst bedoel je?' },
      { role: 'user', content: '(the app answered: toegevoegd aan boodschappen: kaas)' },
      { role: 'user', content: 'en broccoli ook' },
      { role: 'user', content: 'wat staat er nu op' },
    ]);
    expect(req.system).not.toMatch(/^- ?(you|assistant): /m);
    expect(req.system).not.toContain('toegevoegd aan boodschappen: kaas');
    expect(req.messages.filter((m) => m.role === 'assistant').map((m) => m.content)).not.toContain('toegevoegd aan boodschappen: kaas');
  });
});

describe('a turn with many acts', () => {
  it('a call the output cut off is marked, not handed on with empty arguments', () => {
    const parsed = parseOpenAIChatResponse({ choices: [{ message: { tool_calls: [
      { function: { name: 'addItem', arguments: '{"type":"shopping","text":"melk"}' } },
      { function: { name: 'addItem', arguments: '{"type":"shopping","te' } },
    ] } }] });
    expect(parsed.toolCalls[0].truncated).toBeUndefined();
    expect(parsed.toolCalls[1].truncated).toBe(true);
  });

  it('three whole calls and a cut-off fourth: three dispatches, and the member is asked for the rest', async () => {
    const call = (text) => ({ id: 'addItem', args: { type: 'shopping', text } });
    const calls = [call('melk'), call('brood'), call('eieren'), { id: 'addItem', args: {}, truncated: true }];
    const { engine, dispatched, noMatch } = engineWith({ invoke: async () => ({ toolCall: calls[0], toolCalls: calls }) });
    await engine.ask('t', 'melk, brood, eieren en kaas');
    expect(dispatched.map((d) => d.args.text)).toEqual(['melk', 'brood', 'eieren']);
    expect(noMatch).toHaveLength(1);
    expect(assistantReplyText(noMatch[0], nl, 'circle.bot.unknown')).toBe('En verder?');
  });

  it('more calls than the per-turn cap: the cap is dispatched, and the member is asked for the rest', async () => {
    const calls = Array.from({ length: 11 }, (_, i) => ({ id: 'addItem', args: { type: 'shopping', text: `item ${i}` } }));
    const { engine, dispatched, noMatch } = engineWith({ invoke: async () => ({ toolCall: calls[0], toolCalls: calls }) });
    await engine.ask('t', 'een lange lijst');
    expect(dispatched).toHaveLength(8);
    expect(noMatch).toHaveLength(1);
    expect(noMatch[0].partial).toBe(true);
  });

  it('the reply line: the model\'s own words first, then "en verder?" for a cut turn, else the door\'s fallback', () => {
    expect(assistantReplyText({ reply: 'Welke lijst?' }, nl, 'circle.bot.unknown')).toBe('Welke lijst?');
    expect(assistantReplyText({ partial: true }, nl, 'circle.bot.unknown')).toBe('En verder?');
    expect(assistantReplyText(undefined, nl, 'circle.bot.unknown')).toBe(nl('circle.bot.unknown'));
  });
});
