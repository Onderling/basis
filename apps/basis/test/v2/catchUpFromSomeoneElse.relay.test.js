/**
 * WHAT MY DEVICE CANNOT VOUCH FOR IT DOES NOT HAND ON, AND THE OTHER DEVICE GETS IT FROM SOMEONE ELSE.
 *
 * The admin's stored copy of bram's member statement is damaged after it landed (one character of its signature).
 * Dave then joins and catches the circle up from every member. Before a catch-up checked what it served, the admin
 * sent the damaged copy and dave refused it; now the admin withholds it, and bram (and cato), who hold it whole, serve
 * it. Acceptance: dave's roster names bram as bram named himself, AND nothing the admin sent dave carries the damaged
 * statement.
 *
 * Over a real relay with the real factory: admin + bram + cato in one circle, bram's own member statement, dave's join.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from '../support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, readRoster, until, teardown } from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { primeCircleSecurity } from '../../src/v2/circleSecurityPriming.js';
import { EventLog } from '../../src/eventLog.js';

const CIRCLE = 'circle-catch-up-from-someone-else';
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const settleMember = async (node, circleId) => { await bindCircleAddresses([node], circleId); await bindCircleAddressKeysFor({ agent: node.agent, circleId }); };
const rowOf = (roster, webid) => roster.find((m) => m?.webid === webid) ?? null;

describe('a catch-up gets a damaged statement from someone who holds it whole', () => {
  let relay; let admin; let bram; let cato; let dave; const logs = {};

  beforeAll(async () => {
    relay = await startJourneyRelay();
    const opts = (name) => { logs[name] = new EventLog({ initial: [], muted: [] }); return { agentOpts: { allowAddressFallback: false, deviceLog: logs[name] } }; };
    [admin, bram, cato, dave] = await Promise.all(['admin', 'bram', 'cato', 'dave'].map((n) => bootRealAgentNode(n, opts(n))));
    await connectNodesOverRelay([admin, bram, cato, dave], { relayUrl: relay.url });
    await createCircle(admin, { groupId: CIRCLE, name: 'C' });
    await settleMember(admin, CIRCLE);
    for (const [who, handle] of [[bram, 'bram'], [cato, 'cato']]) {
      expect((await joinExistingCircle(admin, who, { groupId: CIRCLE, handle })).joined.ok).toBe(true);
      await settleMember(who, CIRCLE);
    }
    await Promise.all([admin, bram, cato].map((n) => primeCircleSecurity({ agent: n.agent, onWarn: () => {} })));
    await settle(1500);
    for (const n of [admin, bram, cato]) await bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE });
  }, 240_000);

  afterAll(async () => {
    try { await teardown(admin, bram, cato, dave); } catch { /* */ }
    try { await relay?.stop?.(); } catch { /* */ }
  });

  it('the admin withholds its damaged copy; dave still gets bram\'s statement, from bram or cato', async () => {
    await bram.agent.emitMemberProps({ circleIds: [CIRCLE], props: { displayName: 'Bram Heel' } });
    for (const who of [admin, cato]) {
      expect(await until(async () => (rowOf(await readRoster(who, CIRCLE), bram.pubKey)?.displayName === 'Bram Heel' ? true : null), { timeout: 20_000, step: 300 }), `${who.label} has bram's name`).toBe(true);
    }
    // damage the ADMIN's stored copy of bram's member statement: one character of its signature
    const props = logs.admin.query({}).find((e) => e.type === 'membership' && e.circleId === CIRCLE && e.payload?.body?.kind === 'member-props' && e.payload?.body?.payload?.displayName === 'Bram Heel');
    expect(props, 'the admin holds bram\'s statement').toBeTruthy();
    const damagedHash = props.payload.body.hash;
    const sig = props.payload.sig;
    props.payload = { ...props.payload, sig: (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1) };

    // record what the admin sends dave
    const fromAdmin = [];
    const peer = admin.agent.peer; const orig = peer.sendTo.bind(peer);
    peer.sendTo = (to, env, o) => { fromAdmin.push(env); return orig(to, env, o); };
    try {
      expect((await joinExistingCircle(admin, dave, { groupId: CIRCLE, handle: 'dave' })).joined.ok).toBe(true);
      await settleMember(dave, CIRCLE);
      await primeCircleSecurity({ agent: dave.agent, onWarn: () => {} });
      for (const n of [admin, bram, cato, dave]) await bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE });
      const named = await until(async () => (rowOf(await readRoster(dave, CIRCLE), bram.pubKey)?.displayName === 'Bram Heel' ? true : null), { timeout: 40_000, step: 500 });
      expect(named, 'dave has bram\'s statement, from a member who holds it whole').toBe(true);
    } finally { peer.sendTo = orig; }
    const served = fromAdmin.flatMap((env) => {
      const p = env?.payload ?? env;
      const list = Array.isArray(p?.statements) ? p.statements : [];
      return list.map((s) => s?.body?.hash);
    });
    expect(served, 'the admin never handed on the copy it cannot vouch for').not.toContain(damagedHash);
  }, 120_000);
});
