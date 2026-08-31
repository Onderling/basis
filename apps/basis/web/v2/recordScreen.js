/**
 * recordScreen — web renderer for a `shape:'record'` manifest view,
 * e.g. the agents app's read-only `agent-detail` (`viewAgent` +
 * `argsFromContext: {agentId: '$agentId'}`).
 *
 * DOM-only glue (invariant #1): the record itself is extracted from the
 * skill reply by shared `src/v2/screenDrilldown.js` (`recordFromReply`);
 * this module just lays the key→value pairs out as a definition list.
 * No new user-facing strings — the empty state reuses the panel's
 * existing `circle.screen.empty` key (invariant #8).
 */

import { translatorOr } from '../../src/locales/translatorOr.js';
export function renderRecordScreen(container, { record, t } = {}) {
  const tr = translatorOr(t, 'recordScreen.js');
  container.innerHTML = '';
  container.classList.add('record-screen');
  if (!record || typeof record !== 'object') {
    const empty = document.createElement('p');
    empty.className = 'record-screen__empty';
    empty.textContent = tr('circle.screen.empty');
    container.appendChild(empty);
    return container;
  }
  const dl = document.createElement('dl');
  dl.className = 'record-screen__fields';
  for (const [key, value] of Object.entries(record)) {
    const dt = document.createElement('dt');
    dt.className = 'record-screen__key';
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.className = 'record-screen__value';
    dd.textContent = value == null
      ? '—'
      : (typeof value === 'object' ? JSON.stringify(value) : String(value));
    dl.append(dt, dd);
  }
  container.appendChild(dl);
  return container;
}
