/**
 * THE PAIRING WALK — a screen that is yours, somewhere else, gets its grant and starts acting.
 *
 * The chicken-and-egg: the grant has to reach a view that does not yet hold one. This walks the
 * resolution end to end — the view is reachable at its own pubkey BEFORE it is trusted, the owner
 * ticks what it may see and do, and the tokens come back over that same address. Then the thing
 * that matters: the view uses what it was handed and the acting door honours it, so pairing is
 * proven by the view WORKING rather than by a success message.
 *
 * The refusals are walked too, because each is a real mistake a real pairing screen can make:
 * a garbled code, a replayed grant, and tokens minted for somebody else's view.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { memoryDataSource } from '@onderling/item-store';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { makeSurfaceActClient } from '../src/v2/surfaceRail.js';
import {
  encodePairingOffer, parsePairingOffer, acceptConnectionGrant,
  CONNECT_SCHEME, CONNECTION_GRANT_SUBTYPE,
} from '../src/v2/connectionPairing.js';
import { compileConnectionGrant } from '../src/v2/connections.js';

describe('the pairing offer — deny-safe parsing', () => {
  it('round-trips what the view offers', () => {
    const uri = encodePairingOffer({ viewPubKey: 'K', relayUrl: 'ws://r', nonce: 'n1', label: 'laptop' });
    expect(uri.startsWith(CONNECT_SCHEME)).toBe(true);
    expect(parsePairingOffer(uri)).toEqual({ ok: true, viewPubKey: 'K', relayUrl: 'ws://r', nonce: 'n1', label: 'laptop' });
  });

  it('refuses with a REASON rather than a half-understood offer', () => {
    expect(parsePairingOffer('https://example.com').reason).toBe('not-a-connect-uri');
    expect(parsePairingOffer(`${CONNECT_SCHEME}%%%not-base64%%%`).reason).toBe('unreadable');
    // a future version must not be guessed at
    const v9 = CONNECT_SCHEME + btoa(JSON.stringify({ v: 9, k: 'K', n: 'n' })).replace(/=+$/, '');
    expect(parsePairingOffer(v9).reason).toBe('wrong-version');
    const noKey = CONNECT_SCHEME + btoa(JSON.stringify({ v: 1, n: 'n' })).replace(/=+$/, '');
    expect(parsePairingOffer(noKey).reason).toBe('incomplete');
  });

  it('an offer without a relay hint is still valid — the owner\'s own relay is the fallback', () => {
    const uri = encodePairingOffer({ viewPubKey: 'K', nonce: 'n' });
    expect(parsePairingOffer(uri)).toMatchObject({ ok: true, relayUrl: null });
  });
});

describe('the view checks the answer it gets', () => {
  const mine = { nonce: 'n1', viewPubKey: 'V' };
  it('accepts the grant that answers its own offer, and learns whose screen it is', () => {
    const r = acceptConnectionGrant(
      { nonce: 'n1', tokens: [{ subject: 'V', issuer: 'OWNER' }], label: 'laptop' }, mine);
    expect(r).toMatchObject({ ok: true, issuer: 'OWNER', label: 'laptop' });
  });
  it('refuses a replayed or foreign grant', () => {
    expect(acceptConnectionGrant({ nonce: 'OLD', tokens: [{ subject: 'V' }] }, mine).reason).toBe('wrong-nonce');
  });
  it('refuses tokens minted for a DIFFERENT view — accepting them would leave it believing it is paired', () => {
    expect(acceptConnectionGrant({ nonce: 'n1', tokens: [{ subject: 'SOMEONE-ELSE' }] }, mine).reason).toBe('wrong-subject');
  });
  it('refuses an answer carrying nothing to present', () => {
    expect(acceptConnectionGrant({ nonce: 'n1', tokens: [] }, mine).reason).toBe('no-tokens');
  });
});

describe('THE WALK — offer → tick → deliver → the view acts', () => {
  it('pairs a view end to end, and the grant it received is the grant that works', async () => {
    const view = await AgentIdentity.generate(new VaultMemory());
    const nonce = 'walk-nonce-1';

    // 1 — the view offers itself. Public, not a secret: all it can do is ASK to be granted.
    const offer = encodePairingOffer({ viewPubKey: view.pubKey, nonce, label: 'laptop' });

    // The delivery channel the owner answers on. In production this is the peer transport to the
    // view's own address; here it is captured so the walk can assert what actually crossed.
    const inbox = [];
    const A = await createRealHouseholdAgent({
      seedHousehold: false,
      settingsDataSource: memoryDataSource(),
      deliverConnectionGrant: async (to, payload) => { inbox.push({ to, payload }); },
    });
    await A.surfaceGrantsReady();

    // 2 — the owner scans it and ticks: one op, one section.
    const parsed = parsePairingOffer(offer);
    expect(parsed.ok).toBe(true);
    const args = compileConnectionGrant({
      viewPubKey: parsed.viewPubKey, ops: ['params.set-param'], sections: ['fam'], label: parsed.label,
    });
    const granted = await A.callSkill('household', 'grantSurface', { ...args, nonce: parsed.nonce });
    expect(granted.ok).toBe(true);
    expect(granted.delivered, 'the grant was not delivered to the view').toBe(true);

    // 3 — what crossed went to the VIEW's own address, and answers its nonce.
    expect(inbox).toHaveLength(1);
    expect(inbox[0].to).toBe(view.pubKey);
    expect(inbox[0].payload.subtype).toBe(CONNECTION_GRANT_SUBTYPE);
    const accepted = acceptConnectionGrant(inbox[0].payload, { nonce, viewPubKey: view.pubKey });
    expect(accepted.ok).toBe(true);

    // 4 — THE POINT: the view acts with what it was handed, and the door honours it. Pairing is
    // proven by the connection working, not by a success flag.
    let client;
    const door = A.makeSurfaceActDoor({ reply: (p) => client.handleResult(p) });
    client = makeSurfaceActClient({ identity: view, send: (p) => door('wire', p) });
    const res = await client.act({
      group: 'params', op: 'set-param', args: { key: 'display.theme', value: 'dark' },
      token: accepted.tokens[0],
    });
    expect(res.ok, `the paired view could not act: ${JSON.stringify(res)}`).toBe(true);
    expect(A.getParamValue('display.theme')).toBe('dark');

    // 5 — and it appears in the owner's list as a connection, with what it may do.
    const listed = await A.callSkill('household', 'listSurfaceGrants', {});
    expect(listed.surfaces).toHaveLength(1);
    expect(listed.surfaces[0]).toMatchObject({ viewPubKey: view.pubKey, label: 'laptop', ops: ['params.set-param'] });
  }, 60_000);

  it('a grant made WITHOUT an offer is not delivered anywhere — nothing to answer', async () => {
    const view = await AgentIdentity.generate(new VaultMemory());
    const inbox = [];
    const A = await createRealHouseholdAgent({
      seedHousehold: false,
      settingsDataSource: memoryDataSource(),
      deliverConnectionGrant: async (to, payload) => { inbox.push({ to, payload }); },
    });
    await A.surfaceGrantsReady();
    const r = await A.callSkill('household', 'grantSurface', { viewPubKey: view.pubKey, ops: ['params.set-param'] });
    expect(r.ok).toBe(true);
    expect(r.delivered).toBeUndefined();     // no nonce ⇒ no delivery attempt, and no false claim
    expect(inbox).toHaveLength(0);
  }, 60_000);
});
