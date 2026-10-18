// @vitest-environment node
// Property-layer Hop 2 — the egress gate at the dispatch waist. Wraps callSkill so an external-egress op
// is gated (blocked when governed-forbidden, else only the coarse released payload travels + a receipt), while
// non-external ops pass through untouched.
import { describe, it, expect, vi } from 'vitest';
import { wrapCallSkillWithEgressGate, isExternalEgressOp } from '../src/core/agent/egressGate.js';
import { createRequest, createVocabulary, descriptor } from '@onderling/agent-registry';

const vocab = createVocabulary([
  descriptor({ key: 'place', type: 'coarse-enum' }),
  descriptor({ key: 'health', type: 'coded', sensitivity: 'special-category' }),
]);

describe('egress gate at the dispatch waist', () => {
  it('passes a NON-external op through unchanged (inert for local/pod ops)', async () => {
    const inner = vi.fn(async () => ({ ok: true }));
    const gated = wrapCallSkillWithEgressGate(inner, { isExternalEgress: new Set(['menu.match']), gateInputs: () => null });
    await gated('pinboard', 'postRequest', { text: 'hi' });
    expect(inner).toHaveBeenCalledWith('pinboard', 'postRequest', { text: 'hi' });   // untouched
  });

  it('gates an external op: only the released coarse payload travels + a receipt is surfaced', async () => {
    const inner = vi.fn(async () => ({ ok: true }));
    const receipts = [];
    const request = createRequest({ requesterId: 'menu-bot', purpose: 'filter menu', vocabulary: vocab, items: [{ key: 'place', why: 'local specials' }] });
    const gated = wrapCallSkillWithEgressGate(inner, {
      isExternalEgress: new Set(['menu.match']),
      gateInputs: () => ({ request, released: { place: 'Groningen' } }),   // user disclosed place
      onReceipt: (r) => receipts.push(r),
      vocabulary: vocab,
    });
    await gated('menu', 'menu.match', { dish: 'x' });
    expect(inner).toHaveBeenCalledWith('menu', 'menu.match', { dish: 'x', _egress: { place: 'Groningen' } });
    expect(receipts[0]).toMatchObject({ shared: ['place'], withheld: [], nothingLeft: false });
  });

  it('surfaces nothingLeft when the user disclosed nothing (the 🔒 signal)', async () => {
    const inner = vi.fn(async () => ({ ok: true }));
    const receipts = [];
    const request = createRequest({ requesterId: 'menu-bot', purpose: 'x', vocabulary: vocab, items: [{ key: 'place', why: 'y' }] });
    const gated = wrapCallSkillWithEgressGate(inner, {
      isExternalEgress: () => true, gateInputs: () => ({ request, released: {} }), onReceipt: (r) => receipts.push(r), vocabulary: vocab,
    });
    await gated('menu', 'menu.match', {});
    expect(receipts[0].nothingLeft).toBe(true);
    expect(inner).toHaveBeenCalledWith('menu', 'menu.match', { _egress: {} });
  });

  it('BLOCKS a governed-forbidden external ask — nothing leaves, the op is never invoked', async () => {
    const inner = vi.fn(async () => ({ ok: true }));
    const request = createRequest({ requesterId: 'employer', purpose: 'screen', vocabulary: vocab, items: [{ key: 'health', why: 'fitness' }] });
    const gated = wrapCallSkillWithEgressGate(inner, {
      isExternalEgress: () => true,
      gateInputs: () => ({ request, released: { health: { code: 'x' } }, contextType: 'employment' }),   // user even tried to share
      vocabulary: vocab,
    });
    const res = await gated('hr', 'screen.submit', {});
    expect(res).toMatchObject({ ok: false, error: 'egress-blocked' });
    expect(res.receipt.governed.allowed).toBe(false);
    expect(inner).not.toHaveBeenCalled();   // the coerced ask never reaches the external service
  });
});

describe('router-detection for external egress (§10a)', () => {
  it('every local app-origin is NOT external → gate inert today', () => {
    for (const o of ['household', 'tasks', 'pinboard', 'folio', 'calendar', 'agents']) expect(isExternalEgressOp(o)).toBe(false);
  });
  it('an UNKNOWN origin is treated as external (fail-safe: an unrecognised target is gated, not trusted)', () => {
    expect(isExternalEgressOp('some-mcp-tool')).toBe(true);
    expect(isExternalEgressOp('')).toBe(false);   // no origin → nothing to gate
  });
  it('composes with the gate: a local op passes through; an unknown-origin governed-forbidden ask is blocked', async () => {
    const inner = vi.fn(async () => ({ ok: true }));
    const request = createRequest({ requesterId: 'x', purpose: 'p', vocabulary: vocab, items: [{ key: 'health', why: 'w' }] });
    const gated = wrapCallSkillWithEgressGate(inner, {
      isExternalEgress: isExternalEgressOp,
      gateInputs: () => ({ request, released: {}, contextType: 'employment' }),
      vocabulary: vocab,
    });
    await gated('pinboard', 'postRequest', { text: 'hi' });          // local → passthrough, untouched
    expect(inner).toHaveBeenCalledWith('pinboard', 'postRequest', { text: 'hi' });
    const res = await gated('some-external-service', 'send', {}); // external + forbidden → blocked
    expect(res).toMatchObject({ ok: false, error: 'egress-blocked' });
  });
});
