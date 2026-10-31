/**
 * A PERSONA ISSUES ITS GRANTS AS ITSELF. Personas are the filter between the outside world and the person's data and
 * skills; a grant a screen holds names its issuer, so a grant for Werk issued by the default would let the screen link
 * Werk to the person's default. Anna's phone (default + Werk) pairs a view AS Werk: the token's issuer is Werk, nothing
 * the view received carries any of the default's material, the door honours the token, Mij's list names Werk, and a
 * revoke as Werk binds at the door. With two selves on the device, a grant that names none is refused.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { memoryDataSource } from '@onderling/item-store';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { actAsConnection, trustForGrant } from './support/actAsConnection.js';
import { encodePairingOffer, parsePairingOffer, acceptConnectionGrant } from '../src/v2/connectionPairing.js';
import { compileConnectionGrant } from '../src/v2/connections.js';
import { CONNECTION_MANIFESTS } from '../src/v2/connectionManifests.js';

describe('a persona issues its grants as itself', () => {
  let A; let w; let view; const inbox = []; let granted; let accepted;

  beforeAll(async () => {
    view = await AgentIdentity.generate(new VaultMemory());
    A = await createRealHouseholdAgent({
      a2aManifests: CONNECTION_MANIFESTS, seedHousehold: false, settingsDataSource: memoryDataSource(),
      ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(),
      deliverConnectionGrant: async (to, payload) => { inbox.push({ to, payload }); },
    });
    await A.surfaceGrantsReady();
    w = (await A.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const parsed = parsePairingOffer(encodePairingOffer({ viewPubKey: view.pubKey, nonce: 'n-werk', label: 'werkscherm' }));
    const args = compileConnectionGrant({ viewPubKey: parsed.viewPubKey, ops: ['params.set-param'], sections: [], label: parsed.label });
    granted = await A.callSkill('household', 'grantSurface', { ...args, nonce: parsed.nonce, persona: w });
    accepted = inbox.length ? acceptConnectionGrant(inbox[0].payload, { nonce: 'n-werk', viewPubKey: view.pubKey }) : null;
  }, 120_000);

  /** Everything public of the default persona: what a holder could link Werk to. */
  const defaultMaterial = () => {
    const d = A.persona('default');
    return {
      chat: d.chatId.pubKey,
      personKey: d.personKeyPubOf?.(d.personKey ?? d.initialPersonKey) ?? null,
      authority: d.authorityPubKeyB64 ?? null,
      wireDevice: d.enrolledDevice?.deviceId ?? null,
    };
  };

  it('the token is issued by Werk, and nothing the view received carries the default', () => {
    expect(granted?.ok, JSON.stringify(granted)).toBe(true);
    expect(accepted?.ok, JSON.stringify(accepted)).toBe(true);
    const token = accepted.tokens[0]?.toJSON?.() ?? accepted.tokens[0];
    expect(token.issuer, 'the issuer is Werk').toBe(A.persona(w).chatId.pubKey);
    const received = JSON.stringify(inbox[0].payload);
    for (const [k, v] of Object.entries(defaultMaterial())) {
      expect(v, `the default has a ${k}`).toBeTruthy();
      expect(received.includes(v), `what the view received carries the default's ${k}`).toBe(false);
    }
  });

  it('the door honours the token, and Mij lists the grant under Werk', async () => {
    await trustForGrant(A, view.pubKey);
    const res = await actAsConnection(A, {
      callerPubKey: view.pubKey, opId: 'params.set-param', args: { key: 'display.theme', value: 'dark' }, addressedTo: accepted.issuer,
      token: accepted.tokens[0]?.toJSON?.() ?? accepted.tokens[0],
    });
    expect(res.ok, `the Werk-paired view could not act: ${JSON.stringify(res)}`).toBe(true);
    const listed = await A.callSkill('household', 'listSurfaceGrants', {});
    expect(listed.surfaces.find((s) => s.viewPubKey === view.pubKey)).toMatchObject({ viewPubKey: view.pubKey, persona: w });
  });

  it('a revoke as Werk binds at the door', async () => {
    expect((await A.callSkill('household', 'revokeSurface', { viewPubKey: view.pubKey }))?.revoked).toBeTruthy();
    const res = await actAsConnection(A, {
      callerPubKey: view.pubKey, opId: 'params.set-param', args: { key: 'display.theme', value: 'light' }, addressedTo: accepted.issuer,
      token: accepted.tokens[0]?.toJSON?.() ?? accepted.tokens[0],
    });
    expect(res.ok, 'the revoked grant still acted').toBe(false);
    expect(A.getParamValue('display.theme')).toBe('dark');
  });

  it('with two selves on the device, a grant that names none is refused', async () => {
    const other = await AgentIdentity.generate(new VaultMemory());
    const r = await A.callSkill('household', 'grantSurface', { viewPubKey: other.pubKey, ops: ['params.set-param'] });
    expect({ ok: r?.ok, error: r?.error }).toEqual({ ok: false, error: 'self-required' });
  });
});

describe('a device that boots holding a persona', () => {
  it('has the persona\'s grants from the start: its tokens honoured at the door after a restart', async () => {
    const view = await AgentIdentity.generate(new VaultMemory());
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
    const base = { a2aManifests: CONNECTION_MANIFESTS, seedHousehold: false, settingsDataSource: memoryDataSource() };
    const { EventLog } = await import('../src/eventLog.js');
    const deviceLog = new EventLog({ initial: [], muted: [] });
    const inbox = [];
    const first = await createRealHouseholdAgent({ ...base, ...vaults, deviceLog, deliverConnectionGrant: async (to, payload) => { inbox.push(payload); } });
    await first.surfaceGrantsReady();
    const w = (await first.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const parsed = parsePairingOffer(encodePairingOffer({ viewPubKey: view.pubKey, nonce: 'n2', label: 'scherm' }));
    const args = compileConnectionGrant({ viewPubKey: parsed.viewPubKey, ops: ['params.set-param'], sections: [], label: parsed.label });
    expect((await first.callSkill('household', 'grantSurface', { ...args, nonce: 'n2', persona: w }))?.ok).toBe(true);
    const accepted = acceptConnectionGrant(inbox[0], { nonce: 'n2', viewPubKey: view.pubKey });
    await first.dispose?.();
    // the same device, restarted: Werk runs at boot, and its grant is still its own and still honoured
    const again = await createRealHouseholdAgent({ ...base, ...vaults, deviceLog });
    await again.surfaceGrantsReady();
    expect(again.persona(w)?.chatId?.pubKey, 'Werk runs at boot').toBe(accepted.issuer);
    await trustForGrant(again, view.pubKey);
    const res = await actAsConnection(again, {
      callerPubKey: view.pubKey, opId: 'params.set-param', args: { key: 'display.theme', value: 'dark' }, addressedTo: accepted.issuer,
      token: accepted.tokens[0]?.toJSON?.() ?? accepted.tokens[0],
    });
    expect(res.ok, JSON.stringify(res)).toBe(true);
    await again.dispose?.();
  }, 120_000);
});
