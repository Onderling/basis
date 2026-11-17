/**
 * THE INTRODUCTION, painted on web: one card per screen from the shared model (`src/v2/introDeck.js`), "Next" (the
 * last card: "Get started") and "Skip". Paint only: which card, its words and its buttons come from the model; the
 * host decides what closing means (Today again). Phone twin: IntroDeckModal.js.
 */
import { introStep, introNext } from '../../src/v2/introDeck.js';

/**
 * @param {{ container: HTMLElement, t: (key: string, vars?: object) => string, onClose?: () => void, doc?: Document }} p
 * @returns {HTMLElement}
 */
export function renderIntroDeck({ container, t, onClose, doc = globalThis.document } = {}) {
  if (!container) return container;
  let index = 0;
  const done = () => onClose?.();
  const paint = () => {
    const step = introStep(index);
    container.innerHTML = '';
    container.classList.add('circle-intro');
    container.dataset.card = step.id;
    const pos = doc.createElement('p');
    pos.className = 'circle-intro__position';
    pos.textContent = t('circle.introDeck.position', { at: step.position.at, of: step.position.of });
    const h = doc.createElement('h2');
    h.className = 'circle-intro__title';
    h.textContent = t(step.titleKey);
    const body = doc.createElement('p');
    body.className = 'circle-intro__body';
    body.textContent = t(step.bodyKey);
    const next = doc.createElement('button');
    next.type = 'button';
    next.className = 'cc-btn cc-btn--primary circle-intro__next';
    next.textContent = t(step.nextKey);
    next.addEventListener('click', () => {
      const n = introNext(index);
      if (n === null) { done(); return; }
      index = n;
      paint();
    });
    container.append(pos, h, body, next);
    // "Skip" under each card but the last (there "Get started" already leaves)
    if (!step.isLast) {
      const skip = doc.createElement('button');
      skip.type = 'button';
      skip.className = 'cc-btn cc-btn--quiet circle-intro__skip';
      skip.textContent = t(step.skipKey);
      skip.addEventListener('click', done);
      container.appendChild(skip);
    }
    next.focus?.();
  };
  paint();
  return container;
}
