/**
 * rosterFold — the membership head over the spine chain. A pure, DETERMINISTIC fold: same statements → same
 * roster (principle 10), deny-wins falls out of the fold order (a demotion folded before an eviction voids it),
 * equivocators are discounted, founders are the root of authority. These tests ARE the spec for decision 4.
 */
import { describe, it, expect } from 'vitest';
import { foldRoster } from '../src/security/rosterFold.js';
import { signSpine } from '../src/security/spineStatement.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';

async function ids() {
  const founder = await AgentIdentity.generate(new VaultMemory());
  const bob     = await AgentIdentity.generate(new VaultMemory());
  const mallory = await AgentIdentity.generate(new VaultMemory());
  return { founder, bob, mallory };
}
/** Build a spine body (what the fold consumes). `deps` = the cross-author frontier the author had SEEN. */
const body = (id, kind, subject, { payload, parent = null, deps = [] } = {}) =>
  signSpine(id, { kind, circleId: 'c', subject: subject.pubKey ?? subject, payload, parent, deps }).body;

describe('foldRoster — the deterministic membership head', () => {
  it('founders are admin + member; a join adds a member; an admin evicts, a non-admin cannot', async () => {
    const { founder, mallory } = await ids();
    const stmts = [
      body(mallory, 'join', mallory),                     // mallory joins (member)
      body(mallory, 'evict', founder, { parent: null }),  // NON-admin tries to evict the founder → void
    ];
    // add a second mallory statement chained so the two aren't a fork (different parents)
    stmts[1] = body(mallory, 'evict', founder, { parent: stmts[0].hash });
    const r = foldRoster(stmts, { founders: [founder.pubKey] });
    expect(r.members).toEqual([founder.pubKey, mallory.pubKey].sort());
    expect(r.admins).toEqual([founder.pubKey]);
  });

  it('an admin evicts a member; a re-join after re-admits (removal is not permanent)', async () => {
    const { founder, mallory } = await ids();
    const join1 = body(mallory, 'join', mallory);
    const evict = body(founder, 'evict', mallory);
    const rejoin = body(mallory, 'join', mallory, { parent: join1.hash });   // deeper → folded after the evict
    const afterEvict = foldRoster([join1, evict], { founders: [founder.pubKey] });
    expect(afterEvict.members).toEqual([founder.pubKey]);                    // mallory out
    const afterRejoin = foldRoster([join1, evict, rejoin], { founders: [founder.pubKey] });
    expect(afterRejoin.members).toEqual([founder.pubKey, mallory.pubKey].sort());   // re-admitted
  });

  // ── DYNAMIC ROLE AUTHORITY — closed by the deps-DAG (DESIGN-log-ordering-unification §2–4). A cross-author
  // causal edge (`deps`: the frontier the author had SEEN) raises the causal depth, so "bob's evict is causally
  // AFTER founder's promote-of-bob" IS representable: bob's evict carries the promote in its deps, folds at a
  // strictly greater depth, and finds bob already an admin. These two were `it.todo` (PLAN-membership §8, the
  // open decision the deps-DAG closes); they are now passing `it` tests.
  it('role: a promoted non-founder can then evict — its evict folds AFTER its own promotion (deps-DAG)', async () => {
    const { founder, bob, mallory } = await ids();
    const joinBob     = body(bob, 'join', bob);                                       // bob is a member
    const joinMallory = body(mallory, 'join', mallory);                              // mallory is a member
    const promote     = body(founder, 'role', bob, { payload: { role: 'admin' } });  // founder promotes bob → admin
    // bob evicts mallory HAVING SEEN his own promotion: the promote is in his frontier, so his evict is causally
    // LATER than it and folds where he is already an admin. Without the cross-author edge this was the todo gap.
    const bobEvicts   = body(bob, 'evict', mallory, { parent: joinBob.hash, deps: [promote.hash] });
    const r = foldRoster([joinBob, joinMallory, promote, bobEvicts], { founders: [founder.pubKey] });
    expect(r.admins.sort()).toEqual([bob.pubKey, founder.pubKey].sort());   // bob really is admin
    expect(r.members).not.toContain(mallory.pubKey);                        // and his eviction took
    expect(r.members.sort()).toEqual([bob.pubKey, founder.pubKey].sort());
  });

  it('a PAST eviction holds even after the evictor is later demoted (deny-wins falls out of the causal order)', async () => {
    const { founder, bob, mallory } = await ids();
    const joinBob     = body(bob, 'join', bob);
    const joinMallory = body(mallory, 'join', mallory);
    const promote     = body(founder, 'role', bob, { payload: { role: 'admin' } });         // bob → admin
    const bobEvicts   = body(bob, 'evict', mallory, { parent: joinBob.hash, deps: [promote.hash] });  // admin evicts mallory
    // The founder later demotes bob HAVING SEEN the eviction (it is in the demote's frontier) → the demote folds
    // AT A GREATER DEPTH than the eviction. So the eviction was applied while bob was still admin, and bob's
    // later loss of admin does NOT retroactively void it. (Were the two concurrent, deny-wins would void it.)
    const demote      = body(founder, 'role', bob, { payload: { role: 'member' }, parent: promote.hash, deps: [bobEvicts.hash] });
    const r = foldRoster([joinBob, joinMallory, promote, bobEvicts, demote], { founders: [founder.pubKey] });
    expect(r.members).not.toContain(mallory.pubKey);   // the past eviction HELD
    expect(r.admins).not.toContain(bob.pubKey);        // bob was demoted afterwards
    expect(r.members).toContain(bob.pubKey);           // …but is still an ordinary member
    expect(r.admins).toEqual([founder.pubKey]);
  });

  it('a demotion CONCURRENT with the evict still voids it (deny-wins) — the causal edge is what changes the outcome', async () => {
    // The contrast case that proves the deps-DAG (not merely the depth) is load-bearing: same statements, but
    // the demote does NOT see the eviction (no dep) and the evict does NOT see the demote → they are concurrent,
    // fold at the SAME depth, and deny-wins voids bob's evict. mallory stays.
    const { founder, bob, mallory } = await ids();
    const joinBob     = body(bob, 'join', bob);
    const joinMallory = body(mallory, 'join', mallory);
    const promote     = body(founder, 'role', bob, { payload: { role: 'admin' } });
    const bobEvicts   = body(bob, 'evict', mallory, { parent: joinBob.hash, deps: [promote.hash] });
    const demote      = body(founder, 'role', bob, { payload: { role: 'member' }, parent: promote.hash, deps: [promote.hash] });
    const r = foldRoster([joinBob, joinMallory, promote, bobEvicts, demote], { founders: [founder.pubKey] });
    expect(r.members).toContain(mallory.pubKey);   // concurrent demotion voided bob's authority → mallory stays
    expect(r.admins).not.toContain(bob.pubKey);
  });

  it('mutual eviction of two admins resolves to ONE deterministic winner (not both-out, not a fracture)', async () => {
    const { founder, bob } = await ids();
    const promote  = body(founder, 'role', bob, { payload: { role: 'admin' } });
    const aEvictsB = body(founder, 'evict', bob, { parent: promote.hash });
    const bEvictsA = body(bob, 'evict', founder);
    const r = foldRoster([promote, aEvictsB, bEvictsA], { founders: [founder.pubKey] });
    // exactly one admin survives; founder is a founder (not evictable), so founder wins, bob is out.
    expect(r.admins).toEqual([founder.pubKey]);
    expect(r.members).not.toContain(bob.pubKey);
  });

  it('is DETERMINISTIC — the input order does not change the result (convergence)', async () => {
    const { founder, bob, mallory } = await ids();
    const s = [
      body(mallory, 'join', mallory),
      body(founder, 'role', bob, { payload: { role: 'admin' } }),
      body(founder, 'evict', mallory),
    ];
    const a = foldRoster(s, { founders: [founder.pubKey] });
    const b = foldRoster([s[2], s[0], s[1]], { founders: [founder.pubKey] });
    const c = foldRoster([s[1], s[2], s[0]], { founders: [founder.pubKey] });
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it('an EQUIVOCATOR (two statements off one parent) is discounted wholesale', async () => {
    const { founder, bob, mallory } = await ids();
    const join = body(mallory, 'join', mallory);
    const root = body(founder, 'join', founder);                          // founder's chain root
    // founder (a seeded admin) FORKS: two different evictions off the SAME parent → equivocation.
    const forkA = body(founder, 'evict', mallory, { parent: root.hash });
    const forkB = body(founder, 'evict', bob, { parent: root.hash });
    const r = foldRoster([join, root, forkA, forkB], { founders: [founder.pubKey] });
    // founder equivocated → all founder's CHAINED statements discounted → neither eviction applies;
    // mallory (whose own join is untouched) stays a member.
    expect(r.members).toContain(mallory.pubKey);
  });

  it('a SEED roster folds under the spine: seed members start IN (evictable), a seed admin can act', async () => {
    // The cutover model: at cutover the current roster is the materialised HEAD (the seed), and new spine
    // transitions fold on top. A seed admin (a pre-established admin, NOT a spine-promoted one) may act at the
    // first fold point, and a seed member is an ordinary, evictable member — unlike a founder.
    const { founder, bob, mallory } = await ids();
    const evict = body(bob, 'evict', mallory);   // bob (a SEED admin) evicts mallory (a SEED member)
    const r = foldRoster([evict], {
      founders: [founder.pubKey],
      seed: { members: [bob.pubKey, mallory.pubKey], admins: [bob.pubKey] },
    });
    expect(r.members).toContain(founder.pubKey);
    expect(r.members).toContain(bob.pubKey);
    expect(r.members).not.toContain(mallory.pubKey);       // a seed member IS evictable by a seed admin
    expect(r.admins.sort()).toEqual([bob.pubKey, founder.pubKey].sort());
  });

  it('the seed is inert when no spine statements are given (identical to the founders-only fold)', async () => {
    const { founder, bob } = await ids();
    const seeded = foldRoster([], { founders: [founder.pubKey], seed: { members: [bob.pubKey], admins: [] } });
    expect(seeded.members.sort()).toEqual([bob.pubKey, founder.pubKey].sort());
    expect(seeded.admins).toEqual([founder.pubKey]);       // bob a seeded member, not admin
  });

  it('a founder is never evictable', async () => {
    const { founder, bob } = await ids();
    const promote  = body(founder, 'role', bob, { payload: { role: 'admin' } });
    const bobEvictsFounder = body(bob, 'evict', founder);
    const r = foldRoster([promote, bobEvictsFounder], { founders: [founder.pubKey] });
    expect(r.members).toContain(founder.pubKey);
    expect(r.admins).toContain(founder.pubKey);
  });
});
