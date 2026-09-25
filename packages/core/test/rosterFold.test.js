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

  // ── WHO MAY ADMIT SOMEONE ELSE (Frits 2026-09-24, ledger L127: "any admin should be able to readmit someone who
  // left"). A join signed by the joiner stands on its redemption row (checked where the rows are, in the roster
  // read). A join signed by SOMEONE ELSE — an admin confirming a remote joiner — stands only when that author is an
  // admin AT THAT CAUSAL POINT: the same `canAct` the role and evict statements already answer to. Before this the
  // fold admitted every join and the read allowed only founders, so an organiser's promoted admin could never
  // re-admit someone who had left (the pair roster's returning contact, when the one who deleted them had founded it).
  it('a promoted admin re-admits someone who LEFT — the join it signs folds after its own promotion', async () => {
    const { founder, bob, mallory } = await ids();
    const joinBob  = body(bob, 'join', bob);
    const joinMal  = body(mallory, 'join', mallory);
    const promote  = body(founder, 'role', bob, { payload: { role: 'admin' } });
    const malLeaves = body(mallory, 'leave', mallory, { parent: joinMal.hash });
    // bob, having seen his promotion and mallory's leave, confirms mallory's return
    const bobAdmits = body(bob, 'join', mallory, { parent: joinBob.hash, deps: [promote.hash, malLeaves.hash] });
    const r = foldRoster([joinBob, joinMal, promote, malLeaves, bobAdmits], { founders: [founder.pubKey] });
    expect(r.members).toContain(mallory.pubKey);
  });

  it('a join of SOMEONE ELSE signed by a non-admin admits nobody', async () => {
    const { founder, bob, mallory } = await ids();
    const joinBob  = body(bob, 'join', bob);
    // bob is a plain member: his statement that mallory joined carries no authority
    const bobAdmits = body(bob, 'join', mallory, { parent: joinBob.hash });
    const r = foldRoster([joinBob, bobAdmits], { founders: [founder.pubKey] });
    expect(r.members).not.toContain(mallory.pubKey);
  });

  it('an admin DEMOTED at the same depth as an admission they signed admits nobody — the concurrent demotion is the deny (L127 review)', async () => {
    const { founder, bob, mallory } = await ids();
    const jb = body(bob, 'join', bob, { payload: { peerDisplay: 'bob' } });
    const promote = body(founder, 'role', bob, { payload: { role: 'admin' }, parent: null, deps: [jb.hash] });
    // bob (now admin) admits mallory; the founder demotes bob — CONCURRENTLY (same deps: neither saw the other)
    const admit = body(bob, 'join', mallory, { payload: { peerDisplay: 'mal' }, parent: jb.hash, deps: [promote.hash] });
    const demote = body(founder, 'role', bob, { payload: { role: 'member' }, parent: promote.hash, deps: [promote.hash] });
    const r = foldRoster([jb, promote, admit, demote], { founders: [founder.pubKey] });
    expect(r.admins).not.toContain(bob.pubKey);                     // the demotion stands
    expect(r.members, 'the concurrent admission does not').not.toContain(mallory.pubKey);
    // …while an admission that SAW no demotion, one depth earlier, stands
    const admitEarlier = body(bob, 'join', mallory, { payload: { peerDisplay: 'mal' }, parent: jb.hash, deps: [promote.hash] });
    const demoteLater = body(founder, 'role', bob, { payload: { role: 'member' }, parent: promote.hash, deps: [admitEarlier.hash] });
    const r2 = foldRoster([jb, promote, admitEarlier, demoteLater], { founders: [founder.pubKey] });
    expect(r2.members).toContain(mallory.pubKey);
  });

  it('the founder confirming a remote joiner still admits them (unchanged)', async () => {
    const { founder, mallory } = await ids();
    const r = foldRoster([body(founder, 'join', mallory)], { founders: [founder.pubKey] });
    expect(r.members).toContain(mallory.pubKey);
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

  it('an EQUIVOCATOR (two statements off one parent) is discounted from the fork on — its forked acts do not apply', async () => {
    const { founder, bob, mallory } = await ids();
    const join = body(mallory, 'join', mallory);
    const root = body(founder, 'join', founder);                          // founder's chain root
    // founder (a seeded admin) FORKS: two different evictions off the SAME parent → equivocation.
    const forkA = body(founder, 'evict', mallory, { parent: root.hash });
    const forkB = body(founder, 'evict', bob, { parent: root.hash });
    const r = foldRoster([join, root, forkA, forkB], { founders: [founder.pubKey] });
    // founder equivocated → everything from the fork on is discounted → neither eviction applies;
    // mallory (whose own join is untouched) stays a member.
    expect(r.members).toContain(mallory.pubKey);
  });

  // ── FROM THE FORK ONWARD (Frits 2026-09-25, ledger L131) ────────────────────────────────────────────────────
  // A fork (two statements off one parent) proves a key can no longer be trusted — almost always a stolen key. It
  // used to discount EVERYTHING the author ever signed, so an admin's fork took down every member they had admitted,
  // retroactively. Now the author loses standing FROM THE FORK'S DEPTH: what they signed before it stands; from it
  // they are out (not a member, not an admin), and nothing they sign there counts.
  it('an admin who forks keeps what they did BEFORE: the people they admitted stay', async () => {
    const { founder, bob, mallory } = await ids();
    const joinBob = body(bob, 'join', bob);
    const promote = body(founder, 'role', bob, { payload: { role: 'admin' } });
    const bobAdmitsMal = body(bob, 'join', mallory, { parent: joinBob.hash, deps: [promote.hash] });   // bob, an admin, admits mallory
    // later bob's key forks: two different statements off the same parent
    const forkA = body(bob, 'role', founder, { parent: bobAdmitsMal.hash, payload: { role: 'member' } });
    const forkB = body(bob, 'evict', mallory, { parent: bobAdmitsMal.hash });
    const r = foldRoster([joinBob, promote, bobAdmitsMal, forkA, forkB], { founders: [founder.pubKey] });
    expect(r.members, 'mallory, admitted before the fork, stays').toContain(mallory.pubKey);
    expect(r.members, 'the forking key loses its place').not.toContain(bob.pubKey);
    expect(r.admins).not.toContain(bob.pubKey);
    expect(r.admins, 'nothing bob signed at the fork counts: the founder is not demoted').toContain(founder.pubKey);
  });

  it('what the forking key signs AFTER the fork admits nobody', async () => {
    const { founder, bob, mallory } = await ids();
    const joinBob = body(bob, 'join', bob);
    const promote = body(founder, 'role', bob, { payload: { role: 'admin' } });
    const root = body(bob, 'role', bob, { parent: joinBob.hash, deps: [promote.hash], payload: { role: 'admin' } });
    const forkA = body(bob, 'join', mallory, { parent: root.hash });
    const forkB = body(bob, 'role', founder, { parent: root.hash, payload: { role: 'member' } });
    const after = body(bob, 'join', mallory, { parent: forkA.hash });
    const r = foldRoster([joinBob, promote, root, forkA, forkB, after], { founders: [founder.pubKey] });
    expect(r.members).not.toContain(mallory.pubKey);
  });

  it('two DEVICES of one person, each signing a first statement in the circle, are two chains — not a fork (the key forks, never the person)', async () => {
    const { founder, bob } = await ids();
    const laptop = await AgentIdentity.generate(new VaultMemory());   // bob's two per-circle device keys
    const phone  = await AgentIdentity.generate(new VaultMemory());
    // the rail resolves author → ref and keeps the signing key beside it
    const asBob = (b, key) => ({ ...b, author: bob.pubKey, authorKey: key.pubKey });
    const join = body(bob, 'join', bob, { payload: { peerDisplay: 'bob' } });                        // bob's own (a third key, parent null)
    const fromLaptop = asBob(body(laptop, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'Bob L' } }), laptop);
    const fromPhone  = asBob(body(phone,  'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'Bob P' } }), phone);
    const r = foldRoster([join, fromLaptop, fromPhone], { founders: [founder.pubKey] });
    expect(r.members, 'bob is not removed for using two devices').toContain(bob.pubKey);
    expect(['Bob L', 'Bob P']).toContain(r.props[bob.pubKey]?.displayName);
    // …while the SAME key signing twice off one parent is a fork, and removes the person from there
    const twiceA = asBob(body(phone, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'X' } }), phone);
    const twiceB = asBob(body(phone, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'Y' } }), phone);
    const r2 = foldRoster([join, fromLaptop, twiceA, twiceB], { founders: [founder.pubKey] });
    expect(r2.members).not.toContain(bob.pubKey);
  });

  it('a fork is not a fork until there are two: a clean chain keeps everything (unchanged)', async () => {
    const { founder, bob, mallory } = await ids();
    const joinBob = body(bob, 'join', bob);
    const promote = body(founder, 'role', bob, { payload: { role: 'admin' } });
    const admits = body(bob, 'join', mallory, { parent: joinBob.hash, deps: [promote.hash] });
    const r = foldRoster([joinBob, promote, admits], { founders: [founder.pubKey] });
    expect(r.members).toEqual(expect.arrayContaining([bob.pubKey, mallory.pubKey]));
    expect(r.admins).toContain(bob.pubKey);
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

describe('foldRoster — the rules gate (task #80, sitting-A decision 2026-08-20)', () => {
  // The receiver-side half of the rules-acceptance journeys (plans/JOURNEYS.md): acceptance rides the
  // SIGNED join, refusal happens at every device's fold, staleness is visible and never a lockout.

  it('fold half — a join carrying an accepted version folds, and the version is projected', async () => {
    const { founder, bob } = await ids();
    const stmts = [body(bob, 'join', bob, { payload: { rulesAccepted: 'v1' } })];
    const r = foldRoster(stmts, { founders: [founder.pubKey], rulesGate: { versions: ['v1'] } });
    expect(r.members).toContain(bob.pubKey);
    expect(r.rulesAccepted[bob.pubKey]).toBe('v1');
  });

  it('fold half — the modified client: a join WITHOUT acceptance folds on nobody\'s roster', async () => {
    const { founder, mallory } = await ids();
    const stmts = [body(mallory, 'join', mallory, { payload: { redemptionRef: 'r1' } })];
    const r = foldRoster(stmts, { founders: [founder.pubKey], rulesGate: { versions: ['v1'] } });
    expect(r.members).not.toContain(mallory.pubKey);       // the statement is evidence; the roster refuses
    // …and an UNKNOWN version is refused the same way (deny-favouring, not presence-theatre):
    const forged = [body(mallory, 'join', mallory, { payload: { rulesAccepted: 'v99' } })];
    expect(foldRoster(forged, { founders: [founder.pubKey], rulesGate: { versions: ['v1'] } }).members)
      .not.toContain(mallory.pubKey);
  });

  it('fold half — a rules change makes acceptance STALE, never a removal: v1 stays valid, visibly', async () => {
    const { founder, bob } = await ids();
    const stmts = [body(bob, 'join', bob, { payload: { rulesAccepted: 'v1' } })];
    // After the change the circle has had BOTH versions — acceptance of a then-current version stays valid.
    const r = foldRoster(stmts, { founders: [founder.pubKey], rulesGate: { versions: ['v1', 'v2'] } });
    expect(r.members).toContain(bob.pubKey);               // no lockout
    expect(r.rulesAccepted[bob.pubKey]).toBe('v1');        // the staleness is what the member card shows
  });

  it('fold half — a self-signed rules-accept updates the version; a non-member\'s records nothing', async () => {
    const { founder, bob, mallory } = await ids();
    const join = body(bob, 'join', bob, { payload: { rulesAccepted: 'v1' } });
    const reaccept = body(bob, 'rules-accept', bob, {
      payload: { rulesAccepted: 'v2', authorRef: bob.pubKey }, parent: join.hash,
    });
    const outsider = body(mallory, 'rules-accept', mallory, {
      payload: { rulesAccepted: 'v2', authorRef: mallory.pubKey },
    });
    const r = foldRoster([join, reaccept, outsider], {
      founders: [founder.pubKey], rulesGate: { versions: ['v1', 'v2'] },
    });
    expect(r.rulesAccepted[bob.pubKey]).toBe('v2');
    expect(r.members).not.toContain(mallory.pubKey);       // accepting rules does not make you a member
    expect(r.rulesAccepted[mallory.pubKey]).toBeUndefined();
  });

  it('nobody accepts on another\'s behalf — a rules-accept whose subject is not its own signer is ignored', async () => {
    const { founder, bob } = await ids();
    const join = body(bob, 'join', bob, { payload: { rulesAccepted: 'v1' } });
    // the founder tries to mark BOB as having accepted v2 (subject=bob, authorRef=founder)
    const impersonated = body(founder, 'rules-accept', bob, {
      payload: { rulesAccepted: 'v2', authorRef: founder.pubKey },
    });
    const r = foldRoster([join, impersonated], { founders: [founder.pubKey], rulesGate: { versions: ['v1', 'v2'] } });
    expect(r.rulesAccepted[bob.pubKey]).toBe('v1');
  });

  it('WITHOUT a gate, behaviour is exactly as before — and eviction clears the accepted version', async () => {
    const { founder, bob } = await ids();
    const join = body(bob, 'join', bob, { payload: { rulesAccepted: 'v1' } });
    const noGate = foldRoster([join], { founders: [founder.pubKey] });
    expect(noGate.members).toContain(bob.pubKey);          // ungated circles are untouched (opt-in)
    expect(noGate.rulesAccepted[bob.pubKey]).toBe('v1');   // …but the record still projects
    const evict = body(founder, 'evict', bob, { deps: [join.hash] });
    const after = foldRoster([join, evict], { founders: [founder.pubKey] });
    expect(after.members).not.toContain(bob.pubKey);
    expect(after.rulesAccepted[bob.pubKey]).toBeUndefined();
  });

  // ── A circle with members always has an admin ───────────────────────────────────────────────────
  // Promotion/demotion is a declared spine kind whose producer was never built (`setMemberRole`),
  // so the fold's `role` handling had no coverage from a real writer. These pin the rule that makes
  // the op safe to ship: authority can be handed over, but not switched off.

  it('an admin promotes a member, and the new admin can then act', async () => {
    const { founder, bob, mallory } = await ids();
    const join   = body(bob, 'join', bob);
    const joinM  = body(mallory, 'join', mallory);
    // The founder promotes bob. `deps` carries what the author had SEEN, which is what puts the
    // promotion at a shallower causal depth than bob's own later act.
    const promote = body(founder, 'role', bob, { payload: { role: 'admin' }, deps: [join.hash, joinM.hash] });
    const r = foldRoster([join, joinM, promote], { founders: [founder.pubKey] });
    expect(r.admins).toContain(bob.pubKey);

    // …and the promotion is real authority: bob's evict folds DEEPER than his own promotion, so he
    // acts as an admin rather than as the member he was.
    const evict = body(bob, 'evict', mallory, { parent: join.hash, deps: [promote.hash] });
    const after = foldRoster([join, joinM, promote, evict], { founders: [founder.pubKey] });
    expect(after.members).not.toContain(mallory.pubKey);
  });

  it('a MEMBER cannot promote — the fold is the gate, not the op', async () => {
    const { founder, bob, mallory } = await ids();
    const join  = body(bob, 'join', bob);
    const joinM = body(mallory, 'join', mallory);
    // bob is an ordinary member and signs a promotion for himself. The statement is well-formed and
    // genuinely signed; it simply has no authority behind it.
    const selfPromote = body(bob, 'role', bob, { payload: { role: 'admin' }, parent: join.hash });
    const r = foldRoster([join, joinM, selfPromote], { founders: [founder.pubKey] });
    expect(r.admins).not.toContain(bob.pubKey);
    expect(r.members).toContain(bob.pubKey);               // still a member — refused, not evicted
  });

  it('THE LAST ADMIN STEPPING DOWN HANDS OVER — a circle with members is never left unadministrable', async () => {
    const { founder, bob } = await ids();
    const join = body(bob, 'join', bob);
    // The sole admin demotes themselves. This used to be REFUSED — the statement folded to nothing and
    // the circle silently kept an admin who had said they were done. Now it stands and appoints, which
    // is the same answer a DEPARTURE already got: one rule, one mechanism.
    const selfDemote = body(founder, 'role', founder, { payload: { role: 'member' }, deps: [join.hash] });
    const r = foldRoster([join, selfDemote], { founders: [] , seed: { members: [founder.pubKey], admins: [founder.pubKey] } });
    expect(r.admins).toEqual([bob.pubKey]);
    expect(r.admins).not.toContain(founder.pubKey);            // the demotion actually happened
    expect(r.members).toContain(founder.pubKey);               // still in the circle, just not running it
    expect(r.adminProvenance[bob.pubKey]).toBe(`caretaker:${selfDemote.hash}`);
  });

  it('…and never back to the person who just stepped down — that would undo it while reporting success', async () => {
    const { founder, bob, mallory } = await ids();
    const joinB = body(bob, 'join', bob);
    const joinM = body(mallory, 'join', mallory);
    const selfDemote = body(founder, 'role', founder, {
      payload: { role: 'member' }, deps: [joinB.hash, joinM.hash],
    });
    const r = foldRoster([joinB, joinM, selfDemote], {
      founders: [], seed: { members: [founder.pubKey], admins: [founder.pubKey] },
    });
    expect(r.admins).toHaveLength(1);
    expect(r.admins).not.toContain(founder.pubKey);
    expect([bob.pubKey, mallory.pubKey]).toContain(r.admins[0]);
  });

  it('…but with NOBODY to hand to, the demotion cannot stand', async () => {
    const { founder } = await ids();
    // A circle of one. There is no candidate, and no authority could ever appoint one later, so the
    // floor holds: the statement does not fold. This is the ONE case that still refuses, and it
    // refuses because handing over is impossible rather than because demotion is forbidden.
    const selfDemote = body(founder, 'role', founder, { payload: { role: 'member' } });
    const r = foldRoster([selfDemote], {
      founders: [], seed: { members: [founder.pubKey], admins: [founder.pubKey] },
    });
    expect(r.admins).toEqual([founder.pubKey]);
    expect(r.adminProvenance[founder.pubKey]).toBe('founder');   // restored as it was, not re-titled
  });

  it('…but demoting ONE of two admins is fine — handover is allowed, switching authority off is not', async () => {
    const { founder, bob } = await ids();
    const join    = body(bob, 'join', bob);
    const promote = body(founder, 'role', bob, { payload: { role: 'admin' }, deps: [join.hash] });
    // bob (now an admin) demotes the founder — allowed here only because the founder is not in
    // `founders`; a real founder is non-demotable by construction, which is [ledger L36].
    const demote  = body(bob, 'role', founder, { payload: { role: 'member' }, parent: join.hash, deps: [promote.hash] });
    const r = foldRoster([join, promote, demote], {
      founders: [], seed: { members: [founder.pubKey], admins: [founder.pubKey] },
    });
    expect(r.admins).toContain(bob.pubKey);
    expect(r.admins).not.toContain(founder.pubKey);
  });

  // ── Founder permanence: relieved of running it, never put out of it ────────────────────────────
  // Frits' call (2026-08-23): a founder is demotable once the circle has another admin. The organiser
  // who moves away should be able to hand the street over, not hold it open forever.

  it('a FOUNDER can be demoted once another admin exists — handing over is allowed', async () => {
    const { founder, bob } = await ids();
    const join    = body(bob, 'join', bob);
    const promote = body(founder, 'role', bob, { payload: { role: 'admin' }, deps: [join.hash] });
    const demote  = body(bob, 'role', founder, { payload: { role: 'member' }, parent: join.hash, deps: [promote.hash] });
    const r = foldRoster([join, promote, demote], { founders: [founder.pubKey] });
    expect(r.admins).not.toContain(founder.pubKey);
    expect(r.admins).toContain(bob.pubKey);
    expect(r.members).toContain(founder.pubKey);      // still in the circle they made
  });

  it('…and the SOLE founder-admin steps down by handing over, not by being refused', async () => {
    const { founder, bob } = await ids();
    const join   = body(bob, 'join', bob);
    const demote = body(founder, 'role', founder, { payload: { role: 'member' }, deps: [join.hash] });
    const r = foldRoster([join, demote], { founders: [founder.pubKey] });
    expect(r.admins).toEqual([bob.pubKey]);
    expect(r.members).toContain(founder.pubKey);      // still in the circle they made
    expect(r.adminProvenance[bob.pubKey]).toBe(`caretaker:${demote.hash}`);
  });

  it('a demoted founder is still not EVICTABLE — you cannot be put out of the circle you made', async () => {
    const { founder, bob } = await ids();
    const join    = body(bob, 'join', bob);
    const promote = body(founder, 'role', bob, { payload: { role: 'admin' }, deps: [join.hash] });
    const demote  = body(bob, 'role', founder, { payload: { role: 'member' }, parent: join.hash, deps: [promote.hash] });
    const evict   = body(bob, 'evict', founder, { parent: demote.hash, deps: [promote.hash] });
    const r = foldRoster([join, promote, demote, evict], { founders: [founder.pubKey] });
    expect(r.admins).not.toContain(founder.pubKey);   // demoted…
    expect(r.members).toContain(founder.pubKey);      // …but not removable
  });
});

describe('foldRoster — how each admin came to hold it', () => {
  /**
   * Three ways to be an admin, and until now all three rendered as the same word. The one that most
   * needs saying is the third: the log appointed you because the last admin walked out, and nobody
   * asked you. A roster that cannot tell it apart cannot say it.
   */
  it('a founder holds it as founder; a promotion holds it as a decision someone took', async () => {
    const { founder, bob } = await ids();
    const join = body(bob, 'join', bob);
    const promote = body(founder, 'role', bob, { payload: { role: 'admin' }, deps: [join.hash] });
    const r = foldRoster([join, promote], { founders: [founder.pubKey] });

    expect(r.admins).toEqual([founder.pubKey, bob.pubKey].sort());
    expect(r.adminProvenance[founder.pubKey]).toBe('founder');
    expect(r.adminProvenance[bob.pubKey]).toBe('role');
  });

  it('a caretaker holds it as `caretaker:<the departure that emptied the admin set>`', async () => {
    const { founder, bob, mallory } = await ids();
    const joinB = body(bob, 'join', bob);
    const joinM = body(mallory, 'join', mallory);
    const leave = body(founder, 'leave', founder, { deps: [joinB.hash, joinM.hash] });
    const r = foldRoster([joinB, joinM, leave], { founders: [founder.pubKey] });

    expect(r.admins).toHaveLength(1);
    const [caretaker] = r.admins;
    // Named after the statement that emptied the admin set — so every device gives the appointment the
    // same name, and a LATER departure produces a different one.
    expect(r.adminProvenance[caretaker]).toBe(`caretaker:${leave.hash}`);
    expect(r.adminProvenance[caretaker]).not.toBe('founder');
    expect(Object.keys(r.adminProvenance)).toEqual(r.admins);
  });

  it('provenance follows the roster: a demoted admin loses it, and a re-promotion reads as a decision', async () => {
    const { founder, bob } = await ids();
    const joinB   = body(bob, 'join', bob);
    const promote = body(founder, 'role', bob, { payload: { role: 'admin' }, deps: [joinB.hash] });
    const demote  = body(founder, 'role', bob, { payload: { role: 'member' }, parent: promote.hash });
    const again   = body(founder, 'role', bob, { payload: { role: 'admin' }, parent: demote.hash });

    const afterDemote = foldRoster([joinB, promote, demote], { founders: [founder.pubKey] });
    expect(afterDemote.admins).toEqual([founder.pubKey]);
    expect(afterDemote.adminProvenance[bob.pubKey]).toBeUndefined();   // no stale claim left behind

    const afterAgain = foldRoster([joinB, promote, demote, again], { founders: [founder.pubKey] });
    expect(afterAgain.adminProvenance[bob.pubKey]).toBe('role');
  });

  it('names only current admins — an evicted one leaves nothing behind', async () => {
    const { founder, bob } = await ids();
    const joinB   = body(bob, 'join', bob);
    const promote = body(founder, 'role', bob, { payload: { role: 'admin' }, deps: [joinB.hash] });
    const evict   = body(founder, 'evict', bob, { parent: promote.hash });
    const r = foldRoster([joinB, promote, evict], { founders: [founder.pubKey] });

    expect(r.members).toEqual([founder.pubKey]);
    expect(Object.keys(r.adminProvenance)).toEqual([founder.pubKey]);
  });

  it('is a projection, not a store — the same statements give the same provenance on any device', async () => {
    const { founder, bob, mallory } = await ids();
    const joinB = body(bob, 'join', bob);
    const joinM = body(mallory, 'join', mallory);
    const leave = body(founder, 'leave', founder, { deps: [joinB.hash, joinM.hash] });
    const stmts = [joinB, joinM, leave];

    // Arrival order is not agreement; the fold is what makes them agree.
    const a = foldRoster(stmts, { founders: [founder.pubKey] });
    const b = foldRoster([...stmts].reverse(), { founders: [founder.pubKey] });
    expect(b.adminProvenance).toEqual(a.adminProvenance);
  });
});

describe('foldRoster — the handle a member chose rides the join', () => {
  // Walked 2026-09-14: only the admin's device knew a joiner's handle, because the handle lived on the
  // redemption row in the admin's store and that row never reaches the other members. Every device folds the
  // spine; so the spine carries the handle, and the fold hands it out beside the membership it establishes.
  it('a join carrying peerDisplay yields that handle for its subject', async () => {
    const { founder, bob } = await ids();
    const r = foldRoster([body(bob, 'join', bob, { payload: { peerDisplay: 'bee' } })], { founders: [founder.pubKey] });
    expect(r.members).toContain(bob.pubKey);
    expect(r.handles?.[bob.pubKey]).toBe('bee');
  });

  it('a join without one yields no handle; a later re-join with one wins; an evicted member leaves none', async () => {
    const { founder, bob } = await ids();
    const plain = body(bob, 'join', bob);
    expect(foldRoster([plain], { founders: [founder.pubKey] }).handles?.[bob.pubKey]).toBeUndefined();
    const evict  = body(founder, 'evict', bob);
    const rejoin = body(bob, 'join', bob, { payload: { peerDisplay: 'bee2' }, parent: plain.hash, deps: [evict.hash] });
    const r = foldRoster([plain, evict, rejoin], { founders: [founder.pubKey] });
    expect(r.members).toContain(bob.pubKey);
    expect(r.handles?.[bob.pubKey]).toBe('bee2');
    const gone = foldRoster([plain, body(founder, 'evict', bob, { deps: [plain.hash] })], { founders: [founder.pubKey] });
    expect(gone.members).not.toContain(bob.pubKey);
    expect(gone.handles?.[bob.pubKey]).toBeUndefined();
  });
});

// ── `member-props` — what a member says about themselves, on their own row (2026-09-21) ───────────────────────────
// One generalized self-subject kind on the membership lane (the note `NOTE-member-props-on-the-membership-lane.md`,
// Fable's review): handle · displayName · avatarRef — fields, never new kinds. Self-only, members-only, an allowlist
// (admin-owned facts are refused), newest wins per field, and the HANDLE is unique in the circle: a handle another
// current member holds is refused, deny-wins, on every device independently — the one check the admin did at the
// join that moves to the fold.
describe('member-props — a member\'s own display fields, folded onto their row', () => {
  it('a self-signed member-props sets displayName / avatarRef / handle on the member\'s row; newest wins per field', async () => {
    const { founder, bob } = await ids();
    const join = body(bob, 'join', bob, { payload: { peerDisplay: 'bob' } });
    const p1 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'Bob', avatarRef: 'blob:1' }, parent: join.hash });
    const p2 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'Bobby' }, parent: p1.hash });
    const r = foldRoster([join, p1, p2], { founders: [founder.pubKey] });
    expect(r.props[bob.pubKey]).toEqual({ displayName: 'Bobby', avatarRef: 'blob:1' });   // p2 changed one field; the other stands
    expect(r.handles[bob.pubKey]).toBe('bob');
    const p3 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, handle: 'bobby' }, parent: p2.hash });
    const r3 = foldRoster([join, p1, p2, p3], { founders: [founder.pubKey] });
    expect(r3.handles[bob.pubKey]).toBe('bobby');
    expect(r3.props[bob.pubKey].handle, 'a handle from the member\'s own statement is in props too (a projection tells it from the join\'s)').toBe('bobby');
    expect(r.props[bob.pubKey].handle, 'the join\'s handle is not').toBeUndefined();
  });

  // ── THE FACE'S CAP (2026-09-23) ─────────────────────────────────────────────────────────────────────
  // The picture is the persona's `profilePicture`, disclosed per circle and carried in the release. Its
  // sealing line holds a small inline thumbnail — and this lane never drops a statement, so that thumbnail is
  // kept by every device for ever. Capped here, where it binds on every receiver, whatever wrote it.
  it('a released picture within the cap lands; one over it refuses the WHOLE statement', async () => {
    const { founder, bob } = await ids();
    const join = body(bob, 'join', bob, { payload: { peerDisplay: 'bob' } });
    const pic = (thumb) => ({ type: 'blob', ref: 'blob://x', enc: { sealed: true, keyRef: 'k', format: 'b', bytes: 9, thumb } });

    const ok = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'Bob', personaProperties: { profilePicture: pic('A'.repeat(1000)) } }, parent: join.hash });
    const r1 = foldRoster([join, ok], { founders: [founder.pubKey] });
    expect(r1.props[bob.pubKey].personaProperties.profilePicture.enc.thumb.length).toBe(1000);
    expect(r1.props[bob.pubKey].displayName).toBe('Bob');

    const tooBig = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'Bob', personaProperties: { profilePicture: pic('A'.repeat(9000)) } }, parent: join.hash });
    const r2 = foldRoster([join, tooBig], { founders: [founder.pubKey] });
    expect(r2.props[bob.pubKey]?.personaProperties, 'the oversize picture is refused').toBeUndefined();
    expect(r2.props[bob.pubKey]?.displayName, 'and so is everything it travelled with').toBeUndefined();
  });

  it('a release with no picture, or a ref with no inline preview, is not capped away', async () => {
    const { founder, bob } = await ids();
    const join = body(bob, 'join', bob, { payload: { peerDisplay: 'bob' } });
    const noThumb = { type: 'blob', ref: 'blob://x', enc: { sealed: true, keyRef: 'k', format: 'b', bytes: 9 } };
    const p1 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, personaProperties: { region: 'noord' } }, parent: join.hash });
    const p2 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, personaProperties: { profilePicture: noThumb } }, parent: p1.hash });
    const r = foldRoster([join, p1, p2], { founders: [founder.pubKey] });
    expect(r.props[bob.pubKey].personaProperties.profilePicture).toEqual(noThumb);
  });

  it('the PERSONA PROPERTIES ride as one field group (step two, 2026-09-22): the released map, per circle, newest map wins whole; by reference only', async () => {
    // What a persona discloses to THIS circle (`getPersonaRelease` — coarse, reveal-gated, media by sealed reference) travels
    // as `personaProperties` on the same statement, so the admin-mediated `persona-props-update` wire can go. A map, not
    // fields: the release is computed whole per circle, and a key that leaves the release must leave the row.
    const { founder, bob } = await ids();
    const join = body(bob, 'join', bob, { payload: { peerDisplay: 'bob' } });
    const p1 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, personaProperties: { region: 'noord', profilePicture: { ref: 'media:abc', sealedTo: 'circle' } } }, parent: join.hash });
    const r1 = foldRoster([join, p1], { founders: [founder.pubKey] });
    expect(r1.props[bob.pubKey].personaProperties).toEqual({ region: 'noord', profilePicture: { ref: 'media:abc', sealedTo: 'circle' } });
    const p2 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, personaProperties: { region: 'zuid' } }, parent: p1.hash });
    const r2 = foldRoster([join, p1, p2], { founders: [founder.pubKey] });
    expect(r2.props[bob.pubKey].personaProperties, 'the newer map replaces the older whole — a withdrawn picture is gone').toEqual({ region: 'zuid' });
    const cleared = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, personaProperties: {} }, parent: p2.hash });
    expect(foldRoster([join, p1, p2, cleared], { founders: [founder.pubKey] }).props[bob.pubKey].personaProperties, 'an empty map is a clear').toEqual({});
    const notAMap = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, personaProperties: 'noord' }, parent: p2.hash });
    expect(foldRoster([join, p1, p2, notAMap], { founders: [founder.pubKey] }).props[bob.pubKey].personaProperties, 'a non-map is refused; the last map stands').toEqual({ region: 'zuid' });
    const beside = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'Bob', personaProperties: { region: 'oost' } }, parent: p2.hash });
    const rb = foldRoster([join, p1, p2, beside], { founders: [founder.pubKey] });
    expect(rb.props[bob.pubKey]).toEqual({ displayName: 'Bob', personaProperties: { region: 'oost' } });
  });

  it('self-only and members-only: nobody sets another\'s fields; an outsider\'s statement records nothing', async () => {
    const { founder, bob, mallory } = await ids();
    const join = body(bob, 'join', bob, { payload: { peerDisplay: 'bob' } });
    const impersonated = body(founder, 'member-props', bob, { payload: { authorRef: founder.pubKey, displayName: 'Not Bob' } });
    const outsider = body(mallory, 'member-props', mallory, { payload: { authorRef: mallory.pubKey, displayName: 'Mallory' } });
    const r = foldRoster([join, impersonated, outsider], { founders: [founder.pubKey] });
    expect(r.props[bob.pubKey]).toBeUndefined();
    expect(r.props[mallory.pubKey]).toBeUndefined();
    expect(r.members).not.toContain(mallory.pubKey);
  });

  it('the allowlist: a statement naming an admin-owned fact (role, addresses, keys) is refused whole', async () => {
    const { founder, bob } = await ids();
    const join = body(bob, 'join', bob, { payload: { peerDisplay: 'bob' } });
    const sneaky = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'Bob', role: 'admin' }, parent: join.hash });
    const r = foldRoster([join, sneaky], { founders: [founder.pubKey] });
    expect(r.props[bob.pubKey], 'refused whole — not even the harmless field').toBeUndefined();
    expect(r.admins).toEqual([founder.pubKey]);
  });

  it('HANDLE UNIQUENESS at the fold: a handle another current member holds is refused, deny-wins; a freed handle may be taken', async () => {
    const { founder, bob, mallory } = await ids();
    const jb = body(bob, 'join', bob, { payload: { peerDisplay: 'bob' } });
    const jm = body(mallory, 'join', mallory, { payload: { peerDisplay: 'mal' } });
    const grab = body(mallory, 'member-props', mallory, { payload: { authorRef: mallory.pubKey, handle: 'bob', displayName: 'M' }, parent: jm.hash });
    let r = foldRoster([jb, jm, grab], { founders: [founder.pubKey] });
    expect(r.handles[mallory.pubKey], 'the old handle stays').toBe('mal');
    expect(r.props[mallory.pubKey], 'the whole statement is refused — a collision is not a partial success').toBeUndefined();
    // bob leaves; the handle is free; mallory may take it now
    const leave = body(bob, 'leave', bob, { parent: jb.hash });
    const grab2 = body(mallory, 'member-props', mallory, { payload: { authorRef: mallory.pubKey, handle: 'bob' }, parent: grab.hash, deps: [leave.hash] });
    r = foldRoster([jb, jm, grab, leave, grab2], { founders: [founder.pubKey] });
    expect(r.handles[mallory.pubKey]).toBe('bob');
    // …and a member keeping their OWN handle is not a collision with themselves
    const same = body(mallory, 'member-props', mallory, { payload: { authorRef: mallory.pubKey, handle: 'bob', displayName: 'Mal' }, parent: grab2.hash });
    r = foldRoster([jb, jm, grab, leave, grab2, same], { founders: [founder.pubKey] });
    expect(r.props[mallory.pubKey]).toEqual({ handle: 'bob', displayName: 'Mal' });
  });
});

// ── SUPERSESSION (L121, 2026-09-24) — the fold names the member-props statements every device may drop ──────────
// A `member-props` statement is DEAD when it is accepted, sets no handle, and every field it set has a later
// accepted setter from the same subject. Dropping the dead set changes no fold: same members, handles, props.
describe('member-props supersession — the fold computes the dead set, and dropping it changes nothing', () => {
  const strip = (r) => { const { superseded: _s, ...rest } = r; return rest; };

  it('names the fully-overwritten, handle-free statements — and only those', async () => {
    const { founder, bob } = await ids();
    const join = body(bob, 'join', bob, { payload: { peerDisplay: 'bob' } });
    const p1 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'Bob', avatarRef: 'blob:1' }, parent: join.hash });
    const p2 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'Bobby' }, parent: p1.hash });
    const p3 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, handle: 'bobby' }, parent: p2.hash });
    const p4 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'Robert', avatarRef: 'blob:2' }, parent: p3.hash });
    const r = foldRoster([join, p1, p2, p3, p4], { founders: [founder.pubKey] });
    expect(r.superseded).toEqual([p1.hash, p2.hash].sort());   // p1: both fields overwritten; p2: displayName overwritten
    // p3 sets a handle → never dead; p4 is the newest setter of both its fields → alive
    expect(r.superseded).not.toContain(p3.hash);
    expect(r.superseded).not.toContain(p4.hash);
  });

  it('a partially overwritten statement is NOT dead (one of its fields still stands)', async () => {
    const { founder, bob } = await ids();
    const join = body(bob, 'join', bob, { payload: { peerDisplay: 'bob' } });
    const p1 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'Bob', avatarRef: 'blob:1' }, parent: join.hash });
    const p2 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'Bobby' }, parent: p1.hash });
    const r = foldRoster([join, p1, p2], { founders: [founder.pubKey] });
    expect(r.superseded).toEqual([]);
  });

  it('a REFUSED statement is never named — its acceptance depends on the history compaction would remove', async () => {
    const { founder, bob, mallory: cato } = await ids();
    const jb = body(bob, 'join', bob, { payload: { peerDisplay: 'bob' } });
    const jc = body(cato, 'join', cato, { payload: { peerDisplay: 'cato' } });
    const takeX = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, handle: 'x' }, parent: jb.hash });
    // The ORDER is the premise, so it is written as causal edges (2026-09-24 — this test was red one run in two): cato
    // claims x HAVING SEEN bob's claim, and bob moves on to y HAVING SEEN cato's refused claim. Without the edges the
    // statements are concurrent and the fold's deterministic tiebreak over the random test keys decided who held x.
    const catoX = body(cato, 'member-props', cato, { payload: { authorRef: cato.pubKey, handle: 'x' }, parent: jc.hash, deps: [takeX.hash] });
    const bobY = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, handle: 'y' }, parent: takeX.hash, deps: [catoX.hash] });
    const r = foldRoster([jb, jc, takeX, catoX, bobY], { founders: [founder.pubKey] });
    expect(r.handles[cato.pubKey]).toBe('cato');
    expect(r.superseded).toEqual([]);   // handle-bearing statements are never dead, refused ones never named
  });

  it('REFOLD AGREEMENT: the fold over the log with the dead set TOMBSTONED equals the fold over the whole log — in any order', async () => {
    const { founder, bob, mallory: cato } = await ids();
    const jb = body(bob, 'join', bob, { payload: { peerDisplay: 'bob' } });
    const jc = body(cato, 'join', cato, { payload: { peerDisplay: 'cato' } });
    const b1 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'B1', personaProperties: { a: 1 } }, parent: jb.hash });
    const b2 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'B2' }, parent: b1.hash });
    const bx = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, handle: 'x' }, parent: b2.hash });
    const c1 = body(cato, 'member-props', cato, { payload: { authorRef: cato.pubKey, handle: 'x' }, parent: jc.hash });   // refused, bob holds x
    const b3 = body(bob, 'member-props', bob, { payload: { authorRef: bob.pubKey, displayName: 'B3', personaProperties: { a: 2 } }, parent: bx.hash });
    const c2 = body(cato, 'member-props', cato, { payload: { authorRef: cato.pubKey, displayName: 'C2' }, parent: c1.hash });
    const all = [jb, jc, b1, b2, bx, c1, b3, c2];
    const full = foldRoster(all, { founders: [founder.pubKey] });
    expect(full.superseded).toEqual([b1.hash, b2.hash].sort());
    // COMPACTION IS A TOMBSTONE, NOT A DROP: the dead statement keeps its chain fields (hash · author · parentHash
    // · deps) and sheds its payload. Dropping it would shorten bob's chain and move every later statement's
    // causal depth — and depth is what orders the deny-wins handle collision between bob's `x` and cato's `x`.
    const dead = new Set(full.superseded);
    const tomb = (s) => ({ ...s, payload: { authorRef: s.payload.authorRef } });
    const compacted = foldRoster(all.map((s) => (dead.has(s.hash) ? tomb(s) : s)), { founders: [founder.pubKey] });
    expect(strip(compacted)).toEqual(strip(full));
    expect(compacted.superseded, 'a tombstone is never named again').toEqual([]);
    // and the collision was real: exactly one of them holds x, and both folds say the same one
    expect(Object.values(full.handles).filter((h) => h === 'x')).toHaveLength(1);
    // …and a device that received the statements in another order agrees on the dead set too
    const shuffled = [jc, jb, c1, b2, b1, c2, bx, b3];
    expect(foldRoster(shuffled, { founders: [founder.pubKey] }).superseded).toEqual(full.superseded);
  });
});
