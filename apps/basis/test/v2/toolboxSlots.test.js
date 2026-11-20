/**
 * A toolbox word's SLOTS (Frits 2026-11-19: `zoek hagelslag bij Albert Heijn` gave a gift card, because the whole line
 * went on as the query). The operator's placed file says, on a word, which phrases mean which value of a tool parameter
 * (`slots: [{param, list?, values: {value: [phrases]}}]`); the door takes such a phrase off the line and fills the
 * parameter. Basis knows no shop: the phrases are the operator's data.
 *
 * @guard a toolbox word's slot phrase is taken off the line only as whole words at its start or end (longest first, any case), never from inside a product name
 */
import { describe, it, expect } from 'vitest';
import { makeToolboxOps, toolboxGateRule, takeSlots } from '../../src/v2/toolboxes.js';

const SLOTS = [{ param: 'stores', list: true, values: { ah: ['bij albert heijn', 'bij AH', 'bij de ah'], jumbo: ['bij jumbo', 'bij de jumbo'] } }];
const WORD = { word: 'zoek', tool: 'products.choices', field: 'query', toolbox: 'boodschappen', slots: [{ param: 'stores', list: true, values: { ah: ['bij albert heijn', 'bij ah', 'bij de ah'], jumbo: ['bij jumbo', 'bij de jumbo'] } }] };
const input = (line) => toolboxGateRule(() => [WORD]).command(line)?.args?.input;

describe('a toolbox word\'s slots: phrases that fill a tool parameter', () => {
  it('`zoek hagelslag bij Albert Heijn` asks for hagelslag at the shop the phrase names', () => {
    expect(input('zoek hagelslag bij Albert Heijn')).toEqual({ query: 'hagelslag', stores: ['ah'] });
    expect(input('/zoek hagelslag bij AH')).toEqual({ query: 'hagelslag', stores: ['ah'] });
    expect(input('zoek halfvolle melk bij de Jumbo')).toEqual({ query: 'halfvolle melk', stores: ['jumbo'] });
    // at the start too
    expect(input('zoek bij jumbo pindakaas')).toEqual({ query: 'pindakaas', stores: ['jumbo'] });
  });

  it('a line with no phrase, or a phrase only inside a word, is the query as typed', () => {
    expect(input('zoek melk')).toEqual({ query: 'melk' });
    // 'bij' as part of a product name, and 'bij ah' as the start of a longer word: no slot
    expect(input('zoek bijenhoning')).toEqual({ query: 'bijenhoning' });
    expect(input('zoek honing bij ahornsiroop')).toEqual({ query: 'honing bij ahornsiroop' });
    expect(input('zoek bijbel bij jumbonummer')).toEqual({ query: 'bijbel bij jumbonummer' });
  });

  it('a phrase in the MIDDLE of the line is part of the product, not a slot', () => {
    expect(input('zoek koekjes bij ah bonus')).toEqual({ query: 'koekjes bij ah bonus' });
  });

  it('longest phrase first: `bij de ah` is taken whole, never leaving `de` behind', () => {
    expect(takeSlots('kaas bij de ah', SLOTS)).toEqual({ rest: 'kaas', filled: { stores: ['ah'] } });
  });

  it('two phrases give two values for a list parameter; one for a plain one', () => {
    expect(input('zoek bij jumbo melk bij ah')).toEqual({ query: 'melk', stores: ['jumbo', 'ah'] });
    const plain = [{ param: 'store', values: { ah: ['bij ah'], jumbo: ['bij jumbo'] } }];
    expect(takeSlots('melk bij ah', plain)).toEqual({ rest: 'melk', filled: { store: 'ah' } });
  });

  it('a line that is ONLY a phrase stays the query (nothing would be left to ask)', () => {
    expect(input('zoek bij ah')).toEqual({ query: 'bij ah' });
  });

  it('the placed file\'s slots are read as the operator wrote them, cleaned; a broken slot is dropped, the word stays', async () => {
    const placed = { name: 'boodschappen', url: 'http://boodschappen:3000', words: [{ word: 'zoek', tool: 'products.choices', field: 'query', slots: [
      ...SLOTS,
      { param: '', values: { x: ['y'] } },            // no param
      { param: 'query', values: { x: ['bij x'] } },    // the word's own field: never a slot
      { param: 'size', values: 'big' },               // values not a table
    ] }] };
    const vault = new Map();
    const store = { get: async (k) => vault.get(k) ?? null, set: async (k, v) => { vault.set(k, v); } };
    const card = { name: 'Boodschappen', supportedInterfaces: [{ url: 'http://boodschappen:3000/a2a', protocolBinding: 'JSONRPC' }], skills: [{ id: 'products.choices' }] };
    const ops = makeToolboxOps({ store, placedOf: async () => [placed], keyOf: async () => 'k', fetch: async () => ({ ok: true, status: 200, json: async () => card }) });
    await ops.load();
    await ops.addToolbox({ name: 'boodschappen', confirm: true });
    const [w] = ops.wordsNow();
    expect(w.slots).toEqual([{ param: 'stores', list: true, values: { ah: ['bij albert heijn', 'bij ah', 'bij de ah'], jumbo: ['bij jumbo', 'bij de jumbo'] } }]);
    expect(toolboxGateRule(() => ops.wordsNow()).command('zoek hagelslag bij Albert Heijn').args.input).toEqual({ query: 'hagelslag', stores: ['ah'] });
  });
});
