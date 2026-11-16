/**
 * Where one membership statement stands against another in the lane's causal order (the deps-DAG), the same on every
 * device that holds both: by an ancestry path, never by depth or a clock. Concurrent acts are named concurrent.
 */
import { describe, it, expect } from 'vitest';
import { causalPlace, foldRoster, memberStatusFrom } from '../src/security/rosterFold.js';

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

describe('memberStatusFrom: in only for an admitted join of THIS subject', () => {
  const FOUNDERS = { founders: ['ann'] };
  const status = (stmts, webid, after = null, tweak = (f) => f) => {
    const folded = tweak(foldRoster(stmts, FOUNDERS));
    return memberStatusFrom({ folded, statements: stmts, webid, after }).status;
  };

  it('an admitted join with no exit after it is in; an exit after it is out', () => {
    const j = st('j1', 'join', 'bea', 'bea');
    expect(status([j], 'bea', 'j1')).toBe('in');
    expect(status([j, st('e1', 'evict', 'ann', 'bea', null, ['j1'])], 'bea', 'j1')).toBe('out');
  });

  it('a join by an author who may not admit, named as the admission, is not in', () => {
    const j = st('j1', 'join', 'cas', 'bea');   // cas is no admin: the fold does not admit bea
    expect(status([j], 'bea', 'j1')).not.toBe('in');
  });

  it('another member\'s join named for this webid is not in', () => {
    const stmts = [st('j1', 'join', 'bea', 'bea'), st('j2', 'join', 'dan', 'dan')];
    expect(status(stmts, 'bea', 'j2')).not.toBe('in');
  });

  it('a join and an eviction at the same depth (the eviction wins) is not in', () => {
    const stmts = [st('j1', 'join', 'bea', 'bea'), st('e1', 'evict', 'ann', 'bea')];
    expect(foldRoster(stmts, FOUNDERS).members).not.toContain('bea');
    expect(status(stmts, 'bea', 'j1')).not.toBe('in');
  });

  it('a join the roster read did not admit yet (its redemption row not here) is null, and in once it is', () => {
    const j = st('j1', 'join', 'bea', 'bea');
    expect(status([j], 'bea', 'j1', (f) => ({ ...f, members: f.members.filter((m) => m !== 'bea') }))).toBeNull();
    expect(status([j], 'bea', 'j1')).toBe('in');
  });

  it('a founder (no join) is in; with no admission named, the last admitted join decides', () => {
    expect(status([st('j1', 'join', 'bea', 'bea')], 'ann')).toBe('in');
    expect(status([st('j1', 'join', 'bea', 'bea'), st('e1', 'evict', 'ann', 'bea', null, ['j1'])], 'bea')).toBe('out');
  });
});
