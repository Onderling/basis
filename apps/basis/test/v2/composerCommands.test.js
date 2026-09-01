/**
 * The typed door — one seam, and the filter that makes it honest.
 *
 * What this pins is not the dropdown but the FILTER: a composer offers what this place actually does,
 * and stays quiet about the rest. The failure it exists to prevent is the one the attach menu already
 * produced once — offering an op the circle does not compose, then answering a tap with "I couldn't turn
 * that into an action", which is the app blaming a person for its own configuration.
 */
import { describe, it, expect } from 'vitest';
import { createComposerCommands } from '../../src/v2/composerCommands.js';

/** The shape `buildCommandPool` reads: a merged catalogue's op index. */
const catalogue = (ops) => ({ opsById: new Map(ops.map((o) => [o.id, { op: o }])) });
const op = (id, command, hint) => ({ id, surfaces: { slash: { command }, chat: { hint } } });

const CIRCLE = catalogue([
  op('find', '/find', 'search across all apps'),
  op('brief', '/brief', 'morning summary'),
  op('logs', '/logs', 'recent events'),
  { id: 'compare', surfaces: { chat: { hint: 'no slash surface' } } },   // chat-only: not typeable
]);

describe('a circle composer offers what the circle composes', () => {
  const cc = createComposerCommands({ kind: 'circle', catalogue: CIRCLE });

  it('lists only ops that declare a slash command', () => {
    expect(cc.pool.map((e) => e.command)).toEqual(['/brief', '/find', '/logs']);
  });

  it('suggests while the command word is being typed, and stops at the space', () => {
    expect(cc.suggest('/f').map((e) => e.command)).toEqual(['/find']);
    expect(cc.suggest('/'), 'a bare slash offers everything here').toHaveLength(3);
    expect(cc.suggest('/find ada'), 'past the word, the person is into arguments').toEqual([]);
    expect(cc.suggest('hello')).toEqual([]);
  });

  it('parses a typed line into {opId, rest}', () => {
    expect(cc.parse('/find ada lovelace')).toEqual({ opId: 'find', rest: 'ada lovelace' });
    expect(cc.parse('/brief')).toEqual({ opId: 'brief', rest: '' });
  });

  it('returns null for a slash line this place does not offer — chat, not a refusal', () => {
    // The load-bearing case. In a conversation a slash is sometimes just a slash, and an app that
    // refused it would be telling the person their sentence was wrong when its own scope was narrow.
    expect(cc.parse('/compare')).toBeNull();      // declared, but no slash surface
    expect(cc.parse('/nonsense')).toBeNull();
    expect(cc.parse('what about /find?')).toBeNull();
  });
});

describe('a contact composer offers what THAT PEER exposes — not your own ops', () => {
  const cc = createComposerCommands({
    kind: 'contact',
    skills: [
      { id: 'summarise', description: 'summarise a thread' },
      { id: 'translate', description: 'translate a message' },
    ],
  });

  it('builds the pool from the peer’s skill cards', () => {
    expect(cc.pool).toEqual([
      { command: '/summarise', hint: 'summarise a thread', opId: 'summarise' },
      { command: '/translate', hint: 'translate a message', opId: 'translate' },
    ]);
  });

  it('does NOT offer the circle’s ops — a bot is asked what IT can do', () => {
    // A bot is a contact, so this is also the answer to "what does this bot offer".
    expect(cc.suggest('/f')).toEqual([]);
    expect(cc.parse('/find')).toBeNull();
  });

  it('suggests and parses over the peer’s list', () => {
    expect(cc.suggest('/s').map((e) => e.command)).toEqual(['/summarise']);
    expect(cc.parse('/translate hallo')).toEqual({ opId: 'translate', rest: 'hallo' });
  });

  it('a peer that exposes nothing offers nothing, and says so by being empty', () => {
    const none = createComposerCommands({ kind: 'contact', skills: [] });
    expect(none.pool).toEqual([]);
    expect(none.suggest('/')).toEqual([]);
    expect(none.parse('/anything')).toBeNull();
  });
});

describe('the two contexts are the same shape', () => {
  it('both produce {command, hint, opId} rows, so one renderer paints either', () => {
    const circle = createComposerCommands({ kind: 'circle', catalogue: CIRCLE });
    const contact = createComposerCommands({ kind: 'contact', skills: [{ id: 'x', description: 'y' }] });
    for (const row of [...circle.pool, ...contact.pool]) {
      expect(Object.keys(row).sort()).toEqual(['command', 'hint', 'opId']);
    }
  });

  it('tolerates a missing context rather than throwing into a composer', () => {
    const empty = createComposerCommands();
    expect(empty.pool).toEqual([]);
    expect(empty.suggest('/')).toEqual([]);
    expect(empty.parse('/x')).toBeNull();
  });
});
