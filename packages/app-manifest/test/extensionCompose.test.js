/**
 * An extension's manifest at compose: its nouns sit under its composed origin, and the words its chat gate answers to
 * are its own — each starts with its noun's own word, none is a bare verb or a word a first-party noun owns.
 */
import { describe, it, expect } from 'vitest';
import { checkExtensionManifest, extensionVerbsFor } from '../src/index.js';

const firstParty = [{ app: 'household', operations: [{ id: 'addItem', surfaces: { slash: { match: { verbs: ['add'] } } } }, { id: 'addNote', surfaces: { slash: { match: { verbs: ['note'] } } } }] }];
const plants = (extra = {}) => ({ app: 'plants', nouns: { 'plants.plant': { atoms: ['add', 'list'], schema: { type: 'object' }, ...extra } } });

describe('an extension at compose', () => {
  it('its nouns under its origin, and its words start with the noun\'s own word', () => {
    expect(checkExtensionManifest(plants(), { origin: 'plants', firstParty })).toEqual({ ok: true, problems: [] });
    expect(extensionVerbsFor('plants.plant', 'add')).toEqual(['plant', 'add']);
  });

  it('refused: a noun outside its origin, a bare verb, a word another noun owns', () => {
    expect(checkExtensionManifest({ app: 'plants', nouns: { note: { atoms: ['add'] } } }, { origin: 'plants', firstParty }).problems).toEqual([{ noun: 'note', reason: 'not-in-origin' }]);
    const bare = plants({ gateWords: { nl: { add: ['voeg toe'] } } });
    expect(checkExtensionManifest(bare, { origin: 'plants', firstParty }).problems).toEqual([{ noun: 'plants.plant', reason: 'word-not-the-noun', word: 'voeg toe' }]);
    // a noun whose own word a first-party noun already answers to
    const taken = { app: 'notes2', nouns: { 'notes2.note': { atoms: ['add'] } } };
    expect(checkExtensionManifest(taken, { origin: 'notes2', firstParty }).problems).toEqual([{ noun: 'notes2.note', reason: 'word-taken', word: 'note' }]);
  });
});
