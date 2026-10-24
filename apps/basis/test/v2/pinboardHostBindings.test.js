/**
 * Inside basis the pinboard agent is a sub-agent: its own key must stay in the process. So the composition refuses to
 * build it without the two things that keep that key off every card and statement — whom the card names (`selfCard`)
 * and who signs a circle's statements (`circleSignerFor`) — and says which one is missing.
 */
import { describe, it, expect } from 'vitest';
import { assertPinboardHostBindings } from '../../src/core/agent/pinboardHostBindings.js';

const ok = { selfCard: () => ({ pubKey: 'k', stableId: 's' }), circleSignerFor: async () => ({}) };

describe('assertPinboardHostBindings', () => {
  it('passes the options through when both are there', () => {
    expect(assertPinboardHostBindings(ok)).toBe(ok);
  });
  it('names what is missing', () => {
    expect(() => assertPinboardHostBindings({ ...ok, selfCard: undefined })).toThrow(/selfCard/);
    expect(() => assertPinboardHostBindings({ ...ok, circleSignerFor: null })).toThrow(/circleSignerFor/);
    expect(() => assertPinboardHostBindings({})).toThrow(/selfCard.*circleSignerFor/);
  });
});
