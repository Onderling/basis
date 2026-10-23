/**
 * basis v2 — the "Copy log / report a problem" screen (web DOM renderer).
 *
 * A thin projector: the text is `logReportView` (src/log/logReport.js), which the mobile shell paints too.
 * The person sees exactly what Copy puts on the clipboard; nothing is sent from here.
 */

import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderLogReport(container, { text = '', n = 0, t, onBack, win = globalThis } = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'logReport.js');
  container.innerHTML = '';
  container.classList.add('cc-logreport');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'cc-btn cc-btn--quiet cc-logreport__back';
  back.textContent = tr('circle.back_mydata');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.textContent = tr('circle.logReport.title');
  container.appendChild(head);

  const note = document.createElement('p');
  note.className = 'cc-logreport__note';
  note.textContent = tr(n ? 'circle.logReport.intro' : 'circle.logReport.empty');
  container.appendChild(note);

  const pre = document.createElement('pre');
  pre.className = 'cc-logreport__text';
  pre.textContent = text;
  container.appendChild(pre);

  const said = document.createElement('span');
  said.className = 'cc-logreport__copied';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'cc-btn cc-logreport__copy';
  copy.textContent = tr('circle.logReport.copy');
  copy.addEventListener('click', async () => {
    try { await win.navigator.clipboard.writeText(text); said.textContent = tr('circle.logReport.copied'); }
    catch { /* no clipboard here: the text above can be selected by hand */ }
  });
  container.appendChild(copy);
  container.appendChild(said);
  return container;
}
