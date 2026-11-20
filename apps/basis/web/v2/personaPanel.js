/**
 * basis v2 — the persona panel (web DOM renderer): what the persona button opens over the tab that is showing. Painted
 * from the shared model (`personaPanelModel`): one tab per persona when the device holds several (the general self
 * first, the picked one marked), the "Laat zien als" door (the switcher: which personas the app shows), and a close.
 * The short view itself (the name with "Aanpassen", "Deel mijn kaart", my devices and helpers) is the host's to paint
 * into the body this returns — the same declared Me the phone paints. Pure render: the host says what each tap does.
 */
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderPersonaPanel(container, { model, t, onTab, onShowAs, onClose } = {}) {
  if (!container || !model) return null;
  const tr = translatorOr(t, 'personaPanel.js');
  container.innerHTML = '';
  container.classList.add('cc-persona-panel');
  if (model.tabs.length > 0) {
    const tabs = document.createElement('div');
    tabs.className = 'cc-persona-panel__tabs';
    tabs.setAttribute('role', 'tablist');
    for (const tab of model.tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `cc-btn cc-btn--quiet cc-persona-panel__tab${tab.active ? ' is-active' : ''}`;
      b.dataset.self = tab.id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(tab.active));
      b.textContent = tab.nameKey ? tr(tab.nameKey) : (tab.name ?? tab.id);
      b.addEventListener('click', () => onTab?.(tab.id));
      tabs.appendChild(b);
    }
    container.appendChild(tabs);
  }
  const body = document.createElement('div');
  body.className = 'cc-persona-panel__body';
  container.appendChild(body);
  const foot = document.createElement('div');
  foot.className = 'cc-persona-panel__foot';
  if (model.showAs) {
    const showAs = document.createElement('button');
    showAs.type = 'button';
    showAs.className = 'cc-btn cc-btn--quiet cc-persona-panel__show-as';
    showAs.textContent = `${tr('circle.switcher.title')} ▸`;
    showAs.addEventListener('click', () => onShowAs?.());
    foot.appendChild(showAs);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'cc-btn cc-btn--quiet cc-persona-panel__close';
  close.textContent = tr('circle.persona_panel.close');
  close.addEventListener('click', () => onClose?.());
  foot.appendChild(close);
  container.appendChild(foot);
  return body;
}
