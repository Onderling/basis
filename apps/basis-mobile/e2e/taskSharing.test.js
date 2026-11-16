/* global device, element, by */
// A circle's TASKS shared between the phone and a REAL second person (e2e/support/relayPeer.mjs).
//
// Bram (a real agent node on a relay the emulator reaches) has a circle. The phone joins by his invite, opens the
// circle's Tasks tab and adds a task through the tab's own add button (the task op's form). Bram's store holds it,
// open, added by someone else. Bram claims it: the phone's row is no longer open to claim. Bram completes it: the
// phone's tab no longer lists it. Web twin: `journeys.spec.js` 'task-handoff'; box twin: `choresOnTheBox.relay`.
// Each step leaves a screenshot. Release APK, emulator only.

const { launch, isVisible, soon, tapSoon, firstBoot, emulatorOnly } = require('./support/ui');
const { startPeer, joinByInvite } = require('./support/peer');

const TASK = 'ramen lappen';
const CIRCLE = 'Taken Kring';
let peer = null;
let ready = null;

/** Bram's own open tasks, asked until `pred` holds (a write crosses the relay). */
async function bramHolds(pred, tries = 20) {
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    peer.send({ do: 'tasks-dump' });
    last = await peer.next('tasks', () => true, 20_000);
    if (pred(last.open, last.me)) return last;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Bram never held it; his tasks: ${JSON.stringify(last)}`);
}

/** The phone's Tasks tab, read again (it reads when the tab opens), until `pred` holds. */
async function phoneTab(pred, tries = 12) {
  for (let i = 0; i < tries; i += 1) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 4000));
    await tapSoon(by.id('circle-detail-tab-conversation')).catch(() => {});
    await tapSoon(by.id('circle-detail-tab-tasks')).catch(() => {});
    await soon(by.id('circle-detail-taken'), 20_000).catch(() => {});
  }
  return false;
}

describe("a circle's tasks on the phone — a real second person over the relay", () => {
  beforeAll(async () => {
    emulatorOnly('taskSharing');
    peer = await startPeer(['--talk', '--circle', CIRCLE]);
    ready = peer.ready;
    await launch({ fresh: true });
    await firstBoot();
  });

  afterAll(async () => {
    peer?.stop();
  });

  it("the phone joins Bram's circle from his invite link", async () => {
    await joinByInvite({ invite: ready.invite, circleId: ready.circleId, shot: 'tasks-01-join' });
  });

  it("adds a task on the circle's Tasks tab, and Bram holds it, open", async () => {
    await tapSoon(by.id(`circle-tile-${ready.circleId}`));
    await tapSoon(by.id('circle-detail-tab-tasks'), 60_000);
    await soon(by.id('circle-detail-taken'), 20_000);
    await tapSoon(by.id('circle-taken-add'));
    await soon(by.id('op-page-field-text'), 20_000);
    await element(by.id('op-page-field-text')).replaceText(TASK);
    await device.takeScreenshot('tasks-02-form');
    await tapSoon(by.id('op-page-submit'));
    const held = await bramHolds((open) => open.some((x) => x.text === TASK));
    const task = held.open.find((x) => x.text === TASK);
    if (task.assignees.length) throw new Error(`the new task is already held: ${JSON.stringify(task)}`);
    if (held.me.includes(task.addedBy)) throw new Error(`Bram's store says Bram added it: ${JSON.stringify(task)}`);
    // the person sees their own task on the tab, open to claim
    const seen = await phoneTab(async () => (await isVisible(by.text(TASK))) && (await isVisible(by.id('circle-task-chip-claim'))));
    await device.takeScreenshot('tasks-03-added');
    if (!seen) throw new Error("the phone's own task never showed on its Tasks tab, open to claim");
  });

  it('Bram claims it: the phone shows it as taken, no longer open to claim', async () => {
    peer.send({ do: 'task-claim', text: TASK });
    const claimed = await peer.next('task-claimed', () => true, 20_000);
    if (!claimed.ok) throw new Error(`Bram could not claim: ${JSON.stringify(claimed)}`);
    await bramHolds((open, me) => open.some((x) => x.text === TASK && x.assignees.some((a) => me.includes(a))));
    // the status badge says someone is on it (the device's language: nl 'opgepakt', en 'claimed'), and no claim chip.
    // The badge is styled uppercase, and on Android that transform is in the view's text itself: match both spellings.
    const claimedBadge = async () => {
      for (const s of ['opgepakt', 'OPGEPAKT', 'claimed', 'CLAIMED']) if (await isVisible(by.text(s))) return true;
      return false;
    };
    const seen = await phoneTab(async () => (await isVisible(by.text(TASK))) && (await claimedBadge()) && !(await isVisible(by.id('circle-task-chip-claim'))));
    await device.takeScreenshot('tasks-04-claimed');
    if (!seen) throw new Error("Bram's claim never showed on the phone: the task stayed open to claim");
  });

  it("Bram completes it: the phone's Tasks tab no longer lists it", async () => {
    peer.send({ do: 'task-complete', text: TASK });
    const done = await peer.next('task-completed', () => true, 20_000);
    if (!done.ok) throw new Error(`Bram could not complete: ${JSON.stringify(done)}`);
    await bramHolds((open) => !open.some((x) => x.text === TASK));
    const gone = await phoneTab(async () => (await isVisible(by.id('circle-detail-taken'))) && !(await isVisible(by.text(TASK))));
    await device.takeScreenshot('tasks-05-completed');
    if (!gone) throw new Error("Bram's completion never reached the phone: the task is still listed as open");
  });
});
