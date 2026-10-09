/**
 * hostFrameBar — the one line at the top of a hosted build: "← back to <site>".
 *
 * Paint only: the frame comes from the shell (`src/v2/hostFrame.js` over the build values); no frame, no line.
 * Idempotent: a second call keeps the one line. It sits first in its host, above everything the app paints.
 *
 * @param {HTMLElement} host   where the line lives (prepended)
 * @param {{ frame: { href: string, label: string } | null, t: Function }} a
 * @returns {HTMLElement|null}
 */
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderHostFrame(host, { frame, t } = {}) {
  if (!host || !frame?.href) return null;
  const tr = translatorOr(t, 'hostFrameBar.js');
  let bar = [...host.children].find((el) => el.classList?.contains('cc-host-frame')) ?? null;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'cc-host-frame';
    const link = document.createElement('a');
    link.className = 'cc-host-frame__link';
    bar.appendChild(link);
    host.prepend(bar);
  }
  const link = bar.querySelector('.cc-host-frame__link');
  link.setAttribute('href', frame.href);
  link.textContent = tr('circle.hostFrame.back', { site: frame.label });
  return bar;
}
