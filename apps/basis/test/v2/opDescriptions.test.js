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
    expect(opWhat('no-such-app', 'postRequest', 'nl')).toBeNull();   // an app with no words file
    expect(Object.keys(OP_DESCRIPTIONS)).toContain('lists');
    expect(opWhat('calendar', 'addEvent', 'nl')).toBe('Zet een afspraak in de agenda.');
    expect(opDescription('calendar', 'listEvents', 'en').params.day).toBe('on which day');
  });
  it('pinboard: described, a shared parameter phrased once (the circle)', () => {
    expect(opWhat('pinboard', 'postRequest', 'nl')).toBe('Zet iets op het prikbord: een vraag, aanbod of iets om uit te lenen.');
    expect(opDescription('pinboard', 'removeMember', 'en').params.groupId).toBe('which circle');
  });
});

describe('the "/" list shows it under the command', () => {
  // an app with no words file of its own: a made-up one, so the case does not depend on which apps are described yet
  const plain = { app: 'plain', itemTypes: [], operations: [{ id: 'doPlain', visibility: 'authenticated', verb: 'add', params: [],
    surfaces: { slash: { command: '/plain' }, chat: { reply: 'text', hint: 'the model\'s own hint' } } }] };
  it('a lists command shows its sentence in the person\'s language; another app keeps the model\'s hint', () => {
    const cat = mergeManifests([{ manifest: listsManifest }, { manifest: plain }]);
    const nl = buildCommandPool(cat, { lang: 'nl' });
    expect(nl.find((e) => e.opId === 'addToList')?.hint).toBe('Zet iets op een lijst.');
    expect(buildCommandPool(cat, { lang: 'en' }).find((e) => e.opId === 'addToList')?.hint).toBe('Put something on a list.');
    expect(nl.find((e) => e.opId === 'doPlain')?.hint).toBe('the model\'s own hint');
  });
  it('pinboard, described, shows its sentence too', () => {
    const nl = buildCommandPool(mergeManifests([{ manifest: pinboardManifest }]), { lang: 'nl' });
    expect(nl.find((e) => e.opId === 'addContact')?.hint).toBe('Voeg een contact toe.');
  });
});
