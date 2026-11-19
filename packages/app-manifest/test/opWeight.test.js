/**
 * opWeight — how heavy an op is, read from what its manifest row already declares (ledger L977, the design's
 * section 2): read or write (the verb), where it writes (`writes.scope`) and what it writes (`writes.what`). The
 * level is a number that follows; no door reads it yet.
 */
import { describe, it, expect } from 'vitest';
import { opWeight, WRITE_WHATS, REVEALS } from '../src/atoms.js';

const m = { domainVerbs: { help: 'read', pair: 'write' } };
const w = (scope, what, extra = {}) => opWeight(m, { id: 'x', verb: 'add', writes: { scope, ...(what ? { what } : {}) }, ...extra });

describe('opWeight: the table of the design, section 2', () => {
  it('the four words and the two reveals are one vocabulary', () => {
    expect(WRITE_WHATS).toEqual(['content', 'preference', 'control', 'keys']);
    expect(REVEALS).toEqual(['keys', 'none']);
  });

  it('1: a read', () => {
    expect(opWeight(m, { id: 'listThings', verb: 'list' })).toBe(1);
    expect(opWeight(m, { id: 'help', verb: 'help' })).toBe(1);
    expect(opWeight(m, { id: 'peek', verb: 'list', reveals: 'none' })).toBe(1);
  });

  it('2: my own content or preference (person or device)', () => {
    expect(w('person', 'content')).toBe(2);
    expect(w('device', 'preference')).toBe(2);
  });

  it('3: a circle\'s content or preference', () => {
    expect(w('circle', 'content')).toBe(3);
    expect(w('circle', 'preference')).toBe(3);
  });

  it('4: my own control; 5: a circle\'s control', () => {
    expect(w('person', 'control')).toBe(4);
    expect(w('device', 'control')).toBe(4);
    expect(w('circle', 'control')).toBe(5);
  });

  it('6: keys, wherever written; and a read that hands out keys (section 2a)', () => {
    expect(w('device', 'keys')).toBe(6);
    expect(w('circle', 'keys')).toBe(6);
    expect(opWeight(m, { id: 'buildEnrollOffer', verb: 'get', reveals: 'keys' })).toBe(6);
    // a WRITE that hands back a credential (an invite token, a pairing offer) is 6 too, whatever it writes
    expect(w('circle', 'control', { reveals: 'keys' })).toBe(6);
    expect(w('person', 'content', { reveals: 'keys' })).toBe(6);
    expect(w('circle', 'content', { reveals: 'none' })).toBe(3);
  });

  it('no level for a writing op without `what`, an unknown word, or an unclassified verb', () => {
    expect(w('circle', undefined)).toBe(null);
    expect(w('circle', 'settings')).toBe(null);
    expect(opWeight(m, { id: 'pairIt', verb: 'pair' })).toBe(null);           // writes, declares nothing
    expect(opWeight(m, { id: 'odd', verb: 'frobnicate' })).toBe(null);       // nobody classified the verb
  });
});
