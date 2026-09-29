/**
 * Each thing is its own entry: "zet melk en kaas op de boodschappen" is two adds. The split is deterministic, at ADD
 * time, on the gate's route and the model's alike (the walk: "melk en kaas" went in as ONE entry, though the eval split
 * it — the model varies). Fixed pairs ("peper en zout") stay one; the household template keeps that short list.
 */
import { describe, it, expect, vi } from 'vitest';
import { splitEntryText, expandAdds, HOUSEHOLD_TEMPLATE } from '../../src/v2/householdTemplate.js';
import { createCircleDispatch } from '../../src/v2/circleDispatch.js';

describe('splitting an add', () => {
  it('"en" / "and" / commas split; a known pair stays whole', () => {
    const pairs = HOUSEHOLD_TEMPLATE.compoundEntries;
    expect(splitEntryText('melk en kaas', pairs)).toEqual(['melk', 'kaas']);
    expect(splitEntryText('stokbrood, melk en eieren', pairs)).toEqual(['stokbrood', 'melk', 'eieren']);
    expect(splitEntryText('bread and butter', pairs)).toEqual(['bread', 'butter']);
    expect(splitEntryText('peper en zout', pairs)).toEqual(['peper en zout']);
    expect(splitEntryText('melk, peper en zout', pairs)).toEqual(['melk', 'peper en zout']);
    expect(splitEntryText('lamp vervangen', pairs)).toEqual(['lamp vervangen']);
  });

  it('an addToList becomes one add per part; other ops pass as they are', () => {
    const expand = expandAdds();
    expect(expand({ opId: 'addToList', args: { list: 'Boodschappen', text: 'melk en kaas' } }))
      .toEqual([{ opId: 'addToList', args: { list: 'Boodschappen', text: 'melk' } }, { opId: 'addToList', args: { list: 'Boodschappen', text: 'kaas' } }]);
    expect(expand({ opId: 'listEntries', args: { list: 'Boodschappen' } })).toEqual([{ opId: 'listEntries', args: { list: 'Boodschappen' } }]);
  });

  it('the dispatcher expands the model\'s pick and a gate rule\'s command alike', async () => {
    const dispatched = [];
    const gate = { evaluate: async (text) => (/boodschappen/.test(text)
      ? { via: 'rule', command: { opId: 'addToList', args: { list: 'Boodschappen', text: 'appels en peren' } } }
      : { via: 'llm' }) };
    const interpret = vi.fn(async () => ({ opId: 'addToList', args: { list: 'Klusjes', text: 'ramen en deuren' } }));
    const cd = createCircleDispatch({
      policy: { llmTool: 'local' }, llmProviders: { local: { invoke: vi.fn() } }, interpret, gate, botName: 'bot',
      dispatch: (input) => { dispatched.push(input.args.text); }, onNoMatch: () => {}, expand: expandAdds(),
    });
    await cd.handle('@bot zet appels en peren op de boodschappen');
    await cd.handle('@bot ramen en deuren lappen');
    expect(dispatched).toEqual(['appels', 'peren', 'ramen', 'deuren']);
  });
});
