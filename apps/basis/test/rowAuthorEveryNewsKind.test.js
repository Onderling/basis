/**
 * Every kind that is NEWS in a circle (the landing vocabulary: an appointment, a chore, a note, an ask, an offer, a
 * lend) is written by its real writer with a NAMED maker: the circle's self, or the door person a call is for. Never the
 * local 'me' (a receiver reads that as nobody: no author, no news) and never "whoever served the snapshot".
 *
 * Dropping the snapshot-author fallback (itemLanding) is only safe if no writer still stamps 'me' into a circle: this
 * boots the household bot as the box does and makes one of each through the waist, then reads the circle's store.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';
import { HOUSEHOLD_BOT_STORE_OPTS, householdCircleIdFor } from '../src/v2/householdBotStore.js';
import { landingKindOf, itemAuthor } from '../src/v2/itemLanding.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k) => NAMES[k] ?? k;

describe('every news kind in a circle names its maker', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('an appointment, a chore for me with a day, a note, a task and the noticeboard posts: none says "me"', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'row-author-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS,
    });
    const call = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: call, t });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const circleId = householdCircleIdFor(agent.identity?.chat?.pubKey ?? agent.circleSelf?.(null)?.webid);
    const said = [
      await call('calendar', 'addEvent', { title: 'tandarts', when: `${tomorrow}T10:00:00.000Z`, duration: '30m' }),
      await call('lists', 'addToList', { list: 'Klusjes', text: 'ramen lappen', assignee: 'mij', due: tomorrow }),
      await call('tasks', 'addTask', { text: 'vuilnis buiten' }),
      await call('household', encodeGenericOpId('household', 'add', 'note'), { body: 'de sleutel ligt onder de mat' }),
      // a circle-scoped post names its circle as `groupId` (what a shell injects for the open circle)
      ...await Promise.all(['ask', 'offer', 'lend'].map((intent) => call('pinboard', 'postRequest', { intent, text: `${intent}: een boormachine`, groupId: circleId }))),
    ];
    for (const r of said) expect(r?.ok, JSON.stringify(r)).not.toBe(false);

    const rows = (await agent.circleStoreFor(circleId).list()) ?? [];
    const news = rows.filter((r) => landingKindOf(r));
    const kinds = new Set(news.map((r) => landingKindOf(r)));
    for (const k of ['calendar-event', 'task', 'note', 'ask', 'offer', 'lend']) expect([...kinds], `a ${k} was written here`).toContain(k);
    for (const r of rows) {
      expect(r.createdBy, `${r.type} ${r.text ?? r.title ?? ''} createdBy`).not.toBe('me');
      expect(r.updatedBy, `${r.type} ${r.text ?? r.title ?? ''} updatedBy`).not.toBe('me');
      for (const a of [r.assignee, ...(Array.isArray(r.assignees) ? r.assignees : [])].filter(Boolean)) expect(a, `${r.type} holder`).not.toBe('me');
    }
    for (const r of news) expect(itemAuthor(r), `${landingKindOf(r)} has an author`).toBeTruthy();
  }, 90_000);
});
