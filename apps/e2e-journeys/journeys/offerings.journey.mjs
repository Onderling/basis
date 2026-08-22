// J-offerings: the noticeboard's OTHER half — asking, offering, answering, and lending.
//
// Why this journey exists: the 2026-08-23 coverage survey found that this entire domain — offerings
// (aanbod), asks/questions, lending — has NO multi-agent coverage at all. Not one of those tokens
// appears in any test that boots more than one real agent. It is the largest single gap in the map,
// and it is the part of a circle that a neighbour actually touches: "does anyone have a ladder?"
//
// Three actors, because the interesting failures are three-sided: an answer that reaches the asker
// but not the circle, or a claim on an offer that a bystander never sees resolved.
//   Anne — asks the question, and later lends something out
//   Bram — answers, and borrows
//   Cato — the third person: never acts, and must still see the same board
import { AgentIdentity, DataPart } from '@onderling/core';
import { VaultMemory }             from '@onderling/vault';
import { Reveals }                 from '@onderling/identity-resolver';
import { RelayTransport }          from '@onderling/transports';
import { createNeighbourhoodAgent, attachSubstrateMirror } from '@onderling-app/stoop';
import { wait, checker }           from './_util.mjs';

export const name = 'J-offerings (ask · answer · offer · lend, across three people)';

const GROUP = 'e2e-offerings';
const ANNE = 'https://id.example/anne';
const BRAM = 'https://id.example/bram';
const CATO = 'https://id.example/cato';

const refused = (r) => !!(r?.error || r?.ok === false);
const textOf = (i) => i?.text ?? i?.source?.text ?? '';

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
    for (const other of everyone.filter((w) => w !== me)) bundles[me].agent.addPeer(ids[other].pubKey, ids[other].pubKey);
    await attachSubstrateMirror(bundles[me], {
      group: GROUP, peers: everyone.filter((w) => w !== me).map((w) => ({ pubKey: ids[w].pubKey })),
    });
    await bundles[me].offeringMatch.start();
  }

  const call = (b, op, args, from) => {
    const skill = b.agent.skills.get(op);
    if (!skill) return Promise.resolve({ error: `op-not-declared:${op}` });
    return skill.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent: b.agent, envelope: null });
  };
  const board = async (b, from) => {
    const r = await call(b, 'listOpen', {}, from);
    return Array.isArray(r?.items) ? r.items : [];
  };
  /** Poll a board until `pred` holds — propagation is asynchronous, so a single read proves nothing. */
  const until = async (b, from, pred, ms = 12000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const items = await board(b, from);
      if (pred(items)) return items;
      await wait(250);
    }
    return null;
  };

  try {
    await wait(2500);
    check('three neighbours on the relay',
      anne.agent.transport.connected && bram.agent.transport.connected && cato.agent.transport.connected);

    const created = await call(anne, 'createGroupV2', { groupId: GROUP, name: 'Buurt', rules: {} }, ANNE);
    check('the circle exists', typeof created?.code === 'string');
    for (const [who, bundle] of [[BRAM, bram], [CATO, cato]]) {
      const verdict = await call(anne, 'verifyMembershipCodeForPeer',
        { groupId: GROUP, code: created.code, requesterWebid: who }, ANNE);
      await call(bundle, 'recordRemoteRedemption',
        { groupId: GROUP, code: created.code, codeId: verdict?.codeId, confirmedBy: ANNE }, who);
    }
    await wait(1200);

    // ── 1. A QUESTION reaches the whole circle, not just one person ───────────────────────────────
    const ask = await call(anne, 'postRequest', { text: 'Heeft iemand een ladder?', intent: 'ask' }, ANNE);
    check('the question is posted', !refused(ask), JSON.stringify(ask)?.slice(0, 120));
    // Take the id from the BOARD rather than the write's return shape: it is what a person acts on,
    // and the mirror gives each device its own row id anyway.
    const onOwnBoard = async (b, from, needle) =>
      (await board(b, from)).find((i) => textOf(i).includes(needle)) ?? null;
    const askId = (await onOwnBoard(anne, ANNE, 'ladder'))?.id ?? null;
    check('the question is on the asker\'s own board', !!askId);

    check('the answerer sees the question',
      !!(await until(bram, BRAM, (items) => items.some((i) => textOf(i).includes('ladder')))));
    check('the THIRD person sees it too — a board, not a DM',
      !!(await until(cato, CATO, (items) => items.some((i) => textOf(i).includes('ladder')))));

    // ── 2. An ANSWER gets back to the asker ───────────────────────────────────────────────────────
    // `respondToItem` resolves the item by its local id OR by `source.requestId` (the mirror writes a
    // fresh id per device), so answer from the responder's OWN view of the board.
    const bramView = (await board(bram, BRAM)).find((i) => textOf(i).includes('ladder'));
    const answer = await call(bram, 'respondToItem',
      { itemId: bramView?.id ?? askId, body: 'Ja, ik heb er een — kom maar langs.' }, BRAM);
    check('the neighbour can answer the question', !refused(answer), JSON.stringify(answer)?.slice(0, 140));

    // ── 3. Accepting an answer is the asker's act, and only the asker's ───────────────────────────
    const byStranger = await call(cato, 'acceptResponder',
      { requestId: askId, responderWebid: BRAM }, CATO);
    check('a bystander cannot accept an answer on someone else\'s question', refused(byStranger),
      JSON.stringify(byStranger)?.slice(0, 140));

    const accepted = await call(anne, 'acceptResponder', { requestId: askId, responderWebid: BRAM }, ANNE);
    check('the asker can accept the answer (the control)', !refused(accepted),
      JSON.stringify(accepted)?.slice(0, 140));

    // ── 4. OFFERINGS — what a person says they can do ─────────────────────────────────────────────
    const cats = await call(bram, 'listOfferingCategories', {}, BRAM);
    const categoryId = (cats?.categories ?? [])[0]?.id ?? null;
    check('the offering taxonomy is available to choose from', !!categoryId,
      `${(cats?.categories ?? []).length} categories`);

    if (categoryId) {
      const added = await call(bram, 'addMyOffering', { categoryId }, BRAM);
      check('a neighbour can record what they can offer', !refused(added), JSON.stringify(added)?.slice(0, 120));
      const mine = await call(bram, 'listMyOfferings', {}, BRAM);
      check('…and read it back on their own device',
        (mine?.offerings ?? mine?.items ?? []).length > 0, JSON.stringify(mine)?.slice(0, 120));
    }

    // ── 5. LENDING — the object leaves the house and comes back ───────────────────────────────────
    const lend = await call(anne, 'postRequest', { text: 'Ladder te leen', intent: 'lend' }, ANNE);
    check('a lend offer is posted', !refused(lend), JSON.stringify(lend)?.slice(0, 120));
    const lendId = (await onOwnBoard(anne, ANNE, 'Ladder te leen'))?.id ?? null;
    check('the lend offer is on the board', !!lendId, JSON.stringify(lend)?.slice(0, 140));

    if (lendId) {
      const assigned = await call(anne, 'assignLend', { itemId: lendId, borrowerWebid: BRAM }, ANNE);
      // KNOWN FINDING F-005 — this red is expected and deliberate. `assignLendCore` guards on
      // `current.type !== 'lend'`, but nothing has created a `lend` TYPE since the canonical
      // vocabulary refresh: `postRequest({intent:'lend'})` writes `{type:'offer', kind:'lend'}`.
      // The manifest's `appliesTo: {type:'lend'}` strands the affordance the same way. The assertion
      // states what SHOULD happen, so it turns green the day the guard is fixed.
      check('[F-005] the owner lends it to a named neighbour', !refused(assigned), JSON.stringify(assigned)?.slice(0, 140));

      const returned = await call(anne, 'markReturned', { requestId: lendId }, ANNE);
      check('…and can mark it returned', !refused(returned), JSON.stringify(returned)?.slice(0, 140));
    }
  } finally {
    for (const b of [anne, bram, cato]) await b.agent.transport.disconnect().catch(() => {});
  }
  return results;
}
