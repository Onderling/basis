/**
 * DELETING A CONTACT (L114, Frits 2026-09-24: Fable's (i)) — hide + leave the pair circle; a return RE-JOINS the same
 * pair circle and shows "je had dit contact verwijderd".
 *
 * Why not "a stranger again": the pair circle's id is derived from the two webids, so a second relationship would
 * be the same circle. The honest shape is the one the id allows: the relationship pauses (the row out of sight, the
 * route and its keys gone because this side left), and a message from them resumes it, visibly.
 *
 * Walked over the bus with two real agents, the way the pair roster itself is walked (`pairRosterWalk.test.js`),
 * once for each ROLE: which side founded the pair circle is fixed by the two keys, so a contact deletes as the
 * founder in about half of all pairs.
 *
 * THE FOUNDER CASE (found 2026-09-24, instrumented): the return is admitted by the one admin left — the promoted
 * co-admin. The roster read used to admit a join signed by someone else only on a FOUNDER's authority; the fold now
 * admits it on the author's admin authority at that causal point (Frits: "any admin should be able to readmit
 * someone who left", ledger L127).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootRealAgentNode, connectNodesOverBus, until, teardown, readRoster } from '../support/pairRealAgents.js';
import { EventLog } from '../../src/eventLog.js';
import { pairCircleIdFor, pairFounderOf } from '../../src/v2/pairRoster.js';
import { deleteContact } from '../../src/v2/contactDelete.js';
import { bookRowsOf } from '../../src/v2/contactsSource.js';

const log = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });
const dm = (from, to, text, messageId) => from.contactThreadChannel.sendTurn({ peerAddr: to.pubKey, threadId: to.pubKey, text, messageId }).sent;
const rowOf = (roster, webid) => (roster ?? []).find((m) => m.webid === webid);
const contactOf = async (node, webid) => bookRowsOf(await node.agent.callSkill('stoop', 'listContacts', {})).find((c) => c.webid === webid) ?? null;
const threadTexts = async (node, contactId) => ((await node.contactThreadChannel.rehydrate?.(contactId)) ?? []).map((t) => t.text);

/** Two card contacts who have written once, so the pair roster exists; `{deleter, deleted, pairId}` by ROLE. */
async function pairWith(deleterIsFounder) {
  const [X, Y] = await Promise.all([
    bootRealAgentNode('X', { agentOpts: log(), contactChannel: true }),
    bootRealAgentNode('Y', { agentOpts: log(), contactChannel: true }),
  ]);
  await connectNodesOverBus([X, Y]);
  for (const [me, o] of [[X, Y], [Y, X]]) {
    const card = await o.agent.callSkill('stoop', 'getContactShareQr', {});
    expect((await me.agent.callSkill('stoop', 'addContactFromQr', { payload: card.payload })).error).toBeUndefined();
  }
  const pairId = pairCircleIdFor(X.pubKey, Y.pubKey);
  const founder = pairFounderOf(X.pubKey, Y.pubKey) === X.pubKey ? X : Y;
  const other = founder === X ? Y : X;
  await dm(other, founder, 'hoi', 'd1');
  const formed = await until(async () => {
    const [rf, ro] = await Promise.all([readRoster(founder, pairId), readRoster(other, pairId)]);
    return rowOf(rf, other.pubKey)?.personKey && rowOf(ro, founder.pubKey)?.personKey ? true : null;
  }, { timeout: 25_000, step: 150 });
  expect(formed, 'the pair roster never formed').toBe(true);
  return deleterIsFounder ? { deleter: founder, deleted: other, pairId, nodes: [X, Y] } : { deleter: other, deleted: founder, pairId, nodes: [X, Y] };
}

async function deletes({ deleter, deleted, pairId }) {
  const r = await deleteContact({ agent: deleter.agent, contactWebid: deleted.pubKey, pairCircleId: pairId });
  expect(r.ok).toBe(true);
  const row = await contactOf(deleter, deleted.pubKey);
  expect(row.hidden).toBe(true);
  expect(Number.isFinite(row.deletedAt)).toBe(true);
  const gone = await until(async () => (rowOf(await readRoster(deleted, pairId), deleter.pubKey) ? null : true), { timeout: 15_000, step: 150 });
  expect(gone, 'the deleted contact still holds the deleter on the pair roster').toBe(true);
}

async function returns({ deleter, deleted, pairId }) {
  await dm(deleted, deleter, 'ben je er nog?', 'd2');
  const back = await until(async () => (rowOf(await readRoster(deleter, pairId), deleted.pubKey) && rowOf(await readRoster(deleted, pairId), deleter.pubKey) ? true : null), { timeout: 20_000, step: 150 });
  expect(back, 'the pair roster did not re-form').toBe(true);
  const row = await until(async () => { const c = await contactOf(deleter, deleted.pubKey); return c && c.hidden === false ? c : null; }, { timeout: 15_000, step: 150 });
  expect(row, 'the row did not come back').toBeTruthy();
  expect(Number.isFinite(row.deletedAt), 'the marker needs the deletion on record').toBe(true);
  expect(await until(async () => ((await threadTexts(deleter, deleted.pubKey)).includes('ben je er nog?') ? true : null), { timeout: 15_000, step: 150 })).toBe(true);
}

describe('delete a contact — the deleter did NOT found the pair circle', () => {
  let p;
  beforeAll(async () => { p = await pairWith(false); }, 60_000);
  afterAll(async () => { await teardown(...p.nodes); });
  it('deleting hides the row, marks it deleted, and takes the deleter off the pair roster on both sides', async () => { await deletes(p); }, 30_000);
  it('their next message: the SAME pair circle again (the founder invites back), the row returns marked, the words arrive', async () => { await returns(p); }, 60_000);
});

describe('delete a contact — the deleter FOUNDED the pair circle', () => {
  let p;
  beforeAll(async () => { p = await pairWith(true); }, 60_000);
  afterAll(async () => { await teardown(...p.nodes); });
  it('deleting hides the row, marks it deleted, and takes the deleter off the pair roster on both sides', async () => { await deletes(p); }, 30_000);
  // The promoted co-admin re-admits the returning founder (Frits 2026-09-24, L127: any admin may re-admit).
  it('their next message: the co-admin invites the founder back, the pair circle re-forms, the row returns marked', async () => { await returns(p); }, 60_000);
});
