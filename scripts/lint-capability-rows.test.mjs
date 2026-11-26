import { describe, it, expect } from 'vitest';
import { opsWithNoRow, auditRows } from './lint-capability-rows.mjs';

// a manifest that declares its nouns (declared-authoritative): `offer` has remove only; `lend` is a declared kind
const pin = {
  app: 'pin', itemTypes: ['offer'],
  nouns: { offer: { atoms: ['remove'] }, lend: { atoms: ['complete'] } },
  operations: [
    { id: 'cancel', verb: 'remove', appliesTo: { type: 'offer' } },
    { id: 'returned', verb: 'complete', appliesTo: { type: 'offer', kind: 'lend' } },   // the kind is a declared noun: its row
    { id: 'peek', verb: 'get', appliesTo: { type: 'offer' } },                         // offer has no `get` row: refused by default
    { id: 'post', verb: 'add', params: [] },                                            // names no noun: app level by design
    { id: 'help', verb: 'help' },                                                       // not an atom: no capability
  ],
};

describe('lint-capability-rows', () => {
  it('lists an op that names a noun whose atom has no row, and only that one', () => {
    expect(opsWithNoRow([pin])).toEqual(['pin.peek']);
  });
  it('the lend shape before L1040 (the kind not read) would have been red', () => {
    const before = { ...pin, nouns: { offer: { atoms: ['remove'] } } };
    expect(opsWithNoRow([before])).toContain('pin.returned');
  });
  it('a new op with no row is red; a fixed baseline entry asks for --update; the baseline never grows', () => {
    expect(auditRows(['pin.peek'], [])).toEqual([expect.stringMatching(/pin\.peek has a verb whose atom and noun name no capability row/)]);
    expect(auditRows([], ['pin.peek'])).toEqual([expect.stringMatching(/--update/)]);
    expect(auditRows(['pin.peek'], ['pin.peek'])).toEqual([]);
  });
  it('a red line names the file to open and says what to do on a Fix line', () => {
    const [noRow] = auditRows(['pin.peek'], [], { pin: 'apps/pin/manifest.js' });
    expect(noRow).toMatch(/^apps\/pin\/manifest\.js: pin\.peek has a verb/);
    expect(noRow).toMatch(/\n {4}Fix: bind it to a row/);
    const [stale] = auditRows([], ['pin.peek']);
    expect(stale).toMatch(/^scripts\/capability-rows-baseline\.json: /);
    expect(stale).toMatch(/\n {4}Fix: run node scripts\/lint-capability-rows\.mjs --update/);
  });
});
