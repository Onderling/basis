/**
 * A model reply may not claim a result. The walk (2026-09-30): "verander melk en kaas in halfvolle melk" came back as
 * a reply with three "→ halfvolle melk ✓" lines — no tool ran, nothing changed. A reply that says something happened,
 * with no op this turn, is not shown: the model is asked once more; a second claim becomes "I did not do that".
 * The guard reads the reply's text only — no model in it.
 */
import { describe, it, expect, vi } from 'vitest';
import { createCircleDispatch, claimsResult } from '../../src/v2/circleDispatch.js';
import { assistantReplyText } from '../../src/v2/assistantEngine.js';

function harness(interpret) {
  const dispatched = [];
  const noMatch = [];
  const cd = createCircleDispatch({
    catalogue: { opsById: new Map(), commandMenu: [] },
    policy: { llmTool: 'local' }, llmProviders: { local: { invoke: vi.fn() } },
    interpret, botName: 'bot',
    dispatch: (input) => { dispatched.push(input); },
    onNoMatch: (_text, _ctx, extra) => { noMatch.push(extra); },
  });
  return { cd, dispatched, noMatch };
}

describe('a reply that claims a result', () => {
  it('reads a claim: a ✓, or a done-word, in Dutch or English', () => {
    expect(claimsResult('melk → halfvolle melk ✓')).toBe(true);
    expect(claimsResult('Ik heb het aangepast.')).toBe(true);
    expect(claimsResult('Melk is toegevoegd aan de lijst')).toBe(true);
    expect(claimsResult('Done — removed it')).toBe(true);
    expect(claimsResult('Welke lijst bedoel je?')).toBe(false);
    expect(claimsResult('Hoi! Wat kan ik voor je doen?')).toBe(false);
  });

  it('is asked once more; the second answer, a tool call, runs', async () => {
    const interpret = vi.fn()
      .mockResolvedValueOnce({ reply: 'melk → halfvolle melk ✓' })
      .mockResolvedValueOnce({ opId: 'editEntry', args: { item: 'melk', text: 'halfvolle melk' } });
    const { cd, dispatched, noMatch } = harness(interpret);
    await cd.handle('@bot verander melk in halfvolle melk');
    expect(interpret).toHaveBeenCalledTimes(2);
    expect(interpret.mock.calls[1][1].context.at(-1)).toMatch(/described a result without calling a tool/);
    expect(dispatched.map((d) => d.opId)).toEqual(['editEntry']);
    expect(noMatch).toEqual([]);
  });

  it('a second claim is never shown: "I did not do that" instead', async () => {
    const interpret = vi.fn().mockResolvedValue({ reply: '✓ aangepast' });
    const { cd, dispatched, noMatch } = harness(interpret);
    await cd.handle('@bot verander melk in halfvolle melk');
    expect(interpret).toHaveBeenCalledTimes(2);
    expect(dispatched).toEqual([]);
    expect(noMatch).toEqual([{ notDone: true }]);
    expect(assistantReplyText(noMatch[0], (k) => k, 'circle.bot.unknown')).toBe('circle.bot.not_done');
  });

  it('a question that uses a done-word claims nothing; a claim followed by a question still does', () => {
    expect(claimsResult('Aan welke lijst moet het worden toegevoegd?')).toBe(false);
    expect(claimsResult('Which list should it be added to?')).toBe(false);
    expect(claimsResult('Melk is toegevoegd. Nog iets?')).toBe(true);
    expect(claimsResult('kaas → halfvolle melk ✓\nWil je nog iets?')).toBe(true);
  });

  it('a question is shown as it is, asked once', async () => {
    const interpret = vi.fn().mockResolvedValue({ reply: 'Welke lijst bedoel je?' });
    const { cd, noMatch } = harness(interpret);
    await cd.handle('@bot zet het erop');
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(noMatch).toEqual([{ reply: 'Welke lijst bedoel je?' }]);
  });

  // Fable's walk with a real model, 2026-11-17: "wat kan je voor me doen?" was asked twice and the English answer then
  // dropped, because a sentence saying what CAN be done ("what's been done", "wat er al afgevinkt is" under "Ik kan …:")
  // read as a claim. An ability is no claim; a done act still is.
  it('an answer about what can be done is no claim; a done act still is', () => {
    const real = [
      'Ik kan hier een paar dingen voor je doen:\n\n- Afspraken in je agenda zetten, bekijken of zoeken\n- Lijsten aanmaken en bijhouden, met wat erop staat en wat er al afgevinkt is\n- Korte weetjes/notities voor jezelf opschrijven, zodat je ze later terug kunt lezen\n\nWaar kan ik je mee helpen?',
      'Ik kan hier een paar dingen voor je doen:\n\n- Afspraken in je agenda zetten, bekijken of zoeken\n- Lijsten bijhouden: zien wat erop staat en wat er de afgelopen dagen afgerond is\n- Eigen weetjes/notities opschrijven en teruglezen\n\nWaar zal ik mee beginnen?',
      "I can help you with your own stuff here:\n\n- Keep your own notes — jot down things you want to remember\n- Manage your appointments — add events, see what's coming up, search your calendar\n- Work with your lists — see what's on them, what's been done\n\nWhat would you like to do?",
      "I can help with your own stuff here: keep your notes, manage your appointments (add, search, and see what's coming up), and work with your lists — see what's on them, add things, and show what's been done. What would you like to do?",
    ];
    for (const r of real) expect(claimsResult(r), r.slice(0, 60)).toBe(false);
    expect(claimsResult('Ik heb melk toegevoegd.')).toBe(true);
    expect(claimsResult('Melk is toegevoegd. Ik kan nog meer doen als je wilt.')).toBe(true);
    expect(claimsResult('Done, I added it. I can add more?')).toBe(true);
    // an ability word later in the sentence does not hide a done act (Fable's review): only an opening that IS one counts
    expect(claimsResult('Ik heb melk toegevoegd en zal je eraan herinneren.')).toBe(true);
    expect(claimsResult("I added milk, I'll remind you.")).toBe(true);
  });
});

