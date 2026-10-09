/**
 * ONE scanner on Me, routed by what was scanned (Fable, 2026-10-09): contact → add, invite → join, enroll → add this
 * device, pair → pair, a companion's claim line → claim. `routeScan` is the one decision both shells read; mobile's
 * QR classifier list IS `SCAN_CLASSIFIERS` (no second copy).
 */
import { describe, it, expect } from 'vitest';
import { routeScan, SCAN_CLASSIFIERS, SCAN_TARGETS } from '../../src/v2/scanRoute.js';
import stoopManifest from '../../../stoop/manifest.js';
import householdManifest from '../../../household/manifest.js';

describe('routeScan — one scanner, routed by scheme', () => {
  it('a contact card → add', () => {
    expect(routeScan('onderling-contact://AYEgabc')).toMatchObject({ kind: 'contact', payload: 'onderling-contact://AYEgabc', target: { kind: 'flow', id: 'add-contact' }, needs: { payload: 'onderling-contact://AYEgabc' } });
  });
  it('an invite → join', () => {
    expect(routeScan('onderling-invite://eyJ4Ijox').kind).toBe('invite');
  });
  it('a pairing code → pair', () => {
    expect(routeScan('onderling-pair://abc123?name=Tablet')).toMatchObject({ kind: 'pair', target: { kind: 'op', id: 'pairCirclePeer' }, needs: { addr: 'onderling-pair://abc123?name=Tablet' } });
  });
  it("a companion's claim line → claim, normalised", () => {
    expect(routeScan('Claim: abcd-efgh @ Kfz5PiGkohG4VJLe12')).toMatchObject({ kind: 'claim', payload: { code: 'ABCD-EFGH', node: 'Kfz5PiGkohG4VJLe12' }, target: { id: 'claim-companion' }, needs: { claim: 'ABCD-EFGH@Kfz5PiGkohG4VJLe12' } });
  });
  it('anything else is said as unknown, never guessed', () => {
    expect(routeScan('hello world').kind).toBe('unknown');
    expect(routeScan('').kind).toBe('unknown');
    expect(routeScan(null).kind).toBe('unknown');
  });
  it('the classifier list carries every kind, in the one order', () => {
    expect(SCAN_CLASSIFIERS.map((c) => c.kind)).toEqual(['contact', 'invite', 'pair', 'enroll', 'claim']);
  });
});

describe('the route table names only DECLARED targets', () => {
  const MANIFESTS = { stoop: stoopManifest, household: householdManifest };
  it('every kind has a target, and every target exists in its manifest', () => {
    expect(Object.keys(SCAN_TARGETS).sort()).toEqual(SCAN_CLASSIFIERS.map((c) => c.kind).sort());
    for (const [kind, t] of Object.entries(SCAN_TARGETS)) {
      const m = MANIFESTS[t.app];
      expect(m, `${kind}: unknown app ${t.app}`).toBeTruthy();
      const found = t.kind === 'flow'
        ? (m.flows ?? []).find((f) => f.id === t.id)
        : (m.operations ?? []).find((o) => o.id === t.id);
      expect(found, `${kind} → ${t.kind} ${t.app}.${t.id} is not declared`).toBeTruthy();
    }
  });
  it("each target's needs are ones it declares (a flow's needs, an op's params)", () => {
    const sample = { contact: 'onderling-contact://x', invite: 'onderling-invite://x', enroll: 'onderling-enroll://x', claim: { code: 'ABCD-EFGH', node: 'n' }, pair: 'onderling-pair://a' };
    for (const [kind, t] of Object.entries(SCAN_TARGETS)) {
      const m = MANIFESTS[t.app];
      const decl = t.kind === 'flow' ? (m.flows.find((f) => f.id === t.id).needs ?? []) : (m.operations.find((o) => o.id === t.id).params ?? []);
      const names = new Set(decl.map((n) => (typeof n === 'string' ? n : n.name)));
      for (const k of Object.keys(t.needs(sample[kind]))) expect(names.has(k), `${kind}: '${k}' is not a declared need of ${t.id}`).toBe(true);
    }
  });
});

