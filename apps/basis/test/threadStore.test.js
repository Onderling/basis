/**
 * basis — ThreadStore tests. v0.2.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  ThreadStore, createDefaultThreadStore, __resetThreadIdSeq,
} from '../src/threadStore.js';
import { Thread } from '../src/thread.js';

beforeEach(() => __resetThreadIdSeq());

describe('ThreadStore — lifecycle', () => {
  it('starts empty', () => {
    const s = new ThreadStore();
    expect(s.size).toBe(0);
    expect(s.activeId).toBeNull();
    expect(s.listThreads()).toEqual([]);
  });

  it('createThread auto-generates an id when absent', () => {
    const s = new ThreadStore();
    const t = s.createThread({ name: 'Test' });
    expect(t).toBeInstanceOf(Thread);
    expect(t.name).toBe('Test');
    expect(typeof t.id).toBe('string');
    expect(t.id).toMatch(/^t-/);
    expect(s.size).toBe(1);
  });

  it('createThread accepts explicit id, filter, permissions', () => {
    const s = new ThreadStore();
    const t = s.createThread({
      id:   'household-alerts',
      name: 'Household alerts',
      filter:      { apps: ['household'], eventTypes: ['notification'] },
      permissions: { allowCommands: true, allowedApps: ['household'] },
    });
    expect(t.id).toBe('household-alerts');
    expect(t.filter).toEqual({
      apps: ['household'], eventTypes: ['notification'],
    });
    expect(t.permissions).toEqual({
      allowCommands: true, allowedApps: ['household'],
    });
  });

  it('throws on duplicate id', () => {
    const s = new ThreadStore();
    s.createThread({ id: 'main', name: 'Main' });
    expect(() => s.createThread({ id: 'main', name: 'Main 2' }))
      .toThrow(/already exists/);
  });

  it('first thread becomes active automatically', () => {
    const s = new ThreadStore();
    s.createThread({ id: 'a', name: 'A' });
    s.createThread({ id: 'b', name: 'B' });
    expect(s.activeId).toBe('a');
    expect(s.getActiveThread().id).toBe('a');
  });

  it('createdAt uses injected clock', () => {
    const now = vi.fn(() => 100);
    const s = new ThreadStore({ now });
    const t = s.createThread({ name: 'X' });
    expect(t.createdAt).toBe(100);
  });
});

describe('ThreadStore — getThread / deleteThread', () => {
  it('getThread returns the thread or undefined', () => {
    const s = new ThreadStore();
    const t = s.createThread({ id: 'a', name: 'A' });
    expect(s.getThread('a')).toBe(t);
    expect(s.getThread('nope')).toBeUndefined();
  });

  it('deleteThread removes the thread', () => {
    const s = new ThreadStore();
    s.createThread({ id: 'a', name: 'A' });
    expect(s.deleteThread('a')).toBe(true);
    expect(s.size).toBe(0);
    expect(s.deleteThread('nope')).toBe(false);
  });

  it('deleting active thread re-assigns active to newest remaining', () => {
    let t = 0;
    const s = new ThreadStore({ now: () => ++t });
    s.createThread({ id: 'a', name: 'A' });   // createdAt: 1
    s.createThread({ id: 'b', name: 'B' });   // createdAt: 2
    s.createThread({ id: 'c', name: 'C' });   // createdAt: 3
    expect(s.activeId).toBe('a');
    s.setActiveThread('b');
    expect(s.activeId).toBe('b');
    s.deleteThread('b');
    // newest remaining = c
    expect(s.activeId).toBe('c');
  });

  it('deleting only thread sets active to null', () => {
    const s = new ThreadStore();
    s.createThread({ id: 'a', name: 'A' });
    s.deleteThread('a');
    expect(s.activeId).toBeNull();
    expect(s.getActiveThread()).toBeUndefined();
  });
});

describe('ThreadStore — updateThread', () => {
  it('updates name', () => {
    const s = new ThreadStore();
    const t = s.createThread({ id: 'a', name: 'A' });
    s.updateThread('a', { name: 'Aa' });
    expect(t.name).toBe('Aa');
  });

  it('updates filter (normalised + de-duped)', () => {
    const s = new ThreadStore();
    const t = s.createThread({ id: 'a', name: 'A' });
    s.updateThread('a', { filter: { apps: ['x', 'x', 'y'] } });
    expect(t.filter).toEqual({ apps: ['x', 'y'] });
  });

  it("updates permissions partially", () => {
    const s = new ThreadStore();
    const t = s.createThread({
      id: 'a', name: 'A',
      permissions: { allowCommands: true, allowedApps: ['household'] },
    });
    s.updateThread('a', { permissions: { allowCommands: false } });
    expect(t.permissions.allowCommands).toBe(false);
    expect(t.permissions.allowedApps).toEqual(['household']);    // preserved
  });

  it("returns undefined for unknown thread", () => {
    const s = new ThreadStore();
    expect(s.updateThread('nope', { name: 'x' })).toBeUndefined();
  });
});

describe('ThreadStore — listThreads', () => {
  it('returns threads sorted by createdAt newest-first', () => {
    let t = 0;
    const s = new ThreadStore({ now: () => ++t });
    s.createThread({ id: 'a', name: 'A' });
    s.createThread({ id: 'b', name: 'B' });
    s.createThread({ id: 'c', name: 'C' });
    expect(s.listThreads().map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('ThreadStore — active thread', () => {
  it('setActiveThread throws for unknown id', () => {
    const s = new ThreadStore();
    s.createThread({ id: 'a', name: 'A' });
    expect(() => s.setActiveThread('nope')).toThrow(/no thread/);
  });

  it('setActiveThread changes the active id', () => {
    const s = new ThreadStore();
    s.createThread({ id: 'a', name: 'A' });
    s.createThread({ id: 'b', name: 'B' });
    s.setActiveThread('b');
    expect(s.activeId).toBe('b');
    expect(s.getActiveThread().id).toBe('b');
  });
});

describe('ThreadStore — subscriptions', () => {
  it('emits thread-created / -updated / -deleted / active-changed', () => {
    const s = new ThreadStore();
    const events = [];
    s.subscribe((e) => events.push(e));

    s.createThread({ id: 'a', name: 'A' });
    expect(events.at(-1)).toEqual({ kind: 'thread-created', threadId: 'a' });

    s.createThread({ id: 'b', name: 'B' });
    s.setActiveThread('b');
    expect(events.at(-1)).toEqual({ kind: 'active-changed', threadId: 'b' });

    s.updateThread('a', { name: 'A1' });
    expect(events.at(-1)).toEqual({ kind: 'thread-updated', threadId: 'a' });

    s.deleteThread('a');
    expect(events.at(-1)).toEqual({ kind: 'thread-deleted', threadId: 'a' });
  });

  it('unsubscribe stops further deliveries', () => {
    const s = new ThreadStore();
    const events = [];
    const off = s.subscribe((e) => events.push(e));
    s.createThread({ id: 'a', name: 'A' });
    off();
    s.createThread({ id: 'b', name: 'B' });
    expect(events.map((e) => e.threadId)).toEqual(['a']);
  });

  it('swallows subscriber errors (one bad listener doesn\'t break others)', () => {
    const s = new ThreadStore();
    const good = [];
    s.subscribe(() => { throw new Error('boom'); });
    s.subscribe((e) => good.push(e));
    s.createThread({ id: 'a', name: 'A' });
    expect(good.length).toBe(1);
  });
});

describe('createDefaultThreadStore', () => {
  it('seeds Main + Inbox', () => {
    const s = createDefaultThreadStore();
    expect(s.size).toBe(2);
    expect(s.getThread('main')?.name).toBe('Main');
    expect(s.getThread('inbox')?.name).toBe('Inbox');
  });

  it('Main filter is wildcard; Inbox filters notifications + reminders', () => {
    const s = createDefaultThreadStore();
    expect(s.getThread('main').filter).toEqual({});
    expect(s.getThread('inbox').filter).toEqual({
      eventTypes: ['notification', 'reminder'],
    });
  });

  it("Main is active on fresh install", () => {
    const s = createDefaultThreadStore();
    expect(s.activeId).toBe('main');
  });
});

describe('Thread — v0.2 schema extensions', () => {
  it("defaults filter to {} (wildcard) when constructed without opts", () => {
    const t = new Thread();
    expect(t.filter).toEqual({});
  });

  it('defaults permissions.allowCommands to true', () => {
    const t = new Thread();
    expect(t.permissions.allowCommands).toBe(true);
    expect(t.permissions.allowedApps).toBeUndefined();
  });

  it('passes filter + permissions through', () => {
    const t = new Thread({
      filter: { apps: ['household'] },
      permissions: { allowCommands: false, allowedApps: ['pinboard'] },
    });
    expect(t.filter).toEqual({ apps: ['household'] });
    expect(t.permissions).toEqual({
      allowCommands: false, allowedApps: ['pinboard'],
    });
  });

  it('createdAt set at construction', () => {
    const t = new Thread({ now: () => 12_345 });
    expect(t.createdAt).toBe(12_345);
  });
});
