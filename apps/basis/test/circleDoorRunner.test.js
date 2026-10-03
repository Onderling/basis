/**
 * The circle door with the real runner and the real bot agent (no model): a member's line naming the bot acts in THAT
 * circle's lists, as that member; the door's own ops do not exist there (`/users`, `/herinneringen` are unknown); the
 * circle's admin reaches the admin column of the circle's lists (`/list-delete` asks), a member does not; the
 * household's lists are untouched; the replies go onto the circle.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';
import { botOpLevel, botRoleAllows } from '../src/v2/botOpMap.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';
import { createDoorCatalogue } from '../src/telegram/assistantCatalogue.js';
import { householdBotApps } from '../src/v2/householdTemplate.js';
import { createCircleDoors } from '../src/v2/circleDoor.js';
import { composeCircleRunner } from '../src/telegram/circleRunner.js';
import { initLocalisation, t } from '../src/localisation.js';

const CIRCLE = 'joined-circle-r';

describe('the circle door, with the real runner', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('acts in the circle as its member; no door ops; the circle admin\'s column; the household untouched', async () => {
    await initLocalisation({ lng: 'nl' });
    dir = await mkdtemp(path.join(tmpdir(), 'circle-door-runner-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    await own('lists', 'createList', { text: 'Kringlijst', circleId: CIRCLE });
    const householdBefore = JSON.stringify(await agent.householdItems());
    const catalogue = createDoorCatalogue({ householdManifest: agent.manifest, slim: true, getApps: () => householdBotApps(), withoutDoorOps: true });
    const posted = [];
    const roster = [{ webid: 'ann', role: 'member', handle: 'ann' }, { webid: 'zoe', role: 'admin', handle: 'zoe' }];
    const doors = createCircleDoors({
      roster: async () => roster, botRef: () => 'BOT', botHandle: () => 'huisbot-van-frits',
      setDoorCaller: (id, role) => agent.setDoorCaller(id, role),
      post: async (circleId, text) => { posted.push({ circleId, text }); },
      makeRunner: ({ circleId, bridge, roleOf }) => composeCircleRunner({ circleId, bridge, roleOf, agentCall: (a, o, x, ctx) => agent.callSkill(a, o, x, ctx), catalogue, t, lang: 'nl' }),
      perMinute: 100,
    });
    let n = 0;
    const say = async (who, text) => {
      const from = posted.length;
      await doors.landed({ circleId: CIRCLE, msgId: `m${n += 1}`, authorRef: who, text });
      await doors.idle();
      return posted.slice(from).map((p) => p.text).join('\n');
    };

    await say('ann', '@huisbot /add-to-list --list Kringlijst --text kaas');
    expect(JSON.stringify(await own('lists', 'listEntries', { list: 'Kringlijst', circleId: CIRCLE }))).toContain('kaas');
    const words = await say('ann', '@huisbot zet melk op de kringlijst');
    expect(JSON.stringify(await own('lists', 'listEntries', { list: 'Kringlijst', circleId: CIRCLE })), words).toContain('melk');

    const users = await say('ann', '@huisbot /users');
    expect(users).not.toMatch(/Bert|beheerder|admin —/);
    const reminders = await say('ann', '@huisbot /herinneringen aan');
    expect(reminders).not.toMatch(/herinneringen staan (nu )?aan/i);

    // a member: refused at the preview, nothing asked (the act would be refused too)
    const memberDelete = await say('ann', '@huisbot /list-delete Kringlijst');
    expect(memberDelete).not.toMatch(/bevestig/i);
    expect(JSON.stringify(await own('lists', 'listLists', { circleId: CIRCLE }))).toContain('Kringlijst');
    // the circle's admin: asked, with what goes — and in a circle (no buttons) the yes is a word
    const adminDelete = await say('zoe', '@huisbot /list-delete Kringlijst');
    expect(adminDelete).toMatch(/2 regels/);
    expect(adminDelete).toMatch(/ja of nee/i);
    await say('zoe', '@huisbot ja');
    expect(JSON.stringify(await own('lists', 'listLists', { circleId: CIRCLE }))).not.toContain('Kringlijst');

    expect(posted.every((p) => p.circleId === CIRCLE)).toBe(true);
    expect(JSON.stringify(await agent.householdItems())).toBe(householdBefore);
    console.log('REPLIES', JSON.stringify({ words, users, reminders, memberDelete, adminDelete }));
  }, 120_000);
});
