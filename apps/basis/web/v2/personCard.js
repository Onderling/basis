/**
 * personCard — a card the person's clock shows them (their week on Saturday morning). Paint only: the shared op
 * builds the card (`personWeekOverview.js`); this puts it at the top of the app until it is closed. One card at a
 * time: a newer one replaces it.
 *
 * @param {HTMLElement} host
 * @param {{ title: string, lines: string[], note: string }} card
 * @param {{ t: Function }} a
 */
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderPersonCard(host, card, { t } = {}) {
  if (!host || !card) return null;
  const tr = translatorOr(t, 'personCard.js');
  [...host.children].find((el) => el.classList?.contains('cc-person-card'))?.remove();
  const box = document.createElement('section');
  box.className = 'cc-person-card';
  box.setAttribute('role', 'status');
  const h = document.createElement('h2');
  h.className = 'cc-person-card__title';
  h.textContent = card.title ?? '';
  const ul = document.createElement('ul');
  ul.className = 'cc-person-card__lines';
  for (const line of card.lines?.length ? card.lines : [tr('circle.profile.planned_none')]) {
    const li = document.createElement('li');
    li.textContent = line;
    ul.appendChild(li);
  }
  const note = document.createElement('p');
  note.className = 'cc-person-card__note';
  note.textContent = card.note ?? '';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'cc-person-card__close cc-btn';
  close.textContent = tr('circle.profile.week_card_close');
  close.addEventListener('click', () => box.remove());
  box.append(h, ul, note, close);
  host.prepend(box);
  return box;
}
