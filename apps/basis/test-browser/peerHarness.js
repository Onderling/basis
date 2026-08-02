/**
 * peerHarness.js — reusable N-peer headless harness for the connectivity journeys.
 *
 * Phase 0 of plans/PLAN-peer-connectivity.md. Lifts the ad-hoc helpers from the
 * two-peer scratch drive (twopeer.spec.js) and generalises them from "A + B" to N
 * peers, so journeys.spec.js can drive pairing / fan-out / task-handoff / entrust /
 * … across any number of contexts.
 *
 * Design principles (from the Phase-0 doc):
 *   - Each peer is a fresh browser.newContext() → isolated storage → a DISTINCT
 *     identity. That is the whole point: real multi-peer, not one identity in tabs.
 *   - Every helper reaches functionality through the REAL UX surface (the composer,
 *     the ⋯ menu, the wizard, the tabs) — never a raw op. That reachability is the
 *     regression guarantee.
 *   - Helpers return OBSERVABLE state (text / counts / booleans) so specs assert on
 *     what is on screen, on both peers.
 *   - The DOM selectors here are EXACTLY the ones the two-peer drive confirmed
 *     (twopeer.spec.js + helpers.js). Do NOT invent new selectors — if a surface
 *     doesn't exist yet, its journey is a fixme in the spec, not a guessed selector.
 *
 * Transport reality: NKN by default (the app's own relay/rendezvous — the dev server
 * boots WITHOUT VITE_CIRCLE_RELAY_URL). Supply VITE_CIRCLE_RELAY_URL=ws://… to bring
 * up a local relay for a hermetic run; the app's router then picks the best route.
 * NKN is unreliable in a sandbox, so journeys that need real cross-peer delivery are
 * marked with the phase that makes them green — Phase 0 lands the net, not the fixes.
 */

import { createCircleViaWizard } from './helpers.js';

/** Where every journey drops its screenshots. */
export const SHOTS = '/home/frits/.claude/jobs/c6a31a12/tmp/verify-shots';

/** Console lines worth surfacing during a run (transport/redeem/membership events). */
const INTERESTING = /redeem|group-member|pair|joinedGroup|relay connected|peer transport/i;

// ── boot ─────────────────────────────────────────────────────────────────────

// ── per-peer mode seeding ──────────────────────────────────────────────────────
// The localStorage keys the harness seeds (via addInitScript, BEFORE the app boots)
// to put each client in a configured mode. Discovered from product code, not guessed:
//   - LANG      'circle.app.lang'          — web boots en-US headless otherwise.
//   - RELAY_URL 'cc.relayUrl'              — relayPref STORAGE_KEY, read at boot in
//                                            web/v2/circleApp.js (localStorageRelayIo().load()).
//   - TRANSPORT 'cc-chat-id:cc-transport-mode' — the /transport-mode vault key
//                                            ('cc-transport-mode') under the chat-identity
//                                            VaultLocalStorage prefix ('cc-chat-id:').
// NOTE on transport mode: the app also DERIVES the effective mode from which transports
// actually connect (connectPeerTransport: relay present → 'relay'/'both', else 'nkn').
// So the real per-client knob is whether a relayUrl is seeded + whether NKN's CDN lib
// loads. Seeding 'cc-chat-id:cc-transport-mode' is a best-effort hint; the load-bearing
// lever is `relayUrl`. A relayUrl is ALSO passed as the `?relay=` boot param (belt & braces).
export const LS_KEYS = Object.freeze({
  lang:      'circle.app.lang',
  relayUrl:  'cc.relayUrl',
  transport: 'cc-chat-id:cc-transport-mode',
});

/** The relay URL a relay/both peer defaults to when a spec doesn't pass one — set by the relay fixture. */
export const FIXTURE_RELAY = process.env.PEER_TEST_RELAY || '';

/**
 * Boot ONE peer: a fresh isolated context (→ distinct identity), the app at `/`,
 * language forced (headless Chromium is en-US otherwise). Returns a driver handle.
 *
 * The mode options let ONE test hold clients in DIFFERENT modes (the matrix capability):
 * @param {object} [opts]
 * @param {'nl'|'en'} [opts.lang='nl']
 * @param {'nkn'|'relay'|'both'} [opts.transportMode]  which transport(s) this client uses.
 *        Seeds LS_KEYS.transport; for 'relay'/'both' a relayUrl (below, or FIXTURE_RELAY) is
 *        seeded + passed as `?relay=`. 'nkn' seeds no relay (the app's default rendezvous).
 * @param {string} [opts.relayUrl]  explicit ws://… relay for this client (overrides FIXTURE_RELAY).
 * @param {'no-pod'|'shared-pod'|'pod-only'|'hybrid'} [opts.pod]  the INTENDED circle data-policy this
 *        client will create circles under. Today only 'no-pod' is real (fan-out); pod setups are a
 *        per-CIRCLE policy set at create time (circlePolicy `pod`), not a boot flag — carried here so a
 *        spec can branch, and so the field is ready when Phase 2/3 wire pod creation. No-op today beyond
 *        being recorded on the driver.
 * @param {string} [opts.storageState]  path to a Playwright storageState JSON to REUSE another client's
 *        storage → the SAME identity on a second context (multi-device). Omit for a fresh identity.
 */
export async function bootPeer(browser, label, opts = {}) {
  const { lang = 'nl', transportMode, relayUrl, pod = 'no-pod', storageState } = opts;

  // Resolve the effective relay URL for this client's mode.
  const wantsRelay = transportMode === 'relay' || transportMode === 'both';
  const effRelay = relayUrl || (wantsRelay ? FIXTURE_RELAY : '');

  const context = await browser.newContext(storageState ? { storageState } : {});
  await context.addInitScript((seed) => {
    try {
      localStorage.setItem(seed.langKey, seed.lang);
      if (seed.transport) localStorage.setItem(seed.transportKey, seed.transport);
      if (seed.relayUrl)  localStorage.setItem(seed.relayKey, seed.relayUrl);
    } catch { /* storage may be unavailable pre-nav; the ?relay= param still applies */ }
  }, {
    langKey: LS_KEYS.lang, lang,
    transportKey: LS_KEYS.transport, transport: transportMode || '',
    relayKey: LS_KEYS.relayUrl, relayUrl: effRelay,
  });

  const page = await context.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (INTERESTING.test(t)) console.log(`[${label} console] ${t}`);
  });
  page.on('pageerror', (e) => console.log(`[${label} pageerror] ${e.message.split('\n')[0]}`));

  // `?relay=` is the belt to the localStorage braces: the app applies it at boot even if a
  // pre-nav storage seed didn't stick. Only added when this client is meant to use a relay.
  const dest = effRelay ? `/?relay=${encodeURIComponent(effRelay)}` : '/';
  await page.goto(dest);
  await page.waitForTimeout(4000);
  return { context, page, label, mode: { transportMode: transportMode || 'nkn', relayUrl: effRelay, pod } };
}

/**
 * Boot N peers in parallel. Returns `[{context, page, label, mode}, …]` with labels A, B, C, …
 * `opts` may be a SINGLE mode object applied to all peers, OR an ARRAY of per-peer mode objects
 * (index-aligned; shorter arrays repeat the last entry) so ONE test can boot clients in DIFFERENT
 * modes — e.g. `bootPeers(browser, 2, [{transportMode:'relay'}, {transportMode:'nkn'}])`.
 * Use `peers[0]` as the circle creator by convention.
 */
export async function bootPeers(browser, n, opts = {}) {
  const labels = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  const perPeer = Array.isArray(opts)
    ? labels.map((_, i) => opts[Math.min(i, opts.length - 1)] || {})
    : labels.map(() => opts);
  return Promise.all(labels.map((label, i) => bootPeer(browser, label, perPeer[i])));
}

/** Close every peer's context. Always call in a finally so no context leaks. */
export async function teardown(peers) {
  for (const p of peers) {
    try { await p.context.close(); } catch { /* */ }
  }
}

/**
 * Persist a peer's storage to `path` (default: scratch), returning the path. Feed it back as
 * `bootPeer(browser, label, { storageState: path })` to bring the SAME identity up on a second
 * context — the multi-device setup. (Playwright's context.storageState captures cookies + origin
 * localStorage/IndexedDB metadata; the app's identity lives in the seeded localStorage keys.)
 */
export async function saveStorage(peer, path) {
  const out = path || `${SHOTS}/${peer.label}-storage-state.json`;
  await peer.context.storageState({ path: out });
  return out;
}

/** Screenshot helper — writes `${SHOTS}/${name}.png`. */
export async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {});
}

export function log(step, verdict, note) {
  console.log(`\n### ${step}: ${verdict}\n    ${note}\n`);
}

// ── navigation / launcher ──────────────────────────────────────────────────────

/**
 * Navigate to the launcher ("Jouw kringen"). In a kring view the bottom nav is
 * hidden, so leave via the "← kringen" back button first (harness gotcha from the
 * drive — the in-kring nav is NOT `[data-tab="kringen"]`).
 */
export async function gotoKringen(page) {
  const back = page.locator('.circle-kring__back');
  if (await back.count()) { await back.first().click(); await page.waitForTimeout(1500); }
  const tab = page.locator('[data-tab="kringen"]');
  if (await tab.count()) { await tab.first().click(); await page.waitForTimeout(1600); }
  else { await page.waitForTimeout(600); }
}

/** All launcher tile names (normalised whitespace). */
export async function tileNames(page) {
  const tiles = page.locator('.circle-tile');
  const n = await tiles.count();
  const out = [];
  for (let i = 0; i < n; i++) out.push((await tiles.nth(i).innerText()).replace(/\s+/g, ' ').trim());
  return out;
}

/**
 * Create a circle from the launcher, through the WIZARD.
 *
 * This used to accept a `window.prompt` — creation has been a five-step wizard for weeks, so the handler
 * waited for a dialog that is never raised and no circle was ever made. Delegates to the one
 * implementation in `helpers.js` so this harness and the single-page specs cannot drift apart again.
 */
export async function createCircle(page, name) {
  await createCircleViaWizard(page, name);
}

/** Open the launcher tile matching `re` (falls back to the first tile). */
export async function openCircleMatching(page, re) {
  const names = await tileNames(page);
  let idx = names.findIndex((s) => re.test(s));
  if (idx < 0) idx = 0;
  await page.locator('.circle-tile').nth(idx).click();
  await page.waitForTimeout(2500);
  return { names, idx };
}

/** gotoKringen → open the matching circle → switch to Chat view. The common re-entry. */
export async function reopenCircle(page, re) {
  await gotoKringen(page);
  await openCircleMatching(page, re);
  await toChat(page);
}

/** Switch the open kring to Chat view. */
export async function toChat(page) {
  const chat = page.locator('.circle-kring__view-toggle-btn[data-view-mode="chat"]');
  if (await chat.count()) { await chat.first().click(); await page.waitForTimeout(1200); }
}

// ── chat ────────────────────────────────────────────────────────────────────

/** Send a line through the kring composer (explicit send button). */
export async function sendChat(page, text, settle = 3000) {
  await page.locator('.circle-kring__composer-input').fill(text);
  await page.locator('.circle-kring__composer-send').click();
  await page.waitForTimeout(settle);
}

/** All chat bubble texts (normalised). */
export async function readBubbles(page) {
  return (await page.locator('.circle-kring__bubble').allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim());
}

/**
 * Poll until a bubble containing `needle` appears on `page` (or the tries run out).
 * Returns true if it arrived. This is how a receiver asserts a fan-out landed.
 */
export async function waitForBubble(page, needle, { tries = 16, every = 2500 } = {}) {
  for (let i = 0; i < tries; i++) {
    await page.waitForTimeout(every);
    if ((await readBubbles(page)).some((s) => s.includes(needle))) return true;
  }
  return false;
}

// ── ⋯ more-menu / settings ─────────────────────────────────────────────────────

/** Open ⋯ → a more-menu action by data-action id. Returns false if the item is absent. */
export async function openMore(page, action) {
  await page.locator('.circle-kring__more').click();
  await page.waitForTimeout(500);
  const item = page.locator(`.circle-kring__more-item[data-action="${action}"]`);
  if (!(await item.count())) return false;
  await item.first().click();
  await page.waitForTimeout(1800);
  return true;
}

/**
 * Enable a circle feature (default: `tasks`) via ⋯ → settings, then save. A fresh
 * circle has tasks OFF by policy, so this must run before /addtask + the Taken tab.
 */
export async function enableFeature(page, feature = 'tasks') {
  if (!(await openMore(page, 'settings'))) return false;
  const box = page.locator(`input[data-feature="${feature}"]`);
  let ok = false;
  if (await box.count()) {
    if (!(await box.first().isChecked())) await box.first().check().catch(() => {});
    await page.waitForTimeout(400);
    ok = true;
  }
  const save = page.locator('.circle-settings__save');
  if (await save.count()) { await save.first().click(); await page.waitForTimeout(1800); }
  return ok;
}

/** Back-compat alias matching the two-peer drive's name. */
export const enableTasks = (page) => enableFeature(page, 'tasks');

// ── roster / membership ────────────────────────────────────────────────────────

/**
 * Read the circle roster via the admin panel (⋯ → beheer). Polls, since the member
 * load is async and the admin side adds a joiner a beat after the redeem response.
 * Returns `{present, count, names}`.
 */
export async function readRoster(page) {
  if (!(await openMore(page, 'admin'))) return { present: false, count: 0, names: [] };
  const rows = page.locator('.cc-admin__member');
  let n = 0;
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(1200);
    n = await rows.count();
    if (n >= 2) break;
  }
  const names = [];
  for (let i = 0; i < n; i++) names.push((await rows.nth(i).innerText()).replace(/\s+/g, ' ').trim());
  const back = page.locator('.cc-admin__back');
  if (await back.count()) { await back.first().click(); await page.waitForTimeout(1000); }
  return { present: true, count: n, names };
}

// ── pairing (invite → wizard join) ─────────────────────────────────────────────

/**
 * On the circle creator: open ⋯ → invite and read the `onderling-invite://` URI. Returns
 * the URI string (or null if the invite surface / code is missing). Dismisses the modal.
 */
export async function getInvite(page, tag = 'invite') {
  if (!(await openMore(page, 'invite'))) return null;
  const codeEl = page.locator('.cc-mydata-modal code, .cc-mydata-modal__card code');
  const uri = (await codeEl.count()) ? (await codeEl.first().innerText()).trim() : null;
  await shot(page, `${tag}`);
  await page.mouse.click(5, 5).catch(() => {});   // dismiss modal
  await page.waitForTimeout(500);
  return uri || null;
}

/**
 * On a joining peer, from the LAUNCHER: paste an invite URI into the join button's
 * prompt, then walk the 3-step join wizard (rules → privacy → handle) and wait out
 * the redeem handshake. Returns `{joined:boolean, outcome:string}` — `joined` is true
 * when the wizard closes (the redeem completed).
 *
 * NOTE: the ROSTER may still read empty post-join until Phase 1 (bug B1). This helper
 * asserts the handshake, not the roster; the roster assertion is the pairing journey's
 * Phase-1 acceptance.
 */
export async function joinFromInvite(page, inviteUri, { handle = 'joiner', tag = 'join' } = {}) {
  const joinBtn = page.locator('.circle-launcher__join');
  if (!(await joinBtn.count())) return { joined: false, outcome: 'no join button' };
  page.once('dialog', (d) => d.accept(inviteUri));   // paste-prompt
  await joinBtn.first().click();
  await page.waitForTimeout(2500);

  const card = page.locator('.cc-mydata-modal__card');
  await shot(page, `${tag}-step1`);
  // Step 1 — rules
  const rulesCheck = card.locator('.cc-wizard-check input[type="checkbox"]').first();
  if (await rulesCheck.count()) { await rulesCheck.check().catch(() => {}); await page.waitForTimeout(400); }
  await card.locator('.cc-wizard-btn-primary').first().click().catch(() => {});
  await page.waitForTimeout(1200);
  // Step 2 — privacy (leave mesh/DM default on)
  const privCheck = card.locator('.cc-wizard-check input[type="checkbox"]').first();
  if (await privCheck.count()) { await privCheck.check().catch(() => {}); await page.waitForTimeout(400); }
  await card.locator('.cc-wizard-btn-primary').first().click().catch(() => {});
  await page.waitForTimeout(1200);
  // Step 3 — handle + submit
  const handleInput = card.locator('.cc-wizard-handle-input');
  if (await handleInput.count()) { await handleInput.fill(handle); await page.waitForTimeout(400); }
  await shot(page, `${tag}-step3`);
  const submitBtn = card.locator('.cc-wizard-submit');
  if (await submitBtn.count()) await submitBtn.first().click().catch(() => {});

  // Wait out the redeem handshake (local redeem → peer-redeem fallback, ~30s timeout).
  let outcome = 'unknown';
  for (let i = 0; i < 26; i++) {
    await page.waitForTimeout(2500);
    const stillOpen = await page.locator('.cc-mydata-modal__card').count();
    const errEl = page.locator('.cc-mydata-modal__card .cc-wizard-error');
    const errTxt = (await errEl.count()) ? (await errEl.first().innerText()).replace(/\s+/g, ' ').trim() : '';
    if (!stillOpen) { outcome = 'wizard-closed (join succeeded)'; break; }
    if (errTxt) outcome = `error: ${errTxt}`;
  }
  await shot(page, `${tag}-result`);
  return { joined: outcome.startsWith('wizard-closed'), outcome };
}

/**
 * Full pairing convenience: `creator` makes a circle, `joiner` joins it via the real
 * invite→wizard→redeem. Returns everything a spec needs to assert. Reusable across
 * journeys that need a paired circle as their starting point.
 */
export async function pair(creator, joiner, { name = 'Peer Circle', re = /peer.?circle/i, handle = 'peerbee' } = {}) {
  const a = creator.page, b = joiner.page;
  await gotoKringen(a);
  await createCircle(a, name);
  await openCircleMatching(a, re);
  await toChat(a);
  await gotoKringen(b);

  const inviteUri = await getInvite(a, `pair-${creator.label}-invite`);
  if (!inviteUri) return { inviteUri: null, joined: false, outcome: 'no invite', joinerHasTile: false };

  const { joined, outcome } = await joinFromInvite(b, inviteUri, { handle, tag: `pair-${joiner.label}` });

  await b.waitForTimeout(1500);
  await gotoKringen(b);
  const joinerHasTile = (await tileNames(b)).some((s) => re.test(s));
  return { inviteUri, joined, outcome, joinerHasTile };
}

// ── tasks ─────────────────────────────────────────────────────────────────────

/** Add a task via the chat composer (`/addtask <text>`). Requires the tasks feature ON. */
export async function addTask(page, text, settle = 4000) {
  await toChat(page);
  await sendChat(page, `/addtask ${text}`, settle);
}

/**
 * Open the Taken (tasks) tab. Returns `{present, rows:[text,…]}`. Polls for rows so a
 * just-synced task has time to land.
 */
export async function openTakenTab(page, { tries = 6, every = 2500 } = {}) {
  const tabs = page.locator('.circle-kring__tab');
  const labels = (await tabs.allTextContents()).map((s) => s.trim());
  const idx = labels.findIndex((s) => /taken|task/i.test(s));
  if (idx < 0) return { present: false, rows: [] };
  await tabs.nth(idx).click();
  await page.waitForTimeout(2500);
  let rows = [];
  for (let i = 0; i < tries; i++) {
    const rowLoc = page.locator('.circle-kring__task');
    const rc = await rowLoc.count();
    rows = [];
    for (let j = 0; j < rc; j++) rows.push((await rowLoc.nth(j).innerText()).replace(/\s+/g, ' ').trim());
    if (rows.length) break;
    await page.waitForTimeout(every);
  }
  return { present: true, rows };
}

/**
 * Claim the first task matching `re` from the Taken tab (clicks its claim chip —
 * "Ik doe ze" / claim, via the shared actionsForStreamRow chips). Returns whether the
 * chip was found + clicked.
 */
export async function claimTask(page, re = /verf|./) {
  const { present } = await openTakenTab(page);
  if (!present) return { claimed: false, reason: 'no Taken tab' };
  const task = page.locator('.circle-kring__task').filter({ hasText: re }).first();
  if (!(await task.count())) return { claimed: false, reason: 'no matching task row' };
  const chip = task.locator('.circle-kring__task-action, .circle-kring__task-actions button').filter({ hasText: /ik doe|claim|oppak|neem/i });
  if (!(await chip.count())) return { claimed: false, reason: 'no claim chip' };
  await chip.first().click();
  await page.waitForTimeout(2000);
  return { claimed: true, reason: 'claim chip clicked' };
}

// ── entrust / mandate ──────────────────────────────────────────────────────────

/**
 * Open the mandate picker on the first task's owner-only "Toevertrouwen" (entrust)
 * chip. Returns `{opened, whoCount, emptyNote, text}` so a spec can assert the WIE
 * (who) list includes the peer (whoCount ≥ 1 && emptyNote === 0). Leaves the picker open.
 */
export async function openMandatePicker(page) {
  // Idempotent: this helper LEAVES the picker open, and a spec may call it and
  // then call entrustFirstMember (which opens again). If a picker is already up,
  // read it in place — re-clicking the Taken tab / entrust chip would be
  // intercepted by the open modal's backdrop (a pointer-events-blocking overlay)
  // and hang until the test times out. Uses the existing selector only.
  if (!(await page.locator('.cc-mandate-picker').count())) {
    const tabs = page.locator('.circle-kring__tab');
    const labels = (await tabs.allTextContents()).map((s) => s.trim());
    const idx = labels.findIndex((s) => /taken|task/i.test(s));
    if (idx >= 0) { await tabs.nth(idx).click(); await page.waitForTimeout(2000); }

    let entrust = page.locator('.circle-kring__bubble-action--mandate, .circle-kring__task-action--mandate, [data-action="mandate"]');
    if (!(await entrust.count())) {
      entrust = page.locator('.circle-kring__task button, .circle-kring__task-action, .circle-kring__bubble-action').filter({ hasText: /toevertrouwen/i });
    }
    if (!(await entrust.count())) return { opened: false, whoCount: 0, emptyNote: 0, text: '(no entrust chip)' };

    await entrust.first().click();
    await page.waitForTimeout(2000);
  }
  const picker = page.locator('.cc-mandate-picker');
  const whoItems = page.locator('.cc-mandate-picker__who-item');
  const whoCount = await whoItems.count();
  const emptyNote = await page.locator('.cc-mandate-picker__empty').count();
  const text = (await picker.count()) ? (await picker.first().innerText()).replace(/\s+/g, ' ').trim() : '(picker not found)';
  return { opened: await picker.count() > 0, whoCount, emptyNote, text };
}

/**
 * Full entrust: open the picker, pick the first WIE (the peer), pick the default
 * WAARVOOR, confirm (through the shared confirm-gate). Returns `{entrusted, whoCount}`.
 */
export async function entrustFirstMember(page) {
  const info = await openMandatePicker(page);
  if (!(info.whoCount >= 1 && info.emptyNote === 0)) return { entrusted: false, whoCount: info.whoCount, info };
  const whoItems = page.locator('.cc-mandate-picker__who-item');
  await whoItems.first().click();
  await page.waitForTimeout(600);
  const whatItems = page.locator('.cc-mandate-picker__what-item');
  if (await whatItems.count()) { await whatItems.first().click(); await page.waitForTimeout(600); }
  const confirm = page.locator('.cc-mandate-picker__confirm');
  const disabled = (await confirm.count()) ? await confirm.first().isDisabled() : true;
  if (await confirm.count() && !disabled) {
    await confirm.first().click();
    await page.waitForTimeout(1500);
    const gate = page.locator('.cc-confirm__ok, .cc-confirm-gate__confirm, button:has-text("Ja"), button:has-text("Bevestig")');
    if (await gate.count()) { await gate.first().click().catch(() => {}); await page.waitForTimeout(2000); }
  }
  await page.waitForTimeout(1000);
  return { entrusted: true, whoCount: info.whoCount, info };
}

// ── surfaces not yet built (Phase 3/4) — reachers for the fixme journeys ────────
// These wrap the INTENDED affordance so the journey documents the target surface.
// They must not guess stable selectors for UI that doesn't exist; where the surface
// is a known placeholder (G16 LEDEN tab, G17 composer slash dispatch), the journey is
// a fixme and these return "not reachable yet" rather than a fabricated success.

/**
 * Open the LEDEN (members) tab. G16: this tab is a PLACEHOLDER today — the roster only
 * lives in the admin panel + mandate picker. Phase 4 builds the real tab with tappable
 * rows. Returns `{present}` based on whether a leden tab exists.
 */
export async function openLedenTab(page) {
  const tabs = page.locator('.circle-kring__tab');
  const labels = (await tabs.allTextContents()).map((s) => s.trim());
  const idx = labels.findIndex((s) => /leden|member/i.test(s));
  if (idx < 0) return { present: false, labels };
  await tabs.nth(idx).click();
  await page.waitForTimeout(1500);
  return { present: true, labels };
}
