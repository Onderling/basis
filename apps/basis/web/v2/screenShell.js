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
import { createScreenView, screenAddressFor } from '../../src/v2/screenView.js';
import { screenPanelsForGrant } from '../../src/v2/screenPaint.js';
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
  const answerOf = (r) => {
    if (r?.ok === false) return String(r?.error?.message ?? r?.error ?? '');
    if (typeof r?.message === 'string' && r.message) return r.message;
    const items = Array.isArray(r?.items) ? r.items : (Array.isArray(r?.entries) ? r.entries : null);
    if (items) return items.length ? items.map((i, n) => `${n + 1}. ${i?.label ?? i?.text ?? i?.title ?? i?.name ?? ''}`).join('\n') : t('circle.connectScreen.empty');
    return '✓';
  };

  const showOps = () => {
    keepBotAddress();   // connected: a reload finds the kept grant
    const panels = screenPanelsForGrant(view.ops(), t);
    const sections = panels.map((panel) => el('section', { 'data-section': panel.section },
      el('h2', {}, panel.title),
      ...panel.items.map((item) => {
        const out = el('div', { class: 'screen-result', role: 'status', 'data-result-op': item.opId });
        const area = el('div', { class: 'screen-form' });
        const run = async (args) => {
          // the op's own confirm, here: the surface asks (the waist does not)
          if (confirmApplies(item.confirm, args) && !win.confirm(t(item.confirm.messageKey ?? '') || item.confirm.message || t('circle.connectScreen.sure'))) return;
          out.textContent = '…';
          try { out.textContent = answerOf(await view.call(item.skill, args)); } catch (e) { out.textContent = String(e?.message ?? e); }
        };
        const open = el('button', { type: 'button', 'data-op': item.skill, onclick: () => {
          if (!item.needsForm) { run({}); return; }
          const spec = buildFormSpec({ opParams: item.params, missing: item.params.filter((q) => q?.required).map((q) => q.name), prefilledArgs: {}, opId: item.opId, appOrigin: item.appOrigin });
          area.replaceChildren(renderForm(spec, { doc: document, t, onSubmit: (values) => { area.replaceChildren(); run(values); }, onCancel: () => area.replaceChildren() }));
        } }, item.label);
        return el('div', { class: 'screen-op' }, open, area, out);
      })));
    say(el('p', { 'data-screen': 'connected' }, t('circle.connectScreen.connected', { bot })), ...sections);
  };
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
