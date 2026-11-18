/**
 * THE FIRST OPEN, painted on web: the welcome's title, one line, and the three doors from the shared model
 * (`src/v2/firstOpen.js`). Paint only: the host marks the first open answered and runs what the door asks for.
 * Phone twin: FirstRunWelcomeScreen.js (its doors, on the welcome before the first boot).
 */
import { FIRST_OPEN_DOORS, FIRST_OPEN_WORDS } from '../../src/v2/firstOpen.js';

/**
 * @param {HTMLElement} container
 * @param {{ t: (key: string) => string, onDoor: (id: string) => void, doc?: Document }} p
 * @returns {HTMLElement}
 */
export function renderFirstOpen(container, { t, onDoor, doc = globalThis.document } = {}) {
  if (!container) return container;
  container.innerHTML = '';
  const page = doc.createElement('section');
  page.className = 'circle-first-open';
  const h = doc.createElement('h1');
  h.className = 'circle-first-open__title';
  h.textContent = t(FIRST_OPEN_WORDS.titleKey);
  const lead = doc.createElement('p');
  lead.className = 'circle-first-open__lead';
  lead.textContent = t(FIRST_OPEN_WORDS.leadKey);
  page.append(h, lead);
  for (const door of FIRST_OPEN_DOORS) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `cc-btn ${door.primary ? 'cc-btn--primary' : 'cc-btn--quiet'} circle-first-open__door`;
    b.dataset.door = door.id;
    b.textContent = t(door.labelKey);
    b.addEventListener('click', () => onDoor?.(door.id));
    page.appendChild(b);
  }
  container.appendChild(page);
  return container;
}
