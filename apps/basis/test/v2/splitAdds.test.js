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

  it('a known pair is a PHRASE: kept whole wherever it stands in the line, the rest split around it', () => {
    const pairs = ['peper en zout', 'zout en peper'];
    expect(splitEntryText('zout en peper chips', pairs)).toEqual(['zout en peper chips']);
    expect(splitEntryText('chips met zout en peper', pairs)).toEqual(['chips met zout en peper']);
    expect(splitEntryText('kaas en zout en peper', pairs)).toEqual(['kaas', 'zout en peper']);
    expect(splitEntryText('zout en peper en kaas', pairs)).toEqual(['zout en peper', 'kaas']);
    expect(splitEntryText('melk en kaas', pairs)).toEqual(['melk', 'kaas']);
    // a word that only CONTAINS a pair's word is not the pair
    expect(splitEntryText('zoutjes en pepernoten', pairs)).toEqual(['zoutjes', 'pepernoten']);
  });

  it('the add is recognised by its bare or its qualified id', () => {
    const expand = expandAdds();
    expect(expand({ opId: 'lists.addToList', args: { list: 'Boodschappen', text: 'melk en kaas' } })).toHaveLength(2);
    expect(expand({ opId: 'addToList', args: { list: 'Boodschappen', text: 'melk en kaas' } })).toHaveLength(2);
    expect(expand({ opId: 'lists.listEntries', args: { list: 'Boodschappen' } })).toHaveLength(1);
  });

  it('only a list of plain entries splits: a chore or an appointment is one thing ("lamp vervangen en ophangen")', () => {
    const names = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
    const expand = expandAdds({ t: (k) => names[k] ?? k });
    expect(expand({ opId: 'addToList', args: { list: 'Klusjes', text: 'lamp vervangen en ophangen' } })).toHaveLength(1);
    expect(expand({ opId: 'addToList', args: { list: 'takenlijst', text: 'ramen en deuren' } })).toHaveLength(1);   // by its words too
    expect(expand({ opId: 'addToList', args: { list: 'Agenda', text: 'tandarts en huisarts' } })).toHaveLength(1);
    expect(expand({ opId: 'addToList', args: { list: 'Boodschappen', text: 'melk en kaas' } })).toHaveLength(2);
    expect(expand({ opId: 'addToList', args: { list: 'werktaken', text: 'a en b' } })).toHaveLength(2);        // a list of the admin's own: plain
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
    // a chore on Klusjes is one thing: "ramen en deuren" stays whole
    expect(dispatched).toEqual(['appels', 'peren', 'ramen en deuren']);
  });
});
