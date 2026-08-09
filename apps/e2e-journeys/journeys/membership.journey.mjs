// J-membership: the MEMBERSHIP + EVICTION head folded identically across devices, over the relay.
//
// Membership is not a stored list — it is the deterministic FOLD of a circle's signed spine statements
// (join · leave · evict · role), the roster HEAD over the per-author causal chain (spineStatement.js →
// rosterFold.js). The point under test is principle 10: every device that holds the SAME statements folds
// the SAME roster, with no server adjudicating — eviction is "verwijderen kun je vragen, niet afdwingen",
// a folded request, not an instant global command. Each author signs its statement with signSpine; devices
// ship the signed statements to each other OVER THE RELAY, verify each on arrival, and fold with foldRoster.
//
// The RED/GREEN instrument is the last scenario: the same statements delivered in DIFFERENT wire orders
// still converge to one roster. A wall-clock / last-writer-wins merge would diverge (device A sees
// join-before-evict, device B sees evict-before-join); the causal depth-fold does not — that is what the
// spine buys over a naive ordered list.
//
// SCOPE: FOUNDER-rooted authority only. Dynamic non-founder-admin authority (promote-then-act) needs
// cross-author causal ordering and is a known it.todo gap in rosterFold's spec — deliberately NOT tested here.
//
// Scenarios 1–5 fold HAND-CONSTRUCTED signSpine statements (the deterministic-fold spec). Scenarios 6–7 then
// drive the REAL membership WRITERS — `redeemMembershipCode` (join), `removeMember` (evict), `leaveGroup`
// (leave) from `@onderling/circles` — each emitting its transition through the REAL spine appender
// (`createSpineAppender`, the same one stoop wires): the statements those writers sign, shipped over the relay
// and folded, converge to one roster across devices. That closes the loop from a user action to the fold.
import {
  Agent, AgentIdentity, Parts, signSpine, verifySpine, foldRoster,
  createSpineAppender, SPINE_STATEMENT_ITEM,
} from '@onderling/core';
import { redeemMembershipCode, removeMember, leaveGroup } from '@onderling/circles';
import { VaultMemory }    from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { wait, checker }  from './_util.mjs';

export const name = 'J-membership (membership + eviction folded identically across devices)';

const CIRCLE = 'circle:acceptance';

export async function run({ relayUrl }) {
  const { results, check } = checker();

  // A tiny in-memory circle store (duck-typed: addItems/listOpen) — enough for the real writers + the real
  // spine appender, which read the store to source each author's parentHash frontier before signing.
  function memStore() {
    let seq = 0; const items = [];
    return {
      items,
      async addItems(parts, ctx = {}) {
        const made = parts.map((p) => ({ id: `it${++seq}`, addedBy: ctx.actor ?? null, ...p }));
        items.push(...made); return made;
      },
      async listOpen(filter = {}) { return items.filter((i) => !filter.type || i.type === filter.type); },
      async removeItems() {},
    };
  }

  // A device: a real agent over the relay that also holds a circle-scoped signing key (its AgentIdentity),
  // accumulates every VERIFIED spine statement it hears, and can fold its current view into a roster. It also
  // carries its OWN circle store + the real spine appender, so the real writers can run on it.
  async function device(tag) {
    const id = await AgentIdentity.generate(new VaultMemory());
    const a = new Agent({ identity: id, transport: new RelayTransport({ relayUrl, identity: id }) });
    a.tag = tag;
    a.id = id;                       // the circle-scoped signer (pubKey + sign) that signSpine wants
    a.spine = [];                    // this device's accumulated spine statement BODIES (from the wire)
    a.store = memStore();            // the circle store the real writers persist to
    a.appendSpine = createSpineAppender({ store: a.store, signer: id });   // the REAL emitter the writers call
    a.on('message', (m) => {
      let stmt = null;
      try { stmt = JSON.parse(Parts.text(m.parts)); } catch { /* not a spine statement */ }
      const v = stmt && verifySpine(stmt, { expectedCircleId: CIRCLE });
      if (v && v.ok && !a.spine.some((b) => b.hash === v.body.hash)) a.spine.push(v.body);
    });
    return a;
  }

  // The pure-DI collaborators the real writers need, stubbed to the minimum that reaches the emit step: the
  // code is redeemable, the invite is unlimited, no cross-circle link, no pod key custody, no admin gate.
  const noopKey = async () => {};
  const redeemDeps = (dev) => ({
    store: dev.store, simulateSync: () => ({}), grantKey: noopKey, emitSpine: dev.appendSpine,
    codeRedeemableNow: () => true,
    inviteRedemptionVerdict: async () => ({ allow: true }),   // always a fresh admit (so a re-join re-emits)
    INVITE_LIMIT_REACHED: 'invite-limit', verifyCircleLink: () => false,
  });
  const removeDeps = (dev) => ({
    store: dev.store, members: null, revokeKey: noopKey, isCircleAdmin: () => true,
    emitSpine: dev.appendSpine, defaultGroupId: CIRCLE,
  });
  const leaveDeps = (dev) => ({
    store: dev.store, simulateSync: () => ({}), notifier: null, revokeKey: noopKey, emitSpine: dev.appendSpine,
  });
  // The just-emitted statement is the last spine item the writer appended to the device's store.
  const lastEmitted = async (dev) => {
    const items = await dev.store.listOpen({ type: SPINE_STATEMENT_ITEM });
    return items[items.length - 1]?.source?.statement ?? null;
  };
  // Seed a redeemable membership-code so `redeemMembershipCode` validates before it emits the join.
  const seedCode = (dev, code) => dev.store.addItems(
    [{ type: 'membership-code', text: 'code', source: { groupId: CIRCLE, code, expiresAt: Date.now() + 1e6 } }],
    { actor: dev.id.pubKey },
  );

  const alpha = await device('alpha');   // founder + device
  const beta  = await device('beta');    // founder + device
  const mel   = await device('mel');     // an ordinary member (signs its own join / re-join)
  const all = [alpha, beta, mel];
  for (const x of all) for (const y of all) if (x !== y) x.addPeer(y.address, y.address);

  const FOUNDERS = [alpha.id.pubKey, beta.id.pubKey];
  const ship = (from, to, stmt) => from.message(to.address, JSON.stringify(stmt));
  // Fold a device's current spine view into a comparable roster signature.
  const roster = (a) => foldRoster(a.spine, { founders: FOUNDERS });
  const rosterKey = (a) => JSON.stringify(roster(a));
  const resetSpines = () => { for (const a of all) a.spine = []; };

  try {
    for (const a of all) await a.start();
    await wait(1800);
    check('all three devices online', all.every((a) => a.transport.connected));

    // ── Scenario 1 — DETERMINISM: two devices given the SAME statements fold the IDENTICAL roster ──
    // mel self-signs a join; alpha (founder) signs a role-promote of nobody-new — just a plain member set.
    resetSpines();
    const joinMel = signSpine(mel.id, { kind: 'join', circleId: CIRCLE, subject: mel.id.pubKey });
    // Deliver the same one statement to BOTH founder-devices over the relay.
    await ship(mel, alpha, joinMel);
    await ship(mel, beta,  joinMel);
    await wait(900);
    check('scenario 1 — both devices received mel’s signed join over the relay',
      alpha.spine.some((b) => b.hash === joinMel.body.hash) && beta.spine.some((b) => b.hash === joinMel.body.hash));
    check('scenario 1 — mel is a member on alpha’s fold',
      roster(alpha).members.includes(mel.id.pubKey));
    check('scenario 1 — the two devices fold the IDENTICAL roster (determinism, principle 10)',
      rosterKey(alpha) === rosterKey(beta));

    // ── Scenario 2 — EVICTION: a founder-admin evicts a member → BOTH devices drop them ──
    // alpha (founder) evicts mel. The evict is shipped to both devices over the relay; each re-folds.
    const evictMel = signSpine(alpha.id, { kind: 'evict', circleId: CIRCLE, subject: mel.id.pubKey });
    await ship(alpha, beta, evictMel);
    await ship(alpha, alpha, evictMel);   // alpha delivers its own statement to itself over the relay too
    await wait(900);
    check('scenario 2 — the eviction reached both devices over the relay',
      alpha.spine.some((b) => b.hash === evictMel.body.hash) && beta.spine.some((b) => b.hash === evictMel.body.hash));
    check('scenario 2 — alpha drops mel from members after the eviction',
      !roster(alpha).members.includes(mel.id.pubKey));
    check('scenario 2 — beta drops mel too — eviction converges on BOTH devices',
      !roster(beta).members.includes(mel.id.pubKey) && rosterKey(alpha) === rosterKey(beta));

    // ── Scenario 3 — RE-JOIN re-admits: a later join by the evicted member (chained deeper) folds AFTER
    // the eviction and re-admits them (removal is a request, not permanent). ──
    const rejoinMel = signSpine(mel.id, { kind: 'join', circleId: CIRCLE, subject: mel.id.pubKey, parent: joinMel.body.hash });
    await ship(mel, alpha, rejoinMel);
    await ship(mel, beta,  rejoinMel);
    await wait(900);
    check('scenario 3 — the re-join (chained deeper than the eviction) reached both devices',
      alpha.spine.some((b) => b.hash === rejoinMel.body.hash) && beta.spine.some((b) => b.hash === rejoinMel.body.hash));
    check('scenario 3 — mel is RE-ADMITTED on both devices, identically',
      roster(alpha).members.includes(mel.id.pubKey) && rosterKey(alpha) === rosterKey(beta));

    // ── Scenario 4 — TWO FOUNDERS, the OTHER founder evicts a member, converges ──
    // Fresh circle view: mel joins again; this time BETA (the second founder) does the eviction.
    resetSpines();
    const joinMel2  = signSpine(mel.id,  { kind: 'join',  circleId: CIRCLE, subject: mel.id.pubKey });
    const evictByBeta = signSpine(beta.id, { kind: 'evict', circleId: CIRCLE, subject: mel.id.pubKey });
    await ship(mel,  alpha, joinMel2);   await ship(mel,  beta, joinMel2);
    await ship(beta, alpha, evictByBeta); await ship(beta, beta, evictByBeta);
    await wait(1000);
    check('scenario 4 — both founder-devices hold mel’s join AND beta’s eviction',
      alpha.spine.length === 2 && beta.spine.length === 2);
    check('scenario 4 — beta (the second founder) has authority — mel is evicted',
      !roster(alpha).members.includes(mel.id.pubKey));
    check('scenario 4 — both founders keep their seats; the two devices converge',
      roster(alpha).admins.includes(alpha.id.pubKey) && roster(alpha).admins.includes(beta.id.pubKey)
        && rosterKey(alpha) === rosterKey(beta));

    // ── Scenario 5 — THE RED/GREEN INSTRUMENT: same statements, DIFFERENT delivery orders → still converge ──
    // A wall-clock / last-writer-wins merge would let alpha see join-then-evict and beta see evict-then-join
    // and DIVERGE. The causal depth-fold ignores arrival order and converges — that is what the spine buys.
    resetSpines();
    const jMel   = signSpine(mel.id,   { kind: 'join',  circleId: CIRCLE, subject: mel.id.pubKey });
    const eMel   = signSpine(alpha.id, { kind: 'evict', circleId: CIRCLE, subject: mel.id.pubKey });
    const rMel   = signSpine(mel.id,   { kind: 'join',  circleId: CIRCLE, subject: mel.id.pubKey, parent: jMel.body.hash });
    // alpha hears them in causal order; beta hears them REVERSED (evict, re-join, then the original join).
    for (const s of [jMel, eMel, rMel]) { await ship(mel, alpha, s); await wait(80); }
    for (const s of [rMel, eMel, jMel]) { await ship(mel, beta,  s); await wait(80); }
    await wait(1000);
    check('scenario 5 — both devices received all three statements (order aside)',
      alpha.spine.length === 3 && beta.spine.length === 3);
    check('scenario 5 — despite reversed delivery, the two devices fold the SAME roster (causal convergence)',
      rosterKey(alpha) === rosterKey(beta));
    check('scenario 5 — and the converged roster is the causally-correct one (re-join after evict → mel in)',
      roster(alpha).members.includes(mel.id.pubKey));

    // ── Scenario 6 — REAL WRITERS: a redeem→JOIN and an admin removeMember→EVICT converge across devices ──
    // The statements here are NOT hand-built: `redeemMembershipCode` (mel's device) and `removeMember`
    // (alpha's device) each sign + append via the SAME `createSpineAppender` stoop wires. We ship exactly
    // those signed statements over the relay — in OPPOSITE orders to the two founder-devices — and fold.
    resetSpines();
    await seedCode(mel, 'JOIN-1');
    const redeem = await redeemMembershipCode(redeemDeps(mel), { a: { groupId: CIRCLE, code: 'JOIN-1' }, from: mel.id.pubKey });
    check('scenario 6 — redeemMembershipCode succeeded (a real join)', !!redeem.redemptionId);
    const realJoin = await lastEmitted(mel);
    const removal = await removeMember(removeDeps(alpha), { a: { memberWebid: mel.id.pubKey, policy: 'graceful' }, from: alpha.id.pubKey });
    check('scenario 6 — removeMember succeeded (a real eviction)', !!removal.removalId && removal.revoked);
    const realEvict = await lastEmitted(alpha);
    check('scenario 6 — both writers actually EMITTED a signed spine statement',
      !!realJoin && !!realEvict && realJoin.body.kind === 'join' && realEvict.body.kind === 'evict');
    // alpha hears join then evict; beta hears evict then join (reversed) — arrival order must not matter.
    for (const s of [realJoin, realEvict]) await ship(mel, alpha, s);
    for (const s of [realEvict, realJoin]) await ship(alpha, beta, s);
    await wait(1000);
    check('scenario 6 — both devices received both REAL statements (order aside)',
      alpha.spine.length === 2 && beta.spine.length === 2);
    check('scenario 6 — the two devices fold the SAME roster from the writers’ real statements',
      rosterKey(alpha) === rosterKey(beta));
    check('scenario 6 — and the eviction took: mel is out on both devices',
      !roster(alpha).members.includes(mel.id.pubKey) && !roster(beta).members.includes(mel.id.pubKey));

    // ── Scenario 7 — REAL WRITERS: a re-redeem→JOIN chained deeper re-admits; a real leaveGroup→LEAVE removes ──
    // mel redeems AGAIN — the appender sources mel's frontier from her store, so this join chains DEEPER than
    // her first (past the eviction) and re-admits her (removal is a request, not permanent). Then mel really
    // LEAVES; the self-authored leave folds her back out. All three real statements converge under reorder.
    await seedCode(mel, 'JOIN-2');
    const reRedeem = await redeemMembershipCode(redeemDeps(mel), { a: { groupId: CIRCLE, code: 'JOIN-2' }, from: mel.id.pubKey });
    check('scenario 7 — the re-redeem succeeded (a real re-join)', !!reRedeem.redemptionId);
    const realRejoin = await lastEmitted(mel);
    check('scenario 7 — the re-join chains DEEPER than the first (parentHash = mel’s prior spine head)',
      realRejoin.body.parentHash === realJoin.body.hash);
    for (const s of [realRejoin]) { await ship(mel, alpha, s); await ship(mel, beta, s); }
    await wait(900);
    check('scenario 7 — the deeper re-join re-admits mel on BOTH devices, identically',
      roster(alpha).members.includes(mel.id.pubKey) && rosterKey(alpha) === rosterKey(beta));
    const leave = await leaveGroup(leaveDeps(mel), { a: { groupId: CIRCLE }, from: mel.id.pubKey });
    check('scenario 7 — leaveGroup succeeded (a real, self-authored leave)', !!leave.leaveMarkerId);
    const realLeave = await lastEmitted(mel);
    check('scenario 7 — the leave is self-authored (author === subject === mel), as the fold requires',
      realLeave.body.author === mel.id.pubKey && realLeave.body.subject === mel.id.pubKey);
    // deliver the leave to alpha in order, to beta after a beat — still converges to mel-out on both.
    await ship(mel, beta,  realLeave);
    await ship(mel, alpha, realLeave);
    await wait(900);
    check('scenario 7 — mel’s own leave removes her on both devices; the two converge',
      !roster(alpha).members.includes(mel.id.pubKey) && rosterKey(alpha) === rosterKey(beta));
  } finally {
    for (const a of all) await a.transport.disconnect().catch(() => {});
  }
  return results;
}
