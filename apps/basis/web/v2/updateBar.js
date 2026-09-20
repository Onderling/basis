/**
 * updateBar — "there is a newer version of Basis; reload" (2026-09-19).
 *
 * A bar at the top of the app, painted when the shell's version watch (`src/v2/appVersion.js`) finds the site
 * ahead of this tab. One action: reload. Paint only — the shell decides when; this never polls. Idempotent: a
 * second call with a newer tag updates the one bar.
 *
 * @param {HTMLElement} host   where the bar lives (prepended; kept across re-paints)
 * @param {{ served: string, t: Function, onReload: () => void }} a
 */
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderUpdateBar(host, { served, t, onReload } = {}) {
  if (!host) return null;
  const tr = translatorOr(t, 'updateBar.js');
  let bar = [...host.children].find((el) => el.classList?.contains('cc-update')) ?? null;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'cc-update';
    bar.setAttribute('role', 'status');
    const text = document.createElement('span');
    text.className = 'cc-update__text';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cc-update__reload cc-btn';
    btn.textContent = tr('circle.update.reload');
    btn.addEventListener('click', () => { if (typeof onReload === 'function') onReload(); });
    bar.append(text, btn);
    host.prepend(bar);
  }
  bar.querySelector('.cc-update__text').textContent = tr('circle.update.available', { tag: served ?? '' });
  return bar;
}
