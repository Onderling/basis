/**
 * What a person reads after the household bot acted: one worded line per op family, the same for the deterministic
 * gate and the model route. Composed as the box composes a household bot (the real agent over the household store, the
 * slim catalogue, the door's call, the template's word rules and its add expansion, the real runner), in Dutch.
 *
 * Before: three adds were three lines ("\"melk\" toegevoegd aan Boodschappen." each), a claim was "✓ Opgepakt: …",
 * a completed chore "✓ Klaar: …", a chore with a person and a day never said the day, an appointment's day was
 * "2026-10-09 10:00".
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { InMemoryBridge } from '@onderling/chat-agent';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import { ensureHouseholdLists, householdBotApps, templateLists, expandAdds, botPromptLines } from '../../src/v2/householdTemplate.js';
import { botOpLevel, botRoleAllows } from '../../src/v2/botOpMap.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../../src/v2/householdBotStore.js';
import { createDoorCatalogue } from '../../src/telegram/assistantCatalogue.js';
import { createTelegramRunner } from '../../src/telegram/runner.js';
import { listsGateRules } from '../../src/v2/circleGate.js';
import { initLocalisation, t } from '../../src/localisation.js';
import { withAssistantOps } from '../../src/v2/assistantOps.js';
import { interpretToCommand } from '../../src/v2/interpretCommand.js';

/** A day as the household reads it: "vr 9 okt" (and its time, for an appointment). */
const dayWords = (d) => new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('the household bot says one line per op family', () => {
  let dir; let agent; let bridge; let runner;
  /** The model's answers: a line holding the words → these tool calls. */
  const script = new Map();

  beforeAll(async () => {
    await initLocalisation({ lng: 'nl' });
    dir = await mkdtemp(path.join(tmpdir(), 'bot-reply-lines-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    await ensureHouseholdLists({ callSkill: (a, o, x) => agent.callSkill(a, o, x), t });
    // one of the household's people, whom a chore can be given to by name
    await agent.callSkill('stoop', 'addContact', { webid: 'telegram:77', channel: 'telegram', role: 'member', displayName: 'Bob' });
    const catalogue = createDoorCatalogue({ householdManifest: agent.manifest, slim: true, getApps: () => householdBotApps() });
    const doorCall = withAssistantOps({
      callSkill: (a, o, x, ctx) => agent.callSkill(a, o, x, ctx), t, refusal: agent.doorRefusal, threads: { langOf: () => null },
      admin: { users: async () => [] },
    });
    // the stand-in model: the tool calls scripted for the newest member line, else words
    const llm = {
      invoke: async (req) => {
        const last = [...(req.messages ?? [])].reverse().find((m) => m.role === 'user');
        const said = String(last?.content ?? '');
        const hit = [...script.keys()].find((w) => said.includes(w));
        const calls = hit ? script.get(hit) : [];
        return calls.length ? { toolCall: calls[0], toolCalls: calls } : { toolCall: null, replyText: 'Dat weet ik niet.' };
      },
    };
    bridge = new InMemoryBridge({ id: 'telegram' });
    runner = createTelegramRunner({
      bridge, catalogue: catalogue.catalogue, manifestsByOrigin: catalogue.manifestsByOrigin, t, lang: 'nl', callSkill: doorCall, collectMs: 0,
      llm, interpret: interpretToCommand, promptLines: botPromptLines(t), expand: expandAdds({ t }), gateRules: listsGateRules('nl', templateLists(t)),
    });
    await runner.start();
  }, 120_000);

  afterAll(async () => {
    await agent?.stop?.().catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  /** One line from the person; what the bot said to it, message by message. */
  const say = async (text) => {
    bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId: '42', text, sender: { bridgeUid: '42', displayName: 'Frits' } });
    await runner.idle('42');
    return bridge.outbox.map((m) => m.text);
  };

  it('the gate: three things added are one line, naming the list and the things', async () => {
    expect(await say('zet melk, brood en kaas op de boodschappen')).toEqual(['Op de lijst Boodschappen: melk, brood, kaas.']);
  });

  it('the model: two adds it picked are one line too', async () => {
    script.set('eieren en boter', [
      { id: 'addToList', args: { list: 'boodschappen', text: 'eieren' } },
      { id: 'addToList', args: { list: 'boodschappen', text: 'boter' } },
    ]);
    expect(await say('doe eieren en boter erbij')).toEqual(['Op de lijst Boodschappen: eieren, boter.']);
  });

  it('ticks: the gate names what it ticked; two ticks the model picked are one line', async () => {
    expect(await say('melk is klaar')).toEqual(['Afgevinkt: melk.']);
    script.set('brood en kaas zijn op', [
      { id: 'markListItemDone', args: { item: 'brood' } },
      { id: 'markListItemDone', args: { item: 'kaas' } },
    ]);
    expect(await say('brood en kaas zijn op')).toEqual(['Afgevinkt: brood, kaas.']);
  });

  it('a line taken off a list names the list and the thing', async () => {
    expect(await say('haal eieren van de lijst')).toEqual(['Van Boodschappen gehaald: eieren.']);
  });

  it('chores: who holds it and its day, in one line — never "✓ Opgepakt: …"', async () => {
    await say('nieuwe taak: lamp vervangen');
    // said so that it reads right wherever the reply lands (a circle door posts it for everyone): "opgepakt", not "van jou"
    expect(await say('ik doe de lamp')).toEqual(["Klusje 'lamp vervangen' is opgepakt."]);
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(await say('nieuwe taak voor mij: ramen lappen, morgen')).toEqual([`Klusje 'ramen lappen' is opgepakt, ${dayWords(tomorrow)}.`]);
    // the model moves a chore to someone, by the name the person said
    script.set('geef de ramen aan Bob', [{ id: 'reassignTask', args: { id: 'ramen', newAssignee: 'Bob' } }]);
    expect(await say('geef de ramen aan Bob')).toEqual([`Klusje 'ramen lappen' is van Bob, ${dayWords(tomorrow)}.`]);
    // done is ticked off, as a list line is
    expect(await say('lamp vervangen is klaar')).toEqual(['Afgevinkt: lamp vervangen.']);
    // a chore with a day and nobody yet: the day it is on
    script.set('stofzuigen voor', [{ id: 'addToList', args: { list: 'Klusjes', text: 'stofzuigen', due: isoDay(tomorrow) } }]);
    expect(await say('stofzuigen voor morgen')).toEqual([`Klusje 'stofzuigen' staat op ${dayWords(tomorrow)}.`]);
    script.set('weg met stofzuigen', [{ id: 'removeTask', args: { id: 'stofzuigen' } }]);
    expect(await say('weg met stofzuigen')).toEqual(["Klusje 'stofzuigen' is weggehaald."]);
  });

  it('appointments: the day and time in the household\'s words', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const when = `${dayWords(tomorrow)} 10:00`;
    expect(await say('tandarts morgen om 10 uur')).toEqual([`Afspraak 'tandarts' staat op ${when}.`]);
    script.set('ik kom naar de tandarts', [{ id: 'rsvpAccept', args: { id: 'tandarts' } }]);
    expect(await say('ik kom naar de tandarts')).toEqual([`Je komt: tandarts, ${when}.`]);
  });
});
