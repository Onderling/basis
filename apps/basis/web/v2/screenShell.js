/**
 * screenShell — the web app opened as a SCREEN for a household bot (a `/scherm` link), instead of the person's app.
 *
 * Composition and paint only; what a screen does is `src/v2/screenView.js`. The order is the safety:
 *   - the link is read, and its secret is removed from the address bar at once (only the bot's address stays, so a
 *     reload finds the kept grant) — it is never logged;
 *   - the page says WHICH bot, and that this browser keeps the key (Telegram's own window forgets it);
 *   - NOTHING is sent until the person taps "Koppel dit scherm" — a preview service that opens the page sends nothing;
 *   - then the code, which the person PICKS from three in their private chat with the bot;
 *   - then the ops this screen may do, grouped as `/help` groups them, each a button — a form when it has params, the
 *     op's own confirm where it declares one (`src/v2/screenPaint.js`).
 */
import { makeBrowserScreenAgent } from '../../src/web/screenAgent.js';
import { initLocalisation, t, detectDeviceLang } from '../../src/index.js';
import { createScreenView, screenAddressFor, HOUSEHOLD_SETTLE_MS } from '../../src/v2/screenView.js';
import { screenPanelsForGrant, screenReplies, screenPickerFetcher, screenActionForm } from '../../src/v2/screenPaint.js';
import { readHousehold } from '../../src/v2/screenHousehold.js';
import { buildFormSpec } from '../../src/forms/buildFormSpec.js';
import { renderForm } from '../../src/web/domForm.js';
import { confirmApplies } from '../../src/confirmApplies.js';
import { SCREEN_STEP_UP_OUTCOMES, SCREEN_STEP_UP_UNANSWERED } from '../../src/v2/screenStepUp.js';

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k === 'onclick') n.addEventListener('click', v); else n.setAttribute(k, v); }
  for (const k of kids) n.append(k);
  return n;
};

/** Boot the screen instead of the app. */
export async function startScreenShell(win = window) {
  await initLocalisation({ lng: detectDeviceLang() });
  const view = createScreenView({
    link: win.location.href,
    makeAgent: makeBrowserScreenAgent,
    storage: win.localStorage,
  });
  const link = view.link;
  // the link's secret leaves the address bar before anything else happens; the bot's address stays for a reload
  const keepBotAddress = () => { try { win.history.replaceState(null, '', win.location.pathname + win.location.search + (link.ok ? screenAddressFor(link.botAddress) : '')); } catch { /* cosmetic */ } };
  // a link's secret leaves the address bar at once; the paste route's address holds none, and stays until the grant
  if (!link.pasteMode) keepBotAddress();

  const root = el('main', { class: 'screen-shell', 'data-screen': 'shell' });
  document.body.replaceChildren(root);
  const say = (...nodes) => root.replaceChildren(el('h1', {}, t('circle.connectScreen.title')), ...nodes);

  if (!link.ok) { say(el('p', { 'data-screen': 'invalid' }, t('circle.connectScreen.not_a_link'))); return; }
  // the name is the link's own claim (unauthenticated): the address's first characters stand beside it
  const bot = link.botName ? `${link.botName} (${link.botAddress.slice(0, 8)}…)` : `${link.botAddress.slice(0, 10)}…`;

  // what an op answered, in words: its message, or the entries it read, or a tick
  // the door's refusal of too many calls at once, in words (the kernel's word for it is a code)
  // the bot's refusals in words: too many calls, or this screen's grant replaced or taken away (paired again elsewhere,
  // or disconnected) — what to do about it, not the token's state
  const inWords = (msg) => (/rate-limited/.test(String(msg)) ? t('circle.connectScreen.rate_limited')
    : /revoked|INVALID_TOKEN/i.test(String(msg)) ? t('circle.connectScreen.revoked') : String(msg));
  // a pick-list's read says the same words when it is refused
  const pickCall = (skill, args) => view.call(skill, args).catch((e) => { throw new Error(inWords(e?.message ?? e)); });
  const answerOf = (r) => {
    if (r?.ok === false) return inWords(r?.error?.message ?? r?.error ?? '');
    if (typeof r?.message === 'string' && r.message) return r.message;
    const items = Array.isArray(r?.items) ? r.items : (Array.isArray(r?.entries) ? r.entries : null);
    if (items) return items.length ? items.map((i, n) => `${n + 1}. ${i?.label ?? i?.text ?? i?.title ?? i?.name ?? ''}`).join('\n') : t('circle.connectScreen.empty');
    return '✓';
  };

  // The household itself: its lists with their lines and each line's actions, read again after an action (or a nudge)
  const household = el('section', { 'data-section': 'household' });
  const householdSaid = el('p', { class: 'screen-result', role: 'status', 'data-household': 'said' });
  // one read at a time: a paint asked for while one runs is done once, after it (a quick series of taps is one read)
  let painting = null;
  let again = false;
  const paintHousehold = () => {
    if (painting) { again = true; return painting; }
    painting = readAndPaint().finally(() => { painting = null; if (again) { again = false; paintHousehold(); } });
    return painting;
  };
  // after a menu's tap or a nudge, wait a moment: a series of taps (the settings, one after another) is one read after
  // the last, inside the bot's per-screen call budget — a read of the household costs a call per list
  let soon = null;
  const paintSoon = () => { win.clearTimeout(soon); soon = win.setTimeout(() => { soon = null; paintHousehold(); }, HOUSEHOLD_SETTLE_MS); };
  const readAndPaint = async () => {
    let h;
    try { h = await readHousehold({ call: (skill, args) => view.call(skill, args), ops: view.ops(), t }); } catch (e) { householdSaid.textContent = inWords(e?.message ?? e); return; }
    if (!h.lists.length && !h.people) { household.replaceChildren(); return; }
    const run = async (skill, args, confirm) => {
      if (confirmApplies(confirm, args) && !win.confirm(t(confirm.messageKey ?? '') || confirm.message || t('circle.connectScreen.sure'))) return;
      householdSaid.textContent = '…';
      try { householdSaid.textContent = answerOf(await view.call(skill, args)); } catch (e) { householdSaid.textContent = inWords(e?.message ?? e); }
      await paintHousehold();
    };
    // a row's action: run it — or, when its op asks more than the row knows, its form with the row filled in
    const act = (a, area) => {
      const more = screenActionForm(a.skill, a.args);
      if (!more || !area) return run(a.skill, a.args, a.confirm);
      const spec = buildFormSpec({ opParams: more.params, missing: more.missing, prefilledArgs: more.prefilled, opId: more.opId, appOrigin: more.appOrigin });
      const pickerFetcher = screenPickerFetcher({ call: pickCall, ops: () => view.ops(), appOrigin: more.appOrigin });
      area.replaceChildren(renderForm(spec, { doc: document, t, pickerFetcher, onSubmit: (values) => { area.replaceChildren(); run(a.skill, { ...more.prefilled, ...values }, a.confirm); }, onCancel: () => area.replaceChildren() }));
    };
    household.replaceChildren(
      el('h2', {}, t('circle.connectScreen.household')),
      el('button', { type: 'button', 'data-screen': 'refresh', onclick: () => paintHousehold() }, t('circle.connectScreen.refresh')),
      householdSaid,
      ...h.lists.map((l) => el('div', { class: 'screen-list', 'data-list': l.title },
        el('h3', {}, l.title),
        l.items.length
          ? el('ul', {}, ...l.items.map((i) => {
            const form = el('div', { class: 'screen-form' });
            return el('li', { 'data-line': i.id, ...(i.done ? { class: 'done' } : {}) },
              el('span', {}, i.label), ' ',
              ...i.actions.map((a) => el('button', { type: 'button', 'data-action': a.skill, onclick: () => act(a, form) }, a.label)), form);
          }))
          : el('p', {}, t('circle.connectScreen.list_empty')))),
      // the people: the one read's rows, each with its own actions (a role asks which, a removal asks the yes in the chat)
      ...(h.people ? [el('h3', {}, t('circle.connectScreen.people')), el('ul', { 'data-household': 'people' }, ...h.people.map((p) => {
        const form = el('div', { class: 'screen-form' });
        return el('li', { 'data-person': p.id },
          el('span', {}, `${p.label} — ${p.role ?? '?'}`), ' ',
          ...p.actions.map((a) => el('button', { type: 'button', 'data-action': a.skill, onclick: () => act(a, form) }, a.label)), form);
      }))] : []),
    );
  };

  // ONE live tab per screen: every tab of this browser holds the same key, and two relay connections under one key
  // answer each other's handshakes (and the newest pairing supersedes the older tab's grant). The newest tab claims the
  // screen; an older one lets go and says so, with a way to take it back (a reload resumes the newest kept grant).
  const tabId = Math.random().toString(36).slice(2);
  const tabs = typeof win.BroadcastChannel === 'function' ? new win.BroadcastChannel(`onderling-screen-${link.botAddress ?? ''}`) : null;
  const claimScreen = () => { try { tabs?.postMessage({ claim: tabId }); } catch { /* one tab only */ } };
  if (tabs) {
    tabs.onmessage = async (e) => {
      if (!e?.data?.claim || e.data.claim === tabId) return;
      await view.stop();
      const back = el('button', { type: 'button', 'data-screen': 'take-back', onclick: () => win.location.reload() }, t('circle.connectScreen.take_back'));
      say(el('p', { 'data-screen': 'elsewhere' }, t('circle.connectScreen.elsewhere')), back);
    };
  }

  const showOps = () => {
    keepBotAddress();   // connected: a reload finds the kept grant
    claimScreen();
    const panels = screenPanelsForGrant(view.ops(), t);
    const sections = panels.map((panel) => el('section', { 'data-section': panel.section },
      el('h2', {}, panel.title),
      ...panel.items.map((item) => {
        const out = el('div', { class: 'screen-result', role: 'status', 'data-result-op': item.opId });
        const area = el('div', { class: 'screen-form' });
        const replies = el('div', { class: 'screen-replies' });
        // one call of the screen's: the op's own confirm (the surface asks; the waist does not), then its token
        const call = async (skill, args, confirm, writes = item.writes) => {
          if (confirmApplies(confirm, args) && !win.confirm(t(confirm.messageKey ?? '') || confirm.message || t('circle.connectScreen.sure'))) return;
          out.textContent = '…';
          replies.replaceChildren();
          let r;
          try { r = await view.call(skill, args); out.textContent = answerOf(r); } catch (e) { out.textContent = inWords(e?.message ?? e); return; }
          if (writes) paintSoon();
          // the answer's own buttons (a menu): only those the screen resolves to an op it holds a token for
          replies.replaceChildren(...screenReplies(r, view.ops()).map((b) => el('button', { type: 'button', 'data-reply': b.skill, onclick: () => call(b.skill, b.args, b.confirm, true) }, b.label)));
        };
        const run = (args) => call(item.skill, args, item.confirm);
        const open = el('button', { type: 'button', 'data-op': item.skill, onclick: () => {
          if (!item.needsForm) { run({}); return; }
          const spec = buildFormSpec({ opParams: item.params, missing: item.params.filter((q) => q?.required).map((q) => q.name), prefilledArgs: {}, opId: item.opId, appOrigin: item.appOrigin });
          // a field with a declared source is picked from what this screen may read, not typed as an id
          const pickerFetcher = screenPickerFetcher({ call: pickCall, ops: () => view.ops(), appOrigin: item.appOrigin });
          area.replaceChildren(renderForm(spec, { doc: document, t, pickerFetcher, onSubmit: (values) => { area.replaceChildren(); run(values); }, onCancel: () => area.replaceChildren() }));
        } }, item.label);
        return el('div', { class: 'screen-op' }, open, area, out, replies);
      })));
    say(el('p', { 'data-screen': 'connected' }, t('circle.connectScreen.connected', { bot })), household, ...sections);
    paintHousehold();
  };
  // the bot's nudge: something in the household changed — read it again (as this person, through the gate)
  view.onNudge(() => { if (household.isConnected) paintSoon(); });
  // what became of a request that waited for a yes in the person's own chat: said on that op's own line
  view.onNotice(({ outcome, op }) => {
    if (!SCREEN_STEP_UP_OUTCOMES.includes(outcome) && outcome !== SCREEN_STEP_UP_UNANSWERED) return;
    const at = [...root.querySelectorAll('[data-result-op]')].find((n) => n.getAttribute('data-result-op') === op);
    if (at) { at.textContent = t(`circle.connectScreen.stepup_${outcome}`); at.setAttribute('data-outcome', outcome); }
  });


  // a later visit: the kept grant, back on the relay — no pairing
  if (link.resumeOnly) {
    try { if (await view.resume()) { showOps(); return; } } catch { /* falls through to "not valid" */ }
    say(el('p', { 'data-screen': 'invalid' }, t('circle.connectScreen.not_a_link')));
    return;
  }

  // a phone puts the browser away while the person is in Telegram: back in front, the waiting page says it is there
  // (that releases a grant the bot held for it)
  win.document.addEventListener('visibilitychange', () => { if (win.document.visibilityState === 'visible') view.stillHere(); });

  // opened inside Telegram: the button there was the tap — connect at once, with what Telegram signed
  if (link.launchMode) {
    say(el('p', { 'data-screen': 'launching' }, t('circle.connectScreen.launching', { bot })));
    try {
      await view.connect({ label: t('circle.connectScreen.label') });
      await view.granted();
      showOps();
    } catch (e) {
      const why = e?.message === 'refused' ? 'launch_refused' : (e?.message === 'timed-out' ? 'timed_out' : null);
      say(why ? el('p', { 'data-screen': why }, t(`circle.connectScreen.${why}`))
        : el('p', { 'data-screen': 'failed' }, t('circle.connectScreen.failed', { reason: String(e?.message ?? e) })));
    }
    return;
  }

  const tap = el('button', { type: 'button', 'data-screen': 'connect', onclick: async () => {
    tap.disabled = true;
    try {
      const { code, offer } = await view.connect({ label: t('circle.connectScreen.label') });
      // the paste route: this screen's own connect code, for the person to paste into their chat with the bot
      const paste = offer ? [
        el('p', {}, t('circle.connectScreen.paste_this')),
        el('textarea', { readonly: 'readonly', rows: '3', 'data-offer': offer, class: 'screen-offer' }, `/koppel-scherm ${offer}`),
        el('button', { type: 'button', onclick: () => { try { win.navigator.clipboard?.writeText(`/koppel-scherm ${offer}`); } catch { /* select it by hand */ } } }, t('circle.connectScreen.copy')),
      ] : [];
      say(...paste, el('p', { 'data-screen': 'code' }, t('circle.connectScreen.code', { bot })), el('p', { class: 'screen-code', 'data-code': code }, code), el('p', {}, t('circle.connectScreen.waiting')));
      await view.granted();
      showOps();
    } catch (e) {
      const why = e?.message === 'refused' ? 'refused' : (e?.message === 'timed-out' ? 'timed_out' : null);
      say(why ? el('p', { 'data-screen': why }, t(`circle.connectScreen.${why}`))
        : el('p', { 'data-screen': 'failed' }, t('circle.connectScreen.failed', { reason: String(e?.message ?? e) })));
    }
  } }, t('circle.connectScreen.connect'));
  say(el('p', {}, t('circle.connectScreen.which_bot', { bot })), el('p', {}, t('circle.connectScreen.own_browser')), tap);
}
