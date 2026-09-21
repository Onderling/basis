/**
 * shareMyContact — the Mij panel that hands out THIS person's contact (2026-09-19).
 *
 * Three forms of the one card, so the person picks what fits the moment: a QR for a phone camera in the room, the
 * raw `onderling-contact://` code for a paste box, and a LINK for anything with a browser at the other end —
 * `https://onderling.org/basis/#contact=…` opens the app with the contact added (the fragment never reaches a
 * server). This is paint only: the host resolves the card (`getContactShareQr`) and the link (`contactCardLink`);
 * a missing card is said, not guessed. Mobile paints the same three forms on its Mij screen (owed; the shared
 * helpers are in `src/v2/contactCardLink.js`).
 *
 * @param {HTMLElement} container
 * @param {object} a
 * @param {string|null} a.payload   the `onderling-contact://…` card, or null when none could be made
 * @param {string|null} a.link      the clickable form, or null when the app has no http(s) url (a file:// dev shell)
 * @param {string|null} [a.qr]      what the QR encodes — the link when there is one, else the code (the loader decides)
 * @param {Function} a.t
 * @param {() => void} a.onBack
 */
import { translatorOr } from '../../src/locales/translatorOr.js';

export function renderShareMyContact(container, { payload = null, link = null, qr = null, t, onBack } = {}) {
  if (!container) return container;
  const tr = translatorOr(t, 'shareMyContact.js');
  container.innerHTML = '';
  container.className = 'cc-share';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'cc-share__back cc-btn cc-btn--quiet';
  back.textContent = tr('circle.shareContact.back');
  back.addEventListener('click', () => { if (typeof onBack === 'function') onBack(); });
  container.appendChild(back);

  const title = document.createElement('h2');
  title.className = 'cc-share__title';
  title.textContent = tr('circle.shareContact.title');
  container.appendChild(title);

  if (!payload) {
    const err = document.createElement('p');
    err.className = 'cc-share__error';
    err.textContent = tr('circle.shareContact.error');
    container.appendChild(err);
    return container;
  }

  const hint = document.createElement('p');
  hint.className = 'cc-share__hint';
  hint.textContent = tr('circle.shareContact.hint');
  container.appendChild(hint);

  // The QR: the LINK when there is one — a phone's camera opens it in the browser, where the app adds the contact;
  // the in-app scanner reads it too. Else the raw code (only the in-app scanner reads that). Drawn lazily by the
  // qrcode lib — the copyable rows below are the fallback when it cannot load. A card-length link is ~650 bytes:
  // 260px at level L keeps the modules ~3px on a laptop screen, which a phone camera reads; 220px/M was ~2px.
  const qrValue = qr ?? payload;
  const canvas = document.createElement('canvas');
  canvas.className = 'cc-share__qr';
  canvas.dataset.encodes = qrValue === link ? 'link' : 'code';
  canvas.width = 260; canvas.height = 260;
  canvas.style.cssText = 'display:block;max-width:260px;margin:8px 0;background:#fff'; // hex-ok: QR scanner contrast
  container.appendChild(canvas);
  import('qrcode').then((mod) => {
    (mod.default ?? mod).toCanvas(canvas, qrValue, { width: 260, margin: 1, errorCorrectionLevel: 'L' }, () => {});
  }).catch(() => { canvas.remove(); });

  const copyRow = (cls, value, label) => {
    const row = document.createElement('div');
    row.className = `cc-share__row ${cls}`;
    const lab = document.createElement('span');
    lab.className = 'cc-share__label';
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.value = value;
    input.className = 'cc-share__value';
    input.addEventListener('focus', () => input.select());
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'cc-share__copy cc-btn cc-btn--quiet';
    copy.textContent = tr('circle.pairedDevices.copy');
    copy.addEventListener('click', () => {
      try { navigator.clipboard?.writeText(value); } catch { /* the input stays selectable */ }
      copy.textContent = tr('circle.pairedDevices.copied');
      setTimeout(() => { copy.textContent = tr('circle.pairedDevices.copy'); }, 1500);
    });
    row.append(lab, input, copy);
    return row;
  };
  container.appendChild(copyRow('cc-share__code', payload, tr('circle.shareContact.code_label')));
  if (link) container.appendChild(copyRow('cc-share__link', link, tr('circle.shareContact.link_label')));
  return container;
}
