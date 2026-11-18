/**
 * What an op does, in a person's words, read where a person meets the op (the assistant plan's step C, ledger L1025):
 * the "/" list shows it under each command, in the person's language; an app not described yet keeps the model's hint.
 */
import { describe, it, expect } from 'vitest';
import { opDescription, opWhat, OP_DESCRIPTIONS } from '../../src/v2/opDescriptions.js';
import { buildCommandPool } from '../../src/v2/commandSuggest.js';
import { mergeManifests } from '../../src/manifestMerge.js';
import { listsManifest } from '../../../lists/manifest.js';
import { pinboardManifest } from '../../../pinboard/manifest.js';

describe('the words of an op', () => {
  it('a described op has its sentence and its params\' phrases, per language; an undescribed app has none', () => {
    expect(opWhat('lists', 'addToList', 'nl')).toBe('Zet iets op een lijst.');
    expect(opWhat('lists', 'addToList', 'en')).toBe('Put something on a list.');
    expect(opDescription('lists', 'addToList', 'nl').params.list).toBe('op welke lijst');
    expect(opWhat('lists', 'addToList', 'fr'), 'another language: English').toBe('Put something on a list.');
    expect(opWhat('pinboard', 'postRequest', 'nl')).toBeNull();
    expect(Object.keys(OP_DESCRIPTIONS)).toContain('lists');
  });
  it('agents: described, a persona by the word the app already uses', () => {
    expect(opWhat('agents', 'revokeAgent', 'nl')).toBe('Zet een agent uit: al zijn rechten vervallen.');
    expect(opDescription('agents', 'getPersonaRelease', 'en').params.id).toBe('which persona');
  });
});

describe('the "/" list shows it under the command', () => {
  it('a lists command shows its sentence in the person\'s language; another app keeps the model\'s hint', () => {
    const cat = mergeManifests([{ manifest: listsManifest }, { manifest: pinboardManifest }]);
    const nl = buildCommandPool(cat, { lang: 'nl' });
    expect(nl.find((e) => e.opId === 'addToList')?.hint).toBe('Zet iets op een lijst.');
    expect(buildCommandPool(cat, { lang: 'en' }).find((e) => e.opId === 'addToList')?.hint).toBe('Put something on a list.');
    const pin = nl.find((e) => e.appOrigin === 'pinboard');
    const decl = pinboardManifest.operations.find((o) => o.id === pin.opId);
    expect(pin.hint).toBe(decl.surfaces.chat.hint);
  });
});
