// J-roles: ADMIN vs MEMBER, enforced at the act — and what an eviction does to a bystander.
//
// Why this journey exists: the coverage survey (2026-08-23) found that the admin/member distinction
// is asserted end-to-end in exactly ONE place (rules updates). Everywhere else it is a unit test on a
// predicate, or a button the UI hides. That is the wrong place for it: the enforceability test asks
// "could someone on a different app version get it anyway?", so the refusal has to happen where the
// ACT lands, not where the button is drawn.
//
// Three actors on one relay, because two cannot show a bystander effect:
//   Anne  — creator/admin
//   Bram  — ordinary member (the one who must be refused, and later evicted)
//   Cato  — ordinary member, the BYSTANDER: nothing done to Bram may change Cato's standing
//
// Each refusal is paired with a POSITIVE CONTROL — the same op, by the admin, must succeed. A refusal
// test with no control passes just as well when the op is broken for everyone.
import { AgentIdentity, DataPart } from '@onderling/core';
import { VaultMemory }             from '@onderling/vault';
import { Reveals }                 from '@onderling/identity-resolver';
import { RelayTransport }          from '@onderling/transports';
import { createNeighbourhoodAgent, attachSubstrateMirror } from '@onderling-app/stoop';
import { wait, checker }           from './_util.mjs';

export const name = 'J-roles (admin vs member, enforced at the act; eviction and the bystander)';

const GROUP = 'e2e-roles';
const ANNE = 'https://id.example/anne';
const BRAM = 'https://id.example/bram';
const CATO = 'https://id.example/cato';

/** Did the op REFUSE? Refusals here are returned, not thrown — `{error}` or a falsy ok. */
const refused = (r) => !!(r?.error || r?.ok === false || r?.allowed === false);

export async function run({ relayUrl }) {
  const { results, check } = checker();

  const ids = {
    [ANNE]: await AgentIdentity.generate(new VaultMemory()),
    [BRAM]: await AgentIdentity.generate(new VaultMemory()),
    [CATO]: await AgentIdentity.generate(new VaultMemory()),
  };
  const everyone = [ANNE, BRAM, CATO];
  const mk = (me) => createNeighbourhoodAgent({
    identity: ids[me],
    transport: new RelayTransport({ relayUrl, identity: ids[me] }),
    offeringMatch: {
      group: GROUP, localActor: me,
      peers: everyone.filter((w) => w !== me).map((w) => ({ pubKey: ids[w].pubKey })),
    },
    members: everyone.map((w) => ({ webid: w, stableId: ids[w].stableId, pubKey: ids[w].pubKey })),
    reveals: new Reveals(),
  });

  const anne = await mk(ANNE);
  const bram = await mk(BRAM);
  const cato = await mk(CATO);
  const bundles = { [ANNE]: anne, [BRAM]: bram, [CATO]: cato };
  for (const me of everyone) {
    for (const other of everyone.filter((w) => w !== me)) {
      bundles[me].agent.addPeer(ids[other].pubKey, ids[other].pubKey);
    }
    await attachSubstrateMirror(bundles[me], {
      group: GROUP,
      peers: everyone.filter((w) => w !== me).map((w) => ({ pubKey: ids[w].pubKey })),
    });
    await bundles[me].offeringMatch.start();
  }

  const call = (b, op, args, from) => {
    const skill = b.agent.skills.get(op);
    if (!skill) return Promise.resolve({ error: `op-not-declared:${op}` });
    return skill.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent: b.agent, envelope: null });
  };
  const rosterOf = async (b, from) => ((await call(b, 'listGroupMembers', { groupId: GROUP }, from))?.members ?? []);
  const has = (rows, webid) => rows.some((m) => (m.webid ?? m.addr ?? m.ref) === webid);

  try {
    await wait(2500);
    check('three actors on the relay',
      anne.agent.transport.connected && bram.agent.transport.connected && cato.agent.transport.connected);

    // ── Setup: Anne creates the circle; Bram and Cato join with her code ──────────────────────────
    const created = await call(anne, 'createGroupV2', { groupId: GROUP, name: 'Rollen', rules: {} }, ANNE);
    check('Anne created the circle and holds an invite code', typeof created?.code === 'string' && !!created.code);

    for (const [who, bundle] of [[BRAM, bram], [CATO, cato]]) {
      const verdict = await call(anne, 'verifyMembershipCodeForPeer',
        { groupId: GROUP, code: created.code, requesterWebid: who }, ANNE);
      await call(bundle, 'recordRemoteRedemption',
        { groupId: GROUP, code: created.code, codeId: verdict?.codeId, confirmedBy: ANNE }, who);
    }
    await wait(1500);
    const anneRoster = await rosterOf(anne, ANNE);
    check('both members are on the roster', has(anneRoster, BRAM) && has(anneRoster, CATO),
      `roster=${anneRoster.length}`);

    // ── STORY 1 — the admin-only acts, refused for a member AND proven for the admin ──────────────
    // Each pair is (member attempt → must refuse, admin attempt → must succeed). The control is what
    // makes the refusal meaningful: without it, a broken op would "pass" this journey.
    const adminOnly = [
      { op: 'rotateMyGroupCode',      args: { groupId: GROUP },                              label: 'rotate the invite code' },
      { op: 'editGroupRules',         args: { groupId: GROUP, rules: { name: 'Huisregels', purpose: 'proef', agreements: 'wees aardig' } }, label: 'edit the circle rules' },
      { op: 'setCircleStoragePolicy', args: { groupId: GROUP, policy: 'none' },            label: 'change the storage policy' },
    ];
    for (const { op, args, label } of adminOnly) {
      const byMember = await call(bram, op, args, BRAM);
      check(`a MEMBER cannot ${label}`, refused(byMember), JSON.stringify(byMember)?.slice(0, 120));
      const byAdmin = await call(anne, op, args, ANNE);
      check(`…but the ADMIN can ${label} (the control)`, !refused(byAdmin), JSON.stringify(byAdmin)?.slice(0, 120));
    }

    // Removing a member is the sharpest one: a member must not be able to evict a bystander.
    const bramEvictsCato = await call(bram, 'removeMember', { groupId: GROUP, memberWebid: CATO }, BRAM);
    check('a MEMBER cannot remove another member', refused(bramEvictsCato),
      JSON.stringify(bramEvictsCato)?.slice(0, 120));
    check('…and the bystander is still on the roster after that attempt',
      has(await rosterOf(anne, ANNE), CATO));

    // ── STORY 2 — the admin evicts Bram: what changes, and what must NOT ──────────────────────────
    const evict = await call(anne, 'removeMember', { groupId: GROUP, memberWebid: BRAM }, ANNE);
    check('the ADMIN can remove a member (the control)', !refused(evict), JSON.stringify(evict)?.slice(0, 120));
    await wait(2000);

    const afterAnne = await rosterOf(anne, ANNE);
    check('the evicted member is gone from the admin\'s roster', !has(afterAnne, BRAM));
    check('the BYSTANDER is untouched by someone else\'s eviction', has(afterAnne, CATO));

    const afterCato = await rosterOf(cato, CATO);
    check('the eviction reached the bystander\'s own device', !has(afterCato, BRAM),
      `cato sees ${afterCato.length} member(s)`);

    // The evicted member must not be able to act in the circle any more.
    const bramPosts = await call(bram, 'postRequest',
      { groupId: GROUP, text: 'ik ben er nog', intent: 'ask' }, BRAM);
    const anneSees = await call(anne, 'listOpen', {}, ANNE);
    const landed = (anneSees?.items ?? []).some((i) => (i.text ?? '').includes('ik ben er nog'));
    check('an evicted member\'s post does not land in the circle', !landed,
      refused(bramPosts) ? 'refused at the act' : 'accepted locally — check whether it FANS');

    // ── STORY 3 — leaving is not eviction: Cato leaves of his own accord ──────────────────────────
    const left = await call(cato, 'leaveGroup', { groupId: GROUP, confirm: true }, CATO);
    check('a member can leave without asking an admin', !refused(left), JSON.stringify(left)?.slice(0, 120));
    await wait(2000);
    check('the leaver\'s own device drops the membership', !has(await rosterOf(cato, CATO), CATO));
    // PROPAGATION is deliberately NOT asserted here. `leaveGroup` emits a `leave` spine statement, and a
    // statement needs a lane: this harness runs stoop agents over the substrate mirror with no device log
    // and therefore no membership rail, so the statement has nowhere to travel. The shipping composition
    // does propagate it, pinned in `apps/basis/test/v2/leavePropagation.test.js`. Asserting it here would
    // measure the harness, not the product.
  } finally {
    for (const b of [anne, bram, cato]) await b.agent.transport.disconnect().catch(() => {});
  }
  return results;
}
