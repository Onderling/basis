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

  it('a question is shown as it is, asked once', async () => {
    const interpret = vi.fn().mockResolvedValue({ reply: 'Welke lijst bedoel je?' });
    const { cd, noMatch } = harness(interpret);
    await cd.handle('@bot zet het erop');
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(noMatch).toEqual([{ reply: 'Welke lijst bedoel je?' }]);
  });
});
