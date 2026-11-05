/**
 * A pod-backed circle's read grant names the WebID the joiner's pod session signs in as. The joiner says it on the
 * redeem, which goes to the admitting admin only. It must reach the grant and nothing else: not the redemption row,
 * not the roster, not the join statement — those reach every member, and a member's pod WebID is not theirs to see.
 *
 * Three real agents over a real relay: the admin founds, Cor joins first, then Bo joins with a pod WebID. Cor folds
 * Bo's join; nothing Cor stored, and nothing the admin stored, carries the WebID. The admin's grant call does.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown } from './support/pairRealAgents.js';
import { EventLog } from '../src/eventLog.js';

const G = 'pod-circle';
const POD = 'https://pod.example/circles/pod-circle/';
const WEBID = 'https://bo.pods.example/profile/card#me';
const log = () => new EventLog({ initial: [], muted: [] });

describe("a joiner's pod WebID goes to the admitting admin's grant, and nowhere else", () => {
  let relay; const nodes = []; let dir;
  afterAll(async () => { await teardown(...nodes); await relay?.close?.(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it('the admin grants to it; the redemption, the roster and a co-member hold none of it', async () => {
    relay = await startJourneyRelay();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-webid-'));
    const persisted = (who) => ({ pinboardPersistDb: { path: path.join(dir, `${who}-pinboard.json`) }, householdPersistDb: { path: path.join(dir, `${who}-household.json`) } });
    const logs = { admin: log(), cor: log(), bo: log() };
    const admin = await bootRealAgentNode('admin', { agentOpts: { deviceLog: logs.admin, ...persisted('admin') } });
    const cor = await bootRealAgentNode('cor', { agentOpts: { deviceLog: logs.cor, ...persisted('cor') } });
    const bo = await bootRealAgentNode('bo', { podWebId: WEBID, agentOpts: { deviceLog: logs.bo, ...persisted('bo') } });
    nodes.push(admin, cor, bo);
    await connectNodesOverRelay([admin, cor, bo], { relayUrl: relay.url });

    const grants = [];
    const route = admin.circleControlAgentRouter.addMember;
    admin.circleControlAgentRouter.addMember = async (a) => { grants.push(a); return route(a); };

    await createCircle(admin, { groupId: G, name: 'Pod' });
    await bindCircleAddresses([admin], G);
    const corJoin = await joinExistingCircle(admin, cor, { groupId: G, handle: 'cor', podUrl: POD });
    expect(corJoin.joined?.error, JSON.stringify(corJoin.joined)).toBeUndefined();
    await bindCircleAddresses([cor], G);
    const boJoin = await joinExistingCircle(admin, bo, { groupId: G, handle: 'boris', podUrl: POD });
    expect(boJoin.joined?.error, JSON.stringify(boJoin.joined)).toBeUndefined();
    await bindCircleAddresses([bo], G);

    // the admin's grant named it — and only for Bo (Cor joined without a pod session)
    const boGrant = grants.find((g) => g.podAgent === WEBID);
    expect(boGrant, JSON.stringify(grants)).toBeTruthy();
    expect(grants.filter((g) => g.podAgent).length).toBe(1);

    // Cor folded Bo's join: Bo is on Cor's roster (so the absence below is not a join that never arrived)
    const boOnRoster = async () => ((await cor.agent.callSkill('pinboard', 'listGroupMembers', { groupId: G }))?.members ?? [])
      .some((m) => [m?.handle, m?.peerDisplay, m?.displayName].includes('boris'));
    await until(boOnRoster, { timeout: 8000, step: 100 });
    expect(await boOnRoster()).toBe(true);

    const everything = async (n, who) => {
      const parts = [];
      for (const type of ['membership-redemption', 'membership-code']) {
        parts.push(JSON.stringify(await n.agent.callSkill('pinboard', 'listOpenRequests', { type }).catch(() => null)));
      }
      parts.push(JSON.stringify(await n.agent.callSkill('pinboard', 'listGroupMembers', { groupId: G }).catch(() => null)));
      parts.push(JSON.stringify(logs[who].query({})));
      parts.push(JSON.stringify(n.received));
      for (const f of fs.readdirSync(dir).filter((x) => x.startsWith(`${who}-`))) parts.push(fs.readFileSync(path.join(dir, f), 'utf8'));
      return parts.join('\n');
    };
    // let the persisted stores flush what they hold
    await new Promise((r) => setTimeout(r, 300));
    expect((await everything(cor, 'cor')).includes(WEBID)).toBe(false);
    expect((await everything(admin, 'admin')).includes(WEBID)).toBe(false);
  }, 60_000);
});
