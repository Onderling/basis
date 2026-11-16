/* global device, element, by */
// A STRANGER'S FIRST FIVE MINUTES ON THE PHONE (the function matrix's help-onboarding × mobile cell; the mirror of web's
// walk-first-five-minutes). A fresh install reaches the help circle (its row in Contacts), makes a first circle, answers the
// relay question with the relay the other person is on, and shows its invite. Bram (e2e/support/relayPeer.mjs --join)
// joins from the link on the invite card. Then a first message each way: Bram's line shows in the phone's circle,
// and the phone's line arrives at Bram.
// Runs against the RELEASE APK; deletes the app, so emulator only.

const { launch, isVisible, soon, tapSoon, firstOf, firstBoot, emulatorOnly } = require('./support/ui');
const { startPeer } = require('./support/peer');

const HELP_BOT = 'urn:onderling:bot';   // ONDERLING_BOT_WEBID (apps/basis/src/v2/helpCircle.js): the help row's contact
const stamp = Date.now().toString(36);
const NAME = `Eerste ${stamp}`;
const FROM_BRAM = `welkom ${stamp}`;
const FROM_PHONE = `dank je ${stamp}`;
let peer = null;
let circleId = null;

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

describe("a stranger's first five minutes on the phone: the help circle, a first circle, its invite, a first message", () => {
  beforeAll(async () => {
    emulatorOnly('firstFiveMinutes');
    peer = await startPeer(['--join', '--talk', '--handle', 'bram']);
    await launch({ fresh: true });
    await firstBoot();
  });

  afterAll(async () => {
    peer?.stop();
  });

  it('a fresh install reaches the help circle', async () => {
    // the help circle's door is a row in Contacts (the bot's own row), not a tile among the circles
    await tapSoon(by.id('circle-tab-contacten'), 60_000);
    await tapSoon(by.id(`contact-row-${HELP_BOT}`), 60_000);
    await soon(by.id('circle-detail-composer'), 30_000);
    await device.takeScreenshot('ffm-01-help-circle');
    await device.pressBack();
  });

  it('Make a circle on the Circles tab makes the first circle', async () => {
    // the empty Circles tab offers it first (Today's card is further down, below its key and name cards)
    await tapSoon(by.id('circle-tab-circles'), 30_000);
    await tapSoon(by.id('launcher-new'), 30_000);
    await soon(by.id('create-group-wizard'), 15_000);
    // the wizard is two steps now (who you are here, then review): a circle type is asked only where the build offers it
    if (await isVisible(by.id('wizard-radio-household'))) await element(by.id('wizard-radio-household')).tap();
    await element(by.id('create-group-name')).typeText(NAME);
    await device.pressBack();   // the keyboard covers the handle field below
    if (await isVisible(by.id('wizard-handle'))) await element(by.id('wizard-handle')).replaceText('anna');
    await tapSoon(by.text('Household').withAncestor(by.id('create-group-kind')), 20_000);   // the kind, asked here
    for (let i = 0; i < 6; i += 1) {
      if (await isVisible(by.id('create-group-create'))) break;
      await element(by.id('create-group-next')).tap();
      await new Promise((r) => setTimeout(r, 600));
    }
    await device.takeScreenshot('ffm-02-review');
    await element(by.id('create-group-create')).tap();
  });

  it("the invite asks for a relay; the phone names Bram's, and the invite card shows the link", async () => {
    // a device without a relay is asked for one first (the invite carries it)
    const first = await firstOf([by.id('relay-question'), by.id('invite-link')], 60_000);
    if (first === 0) {
      await element(by.id('relay-question-input')).replaceText(peer.ready.relayUrl);
      await device.takeScreenshot('ffm-03-relay-question');
      await tapSoon(by.id('relay-question-save'));
      await new Promise((r) => setTimeout(r, 2000));   // one modal closes as the next opens
    }
    await soon(by.id('invite-link'), 60_000);
    await device.takeScreenshot('ffm-04-invite');
  });

  it("Bram joins from the link on the phone's invite card", async () => {
    const attrs = await element(by.id('invite-link')).getAttributes();
    const link = String(attrs?.text ?? '').trim();
    if (!link.startsWith('onderling-')) throw new Error(`the invite card's link reads ${JSON.stringify(link)}`);
    peer.send({ do: 'join', invite: link });
    const joined = await peer.next('joined', () => true, 120_000);
    if (!joined.ok) throw new Error(`Bram could not join: ${joined.error}`);
    circleId = joined.circleId;
    // the card says who came in, as web's does
    await soon(by.id('invite-joined'), 60_000).catch(() => {});
    await device.takeScreenshot('ffm-05-joined');
    await tapSoon(by.id('invite-close'));
  });

  it("a first message each way: Bram's line shows on the phone, the phone's arrives at Bram", async () => {
    await tapSoon(by.id('circle-tab-circles'), 30_000);
    await tapSoon(by.id(`circle-tile-${circleId}`), 60_000);
    await soon(by.id('circle-detail-composer'), 30_000);
    peer.send({ do: 'circle-say', text: FROM_BRAM });
    const said = await peer.next('circle-said', () => true, 60_000);
    if (!said.ok) throw new Error(`Bram's line did not go out: ${said.error}`);
    await soon(by.text(FROM_BRAM), 90_000);
    // the phone admitted Bram itself (its own invite), so its roster read at open did not hold him: his first line is
    // still named, not "Unknown member" (the shell reads the roster once more for a sender it cannot place)
    let named = false;
    for (let i = 0; i < 10 && !named; i += 1) {
      named = !(await isVisible(by.text('Unknown member')));
      if (!named) await new Promise((r) => setTimeout(r, 1000));
    }
    await device.takeScreenshot('ffm-06-bram-heard');
    if (!named) throw new Error("Bram's first line on the phone is labelled 'Unknown member'");
    await say('circle-detail-composer-input', FROM_PHONE);
    // the phone's keyboard capitalises a line's first letter, as it does for a person
    await peer.next('circle-heard', (m) => String(m.text).toLowerCase() === FROM_PHONE.toLowerCase(), 90_000);
    await device.takeScreenshot('ffm-07-phone-heard');
  });

  it('a cold start never says "No circles yet." to an account that has a circle', async () => {
    // the account has its first circle now: a restart must not paint the empty state on the way to the list (the
    // launcher once said "No circles yet." for seconds before the circles were read)
    await launch({ fresh: false });
    await tapSoon(by.id('circle-tab-circles'), 90_000);
    const until = Date.now() + 90_000;
    let tile = false;
    let lastTap = Date.now();
    while (Date.now() < until) {
      if (await isVisible(by.text('No circles yet.'))) throw new Error('"No circles yet." painted for an account that has a circle');
      if (await isVisible(by.id(`circle-tile-${circleId}`))) { tile = true; break; }
      // the start screen (Today by default) is applied once the agent is up, after an early tap on Circles: go back to
      // the list whenever it took over, so the check watches the list for the whole boot
      if (Date.now() - lastTap > 3000) {
        try { await element(by.id('circle-tab-circles')).tap(); } catch { /* tab bar not painted yet */ }
        lastTap = Date.now();
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    await device.takeScreenshot('ffm-08-cold-start');
    if (!tile) throw new Error("the circle's tile never appeared after the restart");
  });
});
