/**
 * A short follow-up after a read ("en nu?", "wat staat er nog op") is about what was just read (a household's log,
 * 2026-10: once right, once "I didn't do that"). The thread's memory carries the last turns; on top of that, the LAST
 * READ — the list's title and its lines, capped — is part of what the model sees for the ONE turn after it, below the
 * turn marker. A turn later it is gone (it is not a second memory). Composed as the box composes a household bot (the real
 * agent over the household store, the slim catalogue, the door, the person's thread), with the stand-in model.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { InMemoryBridge } from '@onderling/chat-agent';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { ensureHouseholdLists, householdBotApps, templateLists, expandAdds } from '../../src/v2/householdTemplate.js';
import { botPromptLines } from '../../src/v2/botPrompt.js';
import { botOpLevel, botRoleAllows } from '../../src/v2/botOpMap.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../../src/v2/householdBotStore.js';
import { createDoorCatalogue } from '../../src/telegram/assistantCatalogue.js';
import { createTelegramRunner } from '../../src/telegram/runner.js';
import { listsGateRules } from '../../src/v2/circleGate.js';
import { initLocalisation, t } from '../../src/localisation.js';
import { withAssistantOps } from '../../src/v2/assistantOps.js';
import { interpretToCommand, TURN_MARKER } from '../../src/v2/interpretCommand.js';
import { createBotThreads, memoryThreadStore } from '../../src/v2/botThreads.js';
import { EventLog } from '../../src/eventLog.js';
import { testModelProviders } from '../../src/v2/testModel.js';

describe('a follow-up after a read', () => {
  let dir; let agent; let bridge; let runner; let threads;
  const model = { script: [{ when: 'en nu', replyText: 'Wat wil je ermee?' }, { when: 'nog iets', replyText: 'Zeg het maar.' }, { when: 'en verder', replyText: 'Zeg het maar.' }, { when: 'hm', replyText: 'Ja?' }] };

  beforeAll(async () => {
    await initLocalisation({ lng: 'nl' });
    dir = await mkdtemp(path.join(tmpdir(), 'follow-up-read-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    await ensureHouseholdLists({ callSkill: (a, o, x) => agent.callSkill(a, o, x), t });
    await agent.callSkill('stoop', 'addContact', { webid: 'telegram:1', channel: 'telegram', role: 'member', displayName: 'Ann' });
    await agent.setDoorCaller('telegram:1', 'member');
    const catalogue = createDoorCatalogue({ householdManifest: agent.manifest, slim: true, getApps: () => householdBotApps() });
    threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const doorCall = withAssistantOps({ callSkill: (a, o, x, ctx) => agent.callSkill(a, o, x, ctx), t, refusal: agent.doorRefusal, threads, admin: { users: async () => [] } });
    bridge = new InMemoryBridge({ id: 'telegram' });
    runner = createTelegramRunner({
      bridge, catalogue: catalogue.catalogue, manifestsByOrigin: catalogue.manifestsByOrigin, t, lang: 'nl', callSkill: doorCall, collectMs: 0, threads,
      llm: testModelProviders(model).local, interpret: interpretToCommand, promptLines: botPromptLines(t), expand: expandAdds({ t }), gateRules: listsGateRules('nl', templateLists(t)),
      admit: async ({ uid }) => `telegram:${uid}`,
    });
    await runner.start();
  }, 120_000);

  afterAll(async () => {
    await agent?.stop?.().catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const say = async (text) => {
    bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId: '1', text, sender: { bridgeUid: '1', displayName: null } });
    await runner.idle('1');
    return bridge.outbox.map((m) => m.text);
  };
  /** What the model saw below the turn marker on its latest call (this turn's part of the prompt). */
  const thisTurn = () => String(model.requests.at(-1)?.system ?? '').split(TURN_MARKER)[1] ?? '';

  it('the list just read is in what the model sees the next turn — its title and its lines', async () => {
    await say('/help');   // the welcome, out of the way
    await say('zet melk, kaas en eieren op de boodschappen');
    const read = await say('wat staat er op de boodschappen');
    expect(read.join('\n')).toMatch(/melk/);
    await say('en nu?');
    const seen = thisTurn();
    expect(seen).toMatch(/Boodschappen/);
    for (const w of ['melk', 'kaas', 'eieren']) expect(seen).toContain(w);
  }, 60_000);

  it('one turn only: the turn after, it is gone', async () => {
    await say('nog iets');
    expect(thisTurn()).not.toMatch(/eieren/);
  }, 60_000);

  it('bounded: a long list is cut to its first lines, within its size', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `ding${String(i + 1).padStart(2, '0')}`);
    for (const x of many) await say(`zet ${x} op de boodschappen`);
    await say('wat staat er op de boodschappen');
    await say('en verder?');
    const seen = thisTurn();
    expect(seen).toContain('ding01');
    expect(seen).not.toContain('ding30');
    const block = seen.slice(seen.indexOf('Boodschappen'));
    expect(block.split('\n').filter((l) => /ding\d\d/.test(l)).length).toBeLessThanOrEqual(12);
  }, 120_000);

  it('a person who keeps no memory (/geheugen off) is kept nothing: not the last read either', async () => {
    await say('/geheugen off');
    await say('wat staat er op de boodschappen');
    await say('hm');
    expect(thisTurn()).not.toMatch(/eieren/);
    await say('/geheugen short');
  }, 60_000);
});
