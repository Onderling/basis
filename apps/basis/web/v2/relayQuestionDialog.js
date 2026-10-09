/**
 * basis v2 — the relay question (web presenter).
 *
 * Asked when this device knows no relay and the person does something that needs one (the shared
 * `createRelayQuestion` decides WHEN; this only asks). Same overlay pattern as `confirmDialog.js`: inline layout,
 * `.cc-btn` classes, backdrop + ESC = "Later". The typed value is checked with the shared `normalizeRelayUrl`; the
 * host saves it through the relay setting, so nothing here stores anything.
 */
import { normalizeRelayUrl } from '../../src/v2/relayPref.js';

/**
 * @param {HTMLElement} container
 * @param {object} args
 * @param {(key: string) => string} args.t
 * @param {(url: string|null) => void} args.onResolve  called exactly once: the relay to save, or null for "Later"
 */
export function renderRelayQuestionDialog(container, { t, onResolve } = {}) {
  const resolved = typeof onResolve === 'function' ? onResolve : () => {};
  container.innerHTML = '';
  container.classList.add('cc-relay-question');
  Object.assign(container.style, {
    position: 'fixed', inset: '0', zIndex: '210',
    background: 'rgba(0,0,0,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '16px',
  });

  let settled = false;
  function settle(url) {
    if (settled) return;
    settled = true;
    try { document.removeEventListener('keydown', onKeydown); } catch { /* defensive */ }
    try { resolved(url || null); } catch { /* the host decides */ }
  }
  function onKeydown(e) {
    if (e?.key === 'Escape') { e.preventDefault(); settle(null); }
  }
  document.addEventListener('keydown', onKeydown);
  container.addEventListener('click', (e) => { if (e.target === container) settle(null); });

  const sheet = document.createElement('div');
  sheet.className = 'cc-relay-question__sheet';
  Object.assign(sheet.style, {
    background: 'var(--card, #fff)',
    border: '1px solid var(--line, #ddd)',
    borderRadius: 'var(--radius, 10px)',
    padding: '18px 20px',
    maxWidth: '420px', width: '100%',
    boxShadow: '0 8px 28px rgba(0,0,0,.20)',
  });
  sheet.addEventListener('click', (e) => e.stopPropagation());

  const title = document.createElement('h2');
  title.textContent = t('circle.settings.relayAsk_title');
  title.style.cssText = 'margin: 0 0 8px; font-size: 17px;';
  sheet.appendChild(title);

  const body = document.createElement('p');
  body.textContent = t('circle.settings.relayAsk_body');
  body.style.cssText = 'margin: 0 0 12px; font-size: 14px; line-height: 1.45;';
  sheet.appendChild(body);

  const input = document.createElement('input');
  input.type = 'url';
  input.className = 'cc-relay-question__input';
  input.placeholder = t('circle.settings.relayEndpoint_placeholder');
  input.style.cssText = 'width: 100%; box-sizing: border-box; margin: 0 0 6px;';
  sheet.appendChild(input);

  const error = document.createElement('p');
  error.className = 'cc-relay-question__error';
  error.style.cssText = 'margin: 0 0 10px; font-size: 13px; color: var(--danger, #a33); min-height: 1em;';
  sheet.appendChild(error);

  const footer = document.createElement('div');
  footer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px;';

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'cc-relay-question__later cc-btn cc-btn--quiet';
  later.textContent = t('circle.settings.relayAsk_later');
  later.addEventListener('click', () => settle(null));
  footer.appendChild(later);

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'cc-relay-question__save cc-btn cc-btn--primary';
  save.textContent = t('circle.settings.relayAsk_save');
  const trySave = () => {
    const url = normalizeRelayUrl(input.value);
    if (!url) { error.textContent = t('circle.settings.relayAsk_invalid'); return; }
    settle(url);
  };
  save.addEventListener('click', trySave);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); trySave(); } });
  footer.appendChild(save);

  sheet.appendChild(footer);
  container.appendChild(sheet);
  try { input.focus(); } catch { /* non-interactive env */ }
  return container;
}
