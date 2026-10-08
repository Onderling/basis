/**
 * The people reads on the household bot, end to end: "wie doet de lamp", "wat moet Ann doen", "wie is er zaterdag" —
 * by the deterministic gate and by the model alike, each answered in one worded line, and the names ceiling holding on
 * the way out ("iemand", never an id). Composed as the box composes a household bot (the real agent over the household
 * store, the slim catalogue, the door's call, the template's word rules, the real runner admitting its people), in Dutch.
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

const dayWords = (d) => new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }).format(d);
const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WEEKDAY = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

describe('the household bot\'s people reads', () => {
  let dir; let agent; let bridge; let runner;
  const script = new Map();
  const X = new Date(Date.now() + 3 * 86_400_000);
  const names = (value) => agent.callSkill('params', 'set-param', { key: 'assistant.names', value });

  beforeAll(async () => {
    await initLocalisation({ lng: 'nl' });
    dir = await mkdtemp(path.join(tmpdir(), 'bot-people-reads-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    await ensureHouseholdLists({ callSkill: (a, o, x) => agent.callSkill(a, o, x), t });
    for (const [w, n, r] of [['telegram:1', 'Ann', 'member'], ['telegram:2', 'Bert', 'member'], ['telegram:9', 'Frits', 'admin']]) {
      await agent.callSkill('stoop', 'addContact', { webid: w, channel: 'telegram', role: r, displayName: n });
      await agent.setDoorCaller(w, r);
    }
    const asAnn = (a, o, x) => agent.callSkill(a, o, x, { caller: 'telegram:1' });
    await asAnn('lists', 'addToList', { list: 'Klusjes', text: 'lamp vervangen', assignee: 'mij', due: isoDay(X) });
    await agent.callSkill('calendar', 'addEvent', { title: 'tandarts', when: `${isoDay(X)}T10:00`, attendees: ['telegram:1'] });
    const catalogue = createDoorCatalogue({ householdManifest: agent.manifest, slim: true, getApps: () => householdBotApps() });
    const doorCall = withAssistantOps({
      callSkill: (a, o, x, ctx) => agent.callSkill(a, o, x, ctx), t, refusal: agent.doorRefusal, threads: { langOf: () => null },
      admin: { users: async () => [] },
    });
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
      // the door admits its people: every call of the turn carries who asks, and the host's gate decides for them
      admit: async ({ uid }) => `telegram:${uid}`,
    });
    await runner.start();
  }, 120_000);

  afterAll(async () => {
    await agent?.stop?.().catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  /** One line from a person (by their Telegram uid); what the bot said to it. */
  const say = async (uid, text) => {
    bridge.clearOutbox();
    await bridge.simulateIncoming({ chatId: uid, text, sender: { bridgeUid: uid, displayName: null } });
    await runner.idle(uid);
    return bridge.outbox.map((m) => m.text);
  };
  const dayLines = (who) => [`Op ${dayWords(X)}:\n• 10:00 tandarts — ${who}\n• klusje lamp vervangen — ${who}`];

  it('the gate: who does the lamp, what Ann has to do, who is there that day — each one line', async () => {
    expect(await say('2', 'wie doet de lamp')).toEqual([`Klusje 'lamp vervangen' is van Ann, ${dayWords(X)}.`]);
    expect(await say('2', 'wat moet Ann doen')).toEqual([`Ann doet: lamp vervangen (${dayWords(X)}).`]);
    expect(await say('2', `wie is er ${WEEKDAY[X.getDay()]}`)).toEqual(dayLines('Ann'));
    // the one who holds it reads "jou"
    expect(await say('1', 'wie doet de lamp')).toEqual([`Klusje 'lamp vervangen' is van jou, ${dayWords(X)}.`]);
    expect(await say('2', 'wie doet de fiets')).toEqual(["Er is geen open klusje met 'fiets'."]);
  });

  it('the model: the same reads, called with their new arguments, the same lines', async () => {
    script.set('heeft iemand de lamp al', [{ id: 'listOpen', args: { text: 'lamp' } }]);
    expect(await say('2', 'heeft iemand de lamp al')).toEqual([`Klusje 'lamp vervangen' is van Ann, ${dayWords(X)}.`]);
    script.set('hoe druk is Ann', [{ id: 'listMine', args: { who: 'Ann' } }]);
    expect(await say('2', 'hoe druk is Ann')).toEqual([`Ann doet: lamp vervangen (${dayWords(X)}).`]);
    script.set('is er iets over drie dagen', [{ id: 'weekOverview', args: { day: isoDay(X) } }]);
    expect(await say('2', 'is er iets over drie dagen')).toEqual(dayLines('Ann'));
  });

  it('the ceiling on the way out: under names:none a member reads "iemand", never an id; naming someone is refused', async () => {
    await names('none');
    try {
      const said = [
        ...(await say('2', 'wie doet de lamp')),
        ...(await say('2', `wie is er ${WEEKDAY[X.getDay()]}`)),
        ...(await say('2', 'hoe druk is Ann')),
      ];
      expect(said).toEqual([
        `Klusje 'lamp vervangen' is van iemand, ${dayWords(X)}.`,
        ...dayLines('iemand'),
        'Namen zijn hier niet zichtbaar: je kunt alleen je eigen klusjes opvragen.',
      ]);
      expect(said.join('\n')).not.toMatch(/telegram:|Ann/);
    } finally { await names('members'); }
  });
});
