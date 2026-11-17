/* global device, element, by, waitFor, expect */
// The "+" walks' shared moves on the phone: open the sheet, say a line, set the person's own model through the real
// settings screen, make a second self and tick exactly one. One copy, so a fix to a flake lands in every "+" walk
// (plusStory, plusStoryRest, plusStoryCircle).
const { isVisible, soon, tapSoon, firstOf, backToLauncher } = require('./ui');

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** In the thread at all (it may be below the fold) and the first of several matches: what a turn check means. */
const present = (matcher, ms = 20_000) => waitFor(element(matcher).atIndex(0)).toExist().withTimeout(ms);

async function openPlus() {
  await tapSoon(by.id('circle-tab-screens'));
  await tapSoon(by.id('vandaag-plus-open'), 30_000);
  await soon(by.id('vandaag-plus'), 20_000);
}

/** Put a line in the "+" line; resolves when the field holds it. */
async function putLine(line) {
  await element(by.id('vandaag-plus-line')).replaceText(line);
  await expect(element(by.id('vandaag-plus-line'))).toHaveText(line);
}

/**
 * Type a line and read it; resolves when the thread holds the line (its answer follows). Detox's replaceText can set the
 * native field without the sheet's onChangeText firing: the read then gets an empty line and answers "I could not read
 * that" with no turn of the person's (measured on the Samsung 2026-11-17, and on the emulator 2026-11-14). That is the
 * harness, not the product, so the line is put and read again, up to three times; typing a character instead lets the
 * Samsung keyboard change the words (measured: the field no longer held the line).
 */
async function say(line) {
  const inThread = by.text(line).withAncestor(by.id('vandaag-plus-thread'));
  let lastErr = null;
  for (let i = 0; i < 3; i += 1) {
    await putLine(line);
    // the sheet must have TAKEN the line before Read (a tap that comes first goes nowhere: measured 2026-11-16)
    await pause(1500);
    await tapSoon(by.id('vandaag-plus-read'));
    // the same line may be in the thread already (an earlier journey asked it too): the first match is enough
    try { await present(inThread, i < 2 ? 8_000 : 20_000); return; } catch (err) { lastErr = err; }
    try { await device.takeScreenshot(`plus-walk-not-in-thread-${i}-${Date.now()}`); } catch { /* the device may be gone */ }
  }
  throw new Error(`"${line}" never showed in the thread: ${lastErr?.message}`);
}

module.exports = { pause, present, openPlus, putLine, say, textsOf, requestsReach, setOwnModel, makeSelf, onlySelf };
