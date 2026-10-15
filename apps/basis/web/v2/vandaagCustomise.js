/**
 * "Pas aan" — the customise sheet for the active Vandaag page, painted from the shared model (`customiseModel` in
 * src/v2/vandaag.js). Every control reports an act (`onAct(act, args)`); the host turns it into the screen op it is
 * (`customiseOp`) and repaints. Nothing here changes the book itself. Mobile twin: VandaagCustomiseModal.js.
 */
import { translatorOr } from '../../src/locales/translatorOr.js';

/**
 * @param {HTMLElement} container
 * @param {object} a
 * @param {object} a.model                       customiseModel(book)
 * @param {(key: string, p?: object) => string} a.t
 * @param {(act: string, args: object) => void} a.onAct
 * @param {() => void} a.onClose
 * @returns {HTMLElement}
 */
export function renderVandaagCustomise(container, { model, t, onAct, onClose } = {}) {
  const tr = translatorOr(t, 'vandaagCustomise.js');
  container.innerHTML = '';
  container.classList.add('vandaag-customise');
  const h = document.createElement('h3');
  h.textContent = tr('circle.vandaag.customise_title');
  container.appendChild(h);
  if (!model) return container;
  const button = (label, act, args, extra = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cc-btn cc-btn--quiet';
    b.textContent = label;
    b.dataset.act = act;
    if (extra.disabled) b.disabled = true;
    b.addEventListener('click', () => onAct?.(act, args));
    return b;
  };

  // the page's blocks, in order: move, remove, and each one's settings
  const blocksTitle = document.createElement('h4');
  blocksTitle.textContent = tr('circle.vandaag.blocks_title');
  container.appendChild(blocksTitle);
  for (const b of model.blocks) {
    const row = document.createElement('div');
    row.className = 'vandaag-customise__block';
    row.dataset.blockId = b.blockId;
    const name = document.createElement('strong');
    name.textContent = tr(b.labelKey);
    row.appendChild(name);
    const base = { pageId: model.pageId, blockId: b.blockId, index: b.index };
    row.appendChild(button(tr('circle.vandaag.up'), 'up', base, { disabled: !b.canUp }));
    row.appendChild(button(tr('circle.vandaag.down'), 'down', base, { disabled: !b.canDown }));
    row.appendChild(button(tr('circle.vandaag.remove'), 'remove', base));
    for (const c of b.controls) {
      const sel = document.createElement('select');
      sel.dataset.control = c.kind;
      for (const o of c.options) {
        const opt = document.createElement('option');
        opt.value = String(o.value);
        opt.textContent = tr(o.labelKey, o.params);
        if (o.value === c.value) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => {
        const picked = c.options.find((o) => String(o.value) === sel.value);
        if (picked) onAct?.('config', { ...base, kind: c.kind, value: picked.value });
      });
      row.appendChild(sel);
    }
    container.appendChild(row);
  }

  // what can be added: the block table's own for the person's pages, each with its sentence
  const addTitle = document.createElement('h4');
  addTitle.textContent = tr('circle.vandaag.add_block_title');
  container.appendChild(addTitle);
  for (const a of model.addable) {
    const row = document.createElement('div');
    row.className = 'vandaag-customise__addable';
    row.appendChild(button(tr(a.labelKey), 'add', { pageId: model.pageId, type: a.type }));
    const why = document.createElement('span');
    why.textContent = tr(a.descriptionKey);
    row.appendChild(why);
    container.appendChild(row);
  }

  // the page: rename it, add one, remove it (not the last), undo the newest change
  const pageTitle = document.createElement('h4');
  pageTitle.textContent = tr('circle.vandaag.page_title');
  container.appendChild(pageTitle);
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = model.pageName;
  nameInput.dataset.role = 'page-name';
  container.appendChild(nameInput);
  const rename = document.createElement('button');
  rename.type = 'button';
  rename.className = 'cc-btn cc-btn--quiet';
  rename.dataset.act = 'rename-page';
  rename.textContent = tr('circle.vandaag.rename_page');
  rename.addEventListener('click', () => onAct?.('rename-page', { pageId: model.pageId, name: nameInput.value }));
  container.appendChild(rename);
  container.appendChild(button(tr('circle.vandaag.add_page'), 'add-page', { name: tr('circle.vandaag.new_page_name') }));
  container.appendChild(button(tr('circle.vandaag.remove_page'), 'remove-page', { pageId: model.pageId }, { disabled: !model.canRemovePage }));
  container.appendChild(button(tr('circle.vandaag.undo'), 'undo', {}));
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'cc-btn cc-btn--primary';
  done.dataset.act = 'done';
  done.textContent = tr('circle.vandaag.done');
  done.addEventListener('click', () => onClose?.());
  container.appendChild(done);
  return container;
}
