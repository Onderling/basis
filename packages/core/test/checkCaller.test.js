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
