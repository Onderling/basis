/**
 * Household and folio are a manifest and cores registered on the HOST agent, not agents of their own: no key, no
 * vault, no layer each. So the household's wired ops and folio's ops are host skills, the in-process agents are the
 * host, tasks and pinboard only, and a folder share is signed by the host key (the one token issuer).
 */
import { describe, it, expect } from 'vitest';
import { createRealHouseholdAgent } from '../../src/web/realAgent.js';

describe('household and folio fold onto the host', () => {
  it('their ops are host skills, and a folder share is signed by the host key', { timeout: 120_000 }, async () => {
    const agent = await createRealHouseholdAgent({ seedHousehold: false });
    const ids = agent.inProcessSkillIds();
    expect(Object.keys(ids).sort()).toEqual(['host', 'pinboard', 'tasks']);
    for (const op of ['addItem', 'markComplete', 'removeItem', 'listOpenItems',
      'listFiles', 'readNote', 'shareFolder', 'searchFiles', 'folio_briefSummary']) {
      expect(ids.host, `${op} is not a host skill`).toContain(op);
    }
    const shared = await agent.callSkill('folio', 'shareFolder', { folder: 'notes', with: 'https://anne.example/profile/card#me' });
    expect(shared?.ok, shared?.error).toBe(true);
    expect(shared.share.issuer).toBe(agent.inProcessPubKeys().host);
    // ...and a household write still lands and reads back through the host
    await agent.callSkill('household', 'addItem', { type: 'shopping', text: 'melk' });
    const open = await agent.callSkill('household', 'listOpenItems', { type: 'shopping' });
    expect(JSON.stringify(open)).toContain('melk');
  });
});
