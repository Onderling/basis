/**
 * THE PAIR-A-VIEW WALK (remote surface, acting half) — headless: the owner's agent grants a
 * VIEW (a bare keypair — not a circle member, not a device enrollment) a standing surface
 * role covering exactly one op. The view drives the agent's waist through the verified acting
 * door: the permitted op dispatches and its effect is observable on the agent; an op outside
 * the picks refuses; a tampered envelope refuses; a token the view issued to itself refuses;
 * a replayed request refuses; and after the owner revokes the surface, the formerly-permitted
 * op refuses too — the token blob the view still holds is dead at the door, exactly the
 * enforceability rule: the boundary binds where tokens verify, not in the view's code.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { AgentIdentity, CapabilityToken } from '@onderling/core';
import { webcrypto } from 'node:crypto';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';
import { makeSurfaceActClient, SURFACE_ACT_SUBTYPES } from '../src/v2/surfaceRail.js';

describe('the pair-a-view walk — a remote surface acts through the waist over a grant', () => {
  let owner;         // the acting agent's node
  let view;          // the view's identity (a bare keypair)
  let client;        // the view's acting client
  let door;          // the agent's verified acting door (the peer-router handler)
  let grant;         // { tokens } from grantSurface

  /** The walk's transport: the view's send delivers straight into the agent's door, and the
   *  door's reply resolves the client's pending act — the sign→verify→dispatch→reply seam is
   *  crossed with real crypto; the wire itself is the harness's usual in-process bridge. */
  const wire = () => {
    door = owner.agent.makeSurfaceActDoor({
      reply: (payload) => { client.handleResult(payload); },
    });
    client = makeSurfaceActClient({
      identity: view,
      send: (payload) => door('view-wire-addr', payload),
    });
  };

  beforeAll(async () => {
    owner = await bootRealAgentNode('surface-owner');
    const seed = new Uint8Array(32);
    webcrypto.getRandomValues(seed);
    view = await AgentIdentity.fromSeed(seed, new VaultMemory());
    wire();
  }, 30000);

  afterAll(async () => { await teardown(owner); });

  it('grants the view a surface covering exactly one op', async () => {
    grant = await owner.agent.callSkill('household', 'grantSurface', {
      viewPubKey: view.pubKey,
      ops: ['params.set-param'],
      label: 'walk-view',
    });
    expect(grant.ok).toBe(true);
    expect(grant.tokens).toHaveLength(1);
    expect(grant.tokens[0].subject).toBe(view.pubKey);
    expect(grant.tokens[0].skill).toBe('params.set-param');

    const listed = await owner.agent.callSkill('household', 'listSurfaceGrants', {});
    expect(listed.surfaces).toEqual([{ viewPubKey: view.pubKey, label: 'walk-view', ops: ['params.set-param'] }]);
  });

  it('the permitted op ACTS: the reply confirms and the effect lands on the agent', async () => {
    const res = await client.act({
      group: 'params', op: 'set-param',
      args: { key: 'display.theme', value: 'dark' },
      token: grant.tokens[0],
    });
    expect(res.ok).toBe(true);
    expect(owner.agent.getParamValue('display.theme')).toBe('dark');
  });

  it('an op outside the picks refuses out-of-scope — the pick IS the boundary', async () => {
    const res = await client.act({
      group: 'household', op: 'revealOwnerPhrase',
      args: {}, token: grant.tokens[0],
    });
    expect(res).toEqual({ ok: false, code: 'out-of-scope' });
  });

  it('a tampered envelope refuses bad-signature (args changed after signing)', async () => {
    // Hand-build an honest envelope, then mutate the body AFTER capture: the door must refuse
    // because the view's signature no longer covers what arrived.
    let captured = null;
    const spyClient = makeSurfaceActClient({ identity: view, send: (p) => { captured = p; } });
    const pendingAct = spyClient.act({
      group: 'params', op: 'set-param',
      args: { key: 'display.theme', value: 'light' },
      token: grant.tokens[0],
    });
    expect(captured).not.toBeNull();
    captured.body = { ...captured.body, args: { key: 'display.theme', value: 'HIJACKED' } };

    const replies = [];
    const tamperDoor = owner.agent.makeSurfaceActDoor({ reply: (p) => { replies.push(p); } });
    await tamperDoor('view-wire-addr', captured);
    expect(replies).toHaveLength(1);
    expect(replies[0].ok).toBe(false);
    expect(replies[0].code).toBe('bad-signature');
    expect(owner.agent.getParamValue('display.theme')).toBe('dark');
    spyClient.handleResult({ requestId: captured.body.requestId, ok: false, code: 'aborted' });
    await pendingAct;
  });

  it('a token the view issued to ITSELF refuses untrusted-issuer', async () => {
    const selfIssued = (await CapabilityToken.issue(view, {
      subject: view.pubKey,
      agentId: owner.pubKey,
      skill:   'household.revealOwnerPhrase',
      expiresIn: 60_000,
    })).toJSON();
    const res = await client.act({
      group: 'household', op: 'revealOwnerPhrase',
      args: {}, token: selfIssued,
    });
    expect(res).toEqual({ ok: false, code: 'untrusted-issuer' });
  });

  it('a replayed request refuses replay', async () => {
    let captured = null;
    const spyClient = makeSurfaceActClient({ identity: view, send: (p) => { captured = p; } });
    const pendingAct = spyClient.act({
      group: 'params', op: 'set-param',
      args: { key: 'display.theme', value: 'dark' },
      token: grant.tokens[0],
    });
    const replies = [];
    const replayDoor = owner.agent.makeSurfaceActDoor({ reply: (p) => { replies.push(p); } });
    await replayDoor('view-wire-addr', captured);
    await replayDoor('view-wire-addr', captured);
    expect(replies).toHaveLength(2);
    expect(replies[0].ok).toBe(true);
    expect(replies[1]).toMatchObject({ ok: false, code: 'replay' });
    spyClient.handleResult({ requestId: captured.body.requestId, ok: true });
    await pendingAct;
  });

  it('after revoke, the formerly-permitted op refuses — the held blob is dead at the door', async () => {
    const revoked = await owner.agent.callSkill('household', 'revokeSurface', { viewPubKey: view.pubKey });
    expect(revoked).toMatchObject({ ok: true, revoked: true });

    const res = await client.act({
      group: 'params', op: 'set-param',
      args: { key: 'display.theme', value: 'light' },
      token: grant.tokens[0],
    });
    expect(res).toEqual({ ok: false, code: 'revoked' });
    expect(owner.agent.getParamValue('display.theme')).toBe('dark');
  });

  it('a re-grant rotates: the old token set is dead, the fresh one acts', async () => {
    const again = await owner.agent.callSkill('household', 'grantSurface', {
      viewPubKey: view.pubKey, ops: ['params.set-param'], label: 'walk-view',
    });
    expect(again.ok).toBe(true);
    const res = await client.act({
      group: 'params', op: 'set-param',
      args: { key: 'display.theme', value: 'light' },
      token: again.tokens[0],
    });
    expect(res.ok).toBe(true);
    expect(owner.agent.getParamValue('display.theme')).toBe('light');
    // The pre-revocation token stays dead even though the view holds both blobs.
    const stale = await client.act({
      group: 'params', op: 'set-param',
      args: { key: 'display.theme', value: 'dark' },
      token: grant.tokens[0],
    });
    expect(stale).toEqual({ ok: false, code: 'revoked' });
  });

  it('the wire subtypes are the declared pair', () => {
    expect(SURFACE_ACT_SUBTYPES).toEqual({ request: 'surface-act-request', result: 'surface-act-result' });
  });
});
