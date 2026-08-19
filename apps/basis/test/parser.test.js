/**
 * basis — parser tests. v0.1.
 *
 * Pure-function tests; no DOM, no agent, no manifest required to be
 * "real" — we hand-roll catalogues to isolate parser behaviour.
 */
import { describe, it, expect } from 'vitest';

import { parseInput, parseSlash } from '../src/parser.js';

const catalogue = {
  commandMenu: [
    { command: '/done',     opId: 'markComplete',  body: 'match'  },
    { command: '/mine',     opId: 'listMine',      body: 'reject' },
    { command: '/addtask',  opId: 'addTask',       body: 'flags'  },
    // 'body' omitted → defaults to 'match'
    { command: '/help',     opId: 'help' },
  ],
};

describe('parseInput', () => {
  it("returns 'unknown' for empty / whitespace-only input", () => {
    expect(parseInput('',    catalogue)).toEqual({ kind: 'unknown', text: '',   threadId: null });
    expect(parseInput('   ', catalogue)).toEqual({ kind: 'unknown', text: '',   threadId: null });
  });

  it("returns 'unknown' for free-text (no slash)", () => {
    expect(parseInput('hello world', catalogue)).toEqual({
      kind: 'unknown', text: 'hello world', threadId: null,
    });
  });

  it("returns 'unknown' for unmatched slash command", () => {
    const r = parseInput('/nonexistent dishwasher', catalogue);
    expect(r.kind).toBe('unknown');
    expect(r.text).toBe('/nonexistent dishwasher');
  });

  it('passes threadId from ctx through to the result', () => {
    expect(parseInput('hi', catalogue, { threadId: 't-42' })).toEqual({
      kind: 'unknown', text: 'hi', threadId: 't-42',
    });
    const slashResult = parseInput('/done dishwasher', catalogue, { threadId: 't-42' });
    expect(slashResult.threadId).toBe('t-42');
  });

  it("threadId defaults to null when ctx omitted", () => {
    expect(parseInput('/done', catalogue).threadId).toBeNull();
  });

  it("trims leading + trailing whitespace before matching", () => {
    const r = parseInput('   /done dishwasher   ', catalogue);
    expect(r.kind).toBe('slash');
    expect(r.opId).toBe('markComplete');
  });
});

describe('parseSlash — body: match (the default)', () => {
  it('binds body to args._match', () => {
    const r = parseInput('/done dishwasher', catalogue);
    expect(r).toEqual({
      kind:      'slash',
      opId:      'markComplete',
      args:      { _match: 'dishwasher' },
      threadId:  null,
      command:   '/done',
      body:      'dishwasher',
    });
  });

  it('handles multi-word body — _match captures full string', () => {
    const r = parseInput('/done replace the smoke detector', catalogue);
    expect(r.args._match).toBe('replace the smoke detector');
  });

  it('empty body → args is empty object (no _match)', () => {
    const r = parseInput('/done', catalogue);
    expect(r.kind).toBe('slash');
    expect(r.opId).toBe('markComplete');
    expect(r.args).toEqual({});
  });

  it('absent body rule defaults to match', () => {
    const r = parseInput('/help me', catalogue);
    expect(r.args._match).toBe('me');
  });
});

describe('parseSlash — body: reject', () => {
  it('parses fine but emits no args even if body present (v0.1 silent)', () => {
    const r = parseInput('/mine', catalogue);
    expect(r.kind).toBe('slash');
    expect(r.opId).toBe('listMine');
    expect(r.args).toEqual({});
  });

  it('still parses when trailing junk present (v0.1 silent)', () => {
    const r = parseInput('/mine ignored junk', catalogue);
    expect(r.kind).toBe('slash');
    expect(r.opId).toBe('listMine');
    expect(r.args).toEqual({});
  });
});

describe('parseSlash — body: flags', () => {
  it('parses --key=value pairs', () => {
    const r = parseInput('/addtask --due=friday --priority=high', catalogue);
    expect(r.args).toEqual({ due: 'friday', priority: 'high' });
  });

  it("--key with no value is treated as boolean true", () => {
    const r = parseInput('/addtask --urgent --due=friday', catalogue);
    expect(r.args).toEqual({ urgent: true, due: 'friday' });
  });

  it('quoted positional arg → _match', () => {
    const r = parseInput('/addtask --due=friday "fix the back door"', catalogue);
    expect(r.args).toEqual({ due: 'friday', _match: 'fix the back door' });
  });

  it('bare positional arg → _match', () => {
    const r = parseInput('/addtask --due=friday dishwasher', catalogue);
    expect(r.args).toEqual({ due: 'friday', _match: 'dishwasher' });
  });

  it('multiple bare positional args → joined into _match', () => {
    const r = parseInput('/addtask first second third', catalogue);
    expect(r.args._match).toBe('first second third');
  });

  it('flag-only input → empty positional', () => {
    const r = parseInput('/addtask --due=friday', catalogue);
    expect(r.args).toEqual({ due: 'friday' });
    expect(r.args._match).toBeUndefined();
  });
});

describe('parseSlash — edge cases', () => {
  it("returns null when called directly on a non-slash input", () => {
    expect(parseSlash('hello', catalogue)).toBeNull();
  });

  it("returns null when catalogue is empty / null / malformed", () => {
    expect(parseSlash('/done', null)).toBeNull();
    expect(parseSlash('/done', {})).toBeNull();
    expect(parseSlash('/done', { commandMenu: 'not-an-array' })).toBeNull();
  });

  it("case-sensitive command matching", () => {
    expect(parseInput('/DONE dishwasher', catalogue).kind).toBe('unknown');
    expect(parseInput('/done dishwasher', catalogue).kind).toBe('slash');
  });
});
