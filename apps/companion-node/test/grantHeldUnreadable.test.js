/**
 * A grant's record (which tokens an agent holds here) that is there but cannot be read must not turn a revoke into a
 * no-op: read as "holds nothing", the revoke deleted the record and left every token live. Unreadable = revoke every
 * token this node issued to that agent (fail closed).
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, TokenRegistry } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNodeGrants } from '../src/grants.js';

async function setup() {
  const identity = await AgentIdentity.generate(new VaultMemory());
  const bot = await AgentIdentity.generate(new VaultMemory());
  const other = await AgentIdentity.generate(new VaultMemory());
  const vault = new VaultMemory();
  const tokenRegistry = new TokenRegistry(new VaultMemory());
  // delivery is not under test: an agent that cannot be reached
  const agent = { hello: async () => { throw new Error('away'); }, transportFor: async () => { throw new Error('away'); } };
  const grants = createNodeGrants({ identity, agent, tokenRegistry, vault });
  return { grants, vault, tokenRegistry, bot: bot.pubKey, other: other.pubKey };
}

describe('a grant record that cannot be read', () => {
  it('revoke still revokes every token issued to that agent, and only to that agent', async () => {
    const { grants, vault, tokenRegistry, bot, other } = await setup();
    const minted = await grants.mint({ to: bot, families: ['agenda-files'] });
    expect(minted.ok).toBe(true);
    await grants.mint({ to: other, families: ['agenda-files'] });
    const held = JSON.parse(await vault.get(`grant-held:${bot}`)).ids;
    const otherHeld = JSON.parse(await vault.get(`grant-held:${other}`)).ids;
    expect(held.length).toBe(2);

    await vault.set(`grant-held:${bot}`, '{"ids": ["trunc');   // damaged, or written by a newer build
    expect((await grants.list()).find((g) => g.to === bot)).toEqual({ to: bot, families: [], unreadable: true });
    const r = await grants.revoke({ to: bot });
    expect(r).toMatchObject({ ok: true, revoked: 2 });
    for (const id of held) expect(await tokenRegistry.isRevoked(id)).toBe(true);
    for (const id of otherHeld) expect(await tokenRegistry.isRevoked(id)).toBe(false);
  });

  it('a new grant over an unreadable record ends the old tokens too', async () => {
    const { grants, vault, tokenRegistry, bot } = await setup();
    await grants.mint({ to: bot, families: ['agenda-files'] });
    const old = JSON.parse(await vault.get(`grant-held:${bot}`)).ids;
    await vault.set(`grant-held:${bot}`, 'not json');
    await grants.mint({ to: bot, families: ['agenda-files'] });
    for (const id of old) expect(await tokenRegistry.isRevoked(id)).toBe(true);
    const fresh = JSON.parse(await vault.get(`grant-held:${bot}`)).ids;
    for (const id of fresh) expect(await tokenRegistry.isRevoked(id)).toBe(false);
  });
});
