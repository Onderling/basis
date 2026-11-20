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

/** The texts of every element a matcher finds (none: []), read from the screen. */
async function textsOf(matcher) {
  try {
    const attrs = await element(matcher).getAttributes();
    return (attrs.elements ?? [attrs]).map((a) => String(a.text ?? a.label ?? ''));
  } catch { return []; }
}

/** Wait until the stand-in model has had `n` requests (a model answer comes after the line shows). */
async function requestsReach(model, n, ms = 20_000) {
  const until = Date.now() + ms;
  while (model.requests.length < n && Date.now() < until) await pause(300);
  return model.requests.length;
}

/** The own model, set as a person sets it: the settings button → Weergave → the assistant section, preset Local. */
async function setOwnModel(phonePort) {
  await tapSoon(by.id('settings-button'), 15_000);
  await tapSoon(by.id('settings-group-appearance'), 15_000);
  await waitFor(element(by.id('user-llm-preset-local-ollama'))).toBeVisible()
    .whileElement(by.id('circle-settings-group')).scroll(400, 'down');
  // a tap right after a scroll can land nowhere (measured on the Samsung 2026-11-17: the preset stayed off): tap until the
  // preset's fields are there
  for (let i = 0; i < 3; i += 1) {
    await pause(800);
    await element(by.id('user-llm-preset-local-ollama')).tap();
    if (await isVisible(by.id('user-llm-llmBaseUrl'))) break;
    try { await waitFor(element(by.id('user-llm-llmBaseUrl'))).toExist().withTimeout(1500); break; } catch { /* tap again */ }
  }
  await waitFor(element(by.id('user-llm-llmBaseUrl'))).toBeVisible()
    .whileElement(by.id('circle-settings-group')).scroll(200, 'down');
  await element(by.id('user-llm-llmBaseUrl')).replaceText(`http://127.0.0.1:${phonePort}`);
  await element(by.id('user-llm-llmModel')).replaceText('stand-in');
  await waitFor(element(by.id('user-llm-save'))).toBeVisible()
    .whileElement(by.id('circle-settings-group')).scroll(200, 'down');
  // Save until the setting says it is saved (a tap can land nowhere, as the preset's did); a refusal is said, not retried
  let saved = -1;
  for (let i = 0; i < 3 && saved < 0; i += 1) {
    await pause(800);
    await element(by.id('user-llm-save')).tap();
    saved = await firstOf([by.id('user-llm-msg-ok'), by.id('user-llm-msg-error')], 5000);
  }
  await device.takeScreenshot('plus-walk-model-set');
  if (saved !== 0) throw new Error(saved === 1 ? 'the own model setting was refused' : 'the own model setting never said it was saved');
}

/**
 * A second self, made as a person makes one: the header's avatar (with more selves: the switcher → Edit on the general
 * self) → the About-me panel →
 * the dashed "new" card → a name → Make; then the panel closes.
 */
async function makeSelf(name) {
  await backToLauncher();   // out of the settings screen setOwnModel leaves open: the header shows again
  await tapSoon(by.id('persona-button'), 20_000);
  // with one self the avatar opens its About-me panel at once; with more it opens the switcher first
  const at = await firstOf([by.id('circle-aboutme-panel'), by.id('persona-switcher-edit-default')], 15_000);
  if (at === 1) await tapSoon(by.id('persona-switcher-edit-default'));
  else if (at < 0) throw new Error('the persona button opened neither the About-me panel nor the switcher');
  await soon(by.id('circle-aboutme-panel'), 15_000);
  await waitFor(element(by.id('mij-new-persona'))).toBeVisible().whileElement(by.id('mij-scroll')).scroll(400, 'down');
  await pause(800);
  await element(by.id('mij-new-persona')).tap();
  await soon(by.id('mij-new-persona-name'), 10_000);
  await element(by.id('mij-new-persona-name')).replaceText(name);
  await expect(element(by.id('mij-new-persona-name'))).toHaveText(name);
  // Make sits below the name, under the fold on a phone: scroll to it first
  await waitFor(element(by.id('mij-new-persona-create'))).toBeVisible().whileElement(by.id('mij-scroll')).scroll(200, 'down');
  await pause(800);
  await tapSoon(by.id('mij-new-persona-create'));
  // the form closes once the self is made (a refusal leaves it open)
  await waitFor(element(by.id('mij-new-persona-name'))).not.toExist().withTimeout(15_000);
  await device.takeScreenshot(`plus-walk-made-${name}`);
  await tapSoon(by.id('circle-aboutme-panel-close'));
}

/**
 * Tick exactly the self called `name` (the general self: `null`) in the header's switcher. A row's tick reads
 * '☑ <name>' or '☐ <name>'; the last ticked self cannot be unticked, so the wanted one is ticked first.
 */
async function onlySelf(name, otherName) {
  await tapSoon(by.id('persona-button'), 20_000);
  await soon(by.id('persona-switcher'), 10_000);
  const defaultOn = async () => ((await textsOf(by.id('persona-switcher-tick-default')))[0] ?? '').startsWith('☑');
  if (name) {
    if (await isVisible(by.text(`☐ ${name}`))) { await element(by.text(`☐ ${name}`)).tap(); await pause(1200); }
    if (await defaultOn()) { await tapSoon(by.id('persona-switcher-tick-default')); await pause(1200); }
    if (!(await isVisible(by.text(`☑ ${name}`))) || (await defaultOn())) throw new Error(`could not tick only ${name}`);
  } else {
    if (!(await defaultOn())) { await tapSoon(by.id('persona-switcher-tick-default')); await pause(1200); }
    if (await isVisible(by.text(`☑ ${otherName}`))) { await element(by.text(`☑ ${otherName}`)).tap(); await pause(1200); }
    if (!(await defaultOn()) || (await isVisible(by.text(`☑ ${otherName}`)))) throw new Error('could not tick only the general self');
  }
  await device.takeScreenshot(`plus-walk-only-${name ?? 'default'}`);
  await tapSoon(by.id('persona-switcher-close'));
}

module.exports = { pause, present, openPlus, putLine, say, textsOf, requestsReach, setOwnModel, makeSelf, onlySelf };
