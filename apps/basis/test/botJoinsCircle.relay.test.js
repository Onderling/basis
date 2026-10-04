/**
 * THE BOT JOINS A CIRCLE, FOR REAL — three parties over a real relay: the box runner on a function profile (its inbox
 * its only door), Ann (the bot's admin, and the admin of a circle) and Bob (a member of that circle).
 *
 * Ann pastes her circle's invite to the bot (`/kring <invite>`); the bot asks her — the circle's name, its rules, that it
 * keeps that circle's data on the box — and joins only on her yes, with a roster handle naming its operator. Ann and Bob
 * see the bot on the circle's roster. `/kring los <naam>` takes it out again: off the roster, and the box forgets the
 * circle's content (said in the walk log, with no content in it).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown, createCircle, joinExistingCircle, readRoster, bindCircleAddresses, sendCircleChat } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';
import { buildCircleInviteUri } from '../src/v2/circleInvite.js';
import { removeCircleMember } from '../src/v2/circleMembershipHygiene.js';
import { decodeContactCard as decodeCardBody } from '@onderling-app/stoop/lib/contactCard';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));
const CIRCLE = 'huize-rood';
const cardFrom = (stdout) => { const m = /onderling-contact:\/\/([A-Za-z0-9_-]+)/.exec(stdout); return m ? decodeCardBody(m[1]) : null; };
const botTurns = async (node) => (await node.contactThreadChannel.rehydrateAll()).filter((t) => t.origin === 'bot');
const walkLog = (dir) => readdirSync(dir).filter((f) => f.startsWith('walk-log-')).flatMap((f) => readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const botOnRoster = (members) => members.some((m) => /^huisbot/.test(String(m.handle ?? '')));

describe('the bot joins a circle on its admin\'s word', () => {
  let relay; let dataDir; let child; let out = ''; let ann; let bob; let send;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    dataDir = mkdtempSync(path.join(tmpdir(), 'basis-bot-circle-'));
    child = spawn(process.execPath, [RUNNER, '--data-dir', dataDir], {
      env: {
        PATH: process.env.PATH, HOME: dataDir,
        ONDERLING_RELAY_URL: relay.url, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase',
        ONDERLING_PROFILE_KIND: 'function', ONDERLING_PRIMARY_DEVICE: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    const up = await until(async () => (out.includes('device-runner: up') ? true : null), { timeout: 90_000, step: 250 });
    expect(up, `the runner never came up:\n${out.slice(-1500)}`).toBe(true);
    ann = await bootRealAgentNode('ann', { contactChannel: true, taskLane: true });
    bob = await bootRealAgentNode('bob', { taskLane: true });
    await connectNodesOverRelay([ann, bob], { relayUrl: relay.url });
    // Ann's circle, Bob in it
    await createCircle(ann, { groupId: CIRCLE, name: 'Huize Rood', purpose: 'samen het huis' });
    const bj = await joinExistingCircle(ann, bob, { groupId: CIRCLE, handle: 'bob' });
    expect(bj.joined?.ok, `Bob did not join: ${JSON.stringify(bj.joined)}`).toBe(true);
    // what both shells do after a join (as `pairCircle` does): the per-circle addresses on the relay, the members' keys bound
    await bindCircleAddresses([ann, bob], CIRCLE);
    await Promise.all([ann, bob].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
    // Ann is the bot's admin: the first person admitted, with the code it printed
    const card = cardFrom(out);
    expect(card?.peerAddr, 'the runner printed no card').toBeTruthy();
    send = (text, extra = {}) => ann.contactThreadChannel.sendTurn({ peerAddr: card.peerAddr, threadId: card.peerAddr, text, ...extra }).sent;
    const code = /\/start ([0-9a-f]{16}-[0-9a-f]{12})/.exec(out)?.[1];
    await send('hallo', { admission: code });
    const welcomed = await until(async () => ((await botTurns(ann)).length >= 1 ? true : null), { timeout: 30_000, step: 500 });
    expect(welcomed, `Ann was not let in. Runner:\n${out.slice(-1200)}`).toBe(true);
  }, 240_000);

  afterAll(async () => {
    try { child?.kill('SIGTERM'); } catch { /* gone */ }
    await teardown(ann, bob);
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('asked first; joined on the yes; Ann and Bob see the bot on the roster; `/kring los` takes it off and the box forgets', async () => {
    const invite = await buildCircleInviteUri({ callSkill: (a, o, x) => ann.agent.callSkill(a, o, x), circleId: CIRCLE, adminPeerAddr: ann.pubKey });
    expect(invite?.uri).toBeTruthy();
    const before = (await botTurns(ann)).length;
    await send(`/kring ${invite.uri}`);
    // the inbox door has no buttons: the answer is in the words
    const question = await until(async () => (await botTurns(ann)).slice(before).find((t) => /\/kring ja \S+/.test(t.text ?? '')) ?? null, { timeout: 30_000, step: 500 });
    expect(question, `no question came back. The bot said: ${JSON.stringify((await botTurns(ann)).map((t) => [t.text, t.buttons]))}\nRunner:\n${out.split('\n').filter((l) => /device-runner|kring|join|redeem|warn|error/i.test(l)).slice(-30).join('\n')}`).toBeTruthy();
    expect(question.text).toContain('Huize Rood');
    expect(question.text).toMatch(/op dit apparaat/);
    expect(question.text).toMatch(/@huisbot/);
    // nothing joined before the yes
    expect(botOnRoster(await readRoster(ann, CIRCLE))).toBe(false);

    await send(/\/kring ja \S+/.exec(question.text)[0].replace(/\)$/, ''));
    const joined = await until(async () => ((await botTurns(ann)).some((t) => /zit nu in/.test(t.text ?? '')) ? true : null), { timeout: 60_000, step: 500 });
    expect(joined, `the bot did not say it joined. Runner:\n${out.slice(-2000)}`).toBe(true);
    const onAnn = await until(async () => (botOnRoster(await readRoster(ann, CIRCLE)) ? true : null), { timeout: 30_000, step: 500 });
    expect(onAnn, 'the bot is not on Ann\'s roster').toBe(true);
    const onBob = await until(async () => (botOnRoster(await readRoster(bob, CIRCLE)) ? true : null), { timeout: 30_000, step: 500 });
    expect(onBob, 'the bot is not on Bob\'s roster').toBe(true);
    // …and says what it is on its row: a function (a bot), on Ann's and Bob's roster alike
    for (const [who, node] of [['Ann', ann], ['Bob', bob]]) {
      const kind = await until(async () => (await readRoster(node, CIRCLE)).find((m) => /^huisbot/.test(String(m.handle ?? '')))?.kind ?? null, { timeout: 30_000, step: 500 });
      expect(kind, `${who}'s row for the bot does not say what it is: ${JSON.stringify((await readRoster(node, CIRCLE)).map((m) => [m.handle, m.kind]))}`).toBe('function');
    }

    await send('/kringen');
    expect(await until(async () => ((await botTurns(ann)).some((t) => /De bot zit in:\n• Huize Rood/.test(t.text ?? '')) ? true : null), { timeout: 30_000, step: 500 })).toBe(true);

    await send('/kring los Huize Rood');
    const left = await until(async () => ((await botTurns(ann)).some((t) => /is uit “Huize Rood”/.test(t.text ?? '')) ? true : null), { timeout: 60_000, step: 500 });
    expect(left, `the bot did not say it left. Runner:\n${out.slice(-2000)}`).toBe(true);
    const forgotten = walkLog(dataDir).find((e) => e.kind === 'circle-forgotten');
    expect(forgotten).toMatchObject({ ok: true });
    expect(forgotten.entries).toBeGreaterThan(0);
    expect(JSON.stringify(walkLog(dataDir))).not.toContain('samen het huis');
    const offAnn = await until(async () => (!botOnRoster(await readRoster(ann, CIRCLE)) ? true : null), { timeout: 30_000, step: 500 });
    expect(offAnn, `the bot is still on Ann's roster after it left: ${JSON.stringify((await readRoster(ann, CIRCLE)).map((m) => m.handle))} · bot walk log: ${JSON.stringify(walkLog(dataDir).slice(-12).map((e) => e.kind + (e.type ? ':' + e.type : '')))} · Ann's log: ${JSON.stringify(ann.deviceLog?.query?.({}).filter((e) => e.circleId === CIRCLE).map((e) => e.type + ':' + (e.payload?.body?.kind ?? e.payload?.kind ?? '')))}`).toBe(true);

    // …and invited again to the SAME circle: it is back on the roster (a member who left joins again — ledger L193)
    const again = await buildCircleInviteUri({ callSkill: (a, o, x) => ann.agent.callSkill(a, o, x), circleId: CIRCLE, adminPeerAddr: ann.pubKey });
    const n2 = (await botTurns(ann)).length;
    await send(`/kring ${again.uri}`);
    const q2 = await until(async () => (await botTurns(ann)).slice(n2).find((t) => /\/kring ja \S+/.test(t.text ?? '')) ?? null, { timeout: 30_000, step: 500 });
    expect(q2, 'no question for the rejoin').toBeTruthy();
    await send(/\/kring ja \S+/.exec(q2.text)[0].replace(/\)$/, ''));
    const backOnAnn = await until(async () => (botOnRoster(await readRoster(ann, CIRCLE)) ? true : null), { timeout: 60_000, step: 500 });
    expect(backOnAnn, `the bot did not come back on Ann's roster. The bot said: ${JSON.stringify((await botTurns(ann)).slice(n2).map((t) => t.text))}`).toBe(true);
    const n3 = (await botTurns(ann)).length;
    await send('/kring los Huize Rood');
    // the bot says it left only after it forgot the circle: the next case counts forgets from here
    await until(async () => ((await botTurns(ann)).slice(n3).some((t) => /is uit “Huize Rood”/.test(t.text ?? '')) ? true : null), { timeout: 60_000, step: 500 });
  }, 240_000);

  it('removed by the circle\'s admin: the box forgets the circle and its record of it goes', async () => {
    // a second circle of Ann's (a member who left and rejoins the SAME circle is another question — see the ledger)
    const BLUE = 'huize-blauw';
    await createCircle(ann, { groupId: BLUE, name: 'Huize Blauw', purpose: 'een tweede kring' });
    await bindCircleAddresses([ann], BLUE);
    const invite = await buildCircleInviteUri({ callSkill: (a, o, x) => ann.agent.callSkill(a, o, x), circleId: BLUE, adminPeerAddr: ann.pubKey });
    const before = (await botTurns(ann)).length;
    await send(`/kring ${invite.uri}`);
    const question = await until(async () => (await botTurns(ann)).slice(before).find((t) => /\/kring ja \S+/.test(t.text ?? '')) ?? null, { timeout: 30_000, step: 500 });
    expect(question, 'no question for the second circle').toBeTruthy();
    await send(/\/kring ja \S+/.exec(question.text)[0].replace(/\)$/, ''));
    const row = await until(async () => (await readRoster(ann, BLUE)).find((m) => /^huisbot/.test(String(m.handle ?? ''))) ?? null, { timeout: 60_000, step: 500 });
    expect(row, `the bot did not join the second circle. The bot said: ${JSON.stringify((await botTurns(ann)).slice(before).map((t) => t.text))}`).toBeTruthy();
    // what a shell does when its roster changes (production's roster feed): the new member's per-circle key bound
    await bindCircleAddressKeysFor({ agent: ann.agent, circleId: BLUE });
    const forgotBefore = walkLog(dataDir).filter((e) => e.kind === 'circle-forgotten').length;

    const removed = await removeCircleMember({ agent: ann.agent, circleId: BLUE, memberWebid: row.webid });
    expect(removed.ok, JSON.stringify(removed)).toBe(true);
    const gone = await until(async () => (walkLog(dataDir).some((e) => e.kind === 'circle-removed' && e.ok && e.circleId === BLUE.slice(0, 12)) ? true : null), { timeout: 60_000, step: 500 });
    expect(gone, `the box did not notice its removal. Walk log: ${JSON.stringify(walkLog(dataDir).filter((e) => /circle/.test(e.kind)))}`).toBe(true);
    expect(walkLog(dataDir).filter((e) => e.kind === "circle-forgotten").length, JSON.stringify(walkLog(dataDir).filter((e) => /circle-(forgotten|removed|said)/.test(e.kind)))).toBe(forgotBefore + 1);
    const n = (await botTurns(ann)).length;
    await send('/kringen');
    expect(await until(async () => ((await botTurns(ann)).slice(n).some((t) => /in geen enkele kring/.test(t.text ?? '')) ? true : null), { timeout: 30_000, step: 500 })).toBe(true);
  }, 240_000);

  it('the circle door: a member who names it is answered in the circle, in its list; Bob sees the bot\'s signed reply; no door ops; silent after it left', async () => {
    const GREEN = 'huize-groen';
    await createCircle(ann, { groupId: GREEN, name: 'Huize Groen', purpose: 'de derde kring' });
    const bj = await joinExistingCircle(ann, bob, { groupId: GREEN, handle: 'bob' });
    expect(bj.joined?.ok).toBe(true);
    await bindCircleAddresses([ann, bob], GREEN);
    await Promise.all([ann, bob].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: GREEN })));
    const invite = await buildCircleInviteUri({ callSkill: (a, o, x) => ann.agent.callSkill(a, o, x), circleId: GREEN, adminPeerAddr: ann.pubKey });
    const before = (await botTurns(ann)).length;
    await send(`/kring ${invite.uri}`);
    const question = await until(async () => (await botTurns(ann)).slice(before).find((t) => /\/kring ja \S+/.test(t.text ?? '')) ?? null, { timeout: 30_000, step: 500 });
    await send(/\/kring ja \S+/.exec(question.text)[0].replace(/\)$/, ''));
    const row = await until(async () => (await readRoster(ann, GREEN)).find((m) => /^huisbot/.test(String(m.handle ?? ''))) ?? null, { timeout: 60_000, step: 500 });
    expect(row, 'the bot did not join the third circle').toBeTruthy();
    await Promise.all([ann, bob].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: GREEN })));
    // the circle's own list, made by Ann: it reaches every member, the bot too
    const made = await ann.agent.callSkill('lists', 'createList', { text: 'Groenlijst', circleId: GREEN });
    expect(made?.ok, JSON.stringify(made)).not.toBe(false);

    const botLines = (node) => node.chatEvents.filter((e) => e.payload?.circleId === GREEN && e.actor !== node.pubKey && e.actor !== ann.pubKey && e.actor !== bob.pubKey);
    let n = 0;
    const annSays = (text) => sendCircleChat(ann, { groupId: GREEN, msgId: `ann-${n += 1}`, text });
    // the list may take a moment to reach the box: ask until the bot has put it on
    const melk = await until(async () => {
      const entries = JSON.stringify(await ann.agent.callSkill('lists', 'listEntries', { list: 'Groenlijst', circleId: GREEN }));
      if (entries.includes('melk')) return true;
      await annSays('@huisbot zet melk op de groenlijst');
      return null;
    }, { timeout: 60_000, step: 5000 });
    expect(melk, `melk is not on the circle's list. The bot said: ${JSON.stringify(botLines(ann).map((e) => e.payload?.text))}\nRunner:\n${out.split('\n').filter((l) => /circle|warn|error/i.test(l)).slice(-20).join('\n')}`).toBe(true);
    // Bob sees the bot's reply in the circle — a line by the bot's own ref, not Ann's or his
    const onBob = await until(async () => (botLines(bob).some((e) => /melk/.test(e.payload?.text ?? '')) ? true : null), { timeout: 30_000, step: 500 });
    expect(onBob, `Bob did not see the bot's reply: ${JSON.stringify(bob.chatEvents.filter((e) => e.payload?.circleId === GREEN).map((e) => [String(e.actor).slice(0, 6), e.payload?.text]))}`).toBe(true);
    // a member's /users in a circle is not the bot's book
    const k = botLines(ann).length;
    await sendCircleChat(bob, { groupId: GREEN, msgId: 'bob-users', text: '@huisbot /users' });
    const usersReply = await until(async () => botLines(ann).slice(k).find((e) => e.payload?.text) ?? null, { timeout: 30_000, step: 500 });
    expect(usersReply?.payload?.text).not.toMatch(/beheerder|admin —|Ann/);
    // the walk log says a turn happened, never what was said
    const log = JSON.stringify(walkLog(dataDir));
    expect(walkLog(dataDir).some((e) => e.kind === 'circle-turn')).toBe(true);
    expect(log).not.toContain('zet melk op de groenlijst');

    // the bot leaves: a line naming it gets no answer
    await send('/kring los Huize Groen');
    await until(async () => ((await botTurns(ann)).some((t) => /is uit “Huize Groen”/.test(t.text ?? '')) ? true : null), { timeout: 60_000, step: 500 });
    const m = botLines(ann).length;
    await annSays('@huisbot zet kaas op de groenlijst');
    await new Promise((r) => setTimeout(r, 6000));
    expect(botLines(ann).length).toBe(m);
  }, 300_000);
});
