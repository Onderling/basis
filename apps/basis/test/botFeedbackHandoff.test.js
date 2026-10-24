/**
 * FEEDBACK ABOUT THE APP, SAID TO THE HOUSEHOLD BOT, GETS ONE HONEST LINE — never a promise, never a store (Frits
 * 2026-10-09: everything feedback is the feedback repo's; basis carries no feedback code). The line names where app
 * feedback goes: the link to add Onderling's feedback contact (the build's card, the one every fresh app carries), or —
 * on a box without a card — that this bot has none to give. Nothing is forwarded. The deterministic gate takes "feedback: …" lines, so they are answered even when the model is down (the household's log:
 * one was lost in an update window); the model gets the same op as a tool instead of promising a change.
 */
import { describe, it, expect } from 'vitest';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { listsGateRules } from '../src/v2/circleGate.js';
import { assistantManifest } from '../src/v2/assistantManifest.js';
import { HOUSEHOLD_TEMPLATE, templateLists } from '../src/v2/householdTemplate.js';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
const LISTS = templateLists((k) => ({ 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes' }[k] ?? k));
const gateOp = (text) => { for (const r of listsGateRules('nl', LISTS)) { const c = r.command(text); if (c) return c; } return null; };

async function bot({ feedback = {} } = {}) {
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  await threads.load();
  const stored = new Map();
  const calls = [];
  const inner = async (app, op, args) => {
    calls.push(`${app}.${op}`);
    if (app === 'params' && op === 'set-param') { stored.set(args.key, args.value); return { ok: true }; }
    if (app === 'params' && op === 'list-user-params') return { ok: true, params: [...stored].map(([key, value]) => ({ key, value })) };
    return { ok: false };
  };
  return { call: withAssistantOps({ callSkill: inner, threads, t, admin: {}, feedback }), stored, calls };
}

describe('feedback about the app', () => {
  it('the gate takes a feedback line — with or without "voor <naam>", with or without a colon', () => {
    for (const line of ['Feedback voor Frits: scheidingsteken voor meerdere items?', 'feedback: de knop doet niets', 'Feedback de lijst ververst niet']) {
      expect(gateOp(line), line).toMatchObject({ opId: 'assistant-feedback', appOrigin: 'assistant' });
    }
    expect(gateOp('wat vind je van de feedback'), 'a line that merely mentions it is not feedback').toBe(null);
  });

  it('no card on this box: says so, stores nothing, sends nothing, promises nothing', async () => {
    const { call, calls } = await bot();
    const r = await call('assistant', 'assistant-feedback', {}, { threadId: 'telegram:1' });
    expect(r).toMatchObject({ ok: true, message: 'circle.bot.feedback_no_contact' });
    expect(calls, 'it reads and writes nothing anywhere').toEqual([]);
  });

  it('with the build\'s card: the line carries the link to add Onderling\'s feedback contact — and nothing else', async () => {
    const { call, calls } = await bot({ feedback: { card: 'onderling-contact://abc', appUrl: 'https://onderling.org/basis/' } });
    const r = await call('assistant', 'assistant-feedback', {}, { threadId: 'telegram:1' });
    expect(r.message).toBe('circle.bot.feedback_contact {"link":"https://onderling.org/basis/#contact=abc"}');
    expect(calls, 'nothing is forwarded or stored').toEqual([]);
  });

  it('the admin\'s feedback channel is gone: no setting takes it', async () => {
    const { call } = await bot();
    expect((await call('assistant', 'assistant-settings', { change: 'feedback @onderling_feedback_bot' })).ok).toBe(false);
  });

  it('the model has it as a tool, described as a hand-off, never a change', () => {
    const op = assistantManifest.operations.find((o) => o.id === 'assistant-feedback');
    expect(op?.surfaces?.chat?.hint).toMatch(/feedback/i);
    expect(op.surfaces.chat.hint).toMatch(/never promise/i);
    expect(op.params, 'it asks for none of the person\'s words').toEqual([]);
  });
});
