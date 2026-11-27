/**
 * A JOIN'S REDEEM NEVER LEAVES FROM THE DEVICE'S OTHER ADDRESS. A transport that cannot carry the addresses this
 * device speaks as (NKN: its sender is bound to its own seed-derived address) makes the send speak as that address.
 * For a redeem that is the wrong person: the admin admits an address nobody else knows, its answer goes nowhere, the
 * joiner waits out "No admin is online", and the roster keeps a member no one can reach. Found on two phones: after a
 * join tried while neither had a connection point, the next redeems left over NKN from the joiner's NKN address while
 * the relay was up again.
 *
 * Here: two real agents on a relay-like bus, the joiner also on an alias-blind transport the admin hears on. The
 * joiner's relay route to the admin is out when Join is pressed and back a second later. The redeem waits for a route
 * that carries its own address (or does not go at all): it arrives from the joiner's own key, and both rosters hold
 * exactly the two people.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { InternalBus, InternalTransport } from '@onderling/core';

import {
  bootRealAgentNode, connectAgentsOverBus, pairCircle, readRoster, until, teardown,
} from './support/pairRealAgents.js';

/** An NKN-like end: reaches its peer, but carries only its own address (no aliases), like NknTransport. */
class AliasBlindTransport extends InternalTransport {
  get supportsAliases() { return false; }
}

describe('a join\'s redeem over a device that also has an alias-blind route', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });

  it('waits for a route that carries its own address: the admin admits the joiner\'s own key, one roster line each', async () => {
    [A, B] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B')]);
    await connectAgentsOverBus(A, B);

    // the second route: the joiner speaks there as its own native address, as NKN does
    const nknBus = new InternalBus({ presenceAware: true });
    const blindAddrB = 'a0'.repeat(32);
    await A.agent.sa.addSecureTransport('nkn', new AliasBlindTransport(nknBus, A.pubKey));
    await B.agent.sa.addSecureTransport('nkn', new AliasBlindTransport(nknBus, blindAddrB));

    // what the admin hears a redeem from, by sender
    const redeemFrom = [];
    A.agent.sa.agent.on?.('envelope', (env) => { if (env?.payload?.subtype === 'group-redeem-request') redeemFrom.push(env._from); });

    // the joiner's relay route to the admin is out at Join, and back a second later
    const relay = B._busTransport;
    const reach = relay.canReach.bind(relay);
    let relayUp = false;
    relay.canReach = (peer) => relayUp && reach(peer);
    setTimeout(() => { relayUp = true; try { B.agent.presenceSignal?.(A.pubKey); } catch { /* the hold retries itself */ } }, 1000);

    const groupId = 'blind-circle';
    const { joined } = await pairCircle(A, B, { groupId, name: 'Blind Circle', handle: 'blindbee' });
    expect(joined.error, `the join completes once the relay is back — got ${JSON.stringify(joined.error)}`).toBeUndefined();
    expect(joined.ok).toBe(true);

    const aRoster = await until(async () => { const r = await readRoster(A, groupId); return r.length >= 2 ? r : null; });
    const webids = (aRoster ?? (await readRoster(A, groupId))).map((m) => m.webid).sort();
    expect(webids, 'the admin admitted the joiner\'s own key, and no other address of its device').toEqual([A.pubKey, B.pubKey].sort());
    expect(redeemFrom.includes(blindAddrB), `no redeem left from the alias-blind address — heard from ${JSON.stringify(redeemFrom)}`).toBe(false);
  }, 120_000);
});
