/**
 * basis v2 — skill match list (web DOM renderer).
 *
 * Renders an INJECTED match list (`buildOfferingMatches`) as one row per match,
 * each carrying a label + a source badge (human / agent / via-hop). The host
 * supplies the matches; no fetching or local discovery happens here. Empty
 * input shows a "no matches" state. Pure render → unit-testable under
 * happy-dom; mirrors circleStream's list renderer.
 */
import { buildOfferingMatches } from '@onderling/kring-host/circleOfferings';
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderOfferingMatches(container, {
  matches = [], t, onBack,
} = {}) {
  const tr = translatorOr(t, 'circleOfferingMatches.js');
  container.innerHTML = '';
  container.classList.add('circle-offering-matches');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-offering-matches__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-offering-matches__title';
  head.textContent = tr('circle.offerings.matches_title');
  container.appendChild(head);

  const rows = buildOfferingMatches({ matches });

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'circle-offering-matches__empty';
    empty.textContent = tr('circle.offerings.no_matches');
    container.appendChild(empty);
    return container;
  }

  const list = document.createElement('div');
  list.className = 'circle-offering-matches__list';
  for (const row of rows) {
    const el = document.createElement('div');
    el.className = 'circle-offering-matches__row';
    el.dataset.matchId = row.id;
    el.dataset.source = row.source;

    const label = document.createElement('span');
    label.className = 'circle-offering-matches__label';
    label.textContent = row.label;
    el.appendChild(label);

    const badge = document.createElement('span');
    badge.className = 'circle-offering-matches__badge';
    badge.dataset.source = row.source;
    badge.textContent = tr(`circle.offerings.source.${row.source}`);
    el.appendChild(badge);

    list.appendChild(el);
  }
  container.appendChild(list);

  return container;
}
