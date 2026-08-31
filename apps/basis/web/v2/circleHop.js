/**
 * basis v2 — hopping (web DOM renderer).
 *
 * A device-global hop stance toggle (backed by Stoop's getHopMode /
 * setHopMode) plus, when a relay chain is supplied, a hop-match card
 * (Me → gate → target) with an "ask the gate to relay" action gated on the
 * max-one-hop limit. Pure render: the host passes `hopMode` + optional
 * `chain` + handlers + `t`. Unit-testable under happy-dom.
 */

import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderCircleHop(container, {
  hopMode = { global: false },
  chain = null,
  t,
  onToggleGlobal,
  onAskRelay,
  onBack,
} = {}) {
  const tr = translatorOr(t, 'circleHop.js');
  container.innerHTML = '';
  container.classList.add('circle-hop');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-hop__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-hop__title';
  head.textContent = tr('circle.hop.title');
  container.appendChild(head);

  // Global stance toggle.
  const row = document.createElement('label');
  row.className = 'circle-hop__global';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !!hopMode.global;
  box.dataset.field = 'global';
  box.addEventListener('change', () => { if (typeof onToggleGlobal === 'function') onToggleGlobal(box.checked); });
  const span = document.createElement('span');
  span.textContent = tr('circle.hop.global_label');
  row.append(box, span);
  container.appendChild(row);

  const explain = document.createElement('p');
  explain.className = 'circle-hop__explain';
  explain.textContent = tr('circle.hop.explain');
  container.appendChild(explain);

  // Hop-match card (only when a chain is supplied).
  if (chain && Array.isArray(chain.steps) && chain.steps.length) {
    const card = document.createElement('div');
    card.className = 'circle-hop__chain';
    card.dataset.withinLimit = chain.withinLimit ? 'true' : 'false';

    const path = document.createElement('div');
    path.className = 'circle-hop__path';
    chain.steps.forEach((s, i) => {
      if (i > 0) {
        const arrow = document.createElement('span');
        arrow.className = 'circle-hop__arrow';
        arrow.textContent = ' → ';
        path.appendChild(arrow);
      }
      const step = document.createElement('span');
      step.className = 'circle-hop__step';
      step.dataset.role = s.role;
      step.textContent = s.label || s.id || '';
      path.appendChild(step);
    });
    card.appendChild(path);

    if (chain.withinLimit) {
      const ask = document.createElement('button');
      ask.type = 'button';
      ask.className = 'circle-hop__ask';
      ask.textContent = tr('circle.hop.ask_relay');
      ask.addEventListener('click', () => { if (typeof onAskRelay === 'function') onAskRelay(chain); });
      card.appendChild(ask);
    } else {
      const over = document.createElement('div');
      over.className = 'circle-hop__overlimit';
      over.textContent = tr('circle.hop.over_limit');
      card.appendChild(over);
    }
    container.appendChild(card);
  }

  return container;
}
