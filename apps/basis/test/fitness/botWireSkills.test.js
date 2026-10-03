/**
 * FITNESS: which kernel skills another agent's task request reaches on a household bot, over the wire. Composed as the
 * box composes a bot (`acceptPeerSkillCalls`, the door exposed to screens with `exposeDoorToScreens`), the route takes
 * only skills that demand a token, and those are exactly the door's mapped ops — every role's column, nothing else.
 * A new skill that demands a token (a kernel default, an app's op) turns this red until someone decides it belongs.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { botOpLevel, botRoleAllows } from '../../src/v2/botOpMap.js';
import { composeAssistantCatalogue } from '../../src/telegram/assistantCatalogue.js';
import { withAssistantOps } from '../../src/v2/assistantOps.js';
import { createBotUsers, contactBookStore } from '../../src/v2/botUsers.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';
import { EventLog } from '../../src/eventLog.js';
import { exposeDoorToScreens, screenColumnFor } from '../../src/v2/screenActing.js';

import { HOUSEHOLD_BOT_STORE_OPTS } from '../../src/v2/householdBotStore.js';
const t = (k) => k;

describe('FITNESS: the kernel skills the wire reaches on a bot', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('exactly the door\'s mapped ops (every role\'s column); nothing the kernel or the shell registers besides', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-wire-skills-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false, t,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, trustOwnGrants: true, acceptPeerSkillCalls: true,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    const { catalogue, manifestsByOrigin } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], householdManifest: agent.manifest, slim: true });
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    const doorCall = withAssistantOps({ callSkill: (a, o, x, ctx) => agent.callSkill(a, o, x, ctx), threads, t, refusal: agent.doorRefusal, admin: {} });
    exposeDoorToScreens({ agent, catalogue, manifests: Object.values(manifestsByOrigin), doorCall, users: createBotUsers({ store: contactBookStore(own) }) });

    const reached = agent.sa.peer.callableSkills();
    const mapped = [...new Set(['admin', 'member', 'observer'].flatMap((r) => screenColumnFor(catalogue, r)))].sort();
    expect(reached.length, 'the door exposes its ops').toBeGreaterThan(5);
    expect(reached).toEqual(mapped);
    expect(reached).not.toContain('reachable-peers');
  }, 120_000);
});
