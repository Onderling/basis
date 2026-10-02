/**
 * screenShell — the web app opened as a SCREEN for a household bot (a `/scherm` link), instead of the person's app.
 *
 * Composition and paint only; what a screen does is `src/v2/screenView.js`. The order is the safety:
 *   - the link is read, and its secret is removed from the address bar at once (only the bot's address stays, so a
 *     reload finds the kept grant) — it is never logged;
 *   - the page says WHICH bot, and that this browser keeps the key (Telegram's own window forgets it);
 *   - NOTHING is sent until the person taps "Koppel dit scherm" — a preview service that opens the page sends nothing;
 *   - then the code, to compare with the one the bot shows in their private chat, and their yes there;
 *   - then the ops this screen may do, for now as a plain list (painting them as forms comes next).
 */
import { makeBrowserScreenAgent } from '../../src/web/screenAgent.js';
import { initLocalisation, t, detectDeviceLang } from '../../src/index.js';
import { createScreenView, screenAddressFor } from '../../src/v2/screenView.js';

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
  try { win.history.replaceState(null, '', win.location.pathname + win.location.search + (link.ok ? screenAddressFor(link.botAddress) : '')); } catch { /* cosmetic */ }

  const root = el('main', { class: 'screen-shell', 'data-screen': 'shell' });
  document.body.replaceChildren(root);
  const say = (...nodes) => root.replaceChildren(el('h1', {}, t('circle.connectScreen.title')), ...nodes);

  if (!link.ok) { say(el('p', { 'data-screen': 'invalid' }, t('circle.connectScreen.not_a_link'))); return; }
  const bot = link.botName ?? `${link.botAddress.slice(0, 10)}…`;

  const showOps = () => {
    const rows = view.ops().map((op) => {
      const out = el('span', { class: 'screen-result' });
      const run = el('button', { type: 'button', 'data-op': op, onclick: async () => {
        out.textContent = '…';
        try { const r = await view.call(op, {}); out.textContent = r?.message ?? (r?.ok === false ? String(r?.error?.message ?? r?.error ?? '') : '✓'); } catch (e) { out.textContent = String(e?.message ?? e); }
      } }, t('circle.connectScreen.run'));
      return el('li', {}, el('code', {}, op), ' ', run, ' ', out);
    });
    say(el('p', { 'data-screen': 'connected' }, t('circle.connectScreen.connected', { bot })), el('ul', {}, ...rows));
  };

  // a later visit: the kept grant, back on the relay — no pairing
  if (link.resumeOnly) {
    try { if (await view.resume()) { showOps(); return; } } catch { /* falls through to "not valid" */ }
    say(el('p', { 'data-screen': 'invalid' }, t('circle.connectScreen.not_a_link')));
    return;
  }

  const tap = el('button', { type: 'button', 'data-screen': 'connect', onclick: async () => {
    tap.disabled = true;
    try {
      const { code } = await view.connect({ label: t('circle.connectScreen.label') });
      say(el('p', { 'data-screen': 'code' }, t('circle.connectScreen.code', { bot })), el('p', { class: 'screen-code', 'data-code': code }, code), el('p', {}, t('circle.connectScreen.waiting')));
      await view.granted();
      showOps();
    } catch (e) {
      say(el('p', { 'data-screen': 'failed' }, t('circle.connectScreen.failed', { reason: String(e?.message ?? e) })));
    }
  } }, t('circle.connectScreen.connect'));
  say(el('p', {}, t('circle.connectScreen.which_bot', { bot })), el('p', {}, t('circle.connectScreen.own_browser')), tap);
}
