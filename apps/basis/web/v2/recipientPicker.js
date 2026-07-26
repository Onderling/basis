/**
 * basis v2 — out-of-circle recipient picker (web DOM renderer, objective L · Phase 2).
 *
 * A THIN DOM projection over the SHARED `pickableRecipients` selector (invariant #1): given the Contacten
 * roster it lists the contacts that carry a published network key, and selecting one hands the caller the
 * recipient row — which the host wires straight into `shareItemToPublishedKey({ recipient: row.id,
 * recipientNetworkKey: row.recipientNetworkKey })`. No share/seal logic lives here; the selector + the op
 * are shared, this file is platform DOM only (web≡mobile: RN mirrors the SAME selector).
 */
import { pickableRecipients, outOfCircleLinkWarning } from '../../src/v2/shareRecipients.js';

export function renderRecipientPicker(container, {
  contacts = [],
  itemId = null,
  t,
  onPick,
  onCancel,
  busy = false,
  notice = null,
} = {}) {
  if (!container) return container;
  const tr = typeof t === 'function' ? t : (k) => k;
  container.innerHTML = '';
  container.className = 'cc-recipient-picker';

  const header = document.createElement('div');
  header.className = 'cc-recipient-picker__header';
  const title = document.createElement('h3');
  title.className = 'cc-recipient-picker__title';
  title.textContent = tr('circle.share.to_person_heading');
  header.appendChild(title);
  if (typeof onCancel === 'function') {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cc-recipient-picker__cancel';
    cancel.textContent = tr('circle.share.pick_cancel');
    cancel.addEventListener('click', () => onCancel());
    header.appendChild(cancel);
  }
  container.appendChild(header);

  if (notice) {
    const n = document.createElement('div');
    n.className = 'cc-recipient-picker__notice';
    n.textContent = notice;
    container.appendChild(n);
  }

  // The one shared selector — the ONLY logic; the rest is DOM.
  const recipients = pickableRecipients(contacts);

  if (!recipients.length) {
    const empty = document.createElement('p');
    empty.className = 'cc-recipient-picker__empty';
    empty.textContent = tr('circle.share.no_contacts');
    container.appendChild(empty);
    return container;
  }

  // D7 — the out-of-circle LINK warning. Picking here grants by published network key, which is a
  // deliberate 1:1 link both sides can see; say so BEFORE the pick. Informed consent, never a block —
  // the rule (warn iff the pick grants by network key) lives in the shared selector, not here.
  const linkWarning = outOfCircleLinkWarning(recipients);
  if (linkWarning) {
    const w = document.createElement('p');
    w.className = 'cc-recipient-picker__link-warning';
    w.textContent = tr(linkWarning.key);
    container.appendChild(w);
  }

  const list = document.createElement('ul');
  list.className = 'cc-recipient-picker__list';
  for (const r of recipients) {
    const li = document.createElement('li');
    li.className = 'cc-recipient-picker__contact';
    li.dataset.recipient = r.id;
    li.dataset.networkKey = r.recipientNetworkKey;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cc-recipient-picker__pick';
    btn.disabled = !!busy;

    const name = document.createElement('span');
    name.className = 'cc-recipient-picker__name';
    name.textContent = r.name;
    btn.appendChild(name);

    // Light attestation (Phase-3 flavour): show the trust level when the contact carries one.
    if (r.trustLevel != null) {
      const trust = document.createElement('span');
      trust.className = 'cc-recipient-picker__trust';
      trust.dataset.trust = String(r.trustLevel);
      trust.textContent = tr(`circle.share.trust.${r.trustLevel}`);
      btn.appendChild(trust);
    }

    // Selecting a contact hands the host the recipient row → shareItemToPublishedKey.
    btn.addEventListener('click', () => { if (typeof onPick === 'function') onPick(r, { itemId }); });
    li.appendChild(btn);
    list.appendChild(li);
  }
  container.appendChild(list);
  return container;
}
