/**
 * Where one membership statement stands against another in the lane's causal order (the deps-DAG), the same on every
 * device that holds both: by an ancestry path, never by depth or a clock. Concurrent acts are named concurrent.
 */
import { describe, it, expect } from 'vitest';
import { causalPlace, foldRoster } from '../src/security/rosterFold.js';

const st = (hash, kind, author, subject, parentHash = null, deps = []) => ({ hash, kind, author, subject, parentHash, deps });

describe('causalPlace', () => {
  const join = st('j1', 'join', 'bea', 'bea');
  const evictAfter = st('e1', 'evict', 'ann', 'bea', null, ['j1']);         // ann saw the join, then evicted
  const evictConcurrent = st('e2', 'evict', 'ann', 'bea');                  // ann evicted without having seen it
  const rejoin = st('j2', 'join', 'bea', 'bea', 'j1', ['e1']);             // bea rejoined after seeing the evict
  const all = [join, evictAfter, evictConcurrent, rejoin];

  it('an exit that saw the admission is after it', () => { expect(causalPlace(all, 'j1', 'e1')).toBe('after'); });
  it('an admission that saw the exit is after it (the exit is before)', () => { expect(causalPlace(all, 'j2', 'e1')).toBe('before'); });
  it('two acts that never saw each other are concurrent, whatever their depth', () => { expect(causalPlace(all, 'j1', 'e2')).toBe('concurrent'); });
  it('a statement not held cannot be placed', () => { expect(causalPlace(all, 'j1', 'nope')).toBeNull(); expect(causalPlace(all, 'nope', 'e1')).toBeNull(); });
  it('one statement is the same', () => { expect(causalPlace(all, 'j1', 'j1')).toBe('same'); });
});

describe('the fold names the statement of each last exit', () => {
  it('lastExitBy holds the hash of the leave', () => {
    const f = foldRoster([st('j1', 'join', 'bea', 'bea'), st('l1', 'leave', 'bea', 'bea', 'j1')], { founders: ['ann'] });
    expect(f.lastExit.bea).toBe('leave');
    expect(f.lastExitBy.bea).toBe('l1');
  });
});
