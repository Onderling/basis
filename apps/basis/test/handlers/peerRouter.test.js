/**
 * peer-router dispatch coverage.
 */
import { describe, it, expect, vi } from 'vitest';
import { makePeerRouter } from '../../src/core/handlers/peerRouter.js';

describe('makePeerRouter', () => {
  it('dispatches by subtype', () => {
    const calendar = vi.fn();
    const fileShare = vi.fn();
    const router = makePeerRouter({
      handlers: { 'calendar-invite': calendar, 'file-share': fileShare },
      logger:   { info: () => {}, warn: () => {}, debug: () => {} },
    });
    router({ from: 'peer-A', payload: { subtype: 'calendar-invite', x: 1 } });
    router({ from: 'peer-B', payload: { subtype: 'file-share',      y: 2 } });
    expect(calendar).toHaveBeenCalledWith('peer-A', { subtype: 'calendar-invite', x: 1 });
    expect(fileShare).toHaveBeenCalledWith('peer-B', { subtype: 'file-share',     y: 2 });
  });

  it('falls back to defaultHandler when subtype is unknown', () => {
    const defaultHandler = vi.fn();
    const router = makePeerRouter({
      handlers: {},
      defaultHandler,
      logger:   { info: () => {}, warn: () => {}, debug: () => {} },
    });
    router({ from: 'peer-A', payload: { subtype: 'mystery', body: 'hi' } });
    expect(defaultHandler).toHaveBeenCalledWith('peer-A', { subtype: 'mystery', body: 'hi' });
  });

  it('falls back to defaultHandler when subtype is missing (HI envelopes)', () => {
    const defaultHandler = vi.fn();
    const router = makePeerRouter({
      handlers: { 'calendar-invite': vi.fn() },
      defaultHandler,
      logger:   { info: () => {}, warn: () => {}, debug: () => {} },
    });
    router({ from: 'peer-A', payload: { pubKey: 'k' } });
    expect(defaultHandler).toHaveBeenCalled();
  });

  it('catches sync throws in handlers without propagating', () => {
    const error = vi.fn();
    const handler = vi.fn(() => { throw new Error('boom'); });
    const router = makePeerRouter({
      handlers: { test: handler },
      logger:   { info: () => {}, warn: () => {}, debug: () => {}, error },
    });
    expect(() => router({ from: 'p', payload: { subtype: 'test' } })).not.toThrow();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('test threw'), expect.any(Error));
  });

  it('catches async rejection in handlers without propagating', async () => {
    const error = vi.fn();
    const handler = vi.fn(async () => { throw new Error('async boom'); });
    const router = makePeerRouter({
      handlers: { test: handler },
      logger:   { info: () => {}, warn: () => {}, debug: () => {}, error },
    });
    router({ from: 'p', payload: { subtype: 'test' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('test failed'), expect.any(Error));
  });

  it('does not throw when subtype has no handler and no defaultHandler is set', () => {
    const router = makePeerRouter({
      handlers: {},
      logger:   { info: () => {}, warn: () => {}, debug: () => {} },
    });
    expect(() => router({ from: 'p', payload: { subtype: 'mystery' } })).not.toThrow();
  });
});

// A chat turn rides the A2A message shape with its subtype INSIDE the DataPart (chat-p2p's wire);
// the router dispatches on that inner payload. Browser story 4 found every reply to a noticeboard
// post logged as "unhandled subtype undefined" (2026-09-03).
import { makePeerRouter as makeRouterForParts } from '../../src/core/handlers/peerRouter.js';
describe('makePeerRouter — A2A DataPart unwrap', () => {
  const quiet = { info() {}, debug() {}, error() {} };
  it('dispatches a {type:message, parts:[DataPart]} envelope on the part\'s subtype, handing over the part data', () => {
    const seen = [];
    const route = makeRouterForParts({ handlers: { 'chat-message': (from, p) => seen.push([from, p]) }, logger: quiet });
    const data = { type: 'stoop-chat', subtype: 'chat-message', threadId: 'post-1', body: 'hoi', nonce: 'n1' };
    route({ from: 'peer-B', payload: { type: 'message', parts: [{ type: 'DataPart', data }] } });
    expect(seen).toEqual([['peer-B', data]]);
  });
  it('leaves a flat payload and a part without a subtype alone', () => {
    const seen = [];
    const route = makeRouterForParts({ handlers: { x: (from, p) => seen.push(p) }, defaultHandler: (from, p) => seen.push(['default', p]), logger: quiet });
    route({ from: 'a', payload: { subtype: 'x', v: 1 } });
    const raw = { type: 'message', parts: [{ type: 'DataPart', data: { hello: 1 } }] };
    route({ from: 'a', payload: raw });
    expect(seen).toEqual([{ subtype: 'x', v: 1 }, ['default', raw]]);
  });
});
