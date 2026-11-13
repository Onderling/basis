/* global device, element, by */
// PERSONAS ON THE PHONE, end to end with a real second person (the function matrix's personas × mobile cell).
//
// Bram (e2e/support/relayPeer.mjs --talk) has a circle. The phone opens his invite and, in the join wizard's "who
// joins" step, makes a NEW persona and joins as it. Checked on Bram's side, from his own roster: the phone's one row
// carries the persona's name. A line the phone sends arrives from that row. After a restart of the app the phone still
// speaks in the circle as that persona: its next line arrives from the same row.
// Runs against the RELEASE APK; deletes the app, so emulator only.

const { launch, isVisible, soon, tapSoon, firstOf, firstBoot, backToLauncher, emulatorOnly } = require('./support/ui');
const { startPeer, joinByInvite } = require('./support/peer');

const stamp = Date.now().toString(36);
const PERSONA = `Werk ${stamp}`;
const LINE_1 = `als persona ${stamp}`;
const LINE_2 = `na herstart ${stamp}`;
let peer = null;
let ready = null;
let phoneRef = null;

/** Type a line and send it the way a person does: the field submits on the return key (the gotchas file). */
async function say(inputId, text) {
  await soon(by.id(inputId));
  for (let i = 0; i < 3; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    await element(by.id(inputId)).tap();
    await element(by.id(inputId)).typeText(`${text}\n`);
    await new Promise((r) => setTimeout(r, 1500));
    if (!(await isVisible(by.text(text).withAncestor(by.id(inputId))))) return;
    await element(by.id(inputId)).clearText().catch(() => {});
  }
  throw new Error(`the line never left ${inputId}`);
}

/** Bram's roster, polled until `pred` holds over its rows (the other members, his own left out). */
async function rosterUntil(pred, ms = 90_000) {
  const until = Date.now() + ms;
  let last = null;
  while (Date.now() < until) {
    peer.send({ do: 'roster' });
    last = await peer.next('roster', () => true, 20_000);
    if (pred(last.rows ?? [])) return last.rows;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Bram's roster never matched; last: ${JSON.stringify(last?.rows ?? null)}`);
}

const refOf = (row) => row?.webid ?? row?.pubKey ?? null;
const carriesName = (row, name) => JSON.stringify(row ?? {}).includes(name);

describe('personas on the phone — join a circle as a new persona; the other member sees that persona, also after a restart', () => {
  beforeAll(async () => {
    emulatorOnly('personas');
    peer = await startPeer(['--circle', 'Werk Kring', '--talk']);
    ready = peer.ready;
    await launch({ fresh: true });
    await firstBoot();
  });

  afterAll(async () => {
    peer?.stop();
  });

  it("the phone joins Bram's circle as a new persona made in the join wizard", async () => {
    await joinByInvite({
      invite: ready.invite, circleId: ready.circleId, shot: 'per-01-who-joins',
      atWhoJoins: async () => {
        await tapSoon(by.id('join-new-persona'));
        await soon(by.id('join-new-persona-name'));
        await element(by.id('join-new-persona-name')).replaceText(PERSONA);
        await tapSoon(by.id('join-new-persona-make'));
        // the one line now names the new persona as who joins
        await soon(by.text(PERSONA).withAncestor(by.id('join-as-line')), 20_000).catch(async () => {
          await soon(by.id('join-as-line'));   // the line is there; its words are in the screenshot
        });
        await device.takeScreenshot('per-02-joins-as-persona');
      },
    });
  });

  it("Bram's roster shows the phone as the persona: one row, with the persona's name", async () => {
    const rows = await rosterUntil((rs) => rs.some((r) => carriesName(r, PERSONA)));
    const phoneRows = rows.filter((r) => carriesName(r, PERSONA));
    if (phoneRows.length !== 1) throw new Error(`expected one row with the persona's name, got ${JSON.stringify(rows)}`);
    if (rows.length !== 1) throw new Error(`the phone shows in Bram's roster more than once: ${JSON.stringify(rows)}`);
    phoneRef = refOf(phoneRows[0]);
    if (!phoneRef) throw new Error(`the persona's row has no address: ${JSON.stringify(phoneRows[0])}`);
  });

  it('a line the phone sends arrives at Bram from the persona', async () => {
    await tapSoon(by.id(`circle-tile-${ready.circleId}`));
    await soon(by.id('circle-detail-composer'), 30_000);
    await say('circle-detail-composer-input', LINE_1);
    await new Promise((r) => setTimeout(r, 5000));
    await device.takeScreenshot('per-03a-after-send');   // the bubble's delivery state, whichever branch follows
    const heard = await peer.next('circle-heard', (m) => m.text === LINE_1, 60_000);
    if (heard.from !== phoneRef) throw new Error(`the line came from ${heard.from}, the persona's row is ${phoneRef}`);
    await device.takeScreenshot('per-03-sent-as-persona');
  });

  it('after a restart the phone still speaks in the circle as the persona', async () => {
    await backToLauncher();
    await launch({ fresh: false });
    // a restart opens on Today, and a tap while the app is still starting is lost: tap Circles until the tile shows
    let found = false;
    for (let i = 0; i < 9 && !found; i += 1) {
      await tapSoon(by.id('circle-tab-circles'), 60_000);
      found = (await firstOf([by.id(`circle-tile-${ready.circleId}`)], 10_000)) === 0;
    }
    if (!found) { await device.takeScreenshot('per-04a-no-tile'); throw new Error("after the restart the circle's tile never showed"); }
    // the tile still carries the circle's NAME, not its id: a persona's circle names come through the fold of every
    // persona's circles into the launcher's list (they were lost after a restart once, and the tile showed the id)
    const tile = by.id(`circle-tile-${ready.circleId}`);
    if (await isVisible(by.text(ready.circleId).withAncestor(tile))) {
      await device.takeScreenshot('per-04c-tile-shows-id');
      throw new Error(`after the restart the circle's tile shows its id (${ready.circleId}), not its name "${ready.circleName}"`);
    }
    if (!(await isVisible(by.text(ready.circleName).withAncestor(tile)))) {
      await device.takeScreenshot('per-04c-tile-no-name');
      throw new Error(`after the restart the circle's tile does not show its name "${ready.circleName}" (nor its id)`);
    }
    await tapSoon(by.id(`circle-tile-${ready.circleId}`));
    await soon(by.id('circle-detail-composer'), 30_000);
    await say('circle-detail-composer-input', LINE_2);
    await new Promise((r) => setTimeout(r, 8000));
    await device.takeScreenshot('per-04b-after-restart-send');
    const heard = await peer.next('circle-heard', (m) => m.text === LINE_2, 90_000);
    if (heard.from !== phoneRef) throw new Error(`after the restart the line came from ${heard.from}, not the persona's ${phoneRef}`);
    const rows = await rosterUntil(() => true, 20_000);
    if (rows.length !== 1 || !carriesName(rows[0], PERSONA)) throw new Error(`after the restart Bram's roster reads ${JSON.stringify(rows)}`);
    await device.takeScreenshot('per-04-after-restart');
  });
});
