import { describe, it, expect } from 'vitest';
import { createCircleAddressIndex, decidePeerSend, sendDecisionFields } from '../../src/v2/peerSendGate.js';

const ME = 'me-webid';
const rows = (...r) => r;

describe('createCircleAddressIndex: a member\'s per-circle address → its circle, from the rosters', () => {
  it('knows every member circle address (primary and set) and nothing else: no person keys, no webids, not my own row', () => {
    const ix = createCircleAddressIndex();
    ix.recordRoster('c1', rows(
      { webid: 'bram', pubKey: 'bram-person', circleAddress: 'bram@c1', circleAddresses: ['bram@c1', 'bram-phone@c1'] },
      { webid: ME, pubKey: 'me-person', circleAddress: 'me@c1', circleAddresses: ['me@c1', 'me-tablet@c1'] },
    ), { selfWebid: ME });
    expect(ix.circleOf('bram@c1')).toBe('c1');
    expect(ix.circleOf('bram-phone@c1')).toBe('c1');
    expect(ix.circleOf('bram-person')).toBe(null);
    expect(ix.circleOf('bram')).toBe(null);
    expect(ix.circleOf('me@c1')).toBe(null);
    expect(ix.circleOf('me-tablet@c1')).toBe(null);
  });

  it('a refreshed roster REPLACES the circle\'s entries (a removed member\'s address leaves the index)', () => {
    const ix = createCircleAddressIndex();
    ix.recordRoster('c1', rows({ webid: 'bram', circleAddress: 'bram@c1' }, { webid: 'cas', circleAddress: 'cas@c1' }));
    ix.recordRoster('c1', rows({ webid: 'cas', circleAddress: 'cas@c1' }));
    expect(ix.circleOf('bram@c1')).toBe(null);
    expect(ix.circleOf('cas@c1')).toBe('c1');
  });

  it('an empty read records nothing (a failed skill call must not erase a circle)', () => {
    const ix = createCircleAddressIndex();
    ix.recordRoster('c1', rows({ webid: 'bram', circleAddress: 'bram@c1' }));
    ix.recordRoster('c1', []);
    expect(ix.circleOf('bram@c1')).toBe('c1');
  });

  it('forget drops a left circle', () => {
    const ix = createCircleAddressIndex();
    ix.recordRoster('c1', rows({ webid: 'bram', circleAddress: 'bram@c1' }));
    ix.forget('c1');
    expect(ix.circleOf('bram@c1')).toBe(null);
  });

  it('one address claimed by two circles is AMBIGUOUS, which is not the same as unknown', () => {
    const ix = createCircleAddressIndex();
    ix.recordRoster('c1', rows({ webid: 'bram', circleAddress: 'x' }));
    ix.recordRoster('c2', rows({ webid: 'bram', circleAddress: 'x' }));
    expect(ix.circleOf('x')).toBe(null);
    expect(ix.lookup('x')).toEqual({ ambiguous: true });
    expect(ix.lookup('nobody')).toBe(null);
    ix.forget('c2');
    expect(ix.circleOf('x')).toBe('c1');
    expect(ix.lookup('x')).toEqual({ circleId: 'c1' });
  });
});

describe('decidePeerSend: what the device KNOWS decides the path', () => {
  const circleOf = (a) => ({ 'bram@c1': { circleId: 'c1' }, 'twice@': { ambiguous: true } }[a] ?? null);
  it('an address two of my circles both claim is REFUSED: never the person path toward a known circle address', () => {
    expect(decidePeerSend({ to: 'twice@', opts: {}, circleOf })).toEqual({ kind: 'circle-member', circleId: null, reason: 'circle-ambiguous', refuse: true });
    expect(decidePeerSend({ to: 'twice@', opts: { circleId: 'c1' }, circleOf })).toEqual({ kind: 'circle-member', circleId: null, reason: 'circle-ambiguous', refuse: true });
  });
  it('a member\'s circle address → that circle\'s scope, even when the caller named no circle', () => {
    expect(decidePeerSend({ to: 'bram@c1', opts: {}, circleOf })).toEqual({ kind: 'circle-member', circleId: 'c1', reason: 'roster-hit' });
  });
  it('the caller naming the SAME circle agrees', () => {
    expect(decidePeerSend({ to: 'bram@c1', opts: { circleId: 'c1' }, circleOf })).toEqual({ kind: 'circle-member', circleId: 'c1', reason: 'roster-hit' });
  });
  it('the caller naming ANOTHER circle is refused', () => {
    expect(decidePeerSend({ to: 'bram@c1', opts: { circleId: 'c2' }, circleOf })).toEqual({ kind: 'circle-member', circleId: null, reason: 'circle-mismatch', refuse: true });
  });
  it('no roster hit, a caller circle → that circle, as today (an address the roster has not shown yet)', () => {
    expect(decidePeerSend({ to: 'new@c1', opts: { circleId: 'c1' }, circleOf })).toEqual({ kind: 'circle-named', circleId: 'c1', reason: 'caller-circle' });
  });
  it('neither → the person path unchanged (a first Hi to a new card must still go)', () => {
    expect(decidePeerSend({ to: 'stranger', opts: {}, circleOf })).toEqual({ kind: 'person', circleId: null, reason: 'no-roster-hit' });
  });
  it('a caller that names who speaks (sendAs) keeps its choice: no circle is added under it', () => {
    expect(decidePeerSend({ to: 'bram@c1', opts: { sendAs: 'my-person' }, circleOf })).toEqual({ kind: 'as-given', circleId: null, reason: 'caller-sendas' });
  });
  it('asPerson is its own path', () => {
    expect(decidePeerSend({ to: 'x', opts: { asPerson: true }, circleOf })).toEqual({ kind: 'as-person', circleId: null, reason: 'as-person' });
  });
});

describe('sendDecisionFields: one record per decision, codes and scalars only', () => {
  it('flattens the route explanation and carries no identifier', () => {
    const f = sendDecisionFields(
      { kind: 'circle-member', circleId: 'c1-long-circle-id-0123456789abcdef', reason: 'roster-hit' },
      { scoped: true, chosen: 'relay', candidates: [{ kind: 'relay', eligible: true, why: 'ok', reach: true }, { kind: 'nkn', eligible: false, why: 'no-aliases', reach: true }] },
      { held: false, delivered: true },
    );
    expect(f).toEqual({
      kind: 'circle-member', scope: 'circle', reason: 'roster-hit', chosen: 'relay',
      t0: 'relay:ok:reach', t1: 'nkn:no-aliases:reach', candidates: 2, outcome: 'delivered',
    });
    expect(JSON.stringify(f)).not.toContain('c1-long');
  });
  it('a scoped send with no eligible transport and a point mismatch says point-mismatch', () => {
    const f = sendDecisionFields(
      { kind: 'circle-member', circleId: 'c1', reason: 'roster-hit' },
      { scoped: true, chosen: null, candidates: [{ kind: 'relay', eligible: false, why: 'point-mismatch', reach: true }] },
      { held: true, delivered: false, reason: 'unreachable' },
    );
    expect(f.reason).toBe('point-mismatch');
    expect(f.outcome).toBe('held:unreachable');
  });
});
