// Property layer Phase 4 — the neutral request form-spec + the pure egress gate/receipt.
import { describe, it, expect } from 'vitest';
import { createRequest } from '../src/request.js';
import { createVocabulary, descriptor } from '../src/propertyVocabulary.js';
import { DEFAULT_GOVERNED_POLICY } from '../src/governedRequest.js';
import { requestForm } from '../src/requestForm.js';
import { egressReceipt, gateEgress } from '../src/requestGate.js';

const vocab = createVocabulary([
  descriptor({ key: 'place', type: 'coarse-enum', ladder: ['municipality', 'district', 'address'] }),
  descriptor({ key: 'ageBand', type: 'coarse-enum' }),
  descriptor({ key: 'health', type: 'coded', sensitivity: 'special-category' }),
]);

describe('requestForm', () => {
  it('projects one field per item; label defaults to key; required defaults false', () => {
    const req = createRequest({ requesterId: 'circle-42', purpose: 'segment feedback', items: [
      { key: 'place', why: 'which circles' }, { key: 'ageBand', why: 'age spread' },
    ] });
    const form = requestForm(req);
    expect(form.requesterId).toBe('circle-42');
    expect(form.purpose).toBe('segment feedback');
    expect(form.fields.map((f) => f.key)).toEqual(['ageBand', 'place']);   // canonical sorted order preserved
    const place = form.fields.find((f) => f.key === 'place');
    expect(place.label).toBe('place');            // defaults to key
    expect(place.why).toBe('which circles');
    expect(place.required).toBe(false);           // disclosure is opt-in
  });

  it('fills type + ladder from the vocabulary when given', () => {
    const req = createRequest({ requesterId: 'r', purpose: 'p', vocabulary: vocab, items: [
      { key: 'place', why: 'w' }, { key: 'ageBand', why: 'w' },
    ] });
    const form = requestForm(req, vocab);
    const place = form.fields.find((f) => f.key === 'place');
    expect(place.type).toBe('coarse-enum');
    expect(place.ladder).toEqual(['municipality', 'district', 'address']);
    const age = form.fields.find((f) => f.key === 'ageBand');
    expect(age.type).toBe('coarse-enum');
    expect(age.ladder).toBeUndefined();           // no ladder on this descriptor → field omits it
  });

  it('honours an item label + required override, and falls back to item.type without a vocabulary', () => {
    const req = { requesterId: 'r', purpose: 'p', items: [
      { key: 'place', why: 'w', type: 'coarse-enum', label: 'Woonplaats', required: true },
    ] };
    const form = requestForm(req);                 // no vocabulary
    expect(form.fields[0]).toMatchObject({ key: 'place', type: 'coarse-enum', label: 'Woonplaats', required: true });
    expect(form.fields[0].ladder).toBeUndefined();
  });

  it('is defensive on an empty/malformed request', () => {
    expect(requestForm(null)).toEqual({ requesterId: null, purpose: null, fields: [] });
    expect(requestForm({ items: [{ why: 'no key' }] }).fields).toEqual([]);
  });
});

describe('egressReceipt', () => {
  const req = createRequest({ requesterId: 'circle', purpose: 'segment', vocabulary: vocab, items: [
    { key: 'place', why: 'w' }, { key: 'ageBand', why: 'w' },
  ] });

  it('reports shared vs withheld from the released map', () => {
    const r = egressReceipt({ request: req, released: { place: 'Groningen' } });
    expect(r.shared).toEqual(['place']);
    expect(r.withheld).toEqual(['ageBand']);
    expect(r.nothingLeft).toBe(false);
    expect(r.governed).toEqual({ allowed: true, forbidden: [], warn: [] });   // ungoverned when no contextType
  });

  it('nothingLeft:true when the user disclosed nothing (all withheld)', () => {
    const r = egressReceipt({ request: req, released: {} });
    expect(r.shared).toEqual([]);
    expect(r.withheld.sort()).toEqual(['ageBand', 'place']);
    expect(r.nothingLeft).toBe(true);            // 🔒 nothing about you left this device
  });

  it('runs the governed check when a contextType is given', () => {
    const bad = createRequest({ requesterId: 'acme', purpose: 'hiring', vocabulary: vocab, items: [
      { key: 'health', why: 'w' }, { key: 'place', why: 'w' },
    ] });
    const r = egressReceipt({ request: bad, released: { place: 'Groningen' }, contextType: 'employment', policyTable: DEFAULT_GOVERNED_POLICY, vocabulary: vocab });
    expect(r.governed.allowed).toBe(false);
    expect(r.governed.forbidden).toContain('health');
  });
});

describe('gateEgress', () => {
  it('passes a benign request through — payload === released', () => {
    const req = createRequest({ requesterId: 'circle', purpose: 'segment', vocabulary: vocab, items: [{ key: 'place', why: 'w' }] });
    const released = { place: 'Groningen' };
    const g = gateEgress({ request: req, released, contextType: 'community-feedback', vocabulary: vocab });
    expect(g.allow).toBe(true);
    expect(g.payload).toEqual(released);
    expect(g.payload).not.toBe(released);        // fresh copy, not the same reference
    expect(g.receipt.shared).toEqual(['place']);
    expect(g.receipt.nothingLeft).toBe(false);
  });

  it('BLOCKS a governed-forbidden request — allow:false, payload:{} even when the user disclosed values', () => {
    const req = createRequest({ requesterId: 'acme', purpose: 'hiring', vocabulary: vocab, items: [
      { key: 'health', why: 'fitness' }, { key: 'ageBand', why: 'team fit' },
    ] });
    // The user tried to share both — but the ask is forbidden in employment.
    const released = { health: { code: 'x', system: 'SNOMED' }, ageBand: '30-40' };
    const g = gateEgress({ request: req, released, contextType: 'employment', policyTable: DEFAULT_GOVERNED_POLICY, vocabulary: vocab });
    expect(g.allow).toBe(false);
    expect(g.payload).toEqual({});               // nothing leaves on a blocked request
    expect(g.receipt.governed.allowed).toBe(false);
    expect(g.receipt.governed.forbidden.sort()).toEqual(['ageBand', 'health']);
  });
});
