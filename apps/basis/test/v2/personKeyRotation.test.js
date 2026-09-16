/**
 * THE ROTATION CEREMONY (binding-levels §10.5, step 3): the revoked device holds the CURRENT person key, so the
 * ceremony derives the next version, keeps it, announces it to every circle ROOT-REVEALED, and hands the seed to the
 * surviving devices over the sibling carry.
 *
 * Cast: Anna's phone (A, root custody, runs the ceremony), Anna's kept device (A2, enrolled), Anna's lost device
 * (A3, enrolled, revoked), and Bea (B). Real agents over the shared bus, the production ceremony, the production
 * rails and folds; the harness composes its own router, so the production handlers (membership, person-key) are
 * installed on it explicitly, and A2/A3 get their rosters through the production roster-seed request, as the enrol
 * consume does.
 *
 * The claims: after the ceremony A holds v2; A2 holds the same v2, handed over; Bea's roster row for Anna shows v2,
 * folded from the root-revealed statement; A3 still holds v1 and cannot announce a key of its own.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { CIRCLE_ADDRESS_ANNOUNCE_KIND, PERSON_KEY_KIND } from '@onderling/core';
import { bootRealAgentNode, connectNodesOverBus, pairCircle, bindCircleAddresses, readRoster, until, teardown } from '../support/pairRealAgents.js';
import { ownAnnouncementFor } from '../../src/v2/circleAddressAnnounce.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';
import { EventLog } from '../../src/eventLog.js';

const GROUP = 'anna-rotates';
const SEND = { hold: true, firstSendTimeoutMs: 4000, retryDelays: [] };
const log = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });
const rowFor = async (node, webid) => (await readRoster(node, GROUP)).find((m) => m.webid === webid) ?? null;

describe('the person key rotates in the revoke ceremony', () => {
  let A; let B; let A2; let A3; let deviceA3; let phrase;

  beforeAll(async () => {
    A = await bootRealAgentNode('A', { agentOpts: log() });
    B = await bootRealAgentNode('B', { agentOpts: log() });
    phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    // Two more devices of Anna, each enrolled with the phrase on the device itself.
    const enrol = async (label) => {
      const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
      const pre = await bootRealAgentNode(`${label}-pre`, { agentOpts: vaults });
      const e = await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label });
      expect(e.ok).toBe(true);
      await teardown(pre);
      const node = await bootRealAgentNode(label, { agentOpts: { ...vaults, ...log() } });
      return { node, deviceId: e.deviceId };
    };
    ({ node: A2 } = await enrol('A2'));
    ({ node: A3, deviceId: deviceA3 } = await enrol('A3'));
    await connectNodesOverBus([A, B, A2, A3]);
    await pairCircle(A, B, { groupId: GROUP, name: 'Rotatie', handle: 'bea' });
    await bindCircleAddresses([A, B, A2, A3], GROUP);

    // The production receive handlers the harness router lacks: membership on B, A2, A3; the person-key lane on all of Anna's.
    for (const node of [A, B, A2, A3]) {
      const onMembership = makeMembershipPeerHandler({ rail: node.agent.membershipRail, onChange: (cid) => { try { node.agent.rosterReads?.invalidate(cid); } catch { /* cache */ } } });
      const pk = node.agent.personKeySync?.handlers ?? {};
      const prior = node._routerRef.fn;
      node._routerRef.fn = (env) => {
        const st = env?.payload?.subtype;
        if (st === MEMBERSHIP_BROADCAST) return onMembership(env.from, env.payload);
        if (pk[st]) return pk[st](env.from, env.payload);
        return prior?.(env);
      };
    }
    // A2 and A3 get the circle's trail from A (the enrol consume's roster seed).
    for (const node of [A2, A3]) {
      const req = await node.agent.rosterSeed.buildRequest(GROUP, node.agent.circleAddressFor(GROUP));
      await node.agent.sendPeerMessage(A.agent.circleAddressFor(GROUP), req, SEND);
      expect(await until(async () => ((await rowFor(node, B.pubKey)) ? true : null), { timeout: 20000, step: 100 }), `${node.label} never received the roster seed`).toBe(true);
    }
    // Every device of Anna announces its proven address (with its ceremony commitment) into every roster.
    const anns = [A, A2, A3].map((n) => ownAnnouncementFor({ agent: n.agent, circleId: GROUP }));
    for (const node of [A, B, A2, A3]) {
      for (const ann of anns) {
        expect((await node.agent.callSkill('stoop', 'recordCircleAddressAnnouncement', { groupId: GROUP, memberWebid: A.pubKey, ...ann }))?.ok).toBe(true);
      }
      await bindCircleAddressKeysFor({ agent: node.agent, circleId: GROUP });
    }
    for (const node of [A, B, A2, A3]) {
      const row = await rowFor(node, A.pubKey);
      for (const n of [A, A2, A3]) expect(row?.circleAddresses, `${node.label} knows all of Anna's addresses`).toContain(n.agent.circleAddressFor(GROUP));
    }
  }, 180_000);

  afterAll(async () => { await teardown(A, B, A2, A3); });

  it('before: all three devices hold the same version 1', () => {
    const k = A.agent.personKey();
    expect(k).toMatchObject({ version: 1 });
    expect(A2.agent.personKey()).toEqual(k);
    expect(A3.agent.personKey()).toEqual(k);
  });

  it('the ceremony rotates to version 2: kept on A, handed to A2, folded root-revealed on Bea\'s roster; the lost device keeps v1', async () => {
    const v1 = A.agent.personKey();
    const r = await A.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: deviceA3, circleIds: [GROUP] });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.personKeyVersion).toBe(2);
    const v2 = A.agent.personKey();
    expect(v2.version).toBe(2);
    expect(v2.pubKey).not.toBe(v1.pubKey);

    // A2 — handed the seed over the sibling carry
    const got = await until(() => (A2.agent.personKey()?.version === 2 ? true : null), { timeout: 15000, step: 100 });
    expect(got, `A2 never received v2; holds ${JSON.stringify(A2.agent.personKey())}`).toBe(true);
    expect(A2.agent.personKey()).toEqual(v2);

    // Bea — the root-revealed statement, folded
    expect(await until(async () => ((await rowFor(B, A.pubKey))?.personKey?.version === 2 ? true : null), { timeout: 15000, step: 100 }), 'Bea\'s row never showed v2').toBe(true);
    expect((await rowFor(B, A.pubKey)).personKey).toEqual(v2);
    // …and A's own roster
    expect((await rowFor(A, A.pubKey)).personKey).toEqual(v2);

    // A3 — the lost device: retired, never handed the new seed, still on v1
    await new Promise((res) => setTimeout(res, 500));
    expect(A3.agent.personKey()).toEqual(v1);
    expect((await rowFor(B, A.pubKey)).circleAddresses ?? []).not.toContain(A3.agent.circleAddressFor(GROUP));
  }, 60_000);

  it('the lost device cannot announce a key of its own — a person-key statement without the root reveal binds nowhere', async () => {
    const forged = await A3.agent.membershipRail.append(GROUP, { kind: PERSON_KEY_KIND, subject: A.pubKey, payload: { version: 3, pubKey: 'THIEF' }, actor: A.pubKey });
    if (forged?.statement) {
      await B.agent.membershipRail.ingest(GROUP, forged.statement).catch(() => {});
      await A2.agent.membershipRail.ingest(GROUP, forged.statement).catch(() => {});
    }
    await new Promise((res) => setTimeout(res, 300));
    expect((await rowFor(B, A.pubKey)).personKey.version).toBe(2);
    expect((await rowFor(A2, A.pubKey)).personKey?.version ?? 2).toBe(2);
  });
});
