/**
 * The household's notes in people's own words: the gate turns "onthoud dat …" / "weetje: …" into household's people-
 * written note (its generic add), "welke weetjes zijn er" into its list, "vergeet het weetje over …" into its remove (the
 * dispatch finds it by those words) — and the bot's retriever reads the notes beside the open list items.
 */
import { describe, it, expect } from 'vitest';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { listsGateRules } from '../../src/v2/circleGate.js';
import { templateLists } from '../../src/v2/householdTemplate.js';
import { loadAssistantItems } from '../../src/v2/assistantEngine.js';

const op = (atom) => encodeGenericOpId('household', atom, 'note');

describe('the household\'s notes, in people\'s words', () => {
  const rules = listsGateRules('nl', templateLists((k) => k));
  const cmd = (text) => rules.map((r) => r.command(text)).find(Boolean) ?? null;

  it('"onthoud dat …" / "weetje: …" writes one; "welke weetjes zijn er" reads them; "vergeet het weetje over …" takes one away', () => {
    expect(cmd('onthoud dat de vuilnis dinsdag buiten gaat')).toMatchObject({ opId: op('add'), args: { body: 'de vuilnis dinsdag buiten gaat' }, appOrigin: 'household' });
    expect(cmd('weetje: de wifi-code staat op de koelkast')).toMatchObject({ opId: op('add'), args: { body: 'de wifi-code staat op de koelkast' } });
    expect(cmd('welke weetjes zijn er')).toMatchObject({ opId: op('list') });
    expect(cmd('vergeet het weetje over de wifi')).toMatchObject({ opId: op('remove'), args: { id: 'de wifi' } });
    expect(cmd('vergeet alles')?.opId).not.toBe(op('remove'));
  });

  it('the retriever\'s pool holds the notes beside the open list items', async () => {
    const callSkill = async (_app, o) => (o === op('list')
      ? { ok: true, items: [{ id: 'n1', label: 'de vuilnis gaat dinsdag buiten', text: 'de vuilnis gaat dinsdag buiten', type: 'note' }] }
      : { ok: true, items: [{ id: 'i1', text: 'melk', type: 'list-item' }] });
    expect(await loadAssistantItems({ callSkill })()).toEqual([
      { id: 'i1', type: 'list-item', text: 'melk' },
      { id: 'n1', type: 'note', text: 'de vuilnis gaat dinsdag buiten' },
    ]);
  });
});
