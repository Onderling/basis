/**
 * Gate words carry a place (Fable's ruling, 2026-11-17): a verb is a phrase for every place, or `{words, in}` for the
 * places it names. A phrase like "mijn agenda" means the person's own agenda in their own "+", and would be wrong in a
 * circle's bot; asked for no place (every caller before this), a placed verb is not there at all.
 */
import { describe, it, expect } from 'vitest';
import { gateVerbsOf } from '../src/gateVerbs.js';
import { renderGate } from '../src/renderGate.js';

const manifest = {
  app: 'cal',
  gateWords: { nl: {
    'cal.list': { verbs: ['agenda tonen', { words: 'mijn agenda', in: ['own'] }, { words: 'wat heb ik gepland', in: ['own'] }] },
  } },
  operations: [{ id: 'list', verb: 'list', surfaces: { slash: { command: '/list', match: { body: 'none' } } } }],
};

describe('gate words per place', () => {
  it('a placed verb is there only when its place is asked for', () => {
    const op = manifest.operations[0];
    expect(gateVerbsOf(manifest, op, 'nl').map((v) => v.join(' '))).toEqual(['agenda tonen']);
    expect(gateVerbsOf(manifest, op, 'nl', 'circle').map((v) => v.join(' '))).toEqual(['agenda tonen']);
    expect(gateVerbsOf(manifest, op, 'nl', 'own').map((v) => v.join(' '))).toEqual(['agenda tonen', 'mijn agenda', 'wat heb ik gepland']);
  });
  it('renderGate asked for a place reads that place\'s words; asked for none, a circle\'s', () => {
    const [own] = renderGate([manifest], { locale: 'nl', place: 'own' });
    const [plain] = renderGate([manifest], { locale: 'nl' });
    expect(own.command('wat heb ik gepland?')?.opId).toBe('list');
    expect(plain.command('wat heb ik gepland?')).toBeNull();
    expect(plain.command('agenda tonen')?.opId).toBe('list');
  });
});
