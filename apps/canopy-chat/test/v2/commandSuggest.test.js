import { describe, it, expect } from 'vitest';
import { buildCommandPool, suggestCommands, createInputHistory } from '../../src/v2/commandSuggest.js';

// Minimal catalog stub: opsById is a Map<opId, { op }> (the mergeManifests/filterCatalog shape).
function catalogOf(ops) {
  return { opsById: new Map(ops.map((op) => [op.id, { op }])) };
}
const SAMPLE = catalogOf([
  { id: 'addTask',      surfaces: { slash: { command: '/addtask' }, chat: { hint: 'add a task' } } },
  { id: 'completeTask', surfaces: { slash: { command: '/complete-task' }, chat: { hint: 'finish a task' } } },
  { id: 'apps',         surfaces: { slash: { command: '/apps' } } },                 // no chat.hint → falls back to id
  { id: 'listMine',     surfaces: { chat: { hint: 'no slash' } } },                  // no slash → excluded
  { id: 'feedback',     surfaces: { slash: { command: '/feedback' }, chat: { hint: 'give feedback' } } },
]);

describe('buildCommandPool', () => {
  it('extracts every op with a slash command, sorted by command, with hint (or id fallback)', () => {
    expect(buildCommandPool(SAMPLE)).toEqual([
      { command: '/addtask',       hint: 'add a task',    opId: 'addTask' },
      { command: '/apps',          hint: 'apps',          opId: 'apps' },        // hint fell back to id
      { command: '/complete-task', hint: 'finish a task', opId: 'completeTask' },
      { command: '/feedback',      hint: 'give feedback', opId: 'feedback' },
    ]);
  });
  it('accepts the bare-op entry shape too (entry without a nested .op)', () => {
    const cat = { opsById: new Map([['x', { id: 'x', surfaces: { slash: { command: '/x' } } }]]) };
    expect(buildCommandPool(cat).map((m) => m.command)).toEqual(['/x']);
  });
  it('returns [] for a missing / malformed catalog', () => {
    expect(buildCommandPool(null)).toEqual([]);
    expect(buildCommandPool({})).toEqual([]);
    expect(buildCommandPool({ opsById: {} })).toEqual([]);
  });
});

describe('suggestCommands', () => {
  it('prefix-matches the command word (case-insensitive)', () => {
    expect(suggestCommands(SAMPLE, '/a').map((m) => m.command)).toEqual(['/addtask', '/apps']);
    expect(suggestCommands(SAMPLE, '/COMP').map((m) => m.command)).toEqual(['/complete-task']);
  });
  it('returns the whole pool for a bare slash', () => {
    expect(suggestCommands(SAMPLE, '/').length).toBe(4);
  });
  it('closes (returns []) when not starting with "/" or once a space is typed (into args)', () => {
    expect(suggestCommands(SAMPLE, 'add')).toEqual([]);
    expect(suggestCommands(SAMPLE, '/addtask milk')).toEqual([]);
    expect(suggestCommands(SAMPLE, '')).toEqual([]);
  });
  it('respects the limit', () => {
    expect(suggestCommands(SAMPLE, '/', { limit: 2 }).length).toBe(2);
  });
});

describe('createInputHistory', () => {
  it('cycles back with prev() and restores the draft on next() past the newest', () => {
    const h = createInputHistory();
    h.push('/addtask a'); h.push('/mytasks');
    expect(h.prev('draft-x')).toBe('/mytasks');   // first ArrowUp → newest, draft saved
    expect(h.prev()).toBe('/addtask a');           // older
    expect(h.prev()).toBe('/addtask a');           // clamped at oldest
    expect(h.next()).toBe('/mytasks');             // forward
    expect(h.next()).toBe('draft-x');              // past newest → restored draft
    expect(h.next()).toBe(null);                   // not navigating anymore
  });
  it('de-dups consecutive identical entries and resets navigation on push', () => {
    const h = createInputHistory();
    h.push('/x'); h.push('/x'); h.push('/y');
    expect(h.size).toBe(2);
    h.prev('d');
    h.push('/z');                                  // push resets idx → prev starts from newest again
    expect(h.prev('d2')).toBe('/z');
  });
  it('caps the buffer (oldest shifted out)', () => {
    const h = createInputHistory({ cap: 2 });
    h.push('/1'); h.push('/2'); h.push('/3');
    expect(h.size).toBe(2);
    expect(h.prev()).toBe('/3');
    expect(h.prev()).toBe('/2');
    expect(h.prev()).toBe('/2');                   // '/1' was evicted
  });
  it('prev() returns null with no history; reset() abandons navigation', () => {
    const h = createInputHistory();
    expect(h.prev('d')).toBe(null);
    h.push('/a');
    h.prev('d');
    h.reset();
    expect(h.next()).toBe(null);                   // reset cleared the navigation state
  });
});
