/**
 * The FIRST person key rides the join (Frits 2026-09-16, option A): a circle learns a member's current person key
 * from the join itself — device-in-circle signed, the same trust as the join — and the creator's from the create.
 * No ceremony is needed to be reachable at the person level; every later version arrives root-revealed.
 *
 * Real agents over the shared bus, the production pairing (the redeem request → the admin-signed join), the
 * production fold. Plus the enrol half: a second device enrolled with the phrase holds the SAME key (it was handed
 * the current version at its ceremony), so the person's devices agree on who "the person" is at the key level.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { bootRealAgentNode, connectNodesOverBus, pairCircle, readRoster, until, teardown } from '../support/pairRealAgents.js';
import { EventLog } from '../../src/eventLog.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';

const GROUP = 'person-key-join';
const rowOf = (roster, webid) => roster.find((m) => m.webid === webid) ?? null;

describe('the first person key rides the join', () => {
  let A; let B; let A2;
  afterAll(async () => { await teardown(A, B, A2); });

  it('both rosters carry the joiner\'s key from the join and the creator\'s from the create — no ceremony ran', async () => {
    const log = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });
    [A, B] = await Promise.all([bootRealAgentNode('A', { agentOpts: log() }), bootRealAgentNode('B', { agentOpts: log() })]);
    await connectNodesOverBus([A, B]);
    // The harness composes its own router; give the JOINER the production membership receive handler (the
    // shells' exact wiring), so the admin-signed join and the create reach its rail by the fan.
    const onMembership = makeMembershipPeerHandler({ rail: B.agent.membershipRail, onChange: (cid) => { try { B.agent.rosterReads?.invalidate(cid); } catch { /* cache */ } } });
    const prior = B._routerRef.fn;
    B._routerRef.fn = (env) => (env?.payload?.subtype === MEMBERSHIP_BROADCAST ? onMembership(env.from, env.payload) : prior?.(env));
    const keyA = A.agent.personKey(), keyB = B.agent.personKey();
    expect(keyA).toMatchObject({ version: 1 }); expect(keyB).toMatchObject({ version: 1 });
    expect(keyA.pubKey).not.toBe(A.pubKey);   // the person key is NOT the static profile key
    expect(keyA.pubKey).not.toBe(keyB.pubKey);

    const { joined } = await pairCircle(A, B, { groupId: GROUP, name: 'Sleutel', handle: 'bea' });
    expect(joined.ok).toBe(true);
    // The admin fans the join before the joiner has bound the admin's address keys (the redeem response binds
    // them), so the fan is refused or held and CATCH-UP reconciles it in the shells. The harness kicks no
    // catch-up; the stand-in below replays the admin's stored spine into the joiner's production handler,
    // which is what a catch-up batch does. Stated, so the walk is not read as proving the fan's ordering.
    for (const st of A.agent.membershipRail.storedStatements(GROUP)) {
      await onMembership(A.agent.circleAddressFor(GROUP), { subtype: MEMBERSHIP_BROADCAST, circleId: GROUP, event: st });
    }
    const settled = await until(async () => {
      const [ra, rb] = await Promise.all([readRoster(A, GROUP), readRoster(B, GROUP)]);
      const ok = rowOf(ra, B.pubKey)?.personKey && rowOf(rb, B.pubKey)?.personKey && rowOf(ra, A.pubKey)?.personKey && rowOf(rb, A.pubKey)?.personKey;
      return ok ? { ra, rb } : null;
    }, { timeout: 8000, step: 100 });
    if (!settled) {
      const [ra, rb] = await Promise.all([readRoster(A, GROUP), readRoster(B, GROUP)]);
      const show = (r) => r.map((m) => ({ who: m.webid === A.pubKey ? 'A' : m.webid === B.pubKey ? 'B' : m.webid?.slice(0, 8), personKey: m.personKey ?? null }));
      console.info('[walk] rosters —', 'on A:', JSON.stringify(show(ra)), 'on B:', JSON.stringify(show(rb)));
    }
    expect(settled, 'the keys never reached both rosters').toBeTruthy();
    const { ra, rb } = settled;
    expect(rowOf(ra, B.pubKey).personKey, 'the admin learned the joiner\'s key from the admin-signed join').toEqual(keyB);
    expect(rowOf(rb, B.pubKey).personKey, 'the joiner\'s own roster shows its key').toEqual(keyB);
    expect(rowOf(ra, A.pubKey).personKey, 'the creator\'s key rode the create').toEqual(keyA);
    expect(rowOf(rb, A.pubKey).personKey, 'and reached the joiner by catch-up of the spine').toEqual(keyA);
  }, 60_000);

  it('a device enrolled with the phrase holds the SAME person key as the first device', async () => {
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode('A2-pre', { agentOpts: vaults });
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'tweede' })).ok).toBe(true);
    await teardown(pre);
    A2 = await bootRealAgentNode('A2', { agentOpts: { ...vaults, deviceLog: new EventLog({ initial: [], muted: [] }) } });
    expect(A2.pubKey).toBe(A.pubKey);
    expect(A2.agent.personKey(), 'handed the current version at the ceremony, sealed on the device').toEqual(A.agent.personKey());
    // THE ENROL CARRIERS carry the link key's PUBLIC half and nothing that derives its seed: the enrolled device
    // builds cards and answers pulls with the pub; only a ceremony (root in hand) can vouch for a rotation.
    const chainA = A.agent.personKeyChainOf(), chainA2 = A2.agent.personKeyChainOf();
    expect(typeof chainA.current.linkKeyPub).toBe('string');
    expect(chainA2.current.linkKeyPub, 'the enrolled device carries the same pin').toBe(chainA.current.linkKeyPub);
    // (the vault entry's exact key set — pub yes, link seed no — is pinned in core's personKey.test.js; the hand-over
    // wire's in personKeySync.test.js; the delegation blob is `{ seed, deviceId, record, label? }` by construction)
  }, 60_000);
});
