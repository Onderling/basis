/**
 * basis v2 — the header avatar (web DOM renderer): top-right on every tab, the active persona's picture or its
 * initials; a tap opens the person's own editor. Pure render — the host loads the avatar (`loadPersonaAvatar`), opens
 * the picture with its own opener, and says what a tap does.
 */
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderHeaderAvatar(container, { avatar = null, pictureUrl = null, t, onOpen } = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'headerAvatar.js');
  container.innerHTML = '';
  container.className = 'cc-header-avatar';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cc-btn cc-btn--quiet cc-header-avatar__button';
  b.setAttribute('aria-label', tr('circle.profile.avatar_label'));
  if (avatar?.name) b.title = avatar.name;
  if (pictureUrl) {
    const img = document.createElement('img');
    img.className = 'cc-header-avatar__picture';
    img.src = pictureUrl;
    img.alt = avatar?.name ?? '';
    b.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.className = 'cc-header-avatar__initials';
    span.textContent = avatar?.initials ?? '?';
    b.appendChild(span);
  }
  if (typeof onOpen === 'function') b.addEventListener('click', () => onOpen());
  container.appendChild(b);
  return container;
}
