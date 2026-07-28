/**
 * basis v2 — paired devices (web DOM renderer, OBJ-2 no-pod sync pairing).
 *
 * The in-app "add a device by its address" screen: show THIS device's shareable
 * address (copyable) and add/remove peers that share this circle's items over the
 * relay/peer transport — no pod. Pure render over injected data + handlers (mirrors
 * `renderContactsRoster`'s shape — no agent, no fetch), so it's unit-testable under
 * happy-dom and the SAME component idea ports to the mobile screen.
 *
 * Handlers `onAdd`/`onRemove` return the updated peer list (string[]); the component
 * re-draws itself from it, so the host doesn't need to re-render the whole settings panel.
 *
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {string}   opts.selfAddr               this device's shareable address.
 * @param {string[]} [opts.peers]                currently-paired peer addresses.
 * @param {Function} opts.t                      translator.
 * @param {(addr:string)=>Promise<string[]>} opts.onAdd     pair a device; resolves to the new list.
 * @param {(addr:string)=>Promise<string[]>} opts.onRemove  unpair a device; resolves to the new list.
 */
import { makePairUri, parsePairUri } from '../../src/core/qrSchemes.js';

export function renderPairedDevices(container, opts = {}) {
  if (!container) return container;
  const { selfAddr = '', t, onAdd, onRemove } = opts;
  const tr = typeof t === 'function' ? t : (k) => k;
  let peers = Array.isArray(opts.peers) ? [...opts.peers] : [];

  const short = (a) => (a && a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

  function draw() {
    container.innerHTML = '';
    container.className = 'cc-paired';

    const intro = document.createElement('p');
    intro.className = 'cc-paired__intro';
    intro.textContent = tr('circle.pairedDevices.intro');
    container.appendChild(intro);

    // ── This device's address (share it with the other device) ──
    const mine = document.createElement('div');
    mine.className = 'cc-paired__mine';
    const mineLabel = document.createElement('label');
    mineLabel.className = 'cc-paired__label';
    mineLabel.textContent = tr('circle.pairedDevices.yourAddr');
    const mineRow = document.createElement('div');
    mineRow.className = 'cc-paired__row';
    const mineInput = document.createElement('input');
    mineInput.type = 'text';
    mineInput.className = 'cc-paired__addr';
    mineInput.readOnly = true;
    mineInput.value = selfAddr;
    mineInput.addEventListener('focus', () => mineInput.select());
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'cc-paired__copy cc-btn cc-btn--quiet';
    copyBtn.textContent = tr('circle.pairedDevices.copy');
    copyBtn.addEventListener('click', async () => {
      try { await navigator?.clipboard?.writeText?.(selfAddr); } catch { mineInput.select(); }
      copyBtn.textContent = tr('circle.pairedDevices.copied');
      setTimeout(() => { copyBtn.textContent = tr('circle.pairedDevices.copy'); }, 1500);
    });
    mineRow.append(mineInput, copyBtn);
    mine.append(mineLabel, mineRow);
    // QR of this device's address — the other device scans it to pair (no typing). Lazy-loads the
    // qrcode lib so it only costs when this panel is open; the copyable text above is the fallback.
    if (selfAddr) {
      const qrUri = makePairUri(selfAddr);
      const canvas = document.createElement('canvas');
      canvas.className = 'cc-paired__qr';
      canvas.width = 200; canvas.height = 200;
      canvas.style.cssText = 'display:block;max-width:200px;margin:8px 0;background:#fff'; // hex-ok: QR scanner contrast
      const qrHint = document.createElement('p');
      qrHint.className = 'cc-paired__qrhint';
      qrHint.textContent = tr('circle.pairedDevices.qrHint');
      mine.append(canvas, qrHint);
      import('qrcode').then((mod) => {
        (mod.default ?? mod).toCanvas(canvas, qrUri, { width: 200, margin: 1, errorCorrectionLevel: 'M' }, () => {});
      }).catch(() => { canvas.remove(); });   // keep the copyable text fallback
    }
    container.appendChild(mine);

    // ── Add a device by address ──
    const addRow = document.createElement('div');
    addRow.className = 'cc-paired__row cc-paired__add';
    const addInput = document.createElement('input');
    addInput.type = 'text';
    addInput.className = 'cc-paired__input';
    addInput.placeholder = tr('circle.pairedDevices.addPlaceholder');
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'cc-paired__addbtn cc-btn cc-btn--quiet';
    addBtn.textContent = tr('circle.pairedDevices.add');
    const err = document.createElement('p');
    err.className = 'cc-paired__err';
    err.hidden = true;
    const submit = async () => {
      // Accept a bare address OR a pasted `onderling-pair://…` URI (the QR's payload).
      const addr = parsePairUri(addInput.value.trim())?.addr;
      if (!addr) return;
      err.hidden = true;
      addBtn.disabled = true;
      try {
        const next = await onAdd?.(addr);
        if (Array.isArray(next)) peers = next;
        else if (!peers.includes(addr)) peers.push(addr);
        addInput.value = '';
        draw();
      } catch {
        err.textContent = tr('circle.pairedDevices.addFailed');
        err.hidden = false;
        addBtn.disabled = false;
      }
    };
    addBtn.addEventListener('click', submit);
    addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    addRow.append(addInput, addBtn);
    container.append(addRow, err);

    // ── Current peers ──
    if (!peers.length) {
      const empty = document.createElement('p');
      empty.className = 'cc-paired__empty';
      empty.textContent = tr('circle.pairedDevices.empty');
      container.appendChild(empty);
      return;
    }
    const list = document.createElement('ul');
    list.className = 'cc-paired__list';
    for (const addr of peers) {
      const li = document.createElement('li');
      li.className = 'cc-paired__peer';
      const code = document.createElement('span');
      code.className = 'cc-paired__peeraddr';
      code.textContent = short(addr);
      code.title = addr;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'cc-paired__remove cc-btn cc-btn--ghost';
      rm.textContent = tr('circle.pairedDevices.remove');
      rm.addEventListener('click', async () => {
        try {
          const next = await onRemove?.(addr);
          peers = Array.isArray(next) ? next : peers.filter((p) => p !== addr);
        } catch { peers = peers.filter((p) => p !== addr); }
        draw();
      });
      li.append(code, rm);
      list.appendChild(li);
    }
    container.appendChild(list);
  }

  draw();
  return container;
}
