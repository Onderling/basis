/**
 * The household bot's door gate decides on the op the call actually REACHES: its app and its op (`app.op`), never the
 * op's bare id. The catalogue keeping household's `listOpen` off a person's menu is a convention — a different client
 * names `household.listOpen` anyway — so the gate is where it binds. The map's columns name each op with its app; a
 * bare id two apps declare is ambiguous and refused, never resolved to one of them.
 *
 * Composed as the box composes a household bot: the real agent with the bot's map and role rule, and the door's own
 * call (`withAssistantOps`) handed the agent's gate.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists, householdBotApps } from '../src/v2/householdTemplate.js';
import { BOT_OP_MAP, BOT_OP_MAP_UNRESOLVED, botOpLevel, botRoleAllows, botOffers, scopeCatalogueToRole } from '../src/v2/botOpMap.js';
import { STANDARD_ROLE_TABLE } from '@onderling-app/tasks';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';
import { createDoorCatalogue } from '../src/telegram/assistantCatalogue.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { allManifests, catalogueManifests, DOOR_MANIFESTS } from '../src/v2/manifestSources.js';
import { householdManifest } from '../../household/manifest.js';
import { isGenericOpId, decodeGenericOpId } from '@onderling/app-manifest';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, p) => NAMES[k] ?? (p ? `${k} ${JSON.stringify(p)}` : k);
const PEOPLE = { member: 'telegram:111', coordinator: 'telegram:222', observer: 'telegram:333', admin: 'telegram:999' };

/** Which apps declare an op id, over every manifest the app runs. */
// a generic op ("declare a noun → get CRUD free") is declared by its app's noun carrying that atom
const declaresGeneric = (m, id) => { const g = isGenericOpId(id) ? decodeGenericOpId(id) : null; return Boolean(g && g.app === m.app && (m.nouns?.[g.noun]?.atoms ?? []).includes(g.atom)); };
const declarers = (id) => allManifests().filter((m) => (m.operations ?? []).some((o) => o.id === id) || declaresGeneric(m, id)).map((m) => m.app);
const assistantLevel = (id) => DOOR_MANIFESTS[0].operations.find((o) => o.id === id)?.visibility ?? 'authenticated';
const visibilityOf = (qualified) => (qualified.startsWith('assistant.') ? assistantLevel(qualified.slice('assistant.'.length)) : undefined);

describe('the columns name each op with its app', () => {
  it('every column entry is `app.op`, and that app declares that op — no entry left unresolved', () => {
    expect(BOT_OP_MAP_UNRESOLVED).toEqual([]);
    for (const [column, ids] of Object.entries(BOT_OP_MAP)) {
      for (const q of ids) {
        const [app, op, ...rest] = q.split('.');
        expect(rest, `${column}: ${q}`).toEqual([]);
        const m = allManifests().find((x) => x.app === app);
        expect(Boolean(m?.operations?.some((o) => o.id === op) || declaresGeneric(m, op)), `${column}: ${q} is declared by ${app}`).toBe(true);
      }
    }
    // the chores' open read is on the member's column — as the tasks app's, never household's or stoop's
    expect(BOT_OP_MAP.member).toContain('tasks.listOpen');
    expect(BOT_OP_MAP.member).not.toContain('household.listOpen');
  });
});

describe('the door gate decides on the qualified op', () => {
  let dir; let agent; let door;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'door-gate-qualified-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
      chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') },
      seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    // something for household's own read to return, were it reached
    await own('household', 'addItem', { type: 'shopping', text: 'geheim' }).catch(() => {});
    for (const [role, webid] of Object.entries(PEOPLE)) {
      await own('stoop', 'addContact', { webid, channel: 'telegram', role, displayName: role });
      await agent.setDoorCaller(webid, role);
    }
    door = withAssistantOps({
      callSkill: (a, o, x, ctx) => agent.callSkill(a, o, x, ctx), t, refusal: agent.doorRefusal, threads: { langOf: () => null },
      admin: { users: async () => [] },
    });
  }, 120_000);
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('a door call naming household\'s `listOpen` is refused for a member and an observer — so is every household op', async () => {
    for (const role of ['member', 'observer']) {
      const caller = PEOPLE[role];
      const r = await door('household', 'listOpen', {}, { caller, threadId: caller });
      expect(r?.refusal, `${role}: household.listOpen → ${JSON.stringify(r)}`).toMatchObject({ layer: 'door-map' });
      for (const op of householdManifest.operations.map((o) => o.id)) {
        expect(await agent.doorRefusal(`household.${op}`, caller), `${role}: household.${op}`).toBeTruthy();
      }
    }
  });

  it('every op the catalogue hides from a role is refused to that role at the gate', async () => {
    const catalogue = createDoorCatalogue({ householdManifest: agent.manifest, slim: true, getApps: () => householdBotApps() }).catalogue();
    const every = [...catalogueManifests(), ...DOOR_MANIFESTS].flatMap((m) => (m.operations ?? []).map((o) => `${m.app}.${o.id}`));
    for (const role of ['member', 'observer', 'coordinator']) {
      const offered = new Set([...scopeCatalogueToRole(catalogue, role).opsById.values()].map((e) => `${e.appOrigin}.${e.op.id}`));
      // what the role's column holds but the catalogue paints elsewhere (slash-only, the runner's) is still the role's
      const column = new Set([...BOT_OP_MAP.member, ...(role === 'observer' ? BOT_OP_MAP.observer : [])]);
      const hidden = every.filter((q) => !offered.has(q) && !column.has(q) && !q.startsWith('assistant.'));
      expect(hidden.length).toBeGreaterThan(10);
      for (const q of hidden) {
        if (role === 'coordinator' && botRoleAllows('coordinator', q)) continue;
        // the call as a door makes it — its app and its op — reaching the host's waist
        const [app, op] = q.split('.');
        const r = await agent.callSkill(app, op, {}, { caller: PEOPLE[role] }).catch((e) => ({ threw: String(e?.message ?? e) }));
        expect(r?.refusal, `${role}: ${q} → ${JSON.stringify(r).slice(0, 200)}`).toBeTruthy();
      }
    }
    // the stoop app's own `listOpen` too: one name, three apps, one of them the bot's
    expect((await agent.callSkill('stoop', 'listOpen', {}, { caller: PEOPLE.member }))?.refusal).toMatchObject({ layer: 'door-map' });
  });

  it('a bare id two apps declare is refused as ambiguous, not resolved to one of them', async () => {
    expect(declarers('listOpen').length).toBeGreaterThan(1);
    expect(botOpLevel('listOpen')).toBeNull();
    expect(botRoleAllows('member', 'listOpen')).toBe(false);
    for (const role of ['member', 'observer', 'admin']) {
      expect(await agent.doorRefusal('listOpen', PEOPLE[role]), role).toMatchObject({ layer: 'door-map' });
    }
    // a bare id ONE app declares is that app's op
    expect(declarers('addToList')).toEqual(['lists']);
    expect(await agent.doorRefusal('addToList', PEOPLE.member)).toBeNull();
  });

  it('every op on a role\'s column still passes for that role', async () => {
    const coordinatorExtra = [
      ...(STANDARD_ROLE_TABLE.coordinator?.reassign ? ['tasks.reassignTask'] : []),
      ...(STANDARD_ROLE_TABLE.coordinator?.editBody === 'any' ? ['tasks.editTask'] : []),
      ...(STANDARD_ROLE_TABLE.coordinator?.remove ? ['tasks.removeTask'] : []),
    ];
    const columns = {
      member: BOT_OP_MAP.member,
      observer: BOT_OP_MAP.observer,
      coordinator: [...BOT_OP_MAP.member, ...coordinatorExtra],
      admin: [...BOT_OP_MAP.member, ...BOT_OP_MAP.admin],
    };
    for (const [role, ops] of Object.entries(columns)) {
      for (const q of ops) expect(await agent.doorRefusal(q, PEOPLE[role], visibilityOf(q)), `${role}: ${q}`).toBeNull();
    }
    // …and through the door's own call: the chores' open read and an add, as a member
    const open = await door('tasks', 'listOpen', {}, { caller: PEOPLE.member, threadId: PEOPLE.member });
    expect(open?.refusal, JSON.stringify(open)).toBeUndefined();
    const add = await door('lists', 'addToList', { list: 'Boodschappen', text: 'melk' }, { caller: PEOPLE.member, threadId: PEOPLE.member });
    expect(add?.ok, JSON.stringify(add)).not.toBe(false);
  });

  it('the catalogue and the gate read one rule: an op offered is an op the gate passes', () => {
    for (const m of [...catalogueManifests(), ...DOOR_MANIFESTS]) {
      if (m.app === 'assistant') continue;
      for (const op of m.operations ?? []) {
        if (botOffers(m.app, op, 'member')) expect(botOpLevel(`${m.app}.${op.id}`), `${m.app}.${op.id}`).not.toBeNull();
      }
    }
    expect(botOffers('household', { id: 'listOpen' }, null)).toBe(false);
    expect(botOffers('tasks', { id: 'listOpen' }, null)).toBe(true);
  });
});
