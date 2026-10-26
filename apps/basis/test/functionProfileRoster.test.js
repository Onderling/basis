/**
 * A function profile (a bot's node) is a ROSTER fact, proven from the signed statement that put the row there — so
 * a person's phone in the bot's household can tell the bot's row from a person's. Two real agents over one bus:
 *   - the bot FOUNDS the circle → its own signed creation says so → every replica's roster proves it;
 *   - a person founds and invites the bot with a bot invite → the admin's signed join says so;
 *   - the same bot on an ORDINARY invite → no kind; a member never names its own.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { bootRealAgentNode, connectAgentsOverBus, pairCircle, createCircle, joinExistingCircle, bindCircleAddresses, readRoster, until, teardown } from './support/pairRealAgents.js';

const rowOf = (roster, webid) => roster.find((m) => m.webid === webid) ?? null;
// what the shells do after a join (`onJoined`): pull the circle's membership lane, so the statements made before
// this device joined — the circle's creation among them — reach its fold
const pull = (n, gid) => n.membershipCatchUp?.requestCircle(gid, { callSkill: (a, o, x) => n.agent.callSkill(a, o, x) });
const kindOn = (node, gid, webid) => until(async () => rowOf(await readRoster(node, gid), webid)?.provenKind ?? null, { timeout: 8000, step: 50 });
const both = async (A, B, groupId) => {
  await Promise.all([pull(A, groupId), pull(B, groupId)]);
  const a = await until(async () => { const r = await readRoster(A, groupId); return r.length >= 2 ? r : null; });
  const b = await until(async () => { const r = await readRoster(B, groupId); return r.length >= 2 ? r : null; });
  return { a: a ?? [], b: b ?? [] };
};

describe('a function profile on the roster', () => {
  let A; let B;
  afterEach(async () => { await teardown(A, B); A = B = null; });

  it('the bot that founds is proven a function profile on both replicas; the person who joins is not', async () => {
    [A, B] = await Promise.all([bootRealAgentNode('bot', { itemsLane: true }), bootRealAgentNode('frits', { itemsLane: true })]);
    await A.agent.markFunctionProfile();
    await connectAgentsOverBus(A, B);
    const { joined, groupId } = await pairCircle(A, B, { groupId: 'household', name: 'Huis', handle: 'frits' });
    expect(joined.ok).toBe(true);
    const { a, b } = await both(A, B, groupId);
    for (const node of [A, B]) expect(await kindOn(node, groupId, A.pubKey)).toBe('function');
    for (const roster of [a, b]) expect(rowOf(roster, B.pubKey)?.provenKind).toBeUndefined();
  });

  it('a bot admitted on a BOT invite is proven one; on an ordinary invite it is not', async () => {
    [A, B] = await Promise.all([bootRealAgentNode('frits', { itemsLane: true }), bootRealAgentNode('bot', { itemsLane: true })]);
    await B.agent.markFunctionProfile();
    await connectAgentsOverBus(A, B);
    await createCircle(A, { groupId: 'with-bot', name: 'Met bot' });
    const j1 = await joinExistingCircle(A, B, { groupId: 'with-bot', handle: 'bot', forFunction: true });
    expect(j1.joined.ok).toBe(true);
    await bindCircleAddresses([A, B], 'with-bot');
    const r1 = await both(A, B, 'with-bot');
    for (const node of [A, B]) expect(await kindOn(node, 'with-bot', B.pubKey)).toBe('function');
    for (const roster of [r1.a, r1.b]) expect(rowOf(roster, A.pubKey)?.provenKind).toBeUndefined();

    await createCircle(A, { groupId: 'plain', name: 'Gewoon' });
    const j2 = await joinExistingCircle(A, B, { groupId: 'plain', handle: 'bot' });
    expect(j2.joined.ok).toBe(true);
    await bindCircleAddresses([A, B], 'plain');
    const r2 = await both(A, B, 'plain');
    for (const roster of [r2.a, r2.b]) expect(rowOf(roster, B.pubKey)?.provenKind).toBeUndefined();
  });
});
