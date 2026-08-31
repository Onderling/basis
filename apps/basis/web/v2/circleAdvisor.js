/**
 * basis v2 — circle Advisor (web DOM renderer).
 *
 * Shows the single advice card `computeAdvice` decided to surface (or a
 * calm "nothing to flag" line), plus the member "I'm too busy" button that
 * logs a strain signal. Pure render: the host passes the computed `advice`
 * (or null) + handlers + `t`. No LLM — the rules live in `circleAdvisor`.
 */

import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderCircleAdvisor(container, {
  advice = null,
  t,
  onTooBusy,
  onDismiss,
  onBack,
} = {}) {
  const tr = translatorOr(t, 'circleAdvisor.js');
  container.innerHTML = '';
  container.classList.add('circle-advisor');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'circle-advisor__back';
  back.textContent = tr('circle.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const head = document.createElement('h2');
  head.className = 'circle-advisor__title';
  head.textContent = tr('circle.advisor.title');
  container.appendChild(head);

  if (advice) {
    const card = document.createElement('div');
    card.className = 'circle-advisor__card';
    card.dataset.kind = advice.kind;

    const body = document.createElement('p');
    body.className = 'circle-advisor__advice';
    body.textContent = tr('circle.advisor.advice_too_busy', { count: advice.complaints });
    card.appendChild(body);

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'circle-advisor__dismiss';
    dismiss.textContent = tr('circle.advisor.dismiss');
    dismiss.addEventListener('click', () => { if (typeof onDismiss === 'function') onDismiss(advice); });
    card.appendChild(dismiss);

    container.appendChild(card);
  } else {
    const none = document.createElement('div');
    none.className = 'circle-advisor__none';
    none.textContent = tr('circle.advisor.none');
    container.appendChild(none);
  }

  const busy = document.createElement('button');
  busy.type = 'button';
  busy.className = 'circle-advisor__toobusy';
  busy.textContent = tr('circle.advisor.too_busy_btn');
  busy.addEventListener('click', () => { if (typeof onTooBusy === 'function') onTooBusy(); });
  container.appendChild(busy);

  return container;
}
