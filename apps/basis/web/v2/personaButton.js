/**
 * basis v2 — the persona button (web DOM renderer): top-right on every tab, the active persona's picture or its
 * initials; a tap opens the persona panel over the tab. Beside it, the settings button (a gear) opens the settings home
 * from anywhere. Pure render — the host loads the avatar (`loadPersonaAvatar`), opens the picture with its own opener,
 * and says what each tap does.
 */
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderPersonaButton(container, { avatar = null, pictureUrl = null, t, onOpen, onSettings } = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'personaButton.js');
  container.innerHTML = '';
  container.className = 'cc-persona-button';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cc-btn cc-btn--quiet cc-persona-button__button';
  b.setAttribute('aria-label', tr('circle.persona_button.label'));
  if (avatar?.name) b.title = avatar.name;
  if (pictureUrl) {
    const img = document.createElement('img');
    img.className = 'cc-persona-button__picture';
    img.src = pictureUrl;
    img.alt = avatar?.name ?? '';
    b.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.className = 'cc-persona-button__initials';
    span.textContent = avatar?.initials ?? '?';
    b.appendChild(span);
  }
  if (typeof onOpen === 'function') b.addEventListener('click', () => onOpen());
  // the settings button, left of the persona button
  if (typeof onSettings === 'function') {
    const gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'cc-btn cc-btn--quiet cc-persona-button__settings';
    gear.textContent = '⚙';
    gear.title = tr('circle.persona_button.settings');
    gear.setAttribute('aria-label', tr('circle.persona_button.settings'));
    gear.addEventListener('click', () => onSettings());
    container.appendChild(gear);
  }
  container.appendChild(b);
  return container;
}
