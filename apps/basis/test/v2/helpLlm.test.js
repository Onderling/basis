import { describe, it, expect } from 'vitest';
import { answerHelpViaLlm, HELP_ANSWER_SYSTEM } from '../../src/v2/help/helpLlm.js';
import { rankHelpCards } from '../../src/v2/help/helpAnswer.js';
import { helpLlmLabelKeys } from '../../src/v2/helpChat.js';
import { helpDeck } from '../../src/v2/help/kaartjes.js';

// A fake @onderling/llm-client: records the last invoke() request and returns a scripted reply.
function fakeClient(reply, sink = {}) {
  return {
    invoke: async (req) => { sink.req = req; return { replyText: reply, toolCall: null, raw: {} }; },
  };
}

describe('help RAG · rankHelpCards', () => {
  it('ranks the related cards first, localized, best score first', () => {
    const ranked = rankHelpCards('Wat kost het?', { lang: 'nl', limit: 4 });
    expect(ranked.length).toBeGreaterThan(0);
    // The cost card should win for a cost question.
    expect(ranked[0].id).toBe('praktisch.kosten');
    expect(ranked[0].kop).toBe('Wat kost het?');
    expect(ranked[0].text).toBe(helpDeck.kaartjes.find((k) => k.id === 'praktisch.kosten').nl);
    // sorted descending by score.
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
  });

  it('an off-topic query overlaps nothing → empty (the digest-fallback trigger)', () => {
    expect(rankHelpCards('xyzzy quux frobnicate', { lang: 'nl' })).toEqual([]);
  });

  it('empty / non-string query → empty', () => {
    expect(rankHelpCards('', { lang: 'nl' })).toEqual([]);
    expect(rankHelpCards(null, { lang: 'nl' })).toEqual([]);
  });
});

describe('help LLM · answerHelpViaLlm', () => {
  it('builds a grounded HELP prompt (voice + related cards) and returns the model text', async () => {
    const sink = {};
    const client = fakeClient('Het is gratis en open source.', sink);
    const out = await answerHelpViaLlm({ query: 'Wat kost het?', lang: 'nl', client, deck: helpDeck });
    expect(out).toEqual({ text: 'Het is gratis en open source.' });
    // The system prompt carries the HELP voice + the grounding block (the cost card text), NOT a tool list.
    expect(sink.req.system).toContain(HELP_ANSWER_SYSTEM);
    expect(sink.req.system).toContain('Reference cards');
    expect(sink.req.system).toContain(helpDeck.kaartjes.find((k) => k.id === 'praktisch.kosten').nl);
    expect(sink.req.system).toContain('Antwoord in het Nederlands.');
    // A plain chat call — no tools handed to the model.
    expect(sink.req.tools).toBeUndefined();
    expect(sink.req.messages).toEqual([{ role: 'user', content: 'Wat kost het?' }]);
  });

  it('grounds an off-topic ask on the full-deck digest (still no tools, honest voice)', async () => {
    const sink = {};
    const client = fakeClient('Daar heb ik geen vast antwoord op.', sink);
    const out = await answerHelpViaLlm({ query: 'xyzzy quux frobnicate', lang: 'nl', client, deck: helpDeck });
    expect(out).toEqual({ text: 'Daar heb ik geen vast antwoord op.' });
    // Digest fallback → the block references multiple cards' text (more than a single top-N hit).
    const basis = helpDeck.kaartjes.find((k) => k.id === 'product.basis').nl;
    const circles = helpDeck.kaartjes.find((k) => k.id === 'werking.circles').nl;
    expect(sink.req.system).toContain(basis);
    expect(sink.req.system).toContain(circles);
  });

  it('answers in English for lang=en', async () => {
    const sink = {};
    const client = fakeClient('It is free and open source.', sink);
    await answerHelpViaLlm({ query: 'What does it cost?', lang: 'en', client, deck: helpDeck });
    expect(sink.req.system).toContain('Answer in English.');
    expect(sink.req.system).toContain(helpDeck.kaartjes.find((k) => k.id === 'praktisch.kosten').en);
  });

  it('returns null on an empty model reply (never faked)', async () => {
    const out = await answerHelpViaLlm({ query: 'Wat kost het?', lang: 'nl', client: fakeClient('   '), deck: helpDeck });
    expect(out).toBeNull();
  });

  it('returns null on an empty query, a missing client, or a client error', async () => {
    expect(await answerHelpViaLlm({ query: '', lang: 'nl', client: fakeClient('x') })).toBeNull();
    expect(await answerHelpViaLlm({ query: 'hi', lang: 'nl', client: null })).toBeNull();
    expect(await answerHelpViaLlm({ query: 'hi', lang: 'nl', client: {} })).toBeNull();
    const throwing = { invoke: async () => { throw new Error('network'); } };
    expect(await answerHelpViaLlm({ query: 'hi', lang: 'nl', client: throwing, deck: helpDeck })).toBeNull();
  });

  it('defaults to helpDeck when no deck is passed', async () => {
    const sink = {};
    await answerHelpViaLlm({ query: 'Wat kost het?', lang: 'nl', client: fakeClient('ok', sink) });
    expect(sink.req.system).toContain(helpDeck.kaartjes.find((k) => k.id === 'praktisch.kosten').nl);
  });
});

// The composition both shells run in runHelpLlm: forward the CONSENTED query to the dedicated help path,
// then stamp the ROUTE-CONDITIONAL badge on a produced answer, or fall back honestly on null. This mirrors
// the shell wiring (circleApp.js / CircleLauncherScreen.js) without a DOM, so the contract can't drift.
describe('help LLM · shell composition (consent-gated forward + route-conditional badge)', () => {
  it('only forwards on a MISS + "ja, doorsturen"; a produced answer stamps the route-honest badge', async () => {
    // A deterministic HIT never reaches the LLM (routeHelpMessage owns the gate — see helpChat.test.js);
    // here we assert the post-consent branch. Confidential route → the confidential badge key.
    const client = fakeClient('Je kiest zelf het taalmodel.');
    const reply = (await answerHelpViaLlm({ query: 'hoe zit het met AI?', lang: 'nl', client, deck: helpDeck }))?.text;
    expect(reply).toBe('Je kiest zelf het taalmodel.');
    expect(helpLlmLabelKeys({ confidential: true }).badgeKey).toBe('circle.help.provenance_llm');
    expect(helpLlmLabelKeys({ confidential: false }).badgeKey).toBe('circle.help.provenance_llm_plain');
  });

  it('a null answer means the shell shows the honest no-answer fallback (never a faked badge)', async () => {
    const reply = (await answerHelpViaLlm({ query: 'hoe zit het met AI?', lang: 'nl', client: fakeClient(''), deck: helpDeck }))?.text ?? null;
    expect(reply).toBeNull();   // → shell posts circle.help.llm_no_answer + topics, no provenance badge
  });
});
