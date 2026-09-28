/**
 * checkCaller — the tier-vs-visibility check on its own, for ONE caller identity: the half of `checkInbound` that a
 * door's in-process call needs too. A peer arriving over a transport and a person at a door are both callers; the
 * same visibility vocabulary decides both.
 *
 * The one difference is what an UNKNOWN caller is. The registry's default for a peer is `authenticated` (a known key
 * reached us); for a door — a Telegram chat, say — a caller with no record is a stranger, `public`. So the caller of
 * `checkCaller` says which default applies (`unknownAs`), and `checkInbound` keeps passing the peer default.
 */
import { describe, it, expect } from 'vitest';
import { TrustRegistry } from '../src/permissions/TrustRegistry.js';
import { PolicyEngine, PolicyDeniedError } from '../src/permissions/PolicyEngine.js';
import { SkillRegistry } from '../src/skills/SkillRegistry.js';
import { defineSkill } from '../src/skills/defineSkill.js';
import { VaultMemory } from '@onderling/vault';

function setup() {
  const trustRegistry = new TrustRegistry(new VaultMemory());
  const skills = new SkillRegistry();
  skills.register(defineSkill('open', async () => 'ok', { visibility: 'public' }));
  skills.register(defineSkill('member', async () => 'ok', { visibility: 'authenticated' }));
  skills.register(defineSkill('admin', async () => 'ok', { visibility: 'trusted' }));
  skills.register(defineSkill('root', async () => 'ok', { visibility: 'private' }));
  const engine = new PolicyEngine({ trustRegistry, skillRegistry: skills });
  return { engine, trustRegistry };
}

describe('checkCaller', () => {
  it('a known caller reaches what its tier reaches, and no further', async () => {
    const { engine, trustRegistry } = setup();
    await trustRegistry.setTier('telegram:111', 'trusted');
    await expect(engine.checkCaller({ callerId: 'telegram:111', skillId: 'admin' })).resolves.toMatchObject({ tier: 'trusted' });
    await expect(engine.checkCaller({ callerId: 'telegram:111', skillId: 'root' })).rejects.toThrow(PolicyDeniedError);
  });

  it('a door caller with no record is a stranger: public', async () => {
    const { engine } = setup();
    await expect(engine.checkCaller({ callerId: 'telegram:999', skillId: 'open', unknownAs: 'public' })).resolves.toMatchObject({ tier: 'public' });
    await expect(engine.checkCaller({ callerId: 'telegram:999', skillId: 'member', unknownAs: 'public' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_TIER' });
  });

  it('a peer with no record keeps the registry default, authenticated — checkInbound is unchanged', async () => {
    const { engine } = setup();
    await expect(engine.checkCaller({ callerId: 'somePeerKey', skillId: 'member' })).resolves.toMatchObject({ tier: 'authenticated' });
    await expect(engine.checkInbound({ peerPubKey: 'somePeerKey', skillId: 'member' })).resolves.toMatchObject({ allowed: true });
    await expect(engine.checkInbound({ peerPubKey: 'somePeerKey', skillId: 'admin' })).rejects.toMatchObject({ code: 'INSUFFICIENT_TIER' });
  });

  it('an unknown or disabled skill is refused the same way checkInbound refuses it', async () => {
    const { engine } = setup();
    await expect(engine.checkCaller({ callerId: 'x', skillId: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('the registry tells a known record from an unknown one', async () => {
    const { trustRegistry } = setup();
    expect(await trustRegistry.has('telegram:111')).toBe(false);
    await trustRegistry.setTier('telegram:111', 'authenticated');
    expect(await trustRegistry.has('telegram:111')).toBe(true);
  });
});

describe('private is self only — never granted', () => {
  function engineWith({ agentPubKey = 'hostKey', selfIds } = {}) {
    const trustRegistry = new TrustRegistry(new VaultMemory());
    const skills = new SkillRegistry();
    skills.register(defineSkill('root', async () => 'ok', { visibility: 'private' }));
    skills.register(defineSkill('admin', async () => 'ok', { visibility: 'trusted' }));
    return { engine: new PolicyEngine({ trustRegistry, skillRegistry: skills, agentPubKey, ...(selfIds ? { selfIds } : {}) }), trustRegistry };
  }

  it('a caller registered private who is not the agent is refused on a private skill', async () => {
    const { engine, trustRegistry } = engineWith();
    await trustRegistry.setTier('telegram:111', 'private');
    await expect(engine.checkCaller({ callerId: 'telegram:111', skillId: 'root' })).rejects.toMatchObject({ code: 'NOT_SELF' });
    await expect(engine.checkInbound({ peerPubKey: 'telegram:111', skillId: 'root' })).rejects.toMatchObject({ code: 'NOT_SELF' });
  });

  it('the agent itself reaches its private skills', async () => {
    const { engine, trustRegistry } = engineWith();
    await trustRegistry.setTier('hostKey', 'private');
    await expect(engine.checkCaller({ callerId: 'hostKey', skillId: 'root' })).resolves.toMatchObject({ tier: 'private' });
  });

  it('an owner key the host names as self at construction reaches them too (the in-process chat agent)', async () => {
    const { engine, trustRegistry } = engineWith({ selfIds: ['ownerChatKey'] });
    await trustRegistry.setTier('ownerChatKey', 'private');
    await expect(engine.checkCaller({ callerId: 'ownerChatKey', skillId: 'root' })).resolves.toMatchObject({ tier: 'private' });
  });

  it('self is not a tier: a self id with no private record still needs its tier (no shortcut past the registry)', async () => {
    const { engine } = engineWith({ selfIds: ['ownerChatKey'] });
    await expect(engine.checkCaller({ callerId: 'ownerChatKey', skillId: 'root' })).rejects.toMatchObject({ code: 'INSUFFICIENT_TIER' });
  });

  it('a private-registered stranger still reaches what trusted reaches (the rule narrows private, nothing else)', async () => {
    const { engine, trustRegistry } = engineWith();
    await trustRegistry.setTier('telegram:111', 'private');
    await expect(engine.checkCaller({ callerId: 'telegram:111', skillId: 'admin' })).resolves.toBeTruthy();
  });
});
