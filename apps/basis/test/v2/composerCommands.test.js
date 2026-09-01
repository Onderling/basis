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

  it('lists the place\'s ops that declare a slash command, then this DEVICE\'s own', () => {
    // The circle's catalogue is scoped to the apps it composes, which excludes basis on purpose (the
    // bot's LLM must not pick `/me` out of a hundred ops). A person's own typing is the other case:
    // `/whoami` and `/logs` are things this device does, equally true in every circle and in none.
    const commands = cc.pool.map((e) => e.command);
    expect(commands.slice(0, 3), 'the place comes first').toEqual(['/brief', '/find', '/logs']);
    expect(commands, 'and the device\'s own are there too').toContain('/whoami');
    expect(commands, 'de-duplicated: the place wins a collision')
      .toEqual([...new Set(commands)]);
  });

  it('suggests while the command word is being typed, and stops at the space', () => {
    expect(cc.suggest('/f').map((e) => e.command)).toContain('/find');
    expect(cc.suggest('/'), 'a bare slash offers everything here').not.toHaveLength(0);
    expect(cc.suggest('/find ada'), 'past the word, the person is into arguments').toEqual([]);
    expect(cc.suggest('hello')).toEqual([]);
  });

  it('parses a typed line into a dispatch: which app, which op, and the args as declared', () => {
    // `rest` stays for a shell that only wants the raw tail; `args` is the manifest's own reading of it
    // (`flags` → --key=value, `argline`/`match` → the whole line as `_match`), so a shell never has to
    // re-invent per command — which is how five hand-parsed builtins became the only typeable ops.
    expect(cc.parse('/find ada lovelace')).toMatchObject({ opId: 'find', rest: 'ada lovelace' });
    expect(cc.parse('/brief')).toMatchObject({ opId: 'brief', rest: '' });
    const typed = cc.parse('/whoami');
    expect(typed, 'a device command carries its own origin, so the shell can dispatch it')
      .toMatchObject({ opId: 'whoami', appOrigin: 'basis' });
    // Read against the DEVICE's own declarations — this fixture's `/logs` is the fixture's op, and the
    // body rule that matters here is the one basis declares.
    const device = createComposerCommands({ kind: 'circle' });
    expect(device.parse('/logs --app=stoop').args).toEqual({ app: 'stoop' });
    expect(device.parse('/block alice').args, 'an argline body lands as _match, as the handlers read it')
      .toEqual({ _match: 'alice' });
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
    expect(cc.parse('/translate hallo')).toMatchObject({ opId: 'translate', rest: 'hallo' });
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
      expect(Object.keys(row).sort()).toEqual(expect.arrayContaining(['command', 'hint', 'opId']));
    }
  });

  it('tolerates a missing context rather than throwing into a composer', () => {
    const empty = createComposerCommands();
    // No place, so nothing of the place's — but this device's own commands do not depend on being
    // anywhere, which is the point of them: a person with no circle can still ask `/whoami`.
    expect(() => empty.suggest('/')).not.toThrow();
    expect(empty.pool.map((e) => e.command)).toContain('/whoami');
    expect(empty.parse('/whoami')).toMatchObject({ opId: 'whoami', appOrigin: 'basis' });
    expect(empty.parse('/x'), 'and a line nothing offers is still chat').toBeNull();
  });
});
