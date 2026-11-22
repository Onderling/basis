/**
 * A toolbox's page is bound to ITS toolbox (ledger L1049, built with the screen client): the pairing offer names the toolbox, the
 * grant records it on the grants lane, the screen's acting ctx carries it, and `tools.useTool` from that screen runs
 * only for that toolbox. A screen with no toolbox never holds useTool (botScreens.test.js pins the column).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory, VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { encodePairingOffer, parsePairingOffer } from '../../src/v2/connectionPairing.js';
import { screenActsAs, screenToolboxRefusal } from '../../src/v2/screenActing.js';

describe('the pairing offer names its toolbox', () => {
  it('round-trips; an offer with none has none', () => {
    const uri = encodePairingOffer({ viewPubKey: 'K', nonce: 'n', label: 'pagina', toolbox: 'boodschappen' });
    expect(parsePairingOffer(uri)).toMatchObject({ ok: true, viewPubKey: 'K', nonce: 'n', label: 'pagina', toolbox: 'boodschappen' });
    expect(parsePairingOffer(encodePairingOffer({ viewPubKey: 'K', nonce: 'n' })).toolbox).toBeNull();
  });
});

describe('a screen\'s useTool runs only for the grant\'s own toolbox', () => {
  it('A\'s page calling B is refused with a code; its own toolbox passes; a chat door is not a screen', () => {
    const screenA = { via: 'screen', toolbox: 'boodschappen' };
    expect(screenToolboxRefusal(screenA, { toolbox: 'recepten' })).toMatchObject({ ok: false, code: 'toolbox-not-yours' });
    expect(screenToolboxRefusal(screenA, { toolbox: 'boodschappen' })).toBeNull();
    expect(screenToolboxRefusal({ via: 'screen', toolbox: null }, { toolbox: 'boodschappen' })).toMatchObject({ ok: false, code: 'toolbox-not-yours' });
    expect(screenToolboxRefusal({ caller: 'telegram:1' }, { toolbox: 'recepten' })).toBeNull();
  });
});

describe('the grant records the toolbox, and the acting ctx carries it', () => {
  let agent; let dir;
  afterAll(async () => { await agent?.shutdown?.(); if (dir) await rm(dir, { recursive: true, force: true }); });
  it('grantSurface with a toolbox: the entry, the listing and the ctx say which', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-screen-toolbox-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    const view = await AgentIdentity.generate(new VaultMemory());
    const g = await own('household', 'grantSurface', { viewPubKey: view.pubKey, ops: ['tools.useTool'], actingAs: 'telegram:1', label: 'pagina', toolbox: 'boodschappen' });
    expect(g.ok ?? true, JSON.stringify(g)).not.toBe(false);
    const entry = await agent.surfaceTokenEntry(g.tokens[0].id);
    expect(entry).toMatchObject({ actingAs: 'telegram:1', toolbox: 'boodschappen' });
    expect(((await own('household', 'listSurfaceGrants', {}))?.surfaces ?? []).find((s) => s.viewPubKey === view.pubKey)).toMatchObject({ toolbox: 'boodschappen' });
    const users = { list: async () => [{ id: 'telegram:1' }] };
    const ctx = await screenActsAs(users, { activeEntry: (id) => agent.surfaceTokenEntry(id) })({ envelope: { payload: { _token: { id: g.tokens[0].id, subject: view.pubKey, constraints: { actingAs: 'telegram:1' } } } } });
    expect(ctx).toMatchObject({ via: 'screen', caller: 'telegram:1', toolbox: 'boodschappen' });
  }, 60_000);
});
